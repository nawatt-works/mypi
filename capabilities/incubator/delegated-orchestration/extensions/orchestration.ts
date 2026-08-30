import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { herdrCallerContext, isHerdrSession, runHerdr, withHerdrBlocked } from "@nawatt-works/mypi-herdr-integration/client";
import {
	assuranceMet,
	createWorkerRegistry,
	normalizeWorkerName,
	type ArtifactRef,
	type WorkerRecord,
	type WorkerRegistry,
	type WorktreeRef,
	type AssuranceLevel,
	type AssuranceState,
} from "./orchestration-registry.ts";
import { WORKER_SESSION_PREFIX, workerSessionName } from "@nawatt-works/mypi-runtime-mode";
import {
	defaultWorkerRuntimeRoot,
	initializeWorkerMachine,
	listProviderCredentials,
	loadProviderCredential,
	recoverWorkerMachine,
	rotateWorkerCredential,
	verifyWorkerMachine,
	type ProviderCredentialInfo,
	type WorkerMachineManifest,
} from "./worker-machine-setup.ts";

const PREVIEW_TOOL = "mypi_preview_worker";
const SPAWN_TOOL = "mypi_spawn_worker";
const HANDOFF_TOOL = "mypi_handoff";
const COLLECT_TOOL = "mypi_collect";
const WAIT_TOOL = "mypi_wait_worker";
const ASSURANCE_TOOL = "mypi_set_assurance";
const ORCHESTRATION_TOOLS = [PREVIEW_TOOL, SPAWN_TOOL, HANDOFF_TOOL, COLLECT_TOOL, WAIT_TOOL, ASSURANCE_TOOL];

const SPAWN_TIMEOUT_MS = 60_000;
const SPAWN_RETRIES = 4;
const SHELL_SETTLE_MS = 1_500;
const DEFAULT_PROMPT_TIMEOUT_MS = 600_000;
const DEFAULT_WAIT_TIMEOUT_MS = 900_000;
const MODE_ENTRY = "mypi-orchestrate-mode";
const WORKER_MACHINE_ENTRY = "mypi-worker-machine-setup";
const WORKER_ACCEPTANCE_ENTRY = "mypi-worker-generated-profile-acceptance";
const WORKER_ACCEPTANCE_RUNNER = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tests", "agent-teams-acceptance-runner.mjs");

/**
 * Harness kinds come from the installed Herdr binary, never from a list kept
 * here: the enum changes between releases and a stale copy would reject a kind
 * that works or accept one that does not.
 */
export function parseAgentKinds(helpText: string): string[] {
	const match = helpText.match(/possible values:\s*([^\]]+)\]/);
	if (!match) return [];
	return match[1]
		.split(",")
		.map((kind) => kind.trim())
		.filter(Boolean);
}

export type EvidenceItem = {
	description: string;
	satisfied: boolean;
	/** Agreed deliverables are required; corroborating signals are not. */
	required: boolean;
	detail?: string;
};

export type EvidenceVerdict = {
	complete: boolean;
	items: EvidenceItem[];
};

/**
 * A Worker is believed only on evidence that exists outside its own report.
 * Every agreed artifact has to verify: a Worker whose state moved but whose
 * deliverable is missing has not done the work. Lifecycle signals corroborate,
 * they never substitute — a probe showed `prompt --wait` reporting success both
 * for a turn that died on a provider error and for a correction that never
 * reached the agent.
 */
export function evaluateEvidence(items: EvidenceItem[]): EvidenceVerdict {
	const required = items.filter((item) => item.required);
	return { complete: required.length > 0 && required.every((item) => item.satisfied), items };
}

function describeWorker(worker: WorkerRecord): string {
	const identity = worker.observedKind
		? `${worker.observedKind} (${worker.identity}, ${worker.identityEvidence})`
		: `unknown (${worker.identityEvidence})`;
	const artifacts = worker.artifacts.length
		? worker.artifacts.map((artifact) => `    - ${artifact.kind}: ${artifact.value} — ${artifact.purpose}`).join("\n")
		: "    - ยังไม่มี artifact ที่บันทึกไว้";
	return [
		`- ${worker.name} [${worker.status}]`,
		`    task: ${worker.task}`,
		`    requested: ${worker.requestedHarness} / observed: ${identity}`,
		`    pane: ${worker.paneId ?? "-"}  cwd: ${worker.cwd ?? "-"}${worker.worktree ? `  worktree: ${worker.worktree.path}` : ""}`,
		artifacts,
	].join("\n");
}

/**
 * Pi puts its session name in the terminal title, so a Coordinator can confirm
 * from outside that a Worker really started in worker mode.
 */
async function agentSessionName(pi: ExtensionAPI, name: string): Promise<string | undefined> {
	const result = await runHerdr(pi, ["agent", "get", name]);
	const agent = (result.result as { agent?: { terminal_title?: string } } | undefined)?.agent;
	return agent?.terminal_title;
}

async function agentStatus(pi: ExtensionAPI, name: string): Promise<{ status?: string; seq?: number }> {
	const result = await runHerdr(pi, ["agent", "get", name]);
	const agent = (result.result as { agent?: { agent_status?: string; state_change_seq?: number } } | undefined)?.agent;
	return { status: agent?.agent_status, seq: agent?.state_change_seq };
}

async function pathExists(target: string): Promise<{ exists: boolean; detail: string }> {
	try {
		const stats = await stat(target);
		return { exists: stats.size > 0, detail: `${stats.size} bytes, modified ${stats.mtime.toISOString()}` };
	} catch (error) {
		return { exists: false, detail: error instanceof Error ? error.message : String(error) };
	}
}

async function gitRefExists(pi: ExtensionAPI, cwd: string, ref: string): Promise<{ exists: boolean; detail: string }> {
	try {
		const result = await pi.exec("git", ["rev-parse", "--verify", "--quiet", ref], { cwd, timeout: 10_000 });
		const sha = result.stdout.trim();
		return { exists: result.code === 0 && sha.length > 0, detail: sha || result.stderr.trim() || "ไม่พบ ref" };
	} catch (error) {
		return { exists: false, detail: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The repository a worktree was created from. Needed because closing a Worker's
 * pane also closes the Herdr workspace the worktree opened, after which only
 * Git can still remove the checkout.
 */
async function worktreeSourceRepo(pi: ExtensionAPI, path: string): Promise<string | undefined> {
	try {
		const result = await pi.exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
			cwd: path,
			timeout: 10_000,
		});
		const commonDir = result.stdout.trim();
		if (result.code !== 0 || !commonDir) return undefined;
		return dirname(commonDir);
	} catch {
		return undefined;
	}
}

async function worktreeState(
	pi: ExtensionAPI,
	path: string,
): Promise<{ exists: boolean; dirty: number; head?: string; detail?: string }> {
	try {
		const status = await pi.exec("git", ["status", "--porcelain"], { cwd: path, timeout: 10_000 });
		if (status.code !== 0) {
			return { exists: false, dirty: 0, detail: status.stderr.trim() || `git exited with ${status.code}` };
		}
		const head = await pi.exec("git", ["log", "-1", "--format=%h %s"], { cwd: path, timeout: 10_000 });
		const dirty = status.stdout.split("\n").filter((line) => line.trim().length > 0).length;
		return { exists: true, dirty, head: head.stdout.trim() || undefined };
	} catch (error) {
		return { exists: false, dirty: 0, detail: error instanceof Error ? error.message : String(error) };
	}
}

export type HarnessRunSettings = {
	args: string[];
	/** Settings this harness has no known flag for; never silently dropped. */
	unsupported: string[];
};

/**
 * Translate a requested model and effort into the flags a harness actually
 * takes. There is no machine-readable source for this, so the table is small
 * and deliberately incomplete: an unknown harness reports the setting as
 * unsupported rather than being started with something other than what the
 * approval dialog showed.
 */
export function harnessRunSettings(
	kind: string,
	model?: string,
	effort?: string,
): HarnessRunSettings {
	const args: string[] = [];
	const unsupported: string[] = [];

	// A phrase like "inherit default" is a description, not an identifier. Pi
	// hangs on an unmatched `--model` rather than failing fast, so the spawn
	// would only surface as a startup timeout a minute later.
	for (const [label, value] of [["model", model], ["effort", effort]] as const) {
		if (value !== undefined && /\s/.test(value.trim() === "" ? " " : value)) {
			throw new Error(
				`${label} "${value}" ไม่ใช่ identifier — ใส่ค่าที่ harness รับจริงเช่น gpt-5.6-terra ` +
				"หรือเว้นว่างไว้เพื่อสืบทอดค่า default",
			);
		}
	}

	if (model) {
		if (kind === "pi" || kind === "claude" || kind === "codex") args.push("--model", model);
		else unsupported.push(`model (${kind})`);
	}
	if (effort) {
		if (kind === "pi") args.push("--thinking", effort);
		else if (kind === "claude") args.push("--effort", effort);
		else if (kind === "codex") args.push("-c", `model_reasoning_effort="${effort}"`);
		else unsupported.push(`effort (${kind})`);
	}
	return { args, unsupported };
}

/** What a Pi Worker inherits when the Coordinator names no model of its own. */
async function piDefaults(
	pi: ExtensionAPI,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
	try {
		const agentDirectory = environment.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
		const raw = await readFile(resolve(agentDirectory, "settings.json"), "utf8");
		const parsed = JSON.parse(raw) as {
			defaultProvider?: string;
			defaultModel?: string;
			defaultThinkingLevel?: string;
		};
		if (!parsed.defaultModel) return undefined;
		const provider = parsed.defaultProvider ? `${parsed.defaultProvider}/` : "";
		const thinking = parsed.defaultThinkingLevel ? `, thinking ${parsed.defaultThinkingLevel}` : "";
		return `${provider}${parsed.defaultModel}${thinking}`;
	} catch {
		return undefined;
	}
}

export type OrchestrateMode = "automatic" | "off";

export type OrchestrateCommand =
	| { kind: "show" }
	| { kind: "set"; mode: OrchestrateMode }
	| { kind: "invalid" };

export function parseOrchestrateCommand(args: string): OrchestrateCommand {
	const value = args.trim().toLowerCase();
	if (value === "" || value === "status") return { kind: "show" };
	if (value === "automatic" || value === "on") return { kind: "set", mode: "automatic" };
	if (value === "off") return { kind: "set", mode: "off" };
	return { kind: "invalid" };
}

export function restoreOrchestrateMode(entries: readonly unknown[]): OrchestrateMode {
	let mode: OrchestrateMode = "automatic";
	for (const rawEntry of entries) {
		const entry = rawEntry as { type?: string; customType?: string; data?: { mode?: unknown } };
		if (entry.type !== "custom" || entry.customType !== MODE_ENTRY) continue;
		if (entry.data?.mode === "automatic" || entry.data?.mode === "off") mode = entry.data.mode;
	}
	return mode;
}

/**
 * Told to the model at the start of every turn inside Herdr, because the role
 * itself must not be locked behind a skill trigger: a session that never
 * considers delegating never loads the skill that would have told it it could.
 */
export function buildOrchestrationGuidance(
	mode: OrchestrateMode,
	workers: readonly WorkerRecord[],
): string {
	if (mode === "off") return "";

	const live = workers.filter((worker) => worker.status !== "gone");
	if (live.length > 0) {
		const roster = live
			.map((worker) => `- ${worker.name} [${worker.status}] — ${worker.task.split("\n")[0].slice(0, 80)}`)
			.join("\n");
		return [
			"## Workers you are coordinating",
			"",
			roster,
			"",
			`You stay on the critical path for these. Verify results with \`${COLLECT_TOOL}\` against the artifacts`,
			"you agreed on; a Worker's own summary is never evidence. Send corrections back to the same Worker",
			`with \`${HANDOFF_TOOL}\`, and wait with \`${WAIT_TOOL}\` rather than re-reading panes.`,
		].join("\n");
	}

	return [
		"## Coordinating other agents",
		"",
		"This session runs inside Herdr and can put other coding agents to work in their own panes.",
		"Authority is fixed: the user decides who joins and approves every result, you coordinate and stay",
		"on the critical path, and a Worker only executes one bounded assignment without making design",
		"decisions of its own.",
		"",
		"Before substantial work, judge whether any lane is genuinely separable: a lane that shortens the",
		"critical path, context worth isolating, a harness better suited to a bounded part, or a fresh",
		"reviewer the risk calls for. If one holds, propose the smallest team with that reason and let the",
		`user approve it — read the \`herdr-orchestration\` skill first, then \`${PREVIEW_TOOL}\`. If none holds,`,
		"do the work yourself and do not raise delegation at all.",
	].join("\n");
}

function describeAssurance(state: AssuranceState): string {
	const met = assuranceMet(state);
	const verified = state.verifiedBy.length ? state.verifiedBy.join(", ") : "ยังไม่มี";
	const producer = state.producedBy;
	if (met) return `assurance: ${state.level} — เพียงพอแล้ว (ตรวจผ่านจาก ${verified})`;
	if (state.level === "human-approval") {
		return `assurance: human-approval — ต้องให้ผู้ใช้อนุมัติผลก่อนถือว่าจบ (ตรวจผ่านจาก ${verified})`;
	}
	if (state.level === "independent-review") {
		return `assurance: independent-review — งานนี้ผลิตโดย ${producer} จึงต้องมีตัวอื่นตรวจผ่าน (ตรวจผ่านจาก ${verified})`;
	}
	return `assurance: ${state.level} — ยังไม่มีหลักฐานที่ตรวจผ่าน`;
}

export default function orchestration(pi: ExtensionAPI): void {
	const registry: WorkerRegistry = createWorkerRegistry(pi);
	let mode: OrchestrateMode = "automatic";

	function setToolsEnabled(enabled: boolean): void {
		const active = pi.getActiveTools();
		const next = enabled
			? [...active, ...ORCHESTRATION_TOOLS.filter((name) => !active.includes(name))]
			: active.filter((name) => !ORCHESTRATION_TOOLS.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	}

	async function supportedKinds(): Promise<string[]> {
		const help = await runHerdr(pi, ["agent", "start", "--help"]);
		return parseAgentKinds(help.output);
	}

	function requireHerdr(): void {
		if (!isHerdrSession()) {
			throw new Error("Pi ไม่ได้รันอยู่ใต้ Herdr จึงสร้างหรือควบคุม Worker ไม่ได้");
		}
	}

	pi.on("session_start", (_event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		registry.restore(branch);
		mode = restoreOrchestrateMode(branch);
		// Outside Herdr there is nothing to orchestrate; keep normal sessions clean.
		setToolsEnabled(isHerdrSession());
	});

	pi.registerCommand("mypi-worker-setup", {
		description: "สร้าง ตรวจ หรือหมุนเวียน private Worker machine profile โดยไม่รับ secret ผ่าน command arguments",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/mypi-worker-setup ใช้ได้เฉพาะ interactive TUI เพื่อป้องกัน credential projection ผ่าน non-interactive channel", "error");
				return;
			}
			const action = (typeof args === "string" ? args.trim() : "") || "setup";
			if (!new Set(["setup", "verify", "rotate", "recover"]).has(action)) {
				ctx.ui.notify("ใช้ /mypi-worker-setup [setup|verify|rotate|recover] และห้ามส่ง path หรือ secret เป็น argument", "warning");
				return;
			}
			const sourceAgentDir = process.env.PI_CODING_AGENT_DIR;
			if (!sourceAgentDir || !isAbsolute(sourceAgentDir)) {
				ctx.ui.notify("PI_CODING_AGENT_DIR ต้องเป็น absolute path ของ profile ที่กำลังรัน ห้าม fallback ไป Default Pi", "error");
				return;
			}
			const runtimeRoot = defaultWorkerRuntimeRoot();
			let credentials: ProviderCredentialInfo[];
			try {
				credentials = await listProviderCredentials(sourceAgentDir);
			} catch (error) {
				ctx.ui.notify(`อ่าน credential metadata ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			if (credentials.length === 0) {
				ctx.ui.notify("profile นี้ไม่มี stored provider credential ให้ project แบบ file-backed", "error");
				return;
			}
			const preferred = ctx.model ? credentials.find((entry) => entry.providerId === ctx.model?.provider) : undefined;
			let selected = preferred;
			if (!selected || credentials.length > 1) {
				const value = await ctx.ui.select(
					"เลือก provider credential ที่จะ project ให้ Workers (ไม่แสดงค่า secret)",
					credentials.map((entry) => `${entry.providerId} (${entry.type})`),
				);
				if (!value) return;
				selected = credentials.find((entry) => value === `${entry.providerId} (${entry.type})`);
			}
			if (!selected) {
				ctx.ui.notify("เลือก provider credential ไม่สำเร็จ", "error");
				return;
			}
			let verifiedExisting: WorkerMachineManifest | undefined;
			for (const candidate of credentials) {
				const result = await verifyWorkerMachine({ runtimeRoot, sourceAgentDir, providerId: candidate.providerId });
				if (result.verified && result.manifest) {
					verifiedExisting = result.manifest;
					break;
				}
			}
			if (action === "recover") {
				const receipt = [...ctx.sessionManager.getBranch()].reverse().find((entry) =>
					entry.type === "custom" && entry.customType === "mypi-worker-machine-setup" &&
					(entry.data as { runtimeRoot?: unknown }).runtimeRoot === runtimeRoot &&
					(entry.data as { providerId?: unknown }).providerId === selected.providerId
				) as { data?: { setupDigest?: unknown } } | undefined;
				const expectedSetupDigest = receipt?.data?.setupDigest;
				if (typeof expectedSetupDigest !== "string") {
					ctx.ui.notify("session นี้ไม่มี trusted Worker machine receipt สำหรับ recovery ห้ามเชื่อ digestจาก runtimeเอง", "error");
					return;
				}
				const approved = await ctx.ui.confirm(
					"กู้ Worker machine rotation ที่ค้าง?",
					`provider: ${selected.providerId}\nruntime: ${runtimeRoot}\ntrusted setup receipt: ${expectedSetupDigest}\n\nกู้เฉพาะ signed one-step transaction และไม่แสดง credential`,
				);
				if (!approved) return;
				try {
					const manifest = await recoverWorkerMachine({ runtimeRoot, sourceAgentDir, providerId: selected.providerId, expectedSetupDigest });
					pi.appendEntry("mypi-worker-machine-setup", {
						action, providerId: manifest.providerId, credentialType: manifest.credentialType,
						credentialRevision: manifest.credentialRevision, runtimeRoot: manifest.runtimeRoot, setupDigest: manifest.setupDigest,
					});
					ctx.ui.notify(`Worker machine recovery verified\nrevision: ${manifest.credentialRevision}\nsetup: ${manifest.setupDigest}`, "info");
				} catch (error) {
					ctx.ui.notify(`Worker machine recovery ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}
			if (action === "verify") {
				if (!verifiedExisting) {
					ctx.ui.notify(`Worker machine ที่ ${runtimeRoot} ไม่มี verified authority state`, "error");
					return;
				}
				pi.appendEntry(WORKER_MACHINE_ENTRY, {
					action,
					providerId: verifiedExisting.providerId,
					credentialType: verifiedExisting.credentialType,
					credentialRevision: verifiedExisting.credentialRevision,
					runtimeRoot: verifiedExisting.runtimeRoot,
					setupDigest: verifiedExisting.setupDigest,
				});
				ctx.ui.notify(`Worker machine verified\nprovider: ${verifiedExisting.providerId} (${verifiedExisting.credentialType})\nrevision: ${verifiedExisting.credentialRevision}\nsetup: ${verifiedExisting.setupDigest}`, "info");
				return;
			}
			if (verifiedExisting && verifiedExisting.providerId !== selected.providerId) {
				ctx.ui.notify(`Worker machineผูกกับ ${verifiedExisting.providerId}; ห้ามเปลี่ยน providerด้วย setup/rotate เดิม`, "error");
				return;
			}
			if (action === "rotate" && !verifiedExisting) {
				ctx.ui.notify("ยังไม่มี verified Worker machine ให้ rotate", "error");
				return;
			}
			const verb = action === "rotate" ? "หมุนเวียน" : verifiedExisting ? "ตรวจและคง" : "สร้าง";
			const approved = await ctx.ui.confirm(
				`${verb} Worker credential projection?`,
				`provider: ${selected.providerId} (${selected.type})\nsource profile: ${sourceAgentDir}\nruntime: ${runtimeRoot}\n\nค่ credential จะไม่เข้า argv, environment, audit หรือ worktree`,
			);
			if (!approved) return;
			try {
				const credential = await loadProviderCredential(sourceAgentDir, selected.providerId);
				const manifest = action === "rotate"
					? await rotateWorkerCredential({
						runtimeRoot,
						sourceAgentDir,
						providerId: selected.providerId,
						expectedSetupDigest: verifiedExisting!.setupDigest,
						credential,
					})
					: await initializeWorkerMachine({ runtimeRoot, sourceAgentDir, providerId: selected.providerId, credential });
				pi.appendEntry("mypi-worker-machine-setup", {
					action,
					providerId: manifest.providerId,
					credentialType: manifest.credentialType,
					credentialRevision: manifest.credentialRevision,
					runtimeRoot: manifest.runtimeRoot,
					setupDigest: manifest.setupDigest,
				});
				ctx.ui.notify(`Worker machineพร้อมใช้งานใน incubator\nprovider: ${manifest.providerId} (${manifest.credentialType})\nrevision: ${manifest.credentialRevision}\nsetup: ${manifest.setupDigest}\nproduction activation: disabled`, "info");
			} catch (error) {
				ctx.ui.notify(`Worker machine setup ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("mypi-worker-acceptance", {
		description: "รัน disposable real-provider acceptance ผ่าน generated Worker profile โดย production ยัง disabled",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/mypi-worker-acceptance ใช้ได้เฉพาะ interactive Development Pi session", "error");
				return;
			}
			if ((typeof args === "string" ? args.trim() : "") !== "") {
				ctx.ui.notify("/mypi-worker-acceptance ไม่รับ arguments, paths, digests หรือ credentials", "warning");
				return;
			}
			const sourceAgentDir = process.env.PI_CODING_AGENT_DIR;
			if (!sourceAgentDir || !isAbsolute(sourceAgentDir) || !ctx.model) {
				ctx.ui.notify("ต้องรันจาก Development Pi profile ที่มี explicit PI_CODING_AGENT_DIR และ active model", "error");
				return;
			}
			const runtimeRoot = defaultWorkerRuntimeRoot();
			const receipt = [...ctx.sessionManager.getBranch()].reverse().find((entry) =>
				entry.type === "custom" && entry.customType === WORKER_MACHINE_ENTRY &&
				(entry.data as { runtimeRoot?: unknown }).runtimeRoot === runtimeRoot &&
				(entry.data as { providerId?: unknown }).providerId === ctx.model?.provider
			) as { data?: { setupDigest?: unknown; credentialRevision?: unknown; providerId?: unknown } } | undefined;
			if (typeof receipt?.data?.setupDigest !== "string" || !Number.isSafeInteger(receipt.data.credentialRevision)) {
				ctx.ui.notify("session นี้ไม่มี trusted setup receipt สำหรับ active provider; รัน /mypi-worker-setup setup หรือ verify ใน session เดิมก่อน", "error");
				return;
			}
			const verification = await verifyWorkerMachine({
				runtimeRoot,
				sourceAgentDir,
				providerId: ctx.model.provider,
				expectedSetupDigest: receipt.data.setupDigest,
			});
			if (!verification.verified || !verification.manifest || verification.manifest.credentialRevision !== receipt.data.credentialRevision) {
				ctx.ui.notify(`Worker machine receipt verification ไม่ผ่าน: ${verification.mismatches.join(",") || "credential-revision"}`, "error");
				return;
			}
			const approved = await ctx.ui.confirm(
				"รัน real-provider Worker acceptance?",
				`provider/model: ${ctx.model.provider}/${ctx.model.id}\nthinking: low\nrevision: ${verification.manifest.credentialRevision}\n\nจะ clone pinned public source, เรียก provider 1 งาน, ทดสอบ stop/replacement/cleanup แล้วลบ disposable source; production ยัง disabled`,
			);
			if (!approved) return;
			const environment: Record<string, string> = {};
			for (const key of ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TMPDIR"] as const) {
				const value = process.env[key];
				if (value) environment[key] = value;
			}
			environment.MYPI_ACCEPTANCE_SETUP_DIGEST = verification.manifest.setupDigest;
			environment.MYPI_ACCEPTANCE_SOURCE_AGENT_DIR = sourceAgentDir;
			environment.MYPI_ACCEPTANCE_PROVIDER_ID = ctx.model.provider;
			environment.MYPI_ACCEPTANCE_MODEL_ID = ctx.model.id;
			environment.MYPI_ACCEPTANCE_THINKING_LEVEL = "low";
			ctx.ui.notify("เริ่ม generated-profile acceptance; อาจใช้เวลาหลายนาที", "info");
			let safeFailureEvidence: Record<string, unknown> = {};
			try {
				const result = await new Promise<{ code: number | null; stdout: string }>((resolvePromise, reject) => {
					const child = spawn(process.execPath, [WORKER_ACCEPTANCE_RUNNER], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
					let stdout = "";
					child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
					child.stderr.resume();
					child.once("error", reject);
					child.once("close", (code) => resolvePromise({ code, stdout }));
				});
				let evidence: { status?: unknown; profileDigest?: unknown; teamId?: unknown; checks?: unknown; errorDigest?: unknown; noticeCount?: unknown; stage?: unknown; exitCode?: unknown } = {};
				try { evidence = JSON.parse(result.stdout); } catch { /* malformed output is handled below */ }
				if (evidence.status === "FAIL" || evidence.status === "BLOCKED") {
					const allowedStages = new Set(["clone", "checkout", "overlay", "dependencies", "probe"]);
					safeFailureEvidence = {
						outcome: evidence.status,
						stage: typeof evidence.stage === "string" && allowedStages.has(evidence.stage) ? evidence.stage : undefined,
						exitCode: Number.isSafeInteger(evidence.exitCode) ? evidence.exitCode : result.code,
						errorDigest: typeof evidence.errorDigest === "string" && /^[a-f0-9]{64}$/.test(evidence.errorDigest) ? evidence.errorDigest : undefined,
						teamId: typeof evidence.teamId === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(evidence.teamId) ? evidence.teamId : undefined,
						noticeCount: Number.isSafeInteger(evidence.noticeCount) && Number(evidence.noticeCount) >= 0 ? evidence.noticeCount : undefined,
					};
				}
				if (result.code !== 0) throw new Error(`acceptance subprocess exited ${result.code ?? "without a status"}; redacted failure evidence was appended to session audit`);
				const expectedChecks = ["boundedWorktreeMutation", "exactReadOnlyAdapter", "exactWorktreeWriteAdapter", "forcedCrashCleanup", "generatedSpawnReadiness", "leaderLossCleanup", "leaderLossWorktreeRetained", "noInteractiveRequests", "noReusableCredentialState", "orderlyShutdownClassified", "realProviderArtifact", "sameNameReplacement", "stopCleanup"];
				const checks = evidence.checks && typeof evidence.checks === "object" && !Array.isArray(evidence.checks)
					? evidence.checks as Record<string, unknown>
					: {};
				if (evidence.status !== "PASS" || typeof evidence.profileDigest !== "string" || !/^[a-f0-9]{64}$/.test(evidence.profileDigest) ||
					typeof evidence.teamId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(evidence.teamId) ||
					JSON.stringify(Object.keys(checks).sort()) !== JSON.stringify(expectedChecks) || expectedChecks.some((key) => checks[key] !== true)) {
					throw new Error("acceptance evidence is malformed or not PASS");
				}
				pi.appendEntry(WORKER_ACCEPTANCE_ENTRY, {
					status: "PASS",
					providerId: ctx.model.provider,
					modelId: ctx.model.id,
					setupDigest: verification.manifest.setupDigest,
					credentialRevision: verification.manifest.credentialRevision,
					profileDigest: evidence.profileDigest,
					teamId: evidence.teamId,
					checks,
					productionActivated: false,
				});
				ctx.ui.notify(`Generated-profile acceptance PASS\nprofile: ${evidence.profileDigest}\nproduction activation: disabled`, "info");
			} catch (error) {
				pi.appendEntry(WORKER_ACCEPTANCE_ENTRY, {
					status: safeFailureEvidence.outcome === "BLOCKED" ? "BLOCKED" : "FAIL",
					providerId: ctx.model.provider,
					modelId: ctx.model.id,
					setupDigest: verification.manifest.setupDigest,
					credentialRevision: verification.manifest.credentialRevision,
					...safeFailureEvidence,
					productionActivated: false,
				});
				ctx.ui.notify(`Generated-profile acceptance ไม่ผ่าน: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("mypi-orchestrate", {
		description: "ควบคุมการเสนอทีมอัตโนมัติราย session: automatic, off หรือ status",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const command = parseOrchestrateCommand(typeof args === "string" ? args : "");
			if (command.kind === "invalid") {
				ctx.ui.notify("ใช้ /mypi-orchestrate automatic|off|status", "warning");
				return;
			}
			if (command.kind === "set") {
				mode = command.mode;
				pi.appendEntry(MODE_ENTRY, { mode });
			}
			const where = isHerdrSession() ? "" : " (session นี้ไม่ได้รันใต้ Herdr จึงยังไม่มีผล)";
			ctx.ui.notify(
				mode === "automatic"
					? `เปิดการประเมินและเสนอทีมอัตโนมัติ${where}`
					: `ปิดการเสนอทีมอัตโนมัติ tools ยังเรียกเองได้${where}`,
				"info",
			);
		},
	});

	pi.registerCommand("mypi-orchestrate-status", {
		description: "แสดง Worker ที่ Coordinator ดูแลอยู่ พร้อม identity และ artifact references",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			if (!isHerdrSession()) {
				ctx.ui.notify("Pi ไม่ได้รันอยู่ใต้ Herdr จึงไม่มี Worker ให้แสดง", "warning");
				return;
			}
			const workers = await registry.refresh();
			const body = workers.length ? workers.map(describeWorker).join("\n\n") : "ยังไม่มี Worker ใน session นี้";
			ctx.ui.notify(`${describeAssurance(registry.assurance())}\n\n${body}`, "info");
		},
	});

	pi.registerCommand("mypi-orchestrate-cleanup", {
		description: "ตรวจและลบ Git worktree ของ Worker ทีละรายการหลังยืนยัน",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			if (!isHerdrSession()) {
				ctx.ui.notify("Pi ไม่ได้รันอยู่ใต้ Herdr จึงไม่มี worktree ให้จัดการ", "warning");
				return;
			}
			const workers = (await registry.refresh()).filter((worker) => worker.worktree);
			if (workers.length === 0) {
				ctx.ui.notify("ไม่มี Worker ที่ใช้ worktree ใน session นี้", "info");
				return;
			}

			for (const worker of workers) {
				const tree = worker.worktree;
				if (!tree) continue;
				const state = await worktreeState(pi, tree.path);
				const summary = [
					`worker: ${worker.name} [${worker.status}]`,
					`branch: ${tree.branch ?? "-"}`,
					`path: ${tree.path}`,
					state.exists
						? `head: ${state.head ?? "-"}\nuncommitted: ${state.dirty} รายการ`
						: `อ่าน worktree ไม่ได้: ${state.detail ?? "ไม่ทราบสาเหตุ"}`,
				].join("\n");

				if (worker.status === "live") {
					ctx.ui.notify(`ข้าม ${worker.name} เพราะ Worker ยังทำงานอยู่ ให้ปิด Worker ก่อน\n${summary}`, "warning");
					continue;
				}
				if (state.dirty > 0) {
					ctx.ui.notify(`ข้าม ${worker.name} เพราะมีงานที่ยังไม่ commit ${state.dirty} รายการ\n${summary}`, "warning");
					continue;
				}

				const approved = await withHerdrBlocked(pi.events, `Remove worktree ${tree.path}`, () =>
					ctx.ui.confirm(
						`ลบ worktree ของ "${worker.name}"?`,
						`${summary}\n\nคำสั่ง: herdr worktree remove --workspace ${tree.workspaceId ?? "-"}\nbranch และ commit ยังอยู่ใน repository ต้นทาง ลบเฉพาะ checkout`,
					),
				);
				if (!approved) {
					ctx.ui.notify(`ยกเลิกการลบ worktree ของ ${worker.name}`, "info");
					continue;
				}
				let removed = tree.workspaceId
					? await runHerdr(pi, ["worktree", "remove", "--workspace", tree.workspaceId], { timeout: 30_000 })
					: undefined;

				// Closing the Worker's pane closes the worktree's workspace, so the
				// stored id can already be gone. Git still owns the checkout.
				if (!removed?.ok) {
					const sourceRepo = await worktreeSourceRepo(pi, tree.path);
					if (!sourceRepo) {
						ctx.ui.notify(
							`ลบ worktree ของ ${worker.name} ไม่สำเร็จ: ${removed?.error?.message ?? removed?.output ?? "ไม่ทราบ repository ต้นทาง"}`,
							"error",
						);
						continue;
					}
					const pruned = await pi.exec("git", ["worktree", "remove", tree.path], { cwd: sourceRepo, timeout: 30_000 });
					if (pruned.code !== 0) {
						ctx.ui.notify(
							`ลบ worktree ของ ${worker.name} ไม่สำเร็จ: ${pruned.stderr.trim() || `git exited with ${pruned.code}`}`,
							"error",
						);
						continue;
					}
				}
				registry.update(worker.name, { worktree: undefined });
				ctx.ui.notify(`ลบ worktree ของ ${worker.name} แล้ว โดย branch ${tree.branch ?? "-"} ยังอยู่`, "info");
			}
		},
	});

	pi.on("before_agent_start", (event) => {
		if (!isHerdrSession()) return;
		const guidance = buildOrchestrationGuidance(mode, registry.list());
		if (!guidance) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
	});

	pi.registerTool({
		name: PREVIEW_TOOL,
		label: "Preview Worker",
		description:
			"Show exactly what spawning a Worker would do, without creating anything. Call this before " +
			`${SPAWN_TOOL} and show the result to the user. The delegation rationale is required: a Worker must ` +
			"reduce the critical path, isolate context that would otherwise mix, use a harness better suited to the " +
			"assignment, or provide independent inspection. If none of those hold, do the work yourself.",
		parameters: Type.Object({
			task: Type.String({ minLength: 1, description: "Bounded assignment for this Worker, in the words it will receive" }),
			requestedHarness: Type.String({ minLength: 1, description: "Herdr agent kind to run, e.g. pi, codex, claude" }),
			rationale: Type.String({ minLength: 1, description: "Concrete benefit expected from delegating this, not just that the task is large" }),
			name: Type.Optional(Type.String({ description: "Preferred worker name; normalized to Herdr's [a-z][a-z0-9_-]{0,31} rule" })),
			model: Type.Optional(Type.String({ description: "Exact model id the harness accepts, e.g. gpt-5.6-terra. Omit the field entirely to inherit the harness default; never pass a phrase such as \"default\"" })),
			effort: Type.Optional(Type.String({ description: "Exact effort or thinking level the harness accepts, e.g. high. Omit the field entirely to inherit the default" })),
			expectedArtifacts: Type.Optional(Type.Array(Type.String(), {
				description: "Exact paths, branches or commits this Worker is expected to produce",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			requireHerdr();
			const input = params as {
				task: string;
				requestedHarness: string;
				rationale: string;
				name?: string;
				model?: string;
				effort?: string;
				expectedArtifacts?: string[];
			};
			const kinds = await supportedKinds();
			const kindSupported = kinds.length === 0 || kinds.includes(input.requestedHarness);
			const taken = registry.list().map((worker) => worker.name);
			const name = normalizeWorkerName(input.name ?? input.task, taken);
			const caller = herdrCallerContext();
			const run = harnessRunSettings(input.requestedHarness, input.model, input.effort);
			const inherited = input.model || input.effort
				? undefined
				: input.requestedHarness === "pi"
					? await piDefaults(pi)
					: undefined;

			const text = [
				"Worker ที่จะสร้าง (ยังไม่ได้สร้าง):",
				`- name: ${name}`,
				`- harness: ${input.requestedHarness}${kindSupported ? "" : "  ← Herdr ไม่รองรับ kind นี้"}`,
				`- model: ${input.model ?? `harness default${inherited ? ` (${inherited})` : ""}`}`,
				`- effort: ${input.effort ?? "harness default"}`,
				...(run.unsupported.length ? [`- ⚠ ไม่รองรับสำหรับ harness นี้: ${run.unsupported.join(", ")}`] : []),
				`- cwd: ${ctx.cwd}`,
				`- pane: split จาก ${caller.paneId ?? "pane ปัจจุบัน"} โดยไม่ย้าย focus ของผู้ใช้`,
				`- worker mode: ${input.requestedHarness === "pi" ? `session name ${workerSessionName(name)}` : "ไม่ใช้ (ไม่ใช่ Pi)"}`,
				`- rationale: ${input.rationale}`,
				`- expected artifacts: ${input.expectedArtifacts?.join(", ") || "ยังไม่ระบุ"}`,
				"",
				"task ที่จะส่ง:",
				input.task,
				"",
				kinds.length ? `Herdr รองรับ: ${kinds.join(", ")}` : "อ่านรายการ kind จาก Herdr ไม่ได้",
			].join("\n");

			return {
				content: [{ type: "text", text }],
				details: {
					name,
					kindSupported,
					supportedKinds: kinds,
					spawned: false,
					model: input.model,
					effort: input.effort,
					harnessArgs: run.args,
					unsupported: run.unsupported,
				},
			};
		},
	});

	pi.registerTool({
		name: SPAWN_TOOL,
		label: "Spawn Worker",
		description:
			"Create one Worker in a new Herdr pane after the user approves it. The user is always asked first. " +
			"Start with the smallest team that works, and never spawn a Worker to escape a correction loop: send " +
			`the correction back to the same session with ${HANDOFF_TOOL} instead.`,
		parameters: Type.Object({
			task: Type.String({ minLength: 1, description: "Bounded assignment, including exact inputs to read, what must not be touched, expected output and how to report back" }),
			requestedHarness: Type.String({ minLength: 1, description: "Herdr agent kind to run" }),
			rationale: Type.String({ minLength: 1, description: "Concrete benefit expected from delegating this" }),
			name: Type.Optional(Type.String({ description: "Preferred worker name" })),
			cwd: Type.Optional(Type.String({ description: "Absolute working directory for the Worker; defaults to the current one" })),
			model: Type.Optional(Type.String({ description: "Model to run this Worker with; omit to inherit the harness default" })),
			effort: Type.Optional(Type.String({ description: "Reasoning effort or thinking level; the accepted values are harness-specific" })),
			worktree: Type.Optional(Type.Object({
				branch: Type.String({ minLength: 1, description: "Branch to create for this Worker" }),
				base: Type.Optional(Type.String({ description: "Exact base ref or SHA; defaults to the repository's current checkout" })),
			}, { description: "Give this Worker its own Git worktree. Use it when a Worker writes code that must stay off the shared checkout." })),
			harnessArgs: Type.Optional(Type.Array(Type.String(), { description: "Native arguments passed to the harness after --" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			requireHerdr();
			if (!ctx.hasUI) throw new Error("การสร้าง Worker ต้องมีผู้ใช้อนุมัติ จึงทำใน non-interactive mode ไม่ได้");

			const input = params as {
				task: string;
				requestedHarness: string;
				rationale: string;
				name?: string;
				model?: string;
				effort?: string;
				cwd?: string;
				worktree?: { branch: string; base?: string };
				harnessArgs?: string[];
			};
			const kinds = await supportedKinds();
			if (kinds.length > 0 && !kinds.includes(input.requestedHarness)) {
				throw new Error(`Herdr ไม่รองรับ kind "${input.requestedHarness}" (รองรับ: ${kinds.join(", ")})`);
			}

			const run = harnessRunSettings(input.requestedHarness, input.model, input.effort);
			if (run.unsupported.length > 0) {
				// Showing a setting in the approval dialog and then not applying it
				// would make the dialog lie about what the user approved.
				throw new Error(
					`harness "${input.requestedHarness}" ไม่มี flag สำหรับ ${run.unsupported.join(", ")} — ` +
					"ให้ส่งผ่าน harnessArgs เองหรือเลือก harness อื่น",
				);
			}
			const cwd = input.cwd ? resolve(input.cwd) : ctx.cwd;
			if (input.cwd && !isAbsolute(input.cwd)) throw new Error("cwd ของ Worker ต้องเป็น absolute path");
			const taken = registry.list().map((worker) => worker.name);
			const name = normalizeWorkerName(input.name ?? input.task, taken);
			const workerMode = input.requestedHarness === "pi";

			const piInherited = !input.model && !input.effort && input.requestedHarness === "pi"
				? await piDefaults(pi)
				: undefined;
			const approved = await withHerdrBlocked(pi.events, `Spawn worker ${name}`, () =>
				ctx.ui.confirm(
					`สร้าง Worker "${name}" ด้วย ${input.requestedHarness}?`,
					[
						`cwd: ${cwd}`,
						`เหตุผล: ${input.rationale}`,
						`model: ${input.model ?? `harness default${piInherited ? ` (${piInherited})` : ""}`}`,
						`effort: ${input.effort ?? "harness default"}`,
						workerMode ? `worker mode: session name ${workerSessionName(name)}` : "worker mode: ไม่ใช้ (ไม่ใช่ Pi)",
						input.worktree
							? `worktree: branch ${input.worktree.branch}${input.worktree.base ? ` จาก ${input.worktree.base}` : ""} (สร้าง workspace ใหม่ และจะไม่ถูกลบอัตโนมัติ)`
							: "worktree: ใช้ checkout เดิม",
						"",
						"task:",
						input.task,
					].join("\n"),
				),
			);
			if (!approved) {
				return { content: [{ type: "text", text: `ยกเลิกการสร้าง Worker "${name}"` }], details: { spawned: false } };
			}

			let paneId: string | undefined;
			let workerCwd = cwd;
			let worktree: WorktreeRef | undefined;

			if (input.worktree) {
				// A worktree opens its own workspace with a root pane; use that pane
				// rather than splitting, so the Worker lives beside its checkout.
				const created = await runHerdr(pi, [
					"worktree", "create", "--cwd", cwd, "--branch", input.worktree.branch,
					...(input.worktree.base ? ["--base", input.worktree.base] : []),
					"--label", name,
				], { timeout: 30_000 });
				if (!created.ok) throw new Error(`สร้าง worktree ไม่สำเร็จ: ${created.error?.message ?? created.output}`);
				const payload = created.result as {
					worktree?: { path?: string; branch?: string };
					workspace?: { workspace_id?: string };
					root_pane?: { pane_id?: string };
				} | undefined;
				if (!payload?.worktree?.path || !payload.root_pane?.pane_id) {
					throw new Error("Herdr ไม่ได้คืน path หรือ pane ของ worktree");
				}
				workerCwd = payload.worktree.path;
				paneId = payload.root_pane.pane_id;
				worktree = {
					path: payload.worktree.path,
					branch: payload.worktree.branch ?? input.worktree.branch,
					workspaceId: payload.workspace?.workspace_id,
				};
			} else {
				const caller = herdrCallerContext();
				const split = await runHerdr(pi, [
					"pane", "split",
					...(caller.paneId ? ["--pane", caller.paneId] : ["--current"]),
					"--direction", "right", "--cwd", cwd, "--no-focus",
				]);
				if (!split.ok) throw new Error(`สร้าง pane ไม่สำเร็จ: ${split.error?.message ?? split.output}`);
				paneId = (split.result as { pane?: { pane_id?: string } } | undefined)?.pane?.pane_id;
			}
			if (!paneId) throw new Error("Herdr ไม่ได้คืน pane id");

			// Label the pane so the user can find this Worker in the UI by name
			// rather than by an opaque pane id.
			await runHerdr(pi, ["pane", "rename", paneId, name]);

			registry.register({
				name,
				task: input.task,
				requestedHarness: input.requestedHarness,
				paneId,
				cwd: workerCwd,
				worktree,
			});

			// Worker mode rides on `--name`, which Pi applies atomically at startup.
			// Typing an export into the pane's shell instead lost the setting
			// whenever the shell had not reached its prompt yet.
			const startArgs = [
				...(workerMode ? ["--name", workerSessionName(name)] : []),
				...run.args,
				...(input.harnessArgs ?? []),
			];
			let started = await runHerdr(pi, [
				"agent", "start", name, "--kind", input.requestedHarness, "--pane", paneId,
				"--timeout", String(SPAWN_TIMEOUT_MS),
				...(startArgs.length ? ["--", ...startArgs] : []),
			], { timeout: SPAWN_TIMEOUT_MS + 10_000 });

			// A freshly split pane needs a moment before its shell is available.
			for (let attempt = 1; attempt < SPAWN_RETRIES && started.error?.code === "agent_pane_busy"; attempt += 1) {
				await new Promise((done) => setTimeout(done, SHELL_SETTLE_MS));
				started = await runHerdr(pi, [
					"agent", "start", name, "--kind", input.requestedHarness, "--pane", paneId,
					"--timeout", String(SPAWN_TIMEOUT_MS),
					...(startArgs.length ? ["--", ...startArgs] : []),
				], { timeout: SPAWN_TIMEOUT_MS + 10_000 });
			}

			if (!started.ok) {
				registry.update(name, { status: "gone" });
				// Close a pane we split, but never remove a worktree: it may already
				// hold work, and removal stays a decision the user makes.
				if (!worktree) await runHerdr(pi, ["pane", "close", paneId]);
				throw new Error([
					`เริ่ม ${input.requestedHarness} ไม่สำเร็จ: ${started.error?.message ?? started.output}`,
					worktree ? `worktree ${worktree.path} ยังอยู่ ให้ใช้ /mypi-orchestrate-cleanup เมื่อต้องการลบ` : "",
				].filter(Boolean).join("\n"));
			}

			if (workerMode) {
				// Everything else in this system verifies its result; worker mode
				// must not be the one setting that is trusted on faith.
				const applied = await agentSessionName(pi, name);
				if (!applied?.includes(WORKER_SESSION_PREFIX)) {
					registry.update(name, { status: "gone" });
					if (!worktree) await runHerdr(pi, ["pane", "close", paneId]);
					throw new Error([
						`Worker "${name}" เริ่มแล้วแต่ยืนยัน worker mode ไม่ได้ จึงปิดทิ้ง`,
						`ตรวจพบชื่อ session: ${applied ?? "อ่านไม่ได้"}`,
						worktree ? `worktree ${worktree.path} ยังอยู่ ใช้ /mypi-orchestrate-cleanup เมื่อต้องการลบ` : "",
					].filter(Boolean).join("\n"));
				}
			}

			registry.update(name, { status: "live" });
			const [worker] = (await registry.refresh()).filter((candidate) => candidate.name === name);
			return {
				content: [{
					type: "text",
					text: [
						`สร้าง Worker "${name}" แล้วที่ pane ${paneId}`,
						worker ? describeWorker(worker) : "",
						"identity ระดับ lifecycle จะยืนยันได้หลัง Worker ทำงานรอบแรก",
						`ส่งงานด้วย ${HANDOFF_TOOL} แล้วตรวจผลด้วย ${COLLECT_TOOL} จาก artifact จริง`,
					].filter(Boolean).join("\n"),
				}],
				details: { spawned: true, name, paneId, worker },
			};
		},
	});

	pi.registerTool({
		name: HANDOFF_TOOL,
		label: "Hand Off To Worker",
		description:
			"Send an assignment or a correction to a Worker that already exists, keeping its context and worktree. " +
			"Delivery is verified afterwards: Herdr reports success even when a prompt never reaches the agent, so " +
			"this reports `delivered: false` when nothing in the Worker's state moved.",
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "Worker name" }),
			message: Type.String({ minLength: 1, description: "Exact text to deliver: inputs to read, ownership, constraints, acceptance criteria and how to report back" }),
			inputArtifacts: Type.Optional(Type.Array(
				Type.Object({
					kind: Type.Union([Type.Literal("path"), Type.Literal("branch"), Type.Literal("commit")]),
					value: Type.String({ minLength: 1 }),
					purpose: Type.String({ minLength: 1, description: "Why this Worker must read it" }),
				}),
				{ description: "Exact references this Worker must read; recorded against the handoff" },
			)),
			timeoutMs: Type.Optional(Type.Number({ description: `Wait budget in ms (default ${DEFAULT_PROMPT_TIMEOUT_MS})` })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			requireHerdr();
			const input = params as {
				name: string;
				message: string;
				inputArtifacts?: Array<{ kind: ArtifactRef["kind"]; value: string; purpose: string }>;
				timeoutMs?: number;
			};
			await registry.refresh();
			const worker = registry.get(input.name);
			if (!worker) throw new Error(`ไม่พบ Worker "${input.name}" ใน session นี้`);
			if (worker.status === "gone") throw new Error(`Worker "${input.name}" ไม่มีอยู่ใน Herdr แล้ว`);

			const before = await agentStatus(pi, input.name);
			const prompted = await runHerdr(pi, [
				"agent", "prompt", input.name, input.message,
				"--wait", "--timeout", String(input.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS),
			], { timeout: (input.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS) + 10_000 });
			const after = await agentStatus(pi, input.name);

			const stalled = prompted.error?.code === "agent_prompt_stalled";
			const moved = typeof after.seq === "number" && after.seq !== before.seq;
			const delivered = !stalled && moved;
			for (const artifact of input.inputArtifacts ?? []) {
				registry.addArtifact(input.name, { ...artifact, producedBy: worker.name });
			}
			registry.update(input.name, { lastSeq: after.seq, seqAtHandoff: before.seq });

			const lines = [
				delivered
					? `ส่งงานถึง "${input.name}" แล้ว (state_change_seq ${before.seq} → ${after.seq}, status ${after.status ?? "unknown"})`
					: `ยังยืนยันไม่ได้ว่าข้อความถึง "${input.name}"`,
			];
			if (!delivered) {
				lines.push(
					stalled
						? "Herdr รายงาน agent_prompt_stalled: ไม่เห็น state เปลี่ยนหลังส่ง"
						: `state_change_seq ไม่ขยับ (${before.seq} → ${after.seq}) ข้อความอาจไปค้างที่ dialog ของ Worker`,
					`ตรวจหน้าจอด้วย: herdr agent read ${input.name} --source recent-unwrapped`,
				);
			}
			if (after.status === "blocked") {
				lines.push(`Worker กำลังรออนุมัติจากผู้ใช้ ให้แสดงคำขอนี้ต่อผู้ใช้พร้อม pane ${worker.paneId ?? "-"} แทนการตอบแทน`);
			}
			lines.push(`สถานะ lifecycle ไม่ใช่หลักฐานว่างานเสร็จ ให้ตรวจด้วย ${COLLECT_TOOL}`);

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { delivered, stalled, seqBefore: before.seq, seqAfter: after.seq, status: after.status },
			};
		},
	});

	pi.registerTool({
		name: ASSURANCE_TOOL,
		label: "Set Assurance Level",
		description:
			"Record how much evidence this work owes the user before it can be reported done. This is a separate " +
			"decision from how many Workers do the work: a single-Worker task can still need independent review, " +
			"and a large team can be fine with your own verification. Raise it for risk or because the user asked.",
		parameters: Type.Object({
			level: Type.Union([
				Type.Literal("coordinator"),
				Type.Literal("independent-review"),
				Type.Literal("human-approval"),
			], { description: "coordinator: your own verified evidence is enough. independent-review: someone other than the producer must verify it. human-approval: the user must approve the result." }),
			reason: Type.String({ minLength: 1, description: "Why this level, in terms of risk or an explicit user request" }),
			producedBy: Type.Optional(Type.String({
				description: "Who produces the work being judged: omit when you implement it yourself, or give the Worker's name",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const input = params as { level: AssuranceLevel; reason: string; producedBy?: string };
			const state = registry.setAssurance(input.level, input.reason, input.producedBy);
			return {
				content: [{ type: "text", text: `${describeAssurance(state)}\nเหตุผล: ${state.reason}` }],
				details: { assurance: state, met: assuranceMet(state) },
			};
		},
	});

	pi.registerTool({
		name: WAIT_TOOL,
		label: "Wait For Worker",
		description:
			"Block until a Worker reaches a settled state instead of polling its screen. Use this whenever a Worker " +
			"is still busy, or after asking the user to answer something in the Worker's pane. Reaching a state is " +
			`not evidence that the work is done: verify with ${COLLECT_TOOL} afterwards.`,
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "Worker name" }),
			until: Type.Optional(Type.Array(
				Type.Union([
					Type.Literal("idle"),
					Type.Literal("working"),
					Type.Literal("blocked"),
					Type.Literal("done"),
					Type.Literal("unknown"),
				]),
				{ description: "States to wait for; omit to wait for any settled state (idle, done or blocked)" },
			)),
			timeoutMs: Type.Optional(Type.Number({ description: `Wait budget in ms (default ${DEFAULT_WAIT_TIMEOUT_MS})` })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			requireHerdr();
			const input = params as { name: string; until?: string[]; timeoutMs?: number };
			const worker = registry.get(input.name);
			if (!worker) throw new Error(`ไม่พบ Worker "${input.name}" ใน session นี้`);

			const timeout = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
			const waited = await runHerdr(pi, [
				"agent", "wait", input.name,
				...(input.until ?? []).flatMap((state) => ["--until", state]),
				"--timeout", String(timeout),
			], { timeout: timeout + 10_000 });

			const current = await agentStatus(pi, input.name);
			registry.update(input.name, { lastSeq: current.seq });

			if (!waited.ok && !current.status) {
				registry.update(input.name, { status: "gone" });
				return {
					content: [{ type: "text", text: `Worker "${input.name}" ไม่มีอยู่ใน Herdr แล้ว: ${waited.error?.message ?? waited.output}` }],
					details: { reached: false, status: undefined, exited: true },
				};
			}
			if (!waited.ok) {
				return {
					content: [{
						type: "text",
						text: [
							`รอ "${input.name}" ไม่ถึงสถานะที่ต้องการภายใน ${timeout}ms (ตอนนี้ ${current.status ?? "unknown"})`,
							"Worker อาจยังทำงานอยู่จริง ให้รอต่อหรือตรวจหน้าจอก่อนสรุปว่าค้าง",
						].join("\n"),
					}],
					details: { reached: false, status: current.status, timedOut: true },
				};
			}

			const lines = [`Worker "${input.name}" อยู่ในสถานะ ${current.status ?? "unknown"} (state_change_seq ${current.seq ?? "-"})`];
			if (current.status === "blocked") {
				lines.push(`กำลังรอผู้ใช้ที่ pane ${worker.paneId ?? "-"} ให้แสดงคำขอต่อผู้ใช้แทนการตอบแทน`);
			}
			if (current.status === "unknown") {
				lines.push("Herdr แยกแยะสถานะไม่ได้ ซึ่งไม่ได้แปลว่างานเสร็จ");
			}
			lines.push(`สถานะไม่ใช่หลักฐานว่างานเสร็จ ให้ตรวจด้วย ${COLLECT_TOOL}`);

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { reached: true, status: current.status, seq: current.seq },
			};
		},
	});

	pi.registerTool({
		name: COLLECT_TOOL,
		label: "Collect Worker Result",
		description:
			"Verify what a Worker actually produced before accepting it. Checks that the agreed artifacts exist, " +
			"that git refs resolve, and that the Worker's state moved. A Worker's own summary is never evidence; " +
			"when nothing verifies, this returns incomplete so the correction goes back to the same Worker.",
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "Worker name" }),
			artifacts: Type.Array(
				Type.Object({
					kind: Type.Union([Type.Literal("path"), Type.Literal("branch"), Type.Literal("commit")]),
					value: Type.String({ minLength: 1, description: "Exact path, branch or commit agreed for this task" }),
					purpose: Type.String({ minLength: 1, description: "What the next step reads it for" }),
				}),
				{ minItems: 1, description: "The artifacts this task was supposed to produce" },
			),
			gitCwd: Type.Optional(Type.String({ description: "Repository to resolve branch and commit refs in; defaults to the Worker's cwd" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			requireHerdr();
			const input = params as {
				name: string;
				artifacts: Array<{ kind: ArtifactRef["kind"]; value: string; purpose: string }>;
				gitCwd?: string;
			};
			await registry.refresh();
			const worker = registry.get(input.name);
			if (!worker) throw new Error(`ไม่พบ Worker "${input.name}" ใน session นี้`);

			const gitCwd = input.gitCwd ?? worker.worktree?.path ?? worker.cwd ?? ctx.cwd;
			const items: EvidenceItem[] = [];
			for (const artifact of input.artifacts) {
				if (artifact.kind === "path") {
					const target = isAbsolute(artifact.value)
						? artifact.value
						: resolve(worker.worktree?.path ?? worker.cwd ?? ctx.cwd, artifact.value);
					const found = await pathExists(target);
					items.push({ description: `path ${artifact.value}`, satisfied: found.exists, required: true, detail: found.detail });
				} else {
					const found = await gitRefExists(pi, gitCwd, artifact.value);
					items.push({ description: `${artifact.kind} ${artifact.value}`, satisfied: found.exists, required: true, detail: found.detail });
				}
			}

			const current = await agentStatus(pi, input.name);
			// Compare against the counter from before the assignment, not after it:
			// the handoff itself moves the counter and would always look like progress.
			const baseline = worker.seqAtHandoff ?? worker.lastSeq;
			const moved = typeof current.seq === "number" && current.seq !== baseline;
			items.push({
				description: "Worker state moved since the handoff",
				satisfied: moved,
				required: false,
				detail: `state_change_seq ${baseline ?? "-"} → ${current.seq ?? "-"}`,
			});

			const verdict = evaluateEvidence(items);
			if (verdict.complete) {
				for (const artifact of input.artifacts) {
					registry.addArtifact(input.name, { ...artifact, producedBy: input.name });
				}
				registry.recordVerified(input.name);
			}
			registry.update(input.name, { lastSeq: current.seq });
			const assurance = registry.assurance();

			const report = items
				.map((item) => `${item.satisfied ? "✓" : "✗"} ${item.description}${item.required ? "" : " (ประกอบ)"}${item.detail ? ` — ${item.detail}` : ""}`)
				.join("\n");
			const missing = items.filter((item) => item.required && !item.satisfied);
			const text = [
				verdict.complete ? `หลักฐานของ "${input.name}":` : `ยังรับผลงานของ "${input.name}" ไม่ได้:`,
				report,
				current.status === "blocked"
					? `Worker กำลัง blocked รออนุมัติ ให้แสดงต่อผู้ใช้พร้อม pane ${worker.paneId ?? "-"}`
					: "",
				verdict.complete
					? "อ่าน artifact จริงก่อนตัดสินใจขั้นถัดไป ข้อความสรุปของ Worker ไม่ใช่หลักฐาน"
					: `ส่ง correction กลับไปที่ ${input.name} ด้วย ${HANDOFF_TOOL} แทนการสร้าง Worker ใหม่ (artifact ที่ตกลงไว้ยังไม่ผ่าน ${missing.length} รายการ)`,
				describeAssurance(assurance),
			].filter(Boolean).join("\n");

			return {
				content: [{ type: "text", text }],
				details: { complete: verdict.complete, items, status: current.status, assurance, assuranceMet: assuranceMet(assurance) },
			};
		},
	});
}
