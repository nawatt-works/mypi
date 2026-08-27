import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { herdrCallerContext, isHerdrSession, runHerdr, withHerdrBlocked } from "./herdr-client.ts";
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
import { WORKER_ENV } from "./worker-mode.ts";

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
	if (met) return `assurance: ${state.level} — เพียงพอแล้ว (ตรวจผ่านจาก ${verified})`;
	if (state.level === "human-approval") {
		return `assurance: human-approval — ต้องให้ผู้ใช้อนุมัติผลก่อนถือว่าจบ (ตรวจผ่านจาก ${verified})`;
	}
	if (state.level === "independent-review") {
		return `assurance: independent-review — ต้องมี Worker อีกตัวที่ไม่ได้ผลิตงานนี้ตรวจซ้ำ (ตรวจผ่านจาก ${verified})`;
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
				expectedArtifacts?: string[];
			};
			const kinds = await supportedKinds();
			const kindSupported = kinds.length === 0 || kinds.includes(input.requestedHarness);
			const taken = registry.list().map((worker) => worker.name);
			const name = normalizeWorkerName(input.name ?? input.task, taken);
			const caller = herdrCallerContext();

			const text = [
				"Worker ที่จะสร้าง (ยังไม่ได้สร้าง):",
				`- name: ${name}`,
				`- harness: ${input.requestedHarness}${kindSupported ? "" : "  ← Herdr ไม่รองรับ kind นี้"}`,
				`- cwd: ${ctx.cwd}`,
				`- pane: split จาก ${caller.paneId ?? "pane ปัจจุบัน"} โดยไม่ย้าย focus ของผู้ใช้`,
				`- worker mode: ${input.requestedHarness === "pi" ? `${WORKER_ENV}=1` : "ไม่ใช้ (ไม่ใช่ Pi)"}`,
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
				details: { name, kindSupported, supportedKinds: kinds, spawned: false },
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
				cwd?: string;
				worktree?: { branch: string; base?: string };
				harnessArgs?: string[];
			};
			const kinds = await supportedKinds();
			if (kinds.length > 0 && !kinds.includes(input.requestedHarness)) {
				throw new Error(`Herdr ไม่รองรับ kind "${input.requestedHarness}" (รองรับ: ${kinds.join(", ")})`);
			}

			const cwd = input.cwd ? resolve(input.cwd) : ctx.cwd;
			if (input.cwd && !isAbsolute(input.cwd)) throw new Error("cwd ของ Worker ต้องเป็น absolute path");
			const taken = registry.list().map((worker) => worker.name);
			const name = normalizeWorkerName(input.name ?? input.task, taken);
			const workerMode = input.requestedHarness === "pi";

			const approved = await withHerdrBlocked(pi.events, `Spawn worker ${name}`, () =>
				ctx.ui.confirm(
					`สร้าง Worker "${name}" ด้วย ${input.requestedHarness}?`,
					[
						`cwd: ${cwd}`,
						`เหตุผล: ${input.rationale}`,
						workerMode ? `worker mode: ${WORKER_ENV}=1` : "worker mode: ไม่ใช้ (ไม่ใช่ Pi)",
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

			registry.register({
				name,
				task: input.task,
				requestedHarness: input.requestedHarness,
				paneId,
				cwd: workerCwd,
				worktree,
			});

			if (workerMode) {
				// Pi refuses to share a CLI flag between extensions, so worker mode
				// travels through the pane's shell environment instead.
				await runHerdr(pi, ["pane", "send-text", paneId, `export ${WORKER_ENV}=1`]);
				await runHerdr(pi, ["pane", "send-keys", paneId, "enter"]);
			}

			let started = await runHerdr(pi, [
				"agent", "start", name, "--kind", input.requestedHarness, "--pane", paneId,
				"--timeout", String(SPAWN_TIMEOUT_MS),
				...(input.harnessArgs?.length ? ["--", ...input.harnessArgs] : []),
			], { timeout: SPAWN_TIMEOUT_MS + 10_000 });

			// A freshly split pane needs a moment before its shell is available.
			for (let attempt = 1; attempt < SPAWN_RETRIES && started.error?.code === "agent_pane_busy"; attempt += 1) {
				await new Promise((done) => setTimeout(done, SHELL_SETTLE_MS));
				started = await runHerdr(pi, [
					"agent", "start", name, "--kind", input.requestedHarness, "--pane", paneId,
					"--timeout", String(SPAWN_TIMEOUT_MS),
					...(input.harnessArgs?.length ? ["--", ...input.harnessArgs] : []),
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
			], { description: "coordinator: your own verified evidence is enough. independent-review: a Worker that did not produce the work must verify it. human-approval: the user must approve the result." }),
			reason: Type.String({ minLength: 1, description: "Why this level, in terms of risk or an explicit user request" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const input = params as { level: AssuranceLevel; reason: string };
			const state = registry.setAssurance(input.level, input.reason);
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
