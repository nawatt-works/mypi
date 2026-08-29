import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	buildAgentTeamsProfile,
	verifyAgentTeamsProfile,
	type AgentTeamsObservedProfile,
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
	const entry = join(root, "patched-teams", "index.ts");
	const teamsRoot = join(root, "teams");
	await mkdir(join(root, "patched-teams"), { recursive: true });
	await writeFile(entry, "export default function fixture() {}\n");
	return { entry, teamsRoot };
}

test("verifies every Worker boundary artifact against the committed profile manifest", () => {
	const profile = loadWorkerProfile();
	assert.doesNotThrow(() => verifyWorkerProfileArtifacts(profile));
});

test("builds an atomic pinned agent-teams leader/child profile without ambient secrets", async (t) => {
	const { entry, teamsRoot } = await fixture(t);
	const profile = buildAgentTeamsProfile({
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: entry,
		teamsRootDir: teamsRoot,
		maxWorkers: 2,
		environment: ENV,
	});
	assert.equal(profile.kind, "pi-agent-teams");
	assert.equal(profile.profileId, "pi-agent-teams-docker-strong-v1");
	assert.equal(profile.forceWorktree, true);
	assert.equal(profile.maxWorkers, 2);
	assert.deepEqual(profile.childTools, ["read", "bash", "edit", "write", "team_message"]);
	assert.equal(profile.childExtensions.length, 2);
	assert.match(profile.workerBoundaryPath, /profiles\/pi-agent-teams\/node-worker-v1\/worker-boundary\.ts$/);
	assert.equal(profile.leaderEnvironment.PI_TEAMS_FORCE_WORKTREE, "1");
	assert.equal(profile.leaderEnvironment.PI_TEAMS_MAX_WORKERS, "2");
	assert.equal(profile.leaderEnvironment.PI_TEAMS_CHILD_TOOLS, "read,bash,edit,write");
	assert.equal(profile.leaderEnvironment.PI_TEAMS_DEFAULT_AUTO_CLAIM, "0");
	assert.equal(profile.leaderEnvironment.ANTHROPIC_API_KEY, undefined);
	assert.equal(profile.leaderEnvironment.MYPI_PHASE0_PARENT_MARKER, undefined);
	assert.ok(profile.childEnvironmentKeys.includes("MYPI_WORKER"));
	assert.ok(!profile.childEnvironmentKeys.some((key) => /KEY|TOKEN|SECRET|AUTH/i.test(key)));
	assert.equal(profile.profileDigest.length, 64);
	for (const digest of [
		profile.profileArtifactSha256,
		profile.overlayPatchSha256,
		profile.workerBoundarySha256,
		profile.commandPolicySha256,
		profile.scopedWorkerToolsSha256,
	]) assert.equal(digest.length, 64);
});

test("rejects source drift, missing paths, and worker ceilings outside the managed range", async (t) => {
	const { entry, teamsRoot } = await fixture(t);
	assert.throws(() => buildAgentTeamsProfile({
		upstreamCommit: "wrong",
		patchedTeamsEntryPath: entry,
		teamsRootDir: teamsRoot,
		maxWorkers: 2,
		environment: ENV,
	}), /unsupported agent-teams commit/);
	assert.throws(() => buildAgentTeamsProfile({
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: join(teamsRoot, "missing.ts"),
		teamsRootDir: teamsRoot,
		maxWorkers: 2,
		environment: ENV,
	}), /entry is missing/);
	assert.throws(() => buildAgentTeamsProfile({
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: entry,
		teamsRootDir: teamsRoot,
		maxWorkers: 4,
		environment: ENV,
	}), /integer from 1 to 3/);
});

test("verifies observed source, profile, lifecycle, resources, environment, and boundaries", async (t) => {
	const { entry, teamsRoot } = await fixture(t);
	const requested = buildAgentTeamsProfile({
		upstreamCommit: COMMIT,
		patchedTeamsEntryPath: entry,
		teamsRootDir: teamsRoot,
		maxWorkers: 2,
		environment: ENV,
	});
	const observed: AgentTeamsObservedProfile = {
		upstreamCommit: requested.upstreamCommit,
		profileDigest: requested.profileDigest,
		overlayPatchSha256: requested.overlayPatchSha256,
		workerBoundarySha256: requested.workerBoundarySha256,
		commandPolicySha256: requested.commandPolicySha256,
		scopedWorkerToolsSha256: requested.scopedWorkerToolsSha256,
		imageDigest: requested.imageDigest,
		imageReady: true,
		dockerReady: true,
		readyHandshake: true,
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
		"force-worktree",
		"max-workers",
		"child-tools",
		"child-environment",
		"child-environment-secrets",
		"boundary:commandHardlineDenied",
	]);
});
