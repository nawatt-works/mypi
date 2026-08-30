import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
	cleanupAgentTeamsWorkerProfile,
	credentialLeaseSigningPayload,
	materializeAgentTeamsWorkerProfile,
	provisionAgentTeamsWorkerProfile,
	type AgentTeamsWorkerProfileConfiguration,
	type AgentTeamsWorkerSpawnIdentity,
	type CredentialLeasePayload,
} from "../extensions/agent-teams-worker-profile.ts";

const SECRET = "agent-teams-worker-secret";
const NOW = 2_000_000_000_000;
const NONCE = "b".repeat(64);
const CREDENTIAL = { type: "oauth" as const, refresh: `refresh-${SECRET}`, access: `access-${SECRET}`, expires: NOW + 3_600_000 };

function issueLease(input: {
	privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
	leaseId: string;
	runId: string;
	workerId: string;
	providerId?: string;
	readyNonce?: string;
	issuedAt?: number;
	expiresAt?: number;
	credential?: CredentialLeasePayload["credential"];
}): string {
	const payload: CredentialLeasePayload = {
		schemaVersion: 1,
		leaseId: input.leaseId,
		runId: input.runId,
		workerId: input.workerId,
		providerId: input.providerId ?? "openai-codex",
		readyNonceSha256: createHash("sha256").update(input.readyNonce ?? NONCE).digest("hex"),
		issuedAt: input.issuedAt ?? NOW - 1_000,
		expiresAt: input.expiresAt ?? NOW + 60_000,
		credential: input.credential ?? CREDENTIAL,
	};
	const signature = sign(null, credentialLeaseSigningPayload(payload), input.privateKey).toString("base64");
	return `${JSON.stringify({ ...payload, signature }, null, 2)}\n`;
}

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "mypi-agent-teams-worker-profile-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = join(root, "runtime");
	const defaultAgentDir = join(root, "default", ".pi", "agent");
	const credentialRoot = join(runtimeRoot, "credential-leases", "run-1");
	const credentialLeasePath = join(credentialRoot, "worker-a.auth.json");
	const teamsRootDir = join(runtimeRoot, "coordination");
	const worktree = join(root, "worktree");
	const workerBoundaryPath = join(root, "worker-boundary.ts");
	const teamsExtensionPath = join(root, "teams.ts");
	const leaseAuthorityRoot = join(runtimeRoot, "lease-authority");
	const consumedLeasesRoot = join(runtimeRoot, "consumed-leases");
	const claimedLeasesRoot = join(runtimeRoot, "claimed-leases");
	const credentialSourceRoot = join(runtimeRoot, "credential-source");
	for (const path of [
		runtimeRoot, defaultAgentDir, credentialRoot, teamsRootDir, worktree,
		leaseAuthorityRoot, consumedLeasesRoot, claimedLeasesRoot, credentialSourceRoot,
	]) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
	}
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const leasePublicKeyPath = join(leaseAuthorityRoot, "public.pem");
	await writeFile(leasePublicKeyPath, publicKeyPem, { mode: 0o600 });
	await writeFile(join(leaseAuthorityRoot, "private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
	await writeFile(join(credentialSourceRoot, "openai-codex.auth.json"), `${JSON.stringify({
		schemaVersion: 1,
		providerId: "openai-codex",
		credential: CREDENTIAL,
	}, null, 2)}\n`, { mode: 0o600 });
	const leaseRaw = issueLease({ privateKey, leaseId: "lease-worker-a-1", runId: "run-1", workerId: "worker-a" });
	await writeFile(credentialLeasePath, leaseRaw, { mode: 0o600 });
	await writeFile(workerBoundaryPath, "export default function boundary() {}\n", { mode: 0o600 });
	await writeFile(teamsExtensionPath, "export default function teams() {}\n", { mode: 0o600 });
	const agentTeamsWorkerProfilePath = fileURLToPath(new URL("../extensions/agent-teams-worker-profile.ts", import.meta.url));
	const workerProfileRuntimePath = fileURLToPath(new URL("../extensions/worker-profile-runtime.ts", import.meta.url));
	const configuration: AgentTeamsWorkerProfileConfiguration = {
		runtimeRoot,
		defaultAgentDir,
		providerId: "openai-codex",
		modelId: "gpt-5.4-mini",
		thinkingLevel: "low",
		workerBoundaryPath,
		teamsExtensionPath,
		boundaryContractDigest: "a".repeat(64),
		runtimeAuthorityDigest: "c".repeat(64),
		workerProfileRuntimePath,
		workerProfileRuntimeSha256: createHash("sha256").update(await readFile(workerProfileRuntimePath)).digest("hex"),
		agentTeamsWorkerProfilePath,
		agentTeamsWorkerProfileSha256: createHash("sha256").update(await readFile(agentTeamsWorkerProfilePath)).digest("hex"),
		maxWorkers: 2,
		leasePublicKeyPath,
		leasePublicKeySha256: createHash("sha256").update(publicKeyPem).digest("hex"),
	};
	const spawn: AgentTeamsWorkerSpawnIdentity = {
		runId: "run-1",
		workerId: "worker-a",
		worktree,
		teamId: "team-1",
		taskListId: "tasks-1",
		leadName: "team-lead",
		teamsRootDir,
		readyNonce: NONCE,
		credentialLeasePath,
		autoClaim: "0",
		style: "default",
	};
	return {
		root, runtimeRoot, defaultAgentDir, credentialRoot, credentialLeasePath, teamsRootDir, worktree,
		configuration, spawn, privateKey, publicKeyPem, leaseRaw, consumedLeasesRoot, claimedLeasesRoot,
	};
}

test("provisions an identity-bound lease and profile atomically without exposing secrets", async (t) => {
	const f = await fixture(t);
	await rm(f.credentialLeasePath);
	const { credentialLeasePath: _credentialLeasePath, ...spawn } = f.spawn;
	const worker = await provisionAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	});
	assert.ok(!JSON.stringify(worker).includes(SECRET));
	assert.ok(worker.leaseId.length > 0);
	const canonicalCredentialRoot = await realpath(f.credentialRoot);
	await assert.rejects(() => lstat(join(canonicalCredentialRoot, "worker-a.auth.json")), /ENOENT/);
	await cleanupAgentTeamsWorkerProfile({ worker, runtimeRoot: f.runtimeRoot, expectedProfileDigest: worker.profile.manifest.profileDigest });
});

test("atomic provisioning removes issued leases and partial profiles when materialization fails", async (t) => {
	const f = await fixture(t);
	await rm(f.credentialLeasePath);
	const { credentialLeasePath: _credentialLeasePath, ...spawn } = f.spawn;
	await assert.rejects(() => provisionAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn,
		environment: {},
		now: NOW,
	}), /Worker environment requires PATH/);
	await assert.rejects(() => lstat(f.credentialLeasePath), /ENOENT/);
	await assert.rejects(() => lstat(join(f.runtimeRoot, "runs", "run-1", "workers", "worker-a")), /ENOENT/);
	assert.deepEqual(await readdir(f.claimedLeasesRoot), []);
	assert.equal((await readdir(f.consumedLeasesRoot)).length, 1);
});

test("lease issuance rejects a mismatched private key before creating a Worker lease", async (t) => {
	const f = await fixture(t);
	await rm(f.credentialLeasePath);
	const wrongPrivateKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
	await writeFile(join(f.runtimeRoot, "lease-authority", "private.pem"), wrongPrivateKey, { mode: 0o600 });
	const { credentialLeasePath: _credentialLeasePath, ...spawn } = f.spawn;
	await assert.rejects(() => provisionAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /private key does not match/);
	await assert.rejects(() => lstat(f.credentialLeasePath), /ENOENT/);
});

test("materializes an exact child profile from a signed single-use lease without returning secrets", async (t) => {
	const f = await fixture(t);
	const worker = await materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/usr/bin:/bin", OPENAI_API_KEY: "ambient-must-not-leak" },
		now: NOW,
	});
	assert.equal(worker.leaseId, "lease-worker-a-1");
	assert.deepEqual(worker.childArgs, worker.profile.manifest.launchArgs.slice(2));
	assert.deepEqual(worker.childArgs.slice(0, 4), ["--name", "mypi-worker:worker-a", "--session-dir", worker.profile.manifest.paths.sessions]);
	assert.deepEqual(worker.profile.manifest.resources.tools, ["read", "bash", "edit", "write", "team_message"]);
	assert.deepEqual(worker.profile.manifest.resources.extensions.map((entry) => entry.path), [
		await realpath(f.configuration.workerBoundaryPath),
		await realpath(f.configuration.teamsExtensionPath),
	]);
	for (const key of [
		"MYPI_AGENT_TEAMS_RUNTIME_CONTRACT_DIGEST", "MYPI_AGENT_TEAMS_BOUNDARY_PATH", "MYPI_AGENT_TEAMS_ENTRY_PATH",
		"MYPI_AGENT_TEAMS_PROFILE_DIGEST", "MYPI_AGENT_TEAMS_READY_NONCE", "PI_TEAMS_TEAM_ID", "PI_TEAMS_WORKER",
	]) assert.ok(worker.profile.manifest.environmentKeys.includes(key), key);
	assert.equal(worker.profile.environment.OPENAI_API_KEY, undefined);
	assert.ok(!JSON.stringify(worker).includes(SECRET));
	assert.ok(!(await readFile(worker.profile.manifest.paths.manifest, "utf8")).includes(SECRET));
	assert.ok((await readFile(join(worker.profile.manifest.paths.agent, "auth.json"), "utf8")).includes(SECRET));
	await assert.rejects(() => lstat(f.credentialLeasePath), /ENOENT/);
	await assert.rejects(() => lstat(join(f.claimedLeasesRoot, "lease-worker-a-1.lease.json")), /ENOENT/);
	assert.ok(await lstat(join(f.consumedLeasesRoot, "lease-worker-a-1.json")));
	await cleanupAgentTeamsWorkerProfile({
		worker,
		runtimeRoot: f.runtimeRoot,
		expectedProfileDigest: worker.profile.manifest.profileDigest,
	});
	await assert.rejects(() => lstat(worker.profile.manifest.paths.workerRoot), /ENOENT/);
});

test("binds signed leases to run, Worker, provider, nonce, TTL, and authority key", async (t) => {
	const f = await fixture(t);
	const cases: Array<{ name: string; raw: string; spawn?: Partial<AgentTeamsWorkerSpawnIdentity>; config?: Partial<AgentTeamsWorkerProfileConfiguration>; error: RegExp }> = [
		{
			name: "worker",
			raw: issueLease({ privateKey: f.privateKey, leaseId: "lease-wrong-worker", runId: "run-1", workerId: "worker-other" }),
			error: /identity does not match/,
		},
		{
			name: "nonce",
			raw: issueLease({ privateKey: f.privateKey, leaseId: "lease-wrong-nonce", runId: "run-1", workerId: "worker-a", readyNonce: "c".repeat(64) }),
			error: /nonce does not match/,
		},
		{
			name: "expired",
			raw: issueLease({ privateKey: f.privateKey, leaseId: "lease-expired", runId: "run-1", workerId: "worker-a", issuedAt: NOW - 120_000, expiresAt: NOW - 60_000 }),
			error: /expired, future-dated, or exceeds/,
		},
		{
			name: "future",
			raw: issueLease({ privateKey: f.privateKey, leaseId: "lease-future", runId: "run-1", workerId: "worker-a", issuedAt: NOW + 60_000, expiresAt: NOW + 120_000 }),
			error: /expired, future-dated, or exceeds/,
		},
		{
			name: "ttl",
			raw: issueLease({ privateKey: f.privateKey, leaseId: "lease-long-ttl", runId: "run-1", workerId: "worker-a", issuedAt: NOW - 1_000, expiresAt: NOW + 600_000 }),
			error: /expired, future-dated, or exceeds/,
		},
	];
	for (const scenario of cases) {
		await writeFile(f.credentialLeasePath, scenario.raw, { mode: 0o600 });
		await assert.rejects(() => materializeAgentTeamsWorkerProfile({
			configuration: { ...f.configuration, ...scenario.config },
			spawn: { ...f.spawn, ...scenario.spawn },
			environment: { PATH: "/bin" },
			now: NOW,
		}), scenario.error, scenario.name);
	}
	const tampered = JSON.parse(f.leaseRaw);
	tampered.credential.access = "tampered";
	await writeFile(f.credentialLeasePath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /signature verification failed/);

	const wrongKey = generateKeyPairSync("ed25519").privateKey;
	await writeFile(f.credentialLeasePath, issueLease({
		privateKey: wrongKey,
		leaseId: "lease-wrong-key",
		runId: "run-1",
		workerId: "worker-a",
	}), { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /signature verification failed/);

	const run2Root = join(f.runtimeRoot, "credential-leases", "run-2");
	await mkdir(run2Root, { mode: 0o700 });
	const run2Lease = join(run2Root, "worker-a.auth.json");
	await writeFile(run2Lease, f.leaseRaw, { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, runId: "run-2", credentialLeasePath: run2Lease },
		environment: { PATH: "/bin" },
		now: NOW,
	}), /identity does not match/);
});

test("rejects copied leases across Workers and persistent replay after cleanup", async (t) => {
	const f = await fixture(t);
	const first = await materializeAgentTeamsWorkerProfile({ configuration: f.configuration, spawn: f.spawn, environment: { PATH: "/bin" }, now: NOW });
	await cleanupAgentTeamsWorkerProfile({ worker: first, runtimeRoot: f.runtimeRoot, expectedProfileDigest: first.profile.manifest.profileDigest });
	await writeFile(f.credentialLeasePath, f.leaseRaw, { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /already consumed/);

	const workerBLease = join(f.credentialRoot, "worker-b.auth.json");
	await writeFile(workerBLease, f.leaseRaw, { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, workerId: "worker-b", credentialLeasePath: workerBLease },
		environment: { PATH: "/bin" },
		now: NOW,
	}), /identity does not match/);
});

test("a failure after atomic claim leaves no usable profile or replayable lease", async (t) => {
	const f = await fixture(t);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: {},
		now: NOW,
	}), /Worker environment requires PATH/);
	await assert.rejects(() => lstat(f.credentialLeasePath), /ENOENT/);
	await assert.rejects(() => lstat(join(f.claimedLeasesRoot, "lease-worker-a-1.lease.json")), /ENOENT/);
	await assert.rejects(() => lstat(join(f.runtimeRoot, "runs", "run-1", "workers", "worker-a")), /ENOENT/);
	assert.ok(await lstat(join(f.consumedLeasesRoot, "lease-worker-a-1.json")));
});

test("keeps mutable state disjoint when the authority issues distinct Worker leases", async (t) => {
	const f = await fixture(t);
	const first = await materializeAgentTeamsWorkerProfile({ configuration: f.configuration, spawn: f.spawn, environment: { PATH: "/bin" }, now: NOW });
	const secondLease = join(f.credentialRoot, "worker-b.auth.json");
	await writeFile(secondLease, issueLease({
		privateKey: f.privateKey,
		leaseId: "lease-worker-b-1",
		runId: "run-1",
		workerId: "worker-b",
	}), { mode: 0o600 });
	const second = await materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, workerId: "worker-b", credentialLeasePath: secondLease },
		environment: { PATH: "/bin" },
		now: NOW,
	});
	assert.notEqual(first.profile.manifest.paths.agent, second.profile.manifest.paths.agent);
	assert.notEqual(first.profile.manifest.paths.sessions, second.profile.manifest.paths.sessions);
	assert.notEqual(first.profile.manifest.profileDigest, second.profile.manifest.profileDigest);
});

test("rejects leases outside the exact private hierarchy, symlinks, and unsafe permissions", async (t) => {
	const f = await fixture(t);
	const outside = join(f.root, "outside.auth.json");
	await writeFile(outside, f.leaseRaw, { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, credentialLeasePath: outside },
		environment: { PATH: "/bin" },
		now: NOW,
	}), /outside the Worker-scoped lease store/);

	const realSource = join(f.credentialRoot, "real.auth.json");
	await writeFile(realSource, f.leaseRaw, { mode: 0o600 });
	await rm(f.credentialLeasePath);
	await symlink(realSource, f.credentialLeasePath);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /real file/);
	await rm(f.credentialLeasePath);
	await writeFile(f.credentialLeasePath, f.leaseRaw, { mode: 0o640 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /private owner read\/write permissions/);
});

test("requires exact coordination, trusted extensions, Worker limits, and public-key digest", async (t) => {
	const f = await fixture(t);
	const externalTeamsRoot = join(f.root, "external-teams");
	await mkdir(externalTeamsRoot, { mode: 0o700 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, teamsRootDir: externalTeamsRoot },
		environment: { PATH: "/bin" },
		now: NOW,
	}), /dedicated Worker coordination root/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, workerId: "../escape" },
		environment: { PATH: "/bin" },
		now: NOW,
	}), /bounded identifier/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: { ...f.configuration, agentTeamsWorkerProfileSha256: "f".repeat(64) },
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /adapter digest mismatch/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: { ...f.configuration, workerProfileRuntimeSha256: "f".repeat(64) },
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /runtime digest mismatch/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: { ...f.configuration, maxWorkers: 4 },
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /integer from 1 to 3/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: { ...f.configuration, leasePublicKeySha256: "f".repeat(64) },
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /public key digest mismatch/);
	const worktreeExtension = join(f.worktree, "forged-boundary.ts");
	await writeFile(worktreeExtension, "export default function forged() {}\n");
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: { ...f.configuration, workerBoundaryPath: worktreeExtension },
		spawn: f.spawn,
		environment: { PATH: "/bin" },
		now: NOW,
	}), /trusted Worker extensions must be outside/);
});
