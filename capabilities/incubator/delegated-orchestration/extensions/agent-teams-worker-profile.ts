import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

export type AgentTeamsWorkerProfileConfiguration = {
	runtimeRoot: string;
	defaultAgentDir: string;
	providerId: string;
	modelId: string;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	workerBoundaryPath: string;
	teamsExtensionPath: string;
	boundaryContractDigest: string;
	maxWorkers: number;
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

export type AgentTeamsMaterializedWorker = {
	profile: MaterializedWorkerProfile;
	childArgs: string[];
};

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

async function loadCredentialLease(input: {
	runtimeRoot: string;
	defaultAgentDir: string;
	credentialLeasePath: string;
	providerId: string;
	runId: string;
	workerId: string;
}): Promise<{ providerId: string; credential: WorkerCredential; leasePath: string }> {
	const leasesRoot = await canonicalPrivateDirectory("credential lease root", join(input.runtimeRoot, "credential-leases"));
	const runLeaseRoot = await canonicalPrivateDirectory("run credential lease root", join(leasesRoot, input.runId));
	const requestedSource = requireAbsolute("credentialLeasePath", input.credentialLeasePath);
	const expectedSource = join(runLeaseRoot, `${input.workerId}.auth.json`);
	const info = await lstat(requestedSource);
	if (info.isSymbolicLink() || !info.isFile()) throw new Error("credential lease must be a real file");
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("credential lease has a different owner");
	if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (info.mode & 0o600) !== 0o600)) {
		throw new Error("credential lease must use private owner read/write permissions");
	}
	const leasePath = await realpath(requestedSource);
	if (leasePath !== expectedSource) throw new Error("credential lease is outside the Worker-scoped lease store");
	if (pathContains(input.defaultAgentDir, leasePath) || pathContains(leasePath, input.defaultAgentDir)) {
		throw new Error("credential lease must not overlap the Default Pi profile");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(leasePath, "utf8"));
	} catch {
		throw new Error("credential lease is missing or malformed");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("credential lease must be an object");
	const entries = Object.entries(parsed as Record<string, unknown>);
	if (entries.length !== 1 || entries[0]?.[0] !== input.providerId) {
		throw new Error("credential lease must contain exactly the requested provider");
	}
	return { providerId: input.providerId, credential: entries[0][1] as WorkerCredential, leasePath };
}

export async function materializeAgentTeamsWorkerProfile(input: {
	configuration: AgentTeamsWorkerProfileConfiguration;
	spawn: AgentTeamsWorkerSpawnIdentity;
	environment?: NodeJS.ProcessEnv;
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
	const runId = requireIdentifier("runId", spawn.runId);
	const workerId = requireIdentifier("workerId", spawn.workerId);
	const workerBoundaryPath = await canonicalFile("workerBoundaryPath", configuration.workerBoundaryPath);
	const teamsExtensionPath = await canonicalFile("teamsExtensionPath", configuration.teamsExtensionPath);
	const worktree = await canonicalDirectory("worktree", spawn.worktree);
	for (const extensionPath of [workerBoundaryPath, teamsExtensionPath]) {
		if (pathContains(worktree, extensionPath)) throw new Error("trusted Worker extensions must be outside the Worker worktree");
	}
	const credential = await loadCredentialLease({
		runtimeRoot,
		defaultAgentDir,
		credentialLeasePath: spawn.credentialLeasePath,
		providerId,
		runId,
		workerId,
	});
	const teamsRootDir = await canonicalPrivateDirectory("teamsRootDir", spawn.teamsRootDir);
	if (teamsRootDir !== join(runtimeRoot, "coordination")) throw new Error("teamsRootDir must be the dedicated Worker coordination root");
	const teamId = requireIdentifier("teamId", spawn.teamId);
	const taskListId = requireIdentifier("taskListId", spawn.taskListId);
	const leadName = requireIdentifier("leadName", spawn.leadName);
	const style = requireIdentifier("style", spawn.style);
	if (spawn.autoClaim !== "0" && spawn.autoClaim !== "1") throw new Error("autoClaim must be 0 or 1");
	const readyNonce = requireDigest("readyNonce", spawn.readyNonce);

	const runtimeEnvironment = {
		MYPI_AGENT_TEAMS_BOUNDARY_PATH: workerBoundaryPath,
		MYPI_AGENT_TEAMS_ENTRY_PATH: teamsExtensionPath,
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
	const profile = await materializeWorkerProfile({
		runtimeRoot,
		defaultAgentDir,
		runId,
		workerId,
		worktree,
		template: {
			schemaVersion: 1,
			profileId: "pi-agent-teams-docker-strong-v1",
			profileVersion: "1",
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
	if (!verification.verified) {
		await cleanupMaterializedWorkerProfile({
			profile,
			runtimeRoot,
			expectedProfileDigest: profile.manifest.profileDigest,
		});
		throw new Error(`generated agent-teams Worker profile failed verification: ${verification.mismatches.join(",")}`);
	}
	// The setup/broker layer issues one lease per Worker. Once the verified
	// per-Worker auth file exists, remove the handoff artifact to prevent replay.
	try {
		await rm(credential.leasePath);
	} catch (error) {
		await cleanupMaterializedWorkerProfile({
			profile,
			runtimeRoot,
			expectedProfileDigest: profile.manifest.profileDigest,
		}).catch(() => undefined);
		throw new Error("credential lease could not be consumed", { cause: error });
	}
	if (profile.manifest.launchArgs[0] !== "--mode" || profile.manifest.launchArgs[1] !== "rpc") {
		await cleanupMaterializedWorkerProfile({
			profile,
			runtimeRoot,
			expectedProfileDigest: profile.manifest.profileDigest,
		});
		throw new Error("generated Worker launch contract is missing RPC mode");
	}
	return { profile, childArgs: profile.manifest.launchArgs.slice(2) };
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
