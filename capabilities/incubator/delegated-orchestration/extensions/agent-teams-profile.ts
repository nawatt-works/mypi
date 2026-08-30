import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_DIR = join(REPOSITORY_ROOT, "profiles", "pi-agent-teams", "node-worker-v1");
const PROFILE_PATH = join(PROFILE_DIR, "profile.json");
const WORKER_BOUNDARY_PATH = join(PROFILE_DIR, "worker-boundary.ts");
const WORKER_PROFILE_RUNTIME_PATH = join(REPOSITORY_ROOT, "extensions", "worker-profile-runtime.ts");
const WORKER_MACHINE_SETUP_PATH = join(REPOSITORY_ROOT, "extensions", "worker-machine-setup.ts");
const AGENT_TEAMS_WORKER_PROFILE_PATH = join(REPOSITORY_ROOT, "extensions", "agent-teams-worker-profile.ts");
const PINNED_UPSTREAM_COMMIT = "2c1776d2a68104aaadc1c622d8a704684c7c35d6";
const EXACT_CHILD_BUILTIN_TOOLS = ["read", "bash", "edit", "write"] as const;
const EXACT_CHILD_BACKEND_TOOLS = ["team_message"] as const;
const CHILD_PARENT_ENVIRONMENT_ALLOWLIST = new Set([
	"PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TERM",
	"COLORTERM", "NO_COLOR", "FORCE_COLOR", "CI",
]);
const CHILD_RUNTIME_ENVIRONMENT_KEYS = ["AI_AGENT", "PI_CODING_AGENT", "__CF_USER_TEXT_ENCODING"] as const;
const CHILD_OVERRIDE_ENVIRONMENT_KEYS = [
	"MYPI_AGENT_TEAMS_BOUNDARY_PATH",
	"MYPI_AGENT_TEAMS_ENTRY_PATH",
	"MYPI_AGENT_TEAMS_LEASE_ID",
	"MYPI_AGENT_TEAMS_MAX_WORKERS",
	"MYPI_AGENT_TEAMS_PROFILE_DIGEST",
	"MYPI_AGENT_TEAMS_READY_NONCE",
	"MYPI_AGENT_TEAMS_RUNTIME_CONTRACT_DIGEST",
	"MYPI_AGENT_TEAMS_WORKSPACE_MODE",
	"MYPI_WORKER",
	"MYPI_WORKER_PROFILE_DIGEST",
	"MYPI_WORKER_PROFILE_MANIFEST",
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_TEAMS_AGENT_NAME",
	"PI_TEAMS_AUTO_CLAIM",
	"PI_TEAMS_LEAD_NAME",
	"PI_TEAMS_ROOT_DIR",
	"PI_TEAMS_STYLE",
	"PI_TEAMS_TASK_LIST_ID",
	"PI_TEAMS_TEAM_ID",
	"PI_TEAMS_WORKER",
	"TEMP",
	"TMP",
] as const;

const LEADER_ENVIRONMENT_ALLOWLIST = [
	"HOME",
	"PATH",
	"USER",
	"LOGNAME",
	"SHELL",
	"TERM",
	"LANG",
	"LC_ALL",
	"TMPDIR",
	"HERDR_ENV",
	"HERDR_SOCKET_PATH",
	"HERDR_PANE_ID",
] as const;

export type AgentTeamsProfile = {
	kind: "pi-agent-teams";
	profileId: "pi-agent-teams-docker-strong-v1";
	upstreamCommit: string;
	patchedTeamsEntryPath: string;
	workerBoundaryPath: string;
	workerProfileRuntimePath: string;
	workerMachineSetupPath: string;
	agentTeamsWorkerProfilePath: string;
	runtimeRoot: string;
	defaultAgentDir: string;
	teamsRootDir: string;
	providerId: string;
	modelId: string;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	leasePublicKeyPath: string;
	leasePublicKeySha256: string;
	maxWorkers: number;
	forceWorktree: true;
	childTools: string[];
	childExtensions: string[];
	childEnvironmentKeys: string[];
	leaderEnvironment: Readonly<Record<string, string>>;
	imageDigest: string;
	profileArtifactSha256: string;
	overlayPatchSha256: string;
	workerBoundarySha256: string;
	workerProfileRuntimeSha256: string;
	workerMachineSetupSha256: string;
	agentTeamsWorkerProfileSha256: string;
	commandPolicySha256: string;
	scopedWorkerToolsSha256: string;
	patchedTeamsEntrySha256: string;
	patchedTeamsSourceSha256: string;
	boundaryContractDigest: string;
	runtimeAuthorityDigest: string;
	profileDigest: string;
};

export type AgentTeamsObservedProfile = {
	upstreamCommit: string;
	profileDigest: string;
	overlayPatchSha256: string;
	workerBoundarySha256: string;
	workerProfileRuntimeSha256: string;
	workerMachineSetupSha256: string;
	agentTeamsWorkerProfileSha256: string;
	commandPolicySha256: string;
	scopedWorkerToolsSha256: string;
	patchedTeamsEntrySha256: string;
	patchedTeamsSourceSha256: string;
	boundaryContractDigest: string;
	runtimeAuthorityDigest: string;
	imageDigest: string;
	imageReady: boolean;
	dockerReady: boolean;
	readyHandshake: boolean;
	structuredReadiness: boolean;
	sessionBoundReadiness: boolean;
	trustedBoundaryIdentity: boolean;
	generatedProfileReady: boolean;
	credentialLeaseConsumed: boolean;
	runtimeContractBound: boolean;
	cleanupVerified: boolean;
	forceWorktree: boolean;
	maxWorkers: number | null;
	childTools: string[];
	childExtensions: string[];
	childEnvironmentKeys: string[];
	routine: boolean;
	tests: boolean;
	environmentIsolated: boolean;
	secretDenied: boolean;
	hostReadIsolated: boolean;
	externalWriteDenied: boolean;
	networkDenied: boolean;
	commandHardlineDenied: boolean;
	noRoutinePrompt: boolean;
};

export type AgentTeamsVerification = {
	verified: boolean;
	mismatches: string[];
};

type ProfileArtifact = {
	schemaVersion: 1;
	profileId: "pi-agent-teams-docker-strong-v1";
	status: "phase0-candidate";
	policyVersion: string;
	toolchain: {
		observedLocalImageDigest: string;
		workerBoundarySha256: string;
		workerProfileRuntimeSha256: string;
		workerMachineSetupSha256: string;
		agentTeamsWorkerProfileSha256: string;
		commandPolicySha256: string;
		scopedWorkerToolsSha256: string;
	};
	integration: {
		upstreamCommit: string;
		overlayPatchSha256: string;
		patchedTeamsEntrySha256: string;
		patchedTeamsSourceSha256: string;
	};
};

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

export function sha256DirectoryTree(root: string): string {
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

function verifyPatchedTeamsSource(entryPath: string, artifact: ProfileArtifact): void {
	const teamsDirectory = dirname(entryPath);
	if (entryPath !== join(teamsDirectory, "index.ts")) throw new Error("patched agent-teams entry must be extensions/teams/index.ts");
	const checkoutRoot = resolve(teamsDirectory, "..", "..");
	if (realpathSync(join(checkoutRoot, "extensions", "teams")) !== realpathSync(teamsDirectory)) {
		throw new Error("patched agent-teams entry is outside the expected checkout layout");
	}
	if (sha256(readFileSync(entryPath)) !== artifact.integration.patchedTeamsEntrySha256) {
		throw new Error("patched agent-teams entry digest mismatch");
	}
	if (sha256DirectoryTree(teamsDirectory) !== artifact.integration.patchedTeamsSourceSha256) {
		throw new Error("patched agent-teams source tree digest mismatch");
	}
	const git = spawnSync("git", ["-C", checkoutRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 });
	if (git.status !== 0 || git.stdout.trim() !== artifact.integration.upstreamCommit) {
		throw new Error("patched agent-teams checkout does not match the pinned upstream commit");
	}
}

function requireAbsolutePath(label: string, value: string): string {
	if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
	return resolve(value);
}

function requireDigest(label: string, value: string): string {
	if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
	return value;
}

function requireIdentifier(label: string, value: string): string {
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/.test(value)) {
		throw new Error(`${label} must be a bounded identifier`);
	}
	return value;
}

function requirePrivateDirectory(label: string, value: string): string {
	const requested = requireAbsolutePath(label, value);
	const info = lstatSync(requested);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory`);
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`${label} has a different owner`);
	if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (info.mode & 0o700) !== 0o700)) {
		throw new Error(`${label} must be private and owner-accessible`);
	}
	return realpathSync(requested);
}

function pathsOverlap(left: string, right: string): boolean {
	const relation = relative(left, right);
	if (relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation))) return true;
	const reverse = relative(right, left);
	return reverse === "" || (!reverse.startsWith(`..${sep}`) && reverse !== ".." && !isAbsolute(reverse));
}

function loadProfileArtifact(): { artifact: ProfileArtifact; raw: Buffer } {
	const raw = readFileSync(PROFILE_PATH);
	const artifact = JSON.parse(raw.toString("utf8")) as ProfileArtifact;
	if (artifact.schemaVersion !== 1 || artifact.status !== "phase0-candidate") throw new Error("unsupported agent-teams profile artifact");
	if (artifact.profileId !== "pi-agent-teams-docker-strong-v1") throw new Error("unexpected agent-teams profile id");
	if (artifact.integration.upstreamCommit !== PINNED_UPSTREAM_COMMIT) throw new Error("agent-teams upstream pin drift");
	return { artifact, raw };
}

function orderedLeaderEnvironment(source: NodeJS.ProcessEnv, additions: Record<string, string>): Readonly<Record<string, string>> {
	const environment: Record<string, string> = {};
	for (const key of LEADER_ENVIRONMENT_ALLOWLIST) {
		const value = source[key];
		if (value) environment[key] = value;
	}
	for (const [key, value] of Object.entries(additions).sort(([a], [b]) => a.localeCompare(b))) environment[key] = value;
	if (!environment.HOME || !environment.PATH) throw new Error("HOME and PATH are required for agent-teams profile");
	return Object.freeze(environment);
}

export function buildAgentTeamsProfile(input: {
	upstreamCommit: string;
	patchedTeamsEntryPath: string;
	runtimeRoot: string;
	defaultAgentDir: string;
	providerId: string;
	modelId: string;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	leasePublicKeyPath: string;
	leasePublicKeySha256: string;
	maxWorkers: number;
	environment: NodeJS.ProcessEnv;
}): AgentTeamsProfile {
	if (input.upstreamCommit !== PINNED_UPSTREAM_COMMIT) throw new Error(`unsupported agent-teams commit: ${input.upstreamCommit}`);
	if (!Number.isSafeInteger(input.maxWorkers) || input.maxWorkers < 1 || input.maxWorkers > 3) {
		throw new Error("maxWorkers must be an integer from 1 to 3");
	}
	const requestedTeamsEntryPath = requireAbsolutePath("patchedTeamsEntryPath", input.patchedTeamsEntryPath);
	if (!existsSync(requestedTeamsEntryPath)) throw new Error(`patched agent-teams entry is missing: ${requestedTeamsEntryPath}`);
	const patchedTeamsEntryPath = realpathSync(requestedTeamsEntryPath);
	if (!existsSync(WORKER_BOUNDARY_PATH)) throw new Error(`Worker boundary is missing: ${WORKER_BOUNDARY_PATH}`);
	const workerBoundaryPath = realpathSync(WORKER_BOUNDARY_PATH);
	if (!existsSync(WORKER_PROFILE_RUNTIME_PATH) || !existsSync(WORKER_MACHINE_SETUP_PATH) || !existsSync(AGENT_TEAMS_WORKER_PROFILE_PATH)) {
		throw new Error("Worker profile adapter modules are missing");
	}
	const workerProfileRuntimePath = realpathSync(WORKER_PROFILE_RUNTIME_PATH);
	const workerMachineSetupPath = realpathSync(WORKER_MACHINE_SETUP_PATH);
	const agentTeamsWorkerProfilePath = realpathSync(AGENT_TEAMS_WORKER_PROFILE_PATH);
	const { artifact, raw } = loadProfileArtifact();
	verifyPatchedTeamsSource(patchedTeamsEntryPath, artifact);
	if (sha256(readFileSync(workerProfileRuntimePath)) !== artifact.toolchain.workerProfileRuntimeSha256) {
		throw new Error("Worker profile runtime digest mismatch");
	}
	if (sha256(readFileSync(workerMachineSetupPath)) !== artifact.toolchain.workerMachineSetupSha256) {
		throw new Error("Worker machine setup digest mismatch");
	}
	if (sha256(readFileSync(agentTeamsWorkerProfilePath)) !== artifact.toolchain.agentTeamsWorkerProfileSha256) {
		throw new Error("agent-teams Worker profile adapter digest mismatch");
	}
	const runtimeRoot = requirePrivateDirectory("runtimeRoot", input.runtimeRoot);
	const defaultAgentDir = requirePrivateDirectory("defaultAgentDir", input.defaultAgentDir);
	if (pathsOverlap(runtimeRoot, defaultAgentDir)) throw new Error("Worker runtime and Default Pi profile must be disjoint");
	const teamsRootDir = requirePrivateDirectory("teamsRootDir", join(runtimeRoot, "coordination"));
	const leaseAuthorityRoot = requirePrivateDirectory("lease authority root", join(runtimeRoot, "lease-authority"));
	const requestedPublicKey = requireAbsolutePath("leasePublicKeyPath", input.leasePublicKeyPath);
	const publicKeyInfo = lstatSync(requestedPublicKey);
	if (publicKeyInfo.isSymbolicLink() || !publicKeyInfo.isFile()) throw new Error("lease public key must be a real file");
	const leasePublicKeyPath = realpathSync(requestedPublicKey);
	if (leasePublicKeyPath !== join(leaseAuthorityRoot, "public.pem")) throw new Error("lease public key is outside the authority root");
	const leasePublicKeySha256 = requireDigest("leasePublicKeySha256", input.leasePublicKeySha256);
	if (sha256(readFileSync(leasePublicKeyPath)) !== leasePublicKeySha256) throw new Error("lease public key digest mismatch");
	const providerId = requireIdentifier("providerId", input.providerId);
	const modelId = requireIdentifier("modelId", input.modelId);
	const injectedChildExtensions = [workerBoundaryPath];
	const childExtensions = [...injectedChildExtensions, patchedTeamsEntryPath];
	const boundaryContractDigest = sha256(JSON.stringify({
		profileId: artifact.profileId,
		upstreamCommit: artifact.integration.upstreamCommit,
		patchedTeamsEntrySha256: artifact.integration.patchedTeamsEntrySha256,
		workerBoundarySha256: artifact.toolchain.workerBoundarySha256,
		workerProfileRuntimeSha256: artifact.toolchain.workerProfileRuntimeSha256,
		workerMachineSetupSha256: artifact.toolchain.workerMachineSetupSha256,
		agentTeamsWorkerProfileSha256: artifact.toolchain.agentTeamsWorkerProfileSha256,
		commandPolicySha256: artifact.toolchain.commandPolicySha256,
		scopedWorkerToolsSha256: artifact.toolchain.scopedWorkerToolsSha256,
		imageDigest: artifact.toolchain.observedLocalImageDigest,
		childTools: EXACT_CHILD_BUILTIN_TOOLS,
		childExtensions: injectedChildExtensions,
		maxWorkers: input.maxWorkers,
		forceWorktree: true,
	}));
	const runtimeAuthorityDigest = sha256(JSON.stringify({
		boundaryContractDigest,
		workerProfileRuntimePath,
		workerProfileRuntimeSha256: artifact.toolchain.workerProfileRuntimeSha256,
		workerMachineSetupPath,
		workerMachineSetupSha256: artifact.toolchain.workerMachineSetupSha256,
		agentTeamsWorkerProfilePath,
		agentTeamsWorkerProfileSha256: artifact.toolchain.agentTeamsWorkerProfileSha256,
		runtimeRoot,
		defaultAgentDir,
		teamsRootDir,
		providerId,
		modelId,
		thinkingLevel: input.thinkingLevel,
		leasePublicKeyPath,
		leasePublicKeySha256,
	}));
	const leaderEnvironment = orderedLeaderEnvironment(input.environment, {
		PI_TEAMS_CHILD_EXTENSIONS: injectedChildExtensions.join(delimiter),
		PI_TEAMS_CHILD_TOOLS: EXACT_CHILD_BUILTIN_TOOLS.join(","),
		PI_TEAMS_DEFAULT_AUTO_CLAIM: "0",
		PI_TEAMS_FORCE_WORKTREE: "1",
		PI_TEAMS_MANAGED_PROFILE_DIGEST: boundaryContractDigest,
		PI_TEAMS_RUNTIME_CONTRACT_DIGEST: runtimeAuthorityDigest,
		PI_TEAMS_MANAGED_PROFILE_ID: artifact.profileId,
		PI_TEAMS_MAX_WORKERS: String(input.maxWorkers),
		PI_TEAMS_PATCHED_ENTRY_PATH: patchedTeamsEntryPath,
		PI_TEAMS_PATCHED_SOURCE_SHA256: artifact.integration.patchedTeamsSourceSha256,
		PI_TEAMS_ROOT_DIR: teamsRootDir,
		PI_TEAMS_WORKER_PROFILE_ADAPTER_PATH: agentTeamsWorkerProfilePath,
		PI_TEAMS_WORKER_PROFILE_ADAPTER_SHA256: artifact.toolchain.agentTeamsWorkerProfileSha256,
		PI_TEAMS_WORKER_PROFILE_RUNTIME_PATH: workerProfileRuntimePath,
		PI_TEAMS_WORKER_PROFILE_RUNTIME_SHA256: artifact.toolchain.workerProfileRuntimeSha256,
		PI_TEAMS_WORKER_RUNTIME_ROOT: runtimeRoot,
		PI_TEAMS_DEFAULT_AGENT_DIR: defaultAgentDir,
		PI_TEAMS_WORKER_PROVIDER_ID: providerId,
		PI_TEAMS_WORKER_MODEL_ID: modelId,
		PI_TEAMS_WORKER_THINKING_LEVEL: input.thinkingLevel,
		PI_TEAMS_LEASE_PUBLIC_KEY_PATH: leasePublicKeyPath,
		PI_TEAMS_LEASE_PUBLIC_KEY_SHA256: leasePublicKeySha256,
	});
	const childEnvironmentKeys = [...new Set([
		...Object.keys(leaderEnvironment).filter((key) => CHILD_PARENT_ENVIRONMENT_ALLOWLIST.has(key) || key.startsWith("LC_")),
		...CHILD_OVERRIDE_ENVIRONMENT_KEYS,
		...CHILD_RUNTIME_ENVIRONMENT_KEYS,
	])].sort();
	const base = {
		kind: "pi-agent-teams" as const,
		profileId: artifact.profileId,
		upstreamCommit: input.upstreamCommit,
		patchedTeamsEntryPath,
		workerBoundaryPath,
		workerProfileRuntimePath,
		workerMachineSetupPath,
		agentTeamsWorkerProfilePath,
		runtimeRoot,
		defaultAgentDir,
		teamsRootDir,
		providerId,
		modelId,
		thinkingLevel: input.thinkingLevel,
		leasePublicKeyPath,
		leasePublicKeySha256,
		maxWorkers: input.maxWorkers,
		forceWorktree: true as const,
		childTools: [...EXACT_CHILD_BUILTIN_TOOLS, ...EXACT_CHILD_BACKEND_TOOLS],
		childExtensions,
		childEnvironmentKeys,
		leaderEnvironment,
		imageDigest: artifact.toolchain.observedLocalImageDigest,
		profileArtifactSha256: sha256(raw),
		overlayPatchSha256: artifact.integration.overlayPatchSha256,
		workerBoundarySha256: artifact.toolchain.workerBoundarySha256,
		workerProfileRuntimeSha256: artifact.toolchain.workerProfileRuntimeSha256,
		workerMachineSetupSha256: artifact.toolchain.workerMachineSetupSha256,
		agentTeamsWorkerProfileSha256: artifact.toolchain.agentTeamsWorkerProfileSha256,
		commandPolicySha256: artifact.toolchain.commandPolicySha256,
		scopedWorkerToolsSha256: artifact.toolchain.scopedWorkerToolsSha256,
		patchedTeamsEntrySha256: artifact.integration.patchedTeamsEntrySha256,
		patchedTeamsSourceSha256: artifact.integration.patchedTeamsSourceSha256,
		boundaryContractDigest,
		runtimeAuthorityDigest,
	};
	return { ...base, profileDigest: sha256(JSON.stringify(base)) };
}

export function verifyAgentTeamsProfile(input: {
	requested: AgentTeamsProfile;
	observed: AgentTeamsObservedProfile;
}): AgentTeamsVerification {
	const { requested, observed } = input;
	const mismatches: string[] = [];
	if (observed.upstreamCommit !== requested.upstreamCommit) mismatches.push("upstream-commit");
	if (observed.profileDigest !== requested.profileDigest) mismatches.push("profile-digest");
	if (observed.overlayPatchSha256 !== requested.overlayPatchSha256) mismatches.push("overlay-digest");
	if (observed.workerBoundarySha256 !== requested.workerBoundarySha256) mismatches.push("worker-boundary-digest");
	if (observed.workerProfileRuntimeSha256 !== requested.workerProfileRuntimeSha256) mismatches.push("worker-profile-runtime-digest");
	if (observed.workerMachineSetupSha256 !== requested.workerMachineSetupSha256) mismatches.push("worker-machine-setup-digest");
	if (observed.agentTeamsWorkerProfileSha256 !== requested.agentTeamsWorkerProfileSha256) mismatches.push("agent-teams-worker-profile-digest");
	if (observed.commandPolicySha256 !== requested.commandPolicySha256) mismatches.push("command-policy-digest");
	if (observed.scopedWorkerToolsSha256 !== requested.scopedWorkerToolsSha256) mismatches.push("scoped-tools-digest");
	if (observed.patchedTeamsEntrySha256 !== requested.patchedTeamsEntrySha256) mismatches.push("patched-entry-digest");
	if (observed.patchedTeamsSourceSha256 !== requested.patchedTeamsSourceSha256) mismatches.push("patched-source-digest");
	if (observed.boundaryContractDigest !== requested.boundaryContractDigest) mismatches.push("boundary-contract-digest");
	if (observed.runtimeAuthorityDigest !== requested.runtimeAuthorityDigest) mismatches.push("runtime-authority-digest");
	if (observed.imageDigest !== requested.imageDigest) mismatches.push("image-digest");
	if (!observed.imageReady) mismatches.push("image-readiness");
	if (!observed.dockerReady) mismatches.push("docker-readiness");
	if (!observed.readyHandshake) mismatches.push("rpc-readiness");
	if (!observed.structuredReadiness) mismatches.push("structured-readiness");
	if (!observed.sessionBoundReadiness) mismatches.push("session-bound-readiness");
	if (!observed.trustedBoundaryIdentity) mismatches.push("trusted-boundary-identity");
	if (observed.forceWorktree !== requested.forceWorktree) mismatches.push("force-worktree");
	if (observed.maxWorkers !== requested.maxWorkers) mismatches.push("max-workers");
	if (JSON.stringify([...observed.childTools].sort()) !== JSON.stringify([...requested.childTools].sort())) mismatches.push("child-tools");
	if (JSON.stringify([...observed.childExtensions].sort()) !== JSON.stringify([...requested.childExtensions].sort())) mismatches.push("child-extensions");
	if (JSON.stringify([...observed.childEnvironmentKeys].sort()) !== JSON.stringify(requested.childEnvironmentKeys)) {
		mismatches.push("child-environment");
	}
	const forbiddenEnvironment = observed.childEnvironmentKeys.filter((key) =>
		/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)
	);
	if (forbiddenEnvironment.length > 0) mismatches.push("child-environment-secrets");
	for (const field of [
		"routine",
		"tests",
		"environmentIsolated",
		"secretDenied",
		"hostReadIsolated",
		"externalWriteDenied",
		"networkDenied",
		"commandHardlineDenied",
		"noRoutinePrompt",
		"generatedProfileReady",
		"credentialLeaseConsumed",
		"runtimeContractBound",
		"cleanupVerified",
	] as const) {
		if (!observed[field]) mismatches.push(`boundary:${field}`);
	}
	return { verified: mismatches.length === 0, mismatches };
}

export const AGENT_TEAMS_PROFILE_PATHS = Object.freeze({
	profileDir: PROFILE_DIR,
	profilePath: PROFILE_PATH,
	workerBoundaryPath: WORKER_BOUNDARY_PATH,
	workerProfileRuntimePath: WORKER_PROFILE_RUNTIME_PATH,
	workerMachineSetupPath: WORKER_MACHINE_SETUP_PATH,
	agentTeamsWorkerProfilePath: AGENT_TEAMS_WORKER_PROFILE_PATH,
});
