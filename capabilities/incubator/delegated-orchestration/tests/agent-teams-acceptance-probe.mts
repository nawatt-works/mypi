import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAgentTeamsProfile } from "../extensions/agent-teams-profile.ts";
import { defaultWorkerRuntimeRoot, verifyWorkerMachine } from "../extensions/worker-machine-setup.ts";

const checkout = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("patched agent-teams checkout is required");
const outputRoot = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), "mypi-agent-teams-acceptance-"));
const runtimeRoot = defaultWorkerRuntimeRoot();
const expectedSetupDigest = process.env.MYPI_ACCEPTANCE_SETUP_DIGEST ?? "";
const sourceAgentDir = process.env.MYPI_ACCEPTANCE_SOURCE_AGENT_DIR ?? "";
const providerId = process.env.MYPI_ACCEPTANCE_PROVIDER_ID ?? "";
const modelId = process.env.MYPI_ACCEPTANCE_MODEL_ID ?? "";
const thinkingLevel = process.env.MYPI_ACCEPTANCE_THINKING_LEVEL ?? "low";
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

function blocked(reason: string): never {
	process.stdout.write(`${JSON.stringify({
		schemaVersion: 1,
		kind: "mypi-agent-teams-generated-profile-acceptance-blocker",
		status: "BLOCKED",
		reason,
		productionActivated: false,
		nextRequiredAction: "run /mypi-worker-setup setup in the Development Pi profile, then /mypi-worker-acceptance",
	}, null, 2)}\n`);
	process.exit(78);
}

if (!existsSync(runtimeRoot)) blocked("verified Worker machine setup is absent");
if (!DIGEST.test(expectedSetupDigest)) blocked("trusted setup receipt was not supplied by the Development Pi session");
if (!sourceAgentDir || !providerId || !modelId) blocked("acceptance requires source profile, provider and model from the Development Pi session");
if (!ID.test(providerId) || !ID.test(modelId)) blocked("acceptance provider/model identity is invalid");
if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(thinkingLevel)) blocked("acceptance thinking level is invalid");

const machine = await verifyWorkerMachine({ runtimeRoot, sourceAgentDir, providerId, expectedSetupDigest });
if (!machine.verified || !machine.manifest) blocked(`Worker machine verification failed: ${machine.mismatches.join(",")}`);

const entryPath = join(checkout, "extensions", "teams", "index.ts");
const head = spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 });
if (head.status !== 0) throw new Error(head.stderr || "unable to identify agent-teams checkout");
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await chmod(outputRoot, 0o700);
const fixture = join(outputRoot, "fixture");
const leaderSessions = join(outputRoot, "leader-sessions");
await mkdir(fixture, { mode: 0o700 });
await mkdir(leaderSessions, { mode: 0o700 });
for (const args of [
	["init", "-q"],
	["config", "user.email", "acceptance@invalid.local"],
	["config", "user.name", "My Pi Acceptance"],
]) {
	const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8", timeout: 10_000 });
	if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
}
await writeFile(join(fixture, "README.md"), "# Generated-profile acceptance fixture\n", { mode: 0o600 });
for (const args of [["add", "README.md"], ["commit", "-q", "-m", "acceptance fixture"]]) {
	const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8", timeout: 10_000 });
	if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
}

const profile = buildAgentTeamsProfile({
	upstreamCommit: head.stdout.trim(),
	patchedTeamsEntryPath: entryPath,
	runtimeRoot,
	defaultAgentDir: sourceAgentDir,
	providerId,
	modelId,
	thinkingLevel: thinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
	leasePublicKeyPath: machine.manifest.leasePublicKeyPath,
	leasePublicKeySha256: machine.manifest.leasePublicKeySha256,
	machineSetupDigest: machine.manifest.setupDigest,
	credentialRevision: machine.manifest.credentialRevision,
	maxWorkers: 1,
	environment: process.env,
});

type RpcResponse = { id: string; type: "response"; success: boolean; error?: string; data?: unknown };
class RpcClient {
	readonly child: ChildProcessWithoutNullStreams;
	readonly notices: string[] = [];
	readonly events: unknown[] = [];
	private sequence = 0;
	private buffer = "";
	private pending = new Map<string, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
	stderr = "";

	constructor(command: string, args: string[], options: { cwd: string; env: Record<string, string> }) {
		this.child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
		this.child.stdout.on("data", (chunk) => this.consume(chunk.toString()));
		this.child.stderr.on("data", (chunk) => { this.stderr += chunk.toString(); });
		this.child.on("close", (code) => {
			for (const request of this.pending.values()) {
				clearTimeout(request.timer);
				request.reject(new Error(`RPC process exited with ${code}; stderr=${this.stderr.slice(-2000)}`));
			}
			this.pending.clear();
		});
	}

	private consume(text: string): void {
		this.buffer += text;
		let newline: number;
		while ((newline = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			if (!line.trim()) continue;
			let value: any;
			try { value = JSON.parse(line); } catch { continue; }
			if (value.type === "response" && typeof value.id === "string") {
				const request = this.pending.get(value.id);
				if (request) {
					clearTimeout(request.timer);
					this.pending.delete(value.id);
					value.success ? request.resolve(value) : request.reject(new Error(value.error ?? "RPC command failed"));
				}
			} else {
				this.events.push(value);
				if (value.type === "extension_ui_request" && value.method === "notify" && typeof value.message === "string") this.notices.push(value.message);
			}
		}
	}

	async send(command: Record<string, unknown>, timeout = 90_000): Promise<RpcResponse> {
		const id = `acceptance-${++this.sequence}`;
		const payload = `${JSON.stringify({ id, ...command })}\n`;
		return new Promise((resolvePromise, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC command timed out: ${String(command.type)}`));
			}, timeout);
			this.pending.set(id, { resolve: resolvePromise, reject, timer });
			this.child.stdin.write(payload);
		});
	}

	async command(value: string): Promise<void> {
		const noticeOffset = this.notices.length;
		await this.send({ type: "prompt", message: value });
		const failures = this.notices.slice(noticeOffset).filter((notice) => /failed|error|unknown|missing|reached|invalid/i.test(notice));
		if (failures.length > 0) throw new Error(`extension command reported ${failures.length} failure notice(s)`);
	}

	async stop(): Promise<void> {
		if (this.child.exitCode !== null) return;
		this.child.kill("SIGTERM");
		await new Promise<void>((resolvePromise) => {
			const timer = setTimeout(() => { this.child.kill("SIGKILL"); resolvePromise(); }, 2_000);
			this.child.once("close", () => { clearTimeout(timer); resolvePromise(); });
		});
	}
}

async function waitForFile(path: string, timeout: number): Promise<Buffer> {
	const started = Date.now();
	for (;;) {
		try { return await readFile(path); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (Date.now() - started >= timeout) throw new Error(`timed out waiting for Worker artifact: ${path}`);
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
}

function verifyExactWorkerPid(workerPid: number, leaderPid: number): number {
	if (!Number.isSafeInteger(workerPid) || workerPid <= 1) throw new Error("persisted generated Worker process identity is invalid");
	const result = spawnSync("ps", ["-p", String(workerPid), "-o", "ppid="], { encoding: "utf8", timeout: 10_000 });
	if (result.status !== 0) throw new Error("could not inspect the generated Worker process identity");
	if (Number(result.stdout.trim()) !== leaderPid) throw new Error("persisted process is not owned by the exact acceptance leader");
	return workerPid;
}

async function waitUntilProcessAbsent(pid: number, timeout = 15_000): Promise<void> {
	const started = Date.now();
	for (;;) {
		try { process.kill(pid, 0); } catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			throw error;
		}
		if (Date.now() - started >= timeout) throw new Error("forced-crash Worker process did not exit");
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
}

async function waitUntilAbsent(path: string, timeout = 15_000): Promise<void> {
	const started = Date.now();
	for (;;) {
		try { await lstat(path); } catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		if (Date.now() - started >= timeout) throw new Error(`cleanup did not remove ${path}`);
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
	}
}

const leaderArgs = [
	"--mode", "rpc", "--session-dir", leaderSessions,
	"--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
	"--no-extensions", "-e", entryPath,
];
const leader = new RpcClient("pi", leaderArgs, { cwd: fixture, env: { ...profile.leaderEnvironment } });
const workerName = "acceptance-worker";
const artifactNonce = randomBytes(24).toString("hex");
let teamId = "";
let workerCwd = "";
const evidence: Record<string, unknown> = {
	schemaVersion: 1,
	kind: "mypi-agent-teams-generated-profile-acceptance",
	status: "RUNNING",
	productionActivated: false,
	profileDigest: profile.profileDigest,
	runtimeAuthorityDigest: profile.runtimeAuthorityDigest,
	machineSetupDigest: machine.manifest.setupDigest,
	credentialRevision: machine.manifest.credentialRevision,
	providerId,
	modelId,
	checks: {},
};

try {
	const state = await leader.send({ type: "get_state" }, 20_000);
	teamId = String((state.data as { sessionId?: unknown })?.sessionId ?? "");
	if (!ID.test(teamId)) throw new Error("leader did not expose a bounded session/team identity");
	await leader.command(`/team spawn ${workerName} fresh worktree`);
	const teamConfigPath = join(runtimeRoot, "coordination", teamId, "config.json");
	type PersistedMember = { name?: string; status?: string; cwd?: string; meta?: { childProfile?: { generatedProfileDigest?: unknown; leaseId?: unknown; processId?: unknown } } };
	const readPersistedMember = async (): Promise<PersistedMember> => {
		const config = JSON.parse((await readFile(teamConfigPath, "utf8"))) as { members?: PersistedMember[] };
		const member = config.members?.find((entry) => entry.name === workerName);
		if (!member || member.status !== "online" || typeof member.cwd !== "string" ||
			typeof member.meta?.childProfile?.generatedProfileDigest !== "string" || typeof member.meta.childProfile.leaseId !== "string" ||
			!Number.isSafeInteger(member.meta.childProfile.processId)) {
			throw new Error("Worker generated-profile readiness was not persisted");
		}
		return member;
	};
	const member = await readPersistedMember();
	const firstGeneration = {
		profileDigest: member.meta!.childProfile!.generatedProfileDigest as string,
		leaseId: member.meta!.childProfile!.leaseId as string,
	};
	workerCwd = await realpath(member.cwd!);
	const artifactPath = join(workerCwd, "generated-profile-acceptance.json");
	const expectedArtifact = { schemaVersion: 1, kind: "mypi-generated-profile-real-provider", nonce: artifactNonce, result: "PASS" };
	await leader.command(`/team send ${workerName} Create generated-profile-acceptance.json in the current worktree with exactly this JSON and no markdown: ${JSON.stringify(expectedArtifact)}. Use the write tool. Do not modify any other file.`);
	const artifact = JSON.parse((await waitForFile(artifactPath, 300_000)).toString("utf8"));
	if (JSON.stringify(artifact) !== JSON.stringify(expectedArtifact)) throw new Error("Worker artifact content did not match the acceptance contract");
	const interactiveRequests = leader.events.filter((event) => {
		if (!event || typeof event !== "object") return false;
		const value = event as { type?: unknown; method?: unknown };
		return value.type === "extension_ui_request" && ["confirm", "select", "input", "editor"].includes(String(value.method));
	});
	if (interactiveRequests.length !== 0) throw new Error("acceptance observed an interactive approval/input request");
	const status = spawnSync("git", ["status", "--porcelain"], { cwd: workerCwd, encoding: "utf8", timeout: 10_000 });
	if (status.status !== 0 || status.stdout.trim() !== "?? generated-profile-acceptance.json") {
		throw new Error("real-provider task mutated files outside its exact worktree artifact contract");
	}
	const firstWorkerRoot = join(runtimeRoot, "runs", teamId, "workers", workerName);
	const workerPid = verifyExactWorkerPid(member.meta!.childProfile!.processId as number, leader.child.pid!);
	process.kill(workerPid, "SIGKILL");
	await waitUntilProcessAbsent(workerPid);
	await leader.command(`/team spawn ${workerName} fresh worktree`);
	const replacement = await readPersistedMember();
	const secondGeneration = {
		profileDigest: replacement.meta!.childProfile!.generatedProfileDigest as string,
		leaseId: replacement.meta!.childProfile!.leaseId as string,
	};
	if (secondGeneration.profileDigest === firstGeneration.profileDigest || secondGeneration.leaseId === firstGeneration.leaseId) {
		throw new Error("same-name replacement reused the prior generated profile or credential lease identity");
	}
	await realpath(replacement.cwd!);
	await leader.command(`/team kill ${workerName}`);
	await waitUntilAbsent(firstWorkerRoot);
	const prematureLeaderLossMarkers = (await readdir(join(runtimeRoot, "coordination", teamId))).filter((name) => name.startsWith("leader-loss-"));
	if (prematureLeaderLossMarkers.length !== 0) throw new Error("orderly Worker shutdown was misclassified as leader loss");
	await leader.command(`/team spawn ${workerName} fresh worktree`);
	const orphaned = await readPersistedMember();
	const orphanedDigest = orphaned.meta!.childProfile!.generatedProfileDigest as string;
	const orphanedPid = verifyExactWorkerPid(orphaned.meta!.childProfile!.processId as number, leader.child.pid!);
	const leaderPid = leader.child.pid!;
	leader.child.kill("SIGKILL");
	await waitUntilProcessAbsent(leaderPid);
	await waitUntilProcessAbsent(orphanedPid);
	await waitUntilAbsent(firstWorkerRoot);
	const leaderLossMarker = JSON.parse(await readFile(join(runtimeRoot, "coordination", teamId, `leader-loss-${workerName}-${orphanedDigest}.json`), "utf8"));
	if (leaderLossMarker.kind !== "mypi-agent-teams-leader-loss" || leaderLossMarker.teamId !== teamId ||
		leaderLossMarker.workerId !== workerName || leaderLossMarker.profileDigest !== orphanedDigest || leaderLossMarker.worktree !== orphaned.cwd) {
		throw new Error("leader-loss reconciliation marker does not match the exact orphaned generation");
	}
	if (await realpath(leaderLossMarker.worktree) !== leaderLossMarker.worktree) throw new Error("leader-loss worktree was not retained for artifact recovery");
	const claimed = await readdir(join(runtimeRoot, "claimed-leases"));
	const leasesRunRoot = join(runtimeRoot, "credential-leases", teamId);
	const leases = existsSync(leasesRunRoot) ? await readdir(leasesRunRoot) : [];
	if (claimed.length !== 0 || leases.length !== 0) throw new Error("reusable Worker credential lease state remained after cleanup");
	const checks = evidence.checks as Record<string, boolean>;
	checks.realProviderArtifact = true;
	checks.generatedSpawnReadiness = true;
	checks.boundedWorktreeMutation = true;
	checks.noInteractiveRequests = true;
	checks.forcedCrashCleanup = true;
	checks.leaderLossCleanup = true;
	checks.leaderLossWorktreeRetained = true;
	checks.orderlyShutdownClassified = true;
	checks.stopCleanup = true;
	checks.sameNameReplacement = true;
	checks.noReusableCredentialState = true;
	evidence.status = "PASS";
	evidence.teamId = teamId;
	evidence.workerName = workerName;
	evidence.generatedProfileRootRemoved = true;
	evidence.interactiveRequestsObserved = interactiveRequests.length;
	await writeFile(join(outputRoot, "acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
	evidence.status = "FAIL";
	const diagnostic = error instanceof Error ? `${error.name}:${error.message}` : String(error);
	evidence.errorDigest = createHash("sha256").update(diagnostic).digest("hex");
	evidence.teamId = teamId || undefined;
	evidence.noticeCount = leader.notices.length;
	await writeFile(join(outputRoot, "acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	throw new Error("generated-profile acceptance failed; redacted evidence was emitted for the Coordinator audit");
} finally {
	if (teamId) await leader.command("/team done --force").catch(() => undefined);
	await leader.stop().catch(() => undefined);
}
