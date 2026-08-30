import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	cleanupAgentTeamsWorkerProfile,
	materializeAgentTeamsWorkerProfile,
	type AgentTeamsWorkerProfileConfiguration,
	type AgentTeamsWorkerSpawnIdentity,
} from "../extensions/agent-teams-worker-profile.ts";

const SECRET = "agent-teams-worker-secret";

function credentialJson(): string {
	return `${JSON.stringify({
		"openai-codex": { type: "oauth", refresh: `refresh-${SECRET}`, access: `access-${SECRET}`, expires: 4_102_444_800_000 },
	}, null, 2)}\n`;
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
	for (const path of [runtimeRoot, defaultAgentDir, credentialRoot, teamsRootDir, worktree]) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
	}
	await writeFile(credentialLeasePath, credentialJson(), { mode: 0o600 });
	await writeFile(workerBoundaryPath, "export default function boundary() {}\n", { mode: 0o600 });
	await writeFile(teamsExtensionPath, "export default function teams() {}\n", { mode: 0o600 });
	const configuration: AgentTeamsWorkerProfileConfiguration = {
		runtimeRoot,
		defaultAgentDir,
		providerId: "openai-codex",
		modelId: "gpt-5.4-mini",
		thinkingLevel: "low",
		workerBoundaryPath,
		teamsExtensionPath,
		boundaryContractDigest: "a".repeat(64),
		maxWorkers: 2,
	};
	const spawn: AgentTeamsWorkerSpawnIdentity = {
		runId: "run-1",
		workerId: "worker-a",
		worktree,
		teamId: "team-1",
		taskListId: "tasks-1",
		leadName: "team-lead",
		teamsRootDir,
		readyNonce: "b".repeat(64),
		credentialLeasePath,
		autoClaim: "0",
		style: "default",
	};
	return { root, runtimeRoot, defaultAgentDir, credentialRoot, credentialLeasePath, teamsRootDir, worktree, configuration, spawn };
}

test("materializes and verifies an exact agent-teams child profile without returning credential values", async (t) => {
	const f = await fixture(t);
	const worker = await materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/usr/bin:/bin", OPENAI_API_KEY: "ambient-must-not-leak" },
	});
	assert.deepEqual(worker.childArgs, worker.profile.manifest.launchArgs.slice(2));
	assert.deepEqual(worker.childArgs.slice(0, 4), ["--name", "mypi-worker:worker-a", "--session-dir", worker.profile.manifest.paths.sessions]);
	assert.deepEqual(worker.profile.manifest.resources.tools, ["read", "bash", "edit", "write", "team_message"]);
	assert.deepEqual(worker.profile.manifest.resources.extensions.map((entry) => entry.path), [
		await realpath(f.configuration.workerBoundaryPath),
		await realpath(f.configuration.teamsExtensionPath),
	]);
	for (const key of [
		"MYPI_AGENT_TEAMS_BOUNDARY_PATH", "MYPI_AGENT_TEAMS_ENTRY_PATH", "MYPI_AGENT_TEAMS_PROFILE_DIGEST",
		"MYPI_AGENT_TEAMS_READY_NONCE", "PI_TEAMS_TEAM_ID", "PI_TEAMS_WORKER",
	]) assert.ok(worker.profile.manifest.environmentKeys.includes(key), key);
	assert.equal(worker.profile.environment.OPENAI_API_KEY, undefined);
	assert.ok(!JSON.stringify(worker).includes(SECRET));
	assert.ok(!(await readFile(worker.profile.manifest.paths.manifest, "utf8")).includes(SECRET));
	const auth = await readFile(join(worker.profile.manifest.paths.agent, "auth.json"), "utf8");
	assert.ok(auth.includes(SECRET));
	await assert.rejects(() => lstat(f.credentialLeasePath), /ENOENT/, "credential lease must be consumed once");
	await cleanupAgentTeamsWorkerProfile({
		worker,
		runtimeRoot: f.runtimeRoot,
		expectedProfileDigest: worker.profile.manifest.profileDigest,
	});
	await assert.rejects(() => lstat(worker.profile.manifest.paths.workerRoot), /ENOENT/);
});

test("keeps mutable Pi state disjoint across agent-teams Workers", async (t) => {
	const f = await fixture(t);
	const first = await materializeAgentTeamsWorkerProfile({ configuration: f.configuration, spawn: f.spawn, environment: { PATH: "/bin" } });
	const secondLease = join(f.credentialRoot, "worker-b.auth.json");
	await writeFile(secondLease, credentialJson(), { mode: 0o600 });
	const second = await materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, workerId: "worker-b", credentialLeasePath: secondLease },
		environment: { PATH: "/bin" },
	});
	assert.notEqual(first.profile.manifest.paths.agent, second.profile.manifest.paths.agent);
	assert.notEqual(first.profile.manifest.paths.sessions, second.profile.manifest.paths.sessions);
	assert.notEqual(first.profile.manifest.profileDigest, second.profile.manifest.profileDigest);
});

test("requires a private single-use credential lease under the Worker-scoped runtime hierarchy", async (t) => {
	const f = await fixture(t);
	const outside = join(f.root, "outside.auth.json");
	await writeFile(outside, credentialJson(), { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, credentialLeasePath: outside },
		environment: { PATH: "/bin" },
	}), /outside the Worker-scoped lease store/);

	await writeFile(f.credentialLeasePath, `${JSON.stringify({
		"openai-codex": { type: "api_key", key: "one" },
		anthropic: { type: "api_key", key: "two" },
	})}\n`, { mode: 0o600 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
	}), /exactly the requested provider/);
});

test("rejects symlinked, group-readable, or wrong-provider credential leases", async (t) => {
	const f = await fixture(t);
	const realSource = join(f.credentialRoot, "real.auth.json");
	await writeFile(realSource, credentialJson(), { mode: 0o600 });
	await rm(f.credentialLeasePath);
	await symlink(realSource, f.credentialLeasePath);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
	}), /real file/);
	await rm(f.credentialLeasePath);
	await writeFile(f.credentialLeasePath, `${JSON.stringify({ anthropic: { type: "api_key", key: "wrong" } })}\n`, { mode: 0o640 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: f.spawn,
		environment: { PATH: "/bin" },
	}), /private owner read\/write permissions|exactly the requested provider/);
});

test("requires coordination state inside the runtime root and exact spawn identities", async (t) => {
	const f = await fixture(t);
	const externalTeamsRoot = join(f.root, "external-teams");
	await mkdir(externalTeamsRoot, { mode: 0o700 });
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, teamsRootDir: externalTeamsRoot },
		environment: { PATH: "/bin" },
	}), /dedicated Worker coordination root/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, workerId: "../escape" },
		environment: { PATH: "/bin" },
	}), /bounded identifier/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: { ...f.configuration, maxWorkers: 4 },
		spawn: f.spawn,
		environment: { PATH: "/bin" },
	}), /integer from 1 to 3/);
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: f.configuration,
		spawn: { ...f.spawn, autoClaim: "yes" as never },
		environment: { PATH: "/bin" },
	}), /autoClaim must be 0 or 1/);
	const worktreeExtension = join(f.worktree, "forged-boundary.ts");
	await writeFile(worktreeExtension, "export default function forged() {}\n");
	await assert.rejects(() => materializeAgentTeamsWorkerProfile({
		configuration: { ...f.configuration, workerBoundaryPath: worktreeExtension },
		spawn: f.spawn,
		environment: { PATH: "/bin" },
	}), /trusted Worker extensions must be outside/);
});
