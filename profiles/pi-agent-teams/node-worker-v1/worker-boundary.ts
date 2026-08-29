import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createReadTool,
	createWriteTool,
	type BashOperations,
} from "@earendil-works/pi-coding-agent";
import {
	analyzeCommand,
	resolveCommandPolicy,
	type CommandPolicyRequest,
} from "../../../extensions/command-policy.ts";
import { analyzeToolCall } from "../../../extensions/guardrails.ts";
import { createScopedToolOperations } from "../../../extensions/scoped-worker-tools.ts";

const PROFILE_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(PROFILE_DIR, "..", "..", "..");

type WorkerProfile = {
	schemaVersion: 1;
	profileId: string;
	status: "phase0-candidate";
	platform: "linux/arm64";
	policyVersion: string;
	toolchain: {
		baseDigest: string;
		observedLocalImageDigest: string;
		dockerfileSha256: string;
		sbomSpdxSha256: string;
		workerBoundarySha256: string;
		commandPolicySha256: string;
		scopedWorkerToolsSha256: string;
	};
	integration: {
		upstreamCommit: string;
		overlayPatchSha256: string;
		patchedTeamsEntrySha256: string;
		patchedTeamsSourceSha256: string;
	};
	runtime: {
		pull: "never";
		network: "none";
		readOnlyRoot: true;
		user: "node";
		pidsLimit: number;
		memory: string;
		cpus: number;
		tmpfs: string;
		workdir: "/workspace";
	};
	workerResources: {
		tools: ["read", "bash", "edit", "write"];
		backendTools: ["team_message"];
		workspaceMode: "worktree";
	};
};

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256DirectoryTree(root: string): string {
	const canonicalRoot = realpathSync(root);
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new Error(`symlink is not allowed in pinned source: ${path}`);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) files.push(path);
			else throw new Error(`unsupported pinned source entry: ${path}`);
		}
	};
	visit(canonicalRoot);
	const digest = createHash("sha256");
	for (const path of files.sort()) {
		const name = relative(canonicalRoot, path).replaceAll("\\", "/");
		const content = readFileSync(path);
		digest.update(`${Buffer.byteLength(name)}:`).update(name).update(`:${content.length}:`).update(content);
	}
	return digest.digest("hex");
}

function requireHash(label: string, path: string, expected: string): void {
	const observed = sha256File(path);
	if (observed !== expected) throw new Error(`${label} digest mismatch: expected ${expected}, observed ${observed}`);
}

export function loadWorkerProfile(): WorkerProfile {
	const profile = JSON.parse(readFileSync(join(PROFILE_DIR, "profile.json"), "utf8")) as WorkerProfile;
	if (profile.schemaVersion !== 1 || profile.status !== "phase0-candidate") throw new Error("unsupported Worker profile schema/status");
	if (profile.profileId !== "pi-agent-teams-docker-strong-v1") throw new Error("unexpected Worker profile id");
	if (profile.platform !== "linux/arm64") throw new Error("unexpected Worker profile platform");
	if (profile.runtime.pull !== "never" || profile.runtime.network !== "none" || profile.runtime.readOnlyRoot !== true) {
		throw new Error("Worker profile weakens required Docker boundary");
	}
	if (profile.runtime.user !== "node" || profile.runtime.workdir !== "/workspace") throw new Error("unexpected Worker runtime identity");
	if (JSON.stringify(profile.workerResources.tools) !== JSON.stringify(["read", "bash", "edit", "write"]) ||
		JSON.stringify(profile.workerResources.backendTools) !== JSON.stringify(["team_message"])) {
		throw new Error("unexpected Worker tool set");
	}
	return profile;
}

function verifyManagedAgentTeamsSource(profile: WorkerProfile): string {
	const requestedEntry = process.env.MYPI_AGENT_TEAMS_ENTRY_PATH;
	if (!requestedEntry) throw new Error("MYPI_AGENT_TEAMS_ENTRY_PATH is required");
	const entryPath = realpathSync(requestedEntry);
	const teamsDirectory = dirname(entryPath);
	if (entryPath !== join(teamsDirectory, "index.ts")) throw new Error("unexpected patched agent-teams entry path");
	const checkoutRoot = resolve(teamsDirectory, "..", "..");
	if (realpathSync(join(checkoutRoot, "extensions", "teams")) !== realpathSync(teamsDirectory)) {
		throw new Error("patched agent-teams entry is outside the expected checkout layout");
	}
	requireHash("patched agent-teams entry", entryPath, profile.integration.patchedTeamsEntrySha256);
	const sourceDigest = sha256DirectoryTree(teamsDirectory);
	if (sourceDigest !== profile.integration.patchedTeamsSourceSha256) {
		throw new Error(`patched agent-teams source tree digest mismatch: expected ${profile.integration.patchedTeamsSourceSha256}, observed ${sourceDigest}`);
	}
	const git = spawnSync("git", ["-C", checkoutRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 });
	if (git.status !== 0 || git.stdout.trim() !== profile.integration.upstreamCommit) {
		throw new Error("patched agent-teams checkout does not match the pinned upstream commit");
	}
	return entryPath;
}

export function verifyWorkerProfileArtifacts(profile: WorkerProfile): void {
	requireHash("Dockerfile", join(PROFILE_DIR, "Dockerfile"), profile.toolchain.dockerfileSha256);
	requireHash("SBOM", join(PROFILE_DIR, "sbom.spdx.json"), profile.toolchain.sbomSpdxSha256);
	requireHash("Worker boundary", fileURLToPath(import.meta.url), profile.toolchain.workerBoundarySha256);
	requireHash("command policy", join(REPOSITORY_ROOT, "extensions", "command-policy.ts"), profile.toolchain.commandPolicySha256);
	requireHash("scoped Worker tools", join(REPOSITORY_ROOT, "extensions", "scoped-worker-tools.ts"), profile.toolchain.scopedWorkerToolsSha256);
	requireHash("agent-teams overlay", join(PROFILE_DIR, "agent-teams-overlay.patch"), profile.integration.overlayPatchSha256);
}

function verifyDockerBoundary(profile: WorkerProfile): void {
	const info = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
		encoding: "utf8",
		timeout: 10_000,
	});
	if (info.status !== 0) throw new Error(`Docker daemon unavailable: ${info.stderr || info.error}`);
	const image = spawnSync("docker", ["image", "inspect", profile.toolchain.observedLocalImageDigest], {
		encoding: "utf8",
		timeout: 10_000,
	});
	if (image.status !== 0) throw new Error(`required immutable image unavailable: ${profile.toolchain.observedLocalImageDigest}`);
	const inspected = (JSON.parse(image.stdout) as Array<{
		Id?: string;
		Architecture?: string;
		Os?: string;
		Config?: { User?: string; Labels?: Record<string, string> };
	}>)[0];
	if (!inspected || inspected.Id !== profile.toolchain.observedLocalImageDigest) throw new Error("observed Docker image digest mismatch");
	if (inspected.Architecture !== "arm64" || inspected.Os !== "linux") throw new Error("observed Docker image platform mismatch");
	if (inspected.Config?.User !== profile.runtime.user) throw new Error("observed Docker image user mismatch");
	if (inspected.Config?.Labels?.["org.opencontainers.image.base.digest"] !== profile.toolchain.baseDigest) {
		throw new Error("observed Docker base provenance mismatch");
	}
}

function killContainer(cidFile: string): void {
	try {
		const containerId = readFileSync(cidFile, "utf8").trim();
		if (containerId) spawnSync("docker", ["kill", containerId], { timeout: 5_000, stdio: "ignore" });
	} catch {
		// Container may not have reached creation or may already be gone.
	}
}

function createDockerBashOperations(profile: WorkerProfile): BashOperations {
	const cidRoot = join(tmpdir(), "mypi-agent-teams-cids");
	mkdirSync(cidRoot, { recursive: true, mode: 0o700 });
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			const cidFile = join(cidRoot, `${process.pid}-${randomUUID()}.cid`);
			const args = [
				"run",
				"--pull", profile.runtime.pull,
				"--rm",
				"--cidfile", cidFile,
				"--network", profile.runtime.network,
				"--read-only",
				"--cap-drop", "ALL",
				"--security-opt", "no-new-privileges",
				"--pids-limit", String(profile.runtime.pidsLimit),
				"--memory", profile.runtime.memory,
				"--cpus", String(profile.runtime.cpus),
				"--tmpfs", profile.runtime.tmpfs,
				"--mount", `type=bind,source=${cwd},target=${profile.runtime.workdir}`,
				"--workdir", profile.runtime.workdir,
				"--env", "HOME=/tmp",
				profile.toolchain.observedLocalImageDigest,
				"/bin/sh", "-lc", command,
			];
			return await new Promise((resolve, reject) => {
				const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
				let timedOut = false;
				let timer: NodeJS.Timeout | undefined;
				const stop = () => {
					killContainer(cidFile);
					child.kill("SIGKILL");
				};
				if (timeout && timeout > 0) {
					timer = setTimeout(() => {
						timedOut = true;
						stop();
					}, timeout * 1_000);
				}
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				const abort = () => stop();
				signal?.addEventListener("abort", abort, { once: true });
				child.on("error", reject);
				child.on("close", (code) => {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", abort);
					rmSync(cidFile, { force: true });
					if (signal?.aborted) reject(new Error("aborted"));
					else if (timedOut) reject(new Error(`timeout:${timeout}`));
					else resolve({ exitCode: code });
				});
			});
		},
	};
}

function policyRequest(profile: WorkerProfile, cwd: string): CommandPolicyRequest {
	return {
		workerId: process.env.PI_TEAMS_AGENT_NAME || "unidentified-worker",
		sessionId: process.env.PI_TEAMS_TEAM_ID || "unidentified-session",
		mandateId: "phase0-candidate",
		profileId: profile.profileId,
		policyVersion: profile.policyVersion,
		workspaceRoot: cwd,
		cwd,
	};
}

export default function agentTeamsWorkerBoundary(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const profile = loadWorkerProfile();
	const scoped = createScopedToolOperations({ workspaceRoot: cwd });
	const readTool = createReadTool(cwd, { operations: scoped.read });
	const writeTool = createWriteTool(cwd, { operations: scoped.write });
	const editTool = createEditTool(cwd, { operations: scoped.edit });
	const bashTool = createBashTool(cwd, { operations: createDockerBashOperations(profile) });
	let ready = false;
	const assertReady = () => {
		if (!ready) throw new Error("Delegated Worker boundary is not ready");
	};

	pi.registerTool({
		...readTool,
		async execute(...args) {
			assertReady();
			return readTool.execute(...args);
		},
	});
	pi.registerTool({
		...writeTool,
		async execute(...args) {
			assertReady();
			return writeTool.execute(...args);
		},
	});
	pi.registerTool({
		...editTool,
		async execute(...args) {
			assertReady();
			return editTool.execute(...args);
		},
	});
	pi.registerTool({
		...bashTool,
		label: "bash (My Pi immutable Worker boundary)",
		async execute(id, input, signal, onUpdate) {
			assertReady();
			const analysis = analyzeCommand(input.command, {
				workspaceRoot: cwd,
				cwd,
				workspaceAliases: [profile.runtime.workdir],
				protectedPaths: [fileURLToPath(import.meta.url), join(PROFILE_DIR, "profile.json")],
			});
			const decision = resolveCommandPolicy(policyRequest(profile, cwd), analysis, {
				now: new Date().toISOString(),
			});
			if (!decision.executionAllowed) {
				const findingCodes = [...new Set(analysis.findings.map((finding) => finding.code))].join(",");
				throw new Error(
					`Delegated command blocked outcome=${decision.outcome} digest=${analysis.commandDigest} findings=${findingCodes || "none"}. ` +
					"Report this structured blocker to the Coordinator; do not retry through another tool.",
				);
			}
			const mutationFindings = analyzeToolCall("bash", { command: input.command }, cwd);
			if (mutationFindings.length > 0) {
				throw new Error(
					`Delegated command blocked by filesystem/data policy findings=${[...new Set(mutationFindings.map((finding) => finding.kind))].join(",")}. ` +
					"Report this structured blocker to the Coordinator; do not retry through another tool.",
				);
			}
			return bashTool.execute(id, input, signal, onUpdate);
		},
	});

	pi.on("session_start", () => {
		try {
			const contractDigest = process.env.MYPI_AGENT_TEAMS_PROFILE_DIGEST;
			if (!contractDigest || !/^[a-f0-9]{64}$/.test(contractDigest)) throw new Error("managed boundary contract digest is missing or malformed");
			verifyWorkerProfileArtifacts(profile);
			verifyManagedAgentTeamsSource(profile);
			verifyDockerBoundary(profile);
			const activeTools = [...pi.getActiveTools()].sort();
			// Pi reports CLI-selected built-ins here; backend extension tools are pinned by the verified teams source tree.
			const expectedTools = [...profile.workerResources.tools].sort();
			if (JSON.stringify(activeTools) !== JSON.stringify(expectedTools)) {
				throw new Error(`observed Worker tool set mismatch: ${activeTools.join(",")}`);
			}
			ready = true;
			process.stderr.write(`MYPI_WORKER_BOUNDARY_READY ${contractDigest}\n`);
		} catch (error) {
			process.stderr.write(`Fatal delegated Worker boundary initialization failure: ${String(error)}\n`);
			process.exit(78);
		}
	});
	pi.on("session_shutdown", () => {
		ready = false;
	});
}
