import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	buildAgentTeamsProfile,
	sha256DirectoryTree,
	verifyAgentTeamsProfile,
	type AgentTeamsObservedProfile,
	type AgentTeamsProfile,
} from "../extensions/agent-teams-profile.ts";
import {
	loadWorkerProfile,
	verifyWorkerProfileArtifacts,
} from "../profiles/pi-agent-teams/node-worker-v1/worker-boundary.ts";

const COMMIT = "2c1776d2a68104aaadc1c622d8a704684c7c35d6";
const ENV = {
	HOME: "/Users/probe",
	PATH: "/toolchain/bin:/usr/bin:/bin",
	USER: "probe",
	LOGNAME: "probe",
	SHELL: "/bin/zsh",
	TERM: "xterm-256color",
	LANG: "en_US.UTF-8",
	HERDR_ENV: "1",
	HERDR_SOCKET_PATH: "/Users/probe/.config/herdr/herdr.sock",
	HERDR_PANE_ID: "w1:p1",
	ANTHROPIC_API_KEY: "must-not-leak",
	MYPI_PHASE0_PARENT_MARKER: "must-not-leak",
};

async function fixture(t: TestContext): Promise<{
	entry: string;
	teamsRoot: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "mypi-agent-teams-profile-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const entry = join(root, "extensions", "teams", "index.ts");
	const teamsRoot = join(root, "runtime-teams");
	await mkdir(join(root, "extensions", "teams"), { recursive: true });
	await writeFile(entry, "export default function fixture() {}\n");
	return { entry, teamsRoot };
}

test("verifies every Worker boundary artifact against the committed profile manifest", () => {
	const profile = loadWorkerProfile();
	assert.doesNotThrow(() => verifyWorkerProfileArtifacts(profile));
});

test("hashes the complete patched source tree deterministically and detects drift", async (t) => {
	const { entry } = await fixture(t);
	const sourceRoot = join(entry, "..");
	const first = sha256DirectoryTree(sourceRoot);
	const second = sha256DirectoryTree(sourceRoot);
	assert.equal(first, second);
	await writeFile(join(sourceRoot, "leader.ts"), "export const drift = true;\n");
	assert.notEqual(sha256DirectoryTree(sourceRoot), first);
});

test("rejects source drift, missing paths, and worker ceilings outside the managed range", async (t) => {
	const { entry, teamsRoot } = await fixture(t);
	const runtimeInputs = {
		runtimeRoot: teamsRoot,
		defaultAgentDir: join(teamsRoot, "default-agent"),
		providerId: "openai-codex",
		modelId: "gpt-5.4-mini",
		thinkingLevel: "low" as const,
		leasePublicKeyPath: join(teamsRoot, "lease-authority", "public.pem"),
		leasePublicKeySha256: "a".repeat(64),
		machineSetupDigest: "b".repeat(64),
		credentialRevision: 1,
	};
	assert.throws(() => buildAgentTeamsProfile({
		upstreamCommit: "wrong",
		patchedTeamsEntryPath: entry,
		...runtimeInputs,
		maxWorkers: 2,
		environment: ENV,
	}), /unsupported agent-teams commit/);
	assert.throws(() => buildAgentTeamsProfile({
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: join(teamsRoot, "missing.ts"),
		...runtimeInputs,
		maxWorkers: 2,
		environment: ENV,
	}), /entry is missing/);
	assert.throws(() => buildAgentTeamsProfile({
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: entry,
		...runtimeInputs,
		maxWorkers: 4,
		environment: ENV,
	}), /integer from 1 to 3/);
	assert.throws(() => buildAgentTeamsProfile({
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: entry,
		...runtimeInputs,
		maxWorkers: 2,
		environment: ENV,
	}), /patched agent-teams (?:entry|source tree) digest mismatch/);
});

function requestedFixture(entry: string, teamsRoot: string): AgentTeamsProfile {
	const digest = "a".repeat(64);
	return {
		kind: "pi-agent-teams",
		profileId: "pi-agent-teams-docker-strong-v1",
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: entry,
		workerBoundaryPath: "/profile/worker-boundary.ts",
		workerProfileRuntimePath: "/profile/worker-profile-runtime.ts",
		workerMachineSetupPath: "/profile/worker-machine-setup.ts",
		agentTeamsWorkerProfilePath: "/profile/agent-teams-worker-profile.ts",
		runtimeRoot: "/runtime",
		defaultAgentDir: "/default-agent",
		teamsRootDir: teamsRoot,
		providerId: "openai",
		modelId: "gpt-5.4-mini",
		thinkingLevel: "low",
		leasePublicKeyPath: "/runtime/lease-authority/public.pem",
		leasePublicKeySha256: digest,
		machineSetupDigest: digest,
		credentialRevision: 1,
		maxWorkers: 2,
		forceWorktree: true,
		childTools: ["read", "bash", "edit", "write", "team_message"],
		childExtensions: ["/profile/worker-boundary.ts", entry],
		childEnvironmentKeys: ["HOME", "MYPI_AGENT_TEAMS_ENTRY_PATH", "MYPI_AGENT_TEAMS_PROFILE_DIGEST", "MYPI_WORKER", "PATH"],
		leaderEnvironment: Object.freeze({ HOME: "/home/probe", PATH: "/bin" }),
		imageDigest: `sha256:${digest}`,
		profileArtifactSha256: digest,
		overlayPatchSha256: digest,
		workerBoundarySha256: digest,
		workerProfileRuntimeSha256: digest,
		workerMachineSetupSha256: digest,
		agentTeamsWorkerProfileSha256: digest,
		commandPolicySha256: digest,
		scopedWorkerToolsSha256: digest,
		patchedTeamsEntrySha256: digest,
		patchedTeamsSourceSha256: digest,
		boundaryContractDigest: digest,
		runtimeAuthorityDigest: digest,
		profileDigest: digest,
	};
}

test("verifies observed source, profile, lifecycle, resources, environment, and boundaries", async (t) => {
	const { entry, teamsRoot } = await fixture(t);
	const requested = requestedFixture(entry, teamsRoot);
	const observed: AgentTeamsObservedProfile = {
		upstreamCommit: requested.upstreamCommit,
		profileDigest: requested.profileDigest,
		overlayPatchSha256: requested.overlayPatchSha256,
		workerBoundarySha256: requested.workerBoundarySha256,
		workerProfileRuntimeSha256: requested.workerProfileRuntimeSha256,
		workerMachineSetupSha256: requested.workerMachineSetupSha256,
		agentTeamsWorkerProfileSha256: requested.agentTeamsWorkerProfileSha256,
		commandPolicySha256: requested.commandPolicySha256,
		scopedWorkerToolsSha256: requested.scopedWorkerToolsSha256,
		patchedTeamsEntrySha256: requested.patchedTeamsEntrySha256,
		patchedTeamsSourceSha256: requested.patchedTeamsSourceSha256,
		boundaryContractDigest: requested.boundaryContractDigest,
		runtimeAuthorityDigest: requested.runtimeAuthorityDigest,
		imageDigest: requested.imageDigest,
		imageReady: true,
		dockerReady: true,
		readyHandshake: true,
		structuredReadiness: true,
		sessionBoundReadiness: true,
		trustedBoundaryIdentity: true,
		generatedProfileReady: true,
		credentialLeaseConsumed: true,
		runtimeContractBound: true,
		cleanupVerified: true,
		forceWorktree: true,
		maxWorkers: 2,
		childTools: [...requested.childTools],
		childExtensions: [...requested.childExtensions],
		childEnvironmentKeys: [...requested.childEnvironmentKeys],
		routine: true,
		tests: true,
		environmentIsolated: true,
		secretDenied: true,
		hostReadIsolated: true,
		externalWriteDenied: true,
		networkDenied: true,
		commandHardlineDenied: true,
		noRoutinePrompt: true,
	};
	assert.deepEqual(verifyAgentTeamsProfile({ requested, observed }), { verified: true, mismatches: [] });

	const failed = verifyAgentTeamsProfile({
		requested,
		observed: {
			...observed,
			upstreamCommit: "drift",
			readyHandshake: false,
			structuredReadiness: false,
			sessionBoundReadiness: false,
			trustedBoundaryIdentity: false,
			forceWorktree: false,
			maxWorkers: null,
			childTools: ["read", "bash", "edit", "write", "team_message", "fetch_content"],
			childEnvironmentKeys: [...observed.childEnvironmentKeys, "ANTHROPIC_API_KEY"],
			commandHardlineDenied: false,
		},
	});
	assert.equal(failed.verified, false);
	assert.deepEqual(failed.mismatches, [
		"upstream-commit",
		"rpc-readiness",
		"structured-readiness",
		"session-bound-readiness",
		"trusted-boundary-identity",
		"force-worktree",
		"max-workers",
		"child-tools",
		"child-environment",
		"child-environment-secrets",
		"boundary:commandHardlineDenied",
	]);
});
