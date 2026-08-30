import { createHash, randomUUID, sign as signPayload, verify as verifySignature } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	cleanupMaterializedWorkerProfile,
	materializeWorkerProfile,
	verifyMaterializedWorkerProfile,
	type MaterializedWorkerProfile,
	type WorkerCredential,
} from "./worker-profile-runtime.ts";

const AGENT_TEAMS_TOOLS = ["read", "bash", "edit", "write", "team_message"] as const;
const DIGEST = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const MAX_LEASE_TTL_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;

export type AgentTeamsWorkerProfileConfiguration = {
	runtimeRoot: string;
	defaultAgentDir: string;
	providerId: string;
	modelId: string;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	workerBoundaryPath: string;
	teamsExtensionPath: string;
	boundaryContractDigest: string;
	runtimeAuthorityDigest: string;
	workerProfileRuntimePath: string;
	workerProfileRuntimeSha256: string;
	agentTeamsWorkerProfilePath: string;
	agentTeamsWorkerProfileSha256: string;
	maxWorkers: number;
	leasePublicKeyPath: string;
	leasePublicKeySha256: string;
};

export type AgentTeamsWorkerSpawnIdentity = {
	runId: string;
	workerId: string;
	worktree: string;
	teamId: string;
	taskListId: string;
	leadName: string;
	teamsRootDir: string;
	readyNonce: string;
	credentialLeasePath: string;
	autoClaim: "0" | "1";
	style: string;
};

export type CredentialLeasePayload = {
	schemaVersion: 1;
	leaseId: string;
	runId: string;
	workerId: string;
	providerId: string;
	readyNonceSha256: string;
	issuedAt: number;
	expiresAt: number;
	credential: WorkerCredential;
};

export type SignedCredentialLease = CredentialLeasePayload & { signature: string };

export type AgentTeamsMaterializedWorker = {
	profile: MaterializedWorkerProfile;
	childArgs: string[];
	leaseId: string;
};

export type IssuedAgentTeamsCredentialLease = {
	leaseId: string;
	credentialLeasePath: string;
};

type LoadedCredentialLease = {
	providerId: string;
	credential: WorkerCredential;
	leaseId: string;
	leasePath: string;
	rawSha256: string;
};

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
	}
	const encoded = JSON.stringify(value);
	if (encoded === undefined) throw new Error("credential lease must be JSON serializable");
	return encoded;
}

export function credentialLeaseSigningPayload(lease: CredentialLeasePayload): Buffer {
	return Buffer.from(canonicalJson(lease));
}

function requireIdentifier(label: string, value: string): string {
	if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error(`${label} must be a bounded identifier`);
	return value;
}

function requireDigest(label: string, value: string): string {
	if (!DIGEST.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
	return value;
}

function requireAbsolute(label: string, value: string): string {
	if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path`);
	return resolve(value);
}

function pathContains(parent: string, child: string): boolean {
	const relation = relative(parent, child);
	return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

async function canonicalDirectory(label: string, value: string): Promise<string> {
	const requested = requireAbsolute(label, value);
	const info = await lstat(requested);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory`);
	return realpath(requested);
}

async function canonicalPrivateDirectory(label: string, value: string): Promise<string> {
	const requested = requireAbsolute(label, value);
	const info = await lstat(requested);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory`);
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`${label} has a different owner`);
	if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (info.mode & 0o700) !== 0o700)) {
		throw new Error(`${label} must be private and owner-accessible`);
	}
	return realpath(requested);
}

async function canonicalFile(label: string, value: string): Promise<string> {
	const requested = requireAbsolute(label, value);
	const info = await lstat(requested);
	if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a real file`);
	return realpath(requested);
}

async function loadLeasePublicKey(input: {
	runtimeRoot: string;
	path: string;
	expectedSha256: string;
}): Promise<Buffer> {
	const authorityRoot = await canonicalPrivateDirectory("lease authority root", join(input.runtimeRoot, "lease-authority"));
	const requested = requireAbsolute("leasePublicKeyPath", input.path);
	const expected = join(authorityRoot, "public.pem");
	const info = await lstat(requested);
	if (info.isSymbolicLink() || !info.isFile()) throw new Error("lease public key must be a real file");
	const canonical = await realpath(requested);
	if (canonical !== expected) throw new Error("lease public key is outside the authority root");
	const content = await readFile(canonical);
	if (sha256(content) !== requireDigest("leasePublicKeySha256", input.expectedSha256)) {
		throw new Error("lease public key digest mismatch");
	}
	return content;
}

async function loadPrivateFile(label: string, path: string): Promise<Buffer> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a real file`);
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`${label} has a different owner`);
	if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (info.mode & 0o600) !== 0o600)) {
		throw new Error(`${label} must use private owner read/write permissions`);
	}
	if (await realpath(path) !== path) throw new Error(`${label} identity is not canonical`);
	return readFile(path);
}

function parseCredentialSource(raw: Buffer, providerId: string): WorkerCredential {
	let value: unknown;
	try {
		value = JSON.parse(raw.toString("utf8"));
	} catch {
		throw new Error("Worker credential source is malformed");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker credential source must be an object");
	const record = value as Record<string, unknown>;
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["credential", "providerId", "revision", "schemaVersion"])) {
		throw new Error("Worker credential source has an invalid shape");
	}
	if (record.schemaVersion !== 1 || record.providerId !== providerId || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1 ||
		!record.credential || typeof record.credential !== "object") {
		throw new Error("Worker credential source identity does not match the requested provider");
	}
	return record.credential as WorkerCredential;
}

export async function issueAgentTeamsCredentialLease(input: {
	configuration: AgentTeamsWorkerProfileConfiguration;
	runId: string;
	workerId: string;
	readyNonce: string;
	now?: number;
}): Promise<IssuedAgentTeamsCredentialLease> {
	const runtimeRoot = await canonicalPrivateDirectory("runtimeRoot", input.configuration.runtimeRoot);
	const providerId = requireIdentifier("providerId", input.configuration.providerId);
	const runId = requireIdentifier("runId", input.runId);
	const workerId = requireIdentifier("workerId", input.workerId);
	const readyNonce = requireDigest("readyNonce", input.readyNonce);
	const authorityRoot = await canonicalPrivateDirectory("lease authority root", join(runtimeRoot, "lease-authority"));
	const privateKeyPath = join(authorityRoot, "private.pem");
	const privateKey = await loadPrivateFile("lease private key", privateKeyPath);
	const publicKey = await loadLeasePublicKey({
		runtimeRoot,
		path: input.configuration.leasePublicKeyPath,
		expectedSha256: input.configuration.leasePublicKeySha256,
	});
	const credentialSourceRoot = await canonicalPrivateDirectory("credential source root", join(runtimeRoot, "credential-source"));
	const credentialSourcePath = join(credentialSourceRoot, `${providerId}.auth.json`);
	const credential = parseCredentialSource(await loadPrivateFile("Worker credential source", credentialSourcePath), providerId);
	const leasesRoot = await canonicalPrivateDirectory("credential lease root", join(runtimeRoot, "credential-leases"));
	const runLeaseRootPath = join(leasesRoot, runId);
	try {
		await mkdir(runLeaseRootPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const runLeaseRoot = await canonicalPrivateDirectory("run credential lease root", runLeaseRootPath);
	const credentialLeasePath = join(runLeaseRoot, `${workerId}.auth.json`);
	const now = input.now ?? Date.now();
	if (!Number.isSafeInteger(now)) throw new Error("credential lease issuance time is invalid");
	const payload: CredentialLeasePayload = {
		schemaVersion: 1,
		leaseId: randomUUID(),
		runId,
		workerId,
		providerId,
		readyNonceSha256: sha256(readyNonce),
		issuedAt: now,
		expiresAt: now + 60_000,
		credential,
	};
	let signature: Buffer;
	try {
		signature = signPayload(null, credentialLeaseSigningPayload(payload), privateKey);
	} catch (error) {
		throw new Error("credential lease signing failed", { cause: error });
	}
	if (!verifySignature(null, credentialLeaseSigningPayload(payload), publicKey, signature)) {
		throw new Error("lease authority private key does not match the pinned public key");
	}
	const raw = `${JSON.stringify({ ...payload, signature: signature.toString("base64") }, null, 2)}\n`;
	try {
		await writeFile(credentialLeasePath, raw, { mode: 0o600, flag: "wx" });
	} catch (error) {
		throw new Error("Worker credential lease could not be issued", { cause: error });
	}
	return { leaseId: payload.leaseId, credentialLeasePath };
}

function parseSignedLease(raw: Buffer): SignedCredentialLease {
	let value: unknown;
	try {
		value = JSON.parse(raw.toString("utf8"));
	} catch {
		throw new Error("credential lease is missing or malformed");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("credential lease must be an object");
	const expectedFields = [
		"credential", "expiresAt", "issuedAt", "leaseId", "providerId", "readyNonceSha256",
		"runId", "schemaVersion", "signature", "workerId",
	].sort();
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedFields)) throw new Error("credential lease has an invalid shape");
	return value as SignedCredentialLease;
}

async function loadCredentialLease(input: {
	runtimeRoot: string;
	defaultAgentDir: string;
	credentialLeasePath: string;
	providerId: string;
	runId: string;
	workerId: string;
	readyNonce: string;
	publicKey: Buffer;
	now: number;
}): Promise<LoadedCredentialLease> {
	const leasesRoot = await canonicalPrivateDirectory("credential lease root", join(input.runtimeRoot, "credential-leases"));
	const runLeaseRoot = await canonicalPrivateDirectory("run credential lease root", join(leasesRoot, input.runId));
	const requested = requireAbsolute("credentialLeasePath", input.credentialLeasePath);
	const expected = join(runLeaseRoot, `${input.workerId}.auth.json`);
	const info = await lstat(requested);
	if (info.isSymbolicLink() || !info.isFile()) throw new Error("credential lease must be a real file");
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("credential lease has a different owner");
	if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (info.mode & 0o600) !== 0o600)) {
		throw new Error("credential lease must use private owner read/write permissions");
	}
	const leasePath = await realpath(requested);
	if (leasePath !== expected) throw new Error("credential lease is outside the Worker-scoped lease store");
	if (pathContains(input.defaultAgentDir, leasePath) || pathContains(leasePath, input.defaultAgentDir)) {
		throw new Error("credential lease must not overlap the Default Pi profile");
	}
	const raw = await readFile(leasePath);
	const signed = parseSignedLease(raw);
	if (signed.schemaVersion !== 1) throw new Error("unsupported credential lease schema");
	const leaseId = requireIdentifier("leaseId", signed.leaseId);
	if (signed.runId !== input.runId || signed.workerId !== input.workerId || signed.providerId !== input.providerId) {
		throw new Error("credential lease identity does not match the requested Worker");
	}
	if (signed.readyNonceSha256 !== sha256(input.readyNonce)) throw new Error("credential lease nonce does not match the requested spawn");
	if (!Number.isSafeInteger(signed.issuedAt) || !Number.isSafeInteger(signed.expiresAt) || signed.expiresAt <= signed.issuedAt) {
		throw new Error("credential lease timestamps are invalid");
	}
	if (signed.issuedAt > input.now + MAX_CLOCK_SKEW_MS || signed.expiresAt <= input.now || signed.expiresAt - signed.issuedAt > MAX_LEASE_TTL_MS) {
		throw new Error("credential lease is expired, future-dated, or exceeds the TTL ceiling");
	}
	if (typeof signed.signature !== "string" || signed.signature.length > 1024) throw new Error("credential lease signature is invalid");
	const { signature, ...payload } = signed;
	let signatureBytes: Buffer;
	try {
		signatureBytes = Buffer.from(signature, "base64");
	} catch {
		throw new Error("credential lease signature is invalid");
	}
	if (signatureBytes.length === 0 || !verifySignature(null, credentialLeaseSigningPayload(payload), input.publicKey, signatureBytes)) {
		throw new Error("credential lease signature verification failed");
	}
	return { providerId: input.providerId, credential: signed.credential, leaseId, leasePath, rawSha256: sha256(raw) };
}

async function claimCredentialLease(input: {
	runtimeRoot: string;
	lease: LoadedCredentialLease;
	runId: string;
	workerId: string;
}): Promise<string> {
	const consumedRoot = await canonicalPrivateDirectory("consumed lease root", join(input.runtimeRoot, "consumed-leases"));
	const claimedRoot = await canonicalPrivateDirectory("claimed lease root", join(input.runtimeRoot, "claimed-leases"));
	const markerPath = join(consumedRoot, `${input.lease.leaseId}.json`);
	const marker = {
		schemaVersion: 1,
		leaseId: input.lease.leaseId,
		runId: input.runId,
		workerId: input.workerId,
		leaseSha256: input.lease.rawSha256,
	};
	try {
		await writeFile(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600, flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("credential lease was already consumed");
		throw new Error("credential lease consumption marker could not be created", { cause: error });
	}
	const claimedPath = join(claimedRoot, `${input.lease.leaseId}.lease.json`);
	try {
		await lstat(claimedPath);
		throw new Error("credential lease claim target already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	try {
		await rename(input.lease.leasePath, claimedPath);
	} catch (error) {
		// The durable consumed marker intentionally remains: ambiguous claims fail
		// closed and require operator reconciliation, never a retry with the lease.
		throw new Error("credential lease could not be atomically claimed", { cause: error });
	}
	const claimedInfo = await lstat(claimedPath);
	if (claimedInfo.isSymbolicLink() || !claimedInfo.isFile() || await realpath(claimedPath) !== claimedPath) {
		throw new Error("claimed credential lease identity is invalid");
	}
	if (sha256(await readFile(claimedPath)) !== input.lease.rawSha256) throw new Error("claimed credential lease content drifted");
	return claimedPath;
}

export async function materializeAgentTeamsWorkerProfile(input: {
	configuration: AgentTeamsWorkerProfileConfiguration;
	spawn: AgentTeamsWorkerSpawnIdentity;
	environment?: NodeJS.ProcessEnv;
	now?: number;
}): Promise<AgentTeamsMaterializedWorker> {
	const { configuration, spawn } = input;
	const runtimeRoot = await canonicalPrivateDirectory("runtimeRoot", configuration.runtimeRoot);
	const defaultAgentDir = await canonicalPrivateDirectory("defaultAgentDir", configuration.defaultAgentDir);
	if (pathContains(defaultAgentDir, runtimeRoot) || pathContains(runtimeRoot, defaultAgentDir)) {
		throw new Error("Worker runtime and Default Pi profile must be disjoint");
	}
	const providerId = requireIdentifier("providerId", configuration.providerId);
	requireIdentifier("modelId", configuration.modelId);
	if (!Number.isSafeInteger(configuration.maxWorkers) || configuration.maxWorkers < 1 || configuration.maxWorkers > 3) {
		throw new Error("maxWorkers must be an integer from 1 to 3");
	}
	const boundaryContractDigest = requireDigest("boundaryContractDigest", configuration.boundaryContractDigest);
	const runtimeAuthorityDigest = requireDigest("runtimeAuthorityDigest", configuration.runtimeAuthorityDigest);
	const workerProfileRuntimePath = await canonicalFile("workerProfileRuntimePath", configuration.workerProfileRuntimePath);
	const agentTeamsWorkerProfilePath = await canonicalFile("agentTeamsWorkerProfilePath", configuration.agentTeamsWorkerProfilePath);
	const expectedAdapterPath = await realpath(fileURLToPath(import.meta.url));
	const expectedRuntimePath = await realpath(join(dirname(expectedAdapterPath), "worker-profile-runtime.ts"));
	if (agentTeamsWorkerProfilePath !== expectedAdapterPath || workerProfileRuntimePath !== expectedRuntimePath) {
		throw new Error("Worker profile adapter module identity mismatch");
	}
	if (sha256(await readFile(workerProfileRuntimePath)) !== requireDigest("workerProfileRuntimeSha256", configuration.workerProfileRuntimeSha256)) {
		throw new Error("Worker profile runtime digest mismatch");
	}
	if (sha256(await readFile(agentTeamsWorkerProfilePath)) !== requireDigest("agentTeamsWorkerProfileSha256", configuration.agentTeamsWorkerProfileSha256)) {
		throw new Error("agent-teams Worker profile adapter digest mismatch");
	}
	const runId = requireIdentifier("runId", spawn.runId);
	const workerId = requireIdentifier("workerId", spawn.workerId);
	const readyNonce = requireDigest("readyNonce", spawn.readyNonce);
	const workerBoundaryPath = await canonicalFile("workerBoundaryPath", configuration.workerBoundaryPath);
	const teamsExtensionPath = await canonicalFile("teamsExtensionPath", configuration.teamsExtensionPath);
	const worktree = await canonicalDirectory("worktree", spawn.worktree);
	for (const extensionPath of [workerBoundaryPath, teamsExtensionPath]) {
		if (pathContains(worktree, extensionPath)) throw new Error("trusted Worker extensions must be outside the Worker worktree");
	}
	const publicKey = await loadLeasePublicKey({
		runtimeRoot,
		path: configuration.leasePublicKeyPath,
		expectedSha256: configuration.leasePublicKeySha256,
	});
	const credential = await loadCredentialLease({
		runtimeRoot,
		defaultAgentDir,
		credentialLeasePath: spawn.credentialLeasePath,
		providerId,
		runId,
		workerId,
		readyNonce,
		publicKey,
		now: input.now ?? Date.now(),
	});
	const teamsRootDir = await canonicalPrivateDirectory("teamsRootDir", spawn.teamsRootDir);
	if (teamsRootDir !== join(runtimeRoot, "coordination")) throw new Error("teamsRootDir must be the dedicated Worker coordination root");
	const teamId = requireIdentifier("teamId", spawn.teamId);
	const taskListId = requireIdentifier("taskListId", spawn.taskListId);
	const leadName = requireIdentifier("leadName", spawn.leadName);
	const style = requireIdentifier("style", spawn.style);
	if (spawn.autoClaim !== "0" && spawn.autoClaim !== "1") throw new Error("autoClaim must be 0 or 1");

	const claimedLeasePath = await claimCredentialLease({ runtimeRoot, lease: credential, runId, workerId });
	let profile: MaterializedWorkerProfile | undefined;
	try {
		const runtimeEnvironment = {
			MYPI_AGENT_TEAMS_RUNTIME_CONTRACT_DIGEST: runtimeAuthorityDigest,
			MYPI_AGENT_TEAMS_BOUNDARY_PATH: workerBoundaryPath,
			MYPI_AGENT_TEAMS_ENTRY_PATH: teamsExtensionPath,
			MYPI_AGENT_TEAMS_LEASE_ID: credential.leaseId,
			MYPI_AGENT_TEAMS_MAX_WORKERS: String(configuration.maxWorkers),
			MYPI_AGENT_TEAMS_PROFILE_DIGEST: boundaryContractDigest,
			MYPI_AGENT_TEAMS_READY_NONCE: readyNonce,
			MYPI_AGENT_TEAMS_WORKSPACE_MODE: "worktree",
			PI_TEAMS_AGENT_NAME: workerId,
			PI_TEAMS_AUTO_CLAIM: spawn.autoClaim,
			PI_TEAMS_LEAD_NAME: leadName,
			PI_TEAMS_ROOT_DIR: teamsRootDir,
			PI_TEAMS_STYLE: style,
			PI_TEAMS_TASK_LIST_ID: taskListId,
			PI_TEAMS_TEAM_ID: teamId,
			PI_TEAMS_WORKER: "1",
		};
		profile = await materializeWorkerProfile({
			runtimeRoot,
			defaultAgentDir,
			runId,
			workerId,
			worktree,
			template: {
				schemaVersion: 1,
				profileId: "pi-agent-teams-docker-strong-v1",
				profileVersion: "2",
				workspaceMode: "worktree-write",
				providerId,
				modelId: configuration.modelId,
				thinkingLevel: configuration.thinkingLevel,
				tools: [...AGENT_TEAMS_TOOLS],
				extensions: [workerBoundaryPath, teamsExtensionPath],
			},
			credential,
			environment: input.environment,
			runtimeEnvironment,
		});
		const verification = await verifyMaterializedWorkerProfile({
			profile,
			expectedProfileDigest: profile.manifest.profileDigest,
			expectedCredential: credential,
			defaultAgentDir,
		});
		if (!verification.verified) throw new Error(`generated agent-teams Worker profile failed verification: ${verification.mismatches.join(",")}`);
		if (profile.manifest.launchArgs[0] !== "--mode" || profile.manifest.launchArgs[1] !== "rpc") {
			throw new Error("generated Worker launch contract is missing RPC mode");
		}
		try {
			await rm(claimedLeasePath);
		} catch (error) {
			throw new Error("claimed credential lease could not be destroyed", { cause: error });
		}
		return { profile, childArgs: profile.manifest.launchArgs.slice(2), leaseId: credential.leaseId };
	} catch (error) {
		const failures: unknown[] = [error];
		if (profile) {
			try {
				await cleanupMaterializedWorkerProfile({
					profile,
					runtimeRoot,
					expectedProfileDigest: profile.manifest.profileDigest,
				});
			} catch (cleanupError) {
				failures.push(cleanupError);
			}
		}
		try {
			await rm(claimedLeasePath, { force: true });
		} catch (leaseCleanupError) {
			failures.push(leaseCleanupError);
		}
		if (failures.length > 1) throw new AggregateError(failures, "agent-teams Worker profile failed and cleanup was incomplete");
		throw error;
	}
}

export async function provisionAgentTeamsWorkerProfile(input: {
	configuration: AgentTeamsWorkerProfileConfiguration;
	spawn: Omit<AgentTeamsWorkerSpawnIdentity, "credentialLeasePath">;
	environment?: NodeJS.ProcessEnv;
	now?: number;
}): Promise<AgentTeamsMaterializedWorker> {
	const issued = await issueAgentTeamsCredentialLease({
		configuration: input.configuration,
		runId: input.spawn.runId,
		workerId: input.spawn.workerId,
		readyNonce: input.spawn.readyNonce,
		now: input.now,
	});
	try {
		const worker = await materializeAgentTeamsWorkerProfile({
			configuration: input.configuration,
			spawn: { ...input.spawn, credentialLeasePath: issued.credentialLeasePath },
			environment: input.environment,
			now: input.now,
		});
		if (worker.leaseId !== issued.leaseId) {
			await cleanupAgentTeamsWorkerProfile({
				worker,
				runtimeRoot: input.configuration.runtimeRoot,
				expectedProfileDigest: worker.profile.manifest.profileDigest,
			});
			throw new Error("Materialized Worker lease identity does not match the issued lease");
		}
		return worker;
	} catch (error) {
		try {
			await rm(issued.credentialLeasePath, { force: true });
		} catch (leaseCleanupError) {
			throw new AggregateError([error, leaseCleanupError], "Worker profile provisioning failed and the issued lease could not be removed");
		}
		throw error;
	}
}

export async function cleanupAgentTeamsWorkerProfile(input: {
	worker: AgentTeamsMaterializedWorker;
	runtimeRoot: string;
	expectedProfileDigest: string;
}): Promise<void> {
	await cleanupMaterializedWorkerProfile({
		profile: input.worker.profile,
		runtimeRoot: input.runtimeRoot,
		expectedProfileDigest: input.expectedProfileDigest,
	});
}
