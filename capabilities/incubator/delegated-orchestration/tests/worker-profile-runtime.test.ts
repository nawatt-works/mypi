import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	cleanupMaterializedWorkerProfile,
	materializeWorkerProfile,
	verifyMaterializedWorkerProfile,
	type PiWorkerProfileTemplate,
	type WorkerCredentialProjection,
} from "../extensions/worker-profile-runtime.ts";

const SECRET = "sentinel-worker-secret-value";
const CREDENTIAL: WorkerCredentialProjection = {
	providerId: "openai-codex",
	credential: { type: "oauth", refresh: `refresh-${SECRET}`, access: `access-${SECRET}`, expires: 4_102_444_800_000 },
};

async function fixture(t: TestContext): Promise<{
	root: string;
	runtimeRoot: string;
	worktree: string;
	defaultAgentDir: string;
	extension: string;
	template: PiWorkerProfileTemplate;
}> {
	const root = await mkdtemp(join(tmpdir(), "mypi-worker-profile-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = join(root, "runtime");
	const worktree = join(root, "worktree");
	const defaultAgentDir = join(root, "default-home", ".pi", "agent");
	const extension = join(root, "worker-boundary.ts");
	await mkdir(runtimeRoot, { mode: 0o700 });
	await mkdir(worktree, { mode: 0o700 });
	await mkdir(defaultAgentDir, { recursive: true, mode: 0o700 });
	await writeFile(extension, "export default function boundary() {}\n", { mode: 0o600 });
	return {
		root,
		runtimeRoot,
		worktree,
		defaultAgentDir,
		extension,
		template: {
			schemaVersion: 1,
			profileId: "pi-node-worker",
			profileVersion: "1.0.0",
			workspaceMode: "worktree-write",
			providerId: "openai-codex",
			modelId: "gpt-5.4-mini",
			thinkingLevel: "low",
			tools: ["read", "bash", "edit", "write", "team_message"],
			extensions: [extension],
		},
	};
}

async function materialize(t: TestContext, overrides: Record<string, unknown> = {}) {
	const f = await fixture(t);
	const profile = await materializeWorkerProfile({
		runtimeRoot: f.runtimeRoot,
		defaultAgentDir: f.defaultAgentDir,
		runId: "run-1",
		workerId: "worker-a",
		worktree: f.worktree,
		template: f.template,
		credential: CREDENTIAL,
		environment: {
			PATH: "/usr/bin:/bin",
			HOME: "/ambient/default-home",
			USER: "probe",
			LANG: "en_US.UTF-8",
			ANTHROPIC_API_KEY: "must-not-leak",
			OPENAI_API_KEY: "must-not-leak",
			AWS_SESSION_TOKEN: "must-not-leak",
		},
		...overrides,
	});
	return { ...f, profile };
}

test("materializes a private per-Worker Pi profile without ambient Default state", async (t) => {
	const { profile, defaultAgentDir, worktree } = await materialize(t);
	const { manifest, environment } = profile;
	assert.notEqual(environment.HOME, "/ambient/default-home");
	assert.equal(environment.HOME, manifest.paths.home);
	assert.equal(environment.PI_CODING_AGENT_DIR, manifest.paths.agent);
	assert.equal(environment.PI_CODING_AGENT_SESSION_DIR, manifest.paths.sessions);
	assert.equal(environment.MYPI_WORKER, "1");
	assert.equal(environment.ANTHROPIC_API_KEY, undefined);
	assert.equal(environment.OPENAI_API_KEY, undefined);
	assert.equal(environment.AWS_SESSION_TOKEN, undefined);
	assert.equal(manifest.worktree, await realpath(worktree));
	assert.ok(!manifest.launchArgs.includes(defaultAgentDir));
	for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
		assert.ok(manifest.launchArgs.includes(flag), flag);
	}
	assert.deepEqual(await verifyMaterializedWorkerProfile({
		profile,
		expectedProfileDigest: profile.manifest.profileDigest,
		defaultAgentDir,
		expectedCredential: CREDENTIAL,
	}), {
		verified: true,
		mismatches: [],
	});
});

test("writes only one provider credential and never copies its value into manifest, args, or environment", async (t) => {
	const { profile } = await materialize(t);
	const auth = JSON.parse(await readFile(join(profile.manifest.paths.agent, "auth.json"), "utf8"));
	assert.deepEqual(Object.keys(auth), ["openai-codex"]);
	assert.equal(auth["openai-codex"].access, `access-${SECRET}`);
	assert.ok(!(await readFile(profile.manifest.paths.manifest, "utf8")).includes(SECRET));
	assert.ok(!JSON.stringify(profile.manifest).includes(SECRET));
	assert.ok(!JSON.stringify(profile.environment).includes(SECRET));
	assert.ok(!profile.manifest.launchArgs.join(" ").includes(SECRET));
	if (process.platform !== "win32") {
		for (const path of [
			profile.manifest.paths.workerRoot,
			profile.manifest.paths.home,
			profile.manifest.paths.agent,
			profile.manifest.paths.sessions,
			profile.manifest.paths.temp,
		]) assert.equal((await lstat(path)).mode & 0o077, 0, path);
		for (const path of ["auth.json", "settings.json", "trust.json"]) {
			assert.equal((await lstat(join(profile.manifest.paths.agent, path))).mode & 0o077, 0, path);
		}
	}
});

test("creates disjoint mutable state for every Worker and refuses identity reuse", async (t) => {
	const f = await fixture(t);
	const common = {
		runtimeRoot: f.runtimeRoot,
		defaultAgentDir: f.defaultAgentDir,
		runId: "run-shared",
		worktree: f.worktree,
		template: f.template,
		credential: CREDENTIAL,
		environment: { PATH: "/bin" },
	};
	const first = await materializeWorkerProfile({ ...common, workerId: "worker-a" });
	const second = await materializeWorkerProfile({ ...common, workerId: "worker-b" });
	assert.notEqual(first.manifest.paths.workerRoot, second.manifest.paths.workerRoot);
	assert.notEqual(first.manifest.paths.agent, second.manifest.paths.agent);
	assert.notEqual(first.manifest.paths.sessions, second.manifest.paths.sessions);
	assert.notEqual(first.manifest.profileDigest, second.manifest.profileDigest);
	await assert.rejects(() => materializeWorkerProfile({ ...common, workerId: "worker-a" }), /already exists/);
});

test("rejects Default overlap, worktree overlap, symlinks, malformed identifiers, and credential mismatch", async (t) => {
	const f = await fixture(t);
	const common = {
		defaultAgentDir: f.defaultAgentDir,
		runId: "run-1",
		workerId: "worker-a",
		worktree: f.worktree,
		template: f.template,
		credential: CREDENTIAL,
		environment: { PATH: "/bin" },
	};
	await assert.rejects(() => materializeWorkerProfile({ ...common, runtimeRoot: f.defaultAgentDir }), /must be disjoint/);
	const worktreeRuntime = join(f.worktree, "runtime");
	await mkdir(worktreeRuntime, { mode: 0o700 });
	await assert.rejects(() => materializeWorkerProfile({ ...common, runtimeRoot: worktreeRuntime }), /must be disjoint/);
	await assert.rejects(() => materializeWorkerProfile({ ...common, runtimeRoot: f.runtimeRoot, workerId: "../escape" }), /bounded identifier/);
	await assert.rejects(() => materializeWorkerProfile({
		...common,
		runtimeRoot: f.runtimeRoot,
		credential: { providerId: "anthropic", credential: { type: "api_key", key: "x" } },
	}), /must match/);
	const symlinkPath = join(f.root, "extension-link.ts");
	await symlink(f.extension, symlinkPath);
	await assert.rejects(() => materializeWorkerProfile({
		...common,
		runtimeRoot: f.runtimeRoot,
		template: { ...f.template, extensions: [symlinkPath] },
	}), /real file/);
});

test("refuses a symlinked runtime hierarchy before writing Worker state", async (t) => {
	const f = await fixture(t);
	const escaped = join(f.root, "escaped-runtime");
	await mkdir(escaped, { mode: 0o700 });
	await symlink(escaped, join(f.runtimeRoot, "runs"));
	await assert.rejects(() => materializeWorkerProfile({
		runtimeRoot: f.runtimeRoot,
		defaultAgentDir: f.defaultAgentDir,
		runId: "run-1",
		workerId: "worker-a",
		worktree: f.worktree,
		template: f.template,
		credential: CREDENTIAL,
		environment: { PATH: "/bin" },
	}), /not a real directory/);
	assert.deepEqual(await readdir(escaped), []);
});

test("marks settings, trust, credential, extension, and manifest tampering as unverified", async (t) => {
	const { profile, defaultAgentDir, extension } = await materialize(t);
	await writeFile(join(profile.manifest.paths.agent, "settings.json"), "{}\n");
	await writeFile(join(profile.manifest.paths.agent, "trust.json"), "{}\n");
	await writeFile(join(profile.manifest.paths.agent, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "wrong" } }));
	await writeFile(extension, "export const drift = true;\n");
	const result = await verifyMaterializedWorkerProfile({
		profile,
		expectedProfileDigest: profile.manifest.profileDigest,
		defaultAgentDir,
		expectedCredential: CREDENTIAL,
	});
	assert.equal(result.verified, false);
	assert.ok(result.mismatches.includes("settings-digest"));
	assert.ok(result.mismatches.includes("settings-content"));
	assert.ok(result.mismatches.includes("trust-digest"));
	assert.ok(result.mismatches.includes("trust-content"));
	assert.ok(result.mismatches.includes("credential-identity"));
	assert.ok(result.mismatches.includes("credential-content"));
	assert.ok(result.mismatches.some((entry) => entry.startsWith("extension-digest:")));
});

test("fails verification for missing artifacts and unsafe permissions instead of falling back", async (t) => {
	const { profile, defaultAgentDir } = await materialize(t);
	await rm(join(profile.manifest.paths.agent, "auth.json"));
	if (process.platform !== "win32") await chmod(profile.manifest.paths.agent, 0o755);
	const result = await verifyMaterializedWorkerProfile({
		profile,
		expectedProfileDigest: profile.manifest.profileDigest,
		defaultAgentDir,
		expectedCredential: CREDENTIAL,
	});
	assert.equal(result.verified, false);
	assert.ok(result.mismatches.includes(`missing-file:${join(profile.manifest.paths.agent, "auth.json")}`));
	assert.ok(!result.mismatches.includes("credential-json"), "untrusted files must not be parsed");
	if (process.platform !== "win32") assert.ok(result.mismatches.includes(`private-directory:${profile.manifest.paths.agent}`));
});

test("verification is authority-bound and never follows paths from a forged profile object", async (t) => {
	const { profile, defaultAgentDir } = await materialize(t);
	const expectedProfileDigest = profile.manifest.profileDigest;
	const forged = structuredClone(profile);
	forged.manifest.paths.agent = defaultAgentDir;
	forged.manifest.paths.manifest = join(defaultAgentDir, "auth.json");
	forged.manifest.profileDigest = "f".repeat(64);
	const result = await verifyMaterializedWorkerProfile({
		profile: forged,
		expectedProfileDigest,
		defaultAgentDir,
		expectedCredential: CREDENTIAL,
	});
	assert.deepEqual(result, {
		verified: false,
		mismatches: ["requested-profile-digest", "profile-digest"],
	});
});

test("unexpected preflight artifacts fail verification", async (t) => {
	const { profile, defaultAgentDir } = await materialize(t);
	await writeFile(join(profile.manifest.paths.agent, "models.json"), '{"providers":{}}\n', { mode: 0o600 });
	const result = await verifyMaterializedWorkerProfile({
		profile,
		expectedProfileDigest: profile.manifest.profileDigest,
		defaultAgentDir,
		expectedCredential: CREDENTIAL,
	});
	assert.equal(result.verified, false);
	assert.ok(result.mismatches.includes("unexpected-agent-artifacts"));
});

test("cleanup is identity-bound and refuses a forged manifest", async (t) => {
	const { profile } = await materialize(t);
	const forged = structuredClone(profile);
	forged.manifest.workerId = "worker-forged";
	await assert.rejects(() => cleanupMaterializedWorkerProfile({
		profile: forged,
		runtimeRoot: profile.manifest.paths.workerRoot,
		expectedProfileDigest: profile.manifest.profileDigest,
	}), /outside the authorized hierarchy|authority-bound|mismatched identity/);
	assert.ok(await lstat(profile.manifest.paths.workerRoot));
	const runtimeRoot = join(profile.manifest.paths.workerRoot, "..", "..", "..", "..");
	await cleanupMaterializedWorkerProfile({
		profile,
		runtimeRoot,
		expectedProfileDigest: profile.manifest.profileDigest,
	});
	await assert.rejects(() => lstat(profile.manifest.paths.workerRoot), /ENOENT/);
});

test("invalid or empty credential projection never leaves a partial Worker profile", async (t) => {
	const f = await fixture(t);
	await assert.rejects(() => materializeWorkerProfile({
		runtimeRoot: f.runtimeRoot,
		defaultAgentDir: f.defaultAgentDir,
		runId: "run-invalid",
		workerId: "worker-a",
		worktree: f.worktree,
		template: f.template,
		credential: { providerId: "openai-codex", credential: { type: "api_key" } },
		environment: { PATH: "/bin" },
	}), /must contain/);
	await assert.rejects(() => lstat(join(f.runtimeRoot, "runs", "run-invalid", "workers", "worker-a")), /ENOENT/);
});

test("a real child Pi loads only the generated profile and never the Default or project canaries", async (t) => {
	const f = await fixture(t);
	const observedPath = join(f.root, "observed-worker.json");
	const defaultCanary = join(f.defaultAgentDir, "extensions", "default-canary.ts");
	const projectCanary = join(f.worktree, ".pi", "extensions", "project-canary.ts");
	await mkdir(join(f.defaultAgentDir, "extensions"), { recursive: true, mode: 0o700 });
	await mkdir(join(f.worktree, ".pi", "extensions"), { recursive: true, mode: 0o700 });
	await writeFile(defaultCanary, `export default p=>p.registerCommand("default-canary",{handler:async()=>{}});\n`);
	await writeFile(projectCanary, `export default p=>p.registerCommand("project-canary",{handler:async()=>{}});\n`);
	await writeFile(join(f.defaultAgentDir, "auth.json"), `${JSON.stringify({ anthropic: { type: "api_key", key: "default-auth-canary" } })}\n`, { mode: 0o600 });
	await writeFile(f.extension, `
import { readFileSync, writeFileSync } from "node:fs";
export default function generatedWorker(pi) {
  const auth = JSON.parse(readFileSync(process.env.PI_CODING_AGENT_DIR + "/auth.json", "utf8"));
  writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({
    home: process.env.HOME,
    agent: process.env.PI_CODING_AGENT_DIR,
    sessions: process.env.PI_CODING_AGENT_SESSION_DIR,
    providers: Object.keys(auth),
    defaultMarker: process.env.ANTHROPIC_API_KEY,
  }));
  pi.registerCommand("generated-worker-canary", { handler: async () => {} });
}
`);
	const profile = await materializeWorkerProfile({
		runtimeRoot: f.runtimeRoot,
		defaultAgentDir: f.defaultAgentDir,
		runId: "runtime-probe",
		workerId: "worker-a",
		worktree: f.worktree,
		template: f.template,
		credential: CREDENTIAL,
		environment: { ...process.env, PI_OFFLINE: "1", ANTHROPIC_API_KEY: "ambient-auth-canary" },
	});
	const child = spawnSync("pi", profile.manifest.launchArgs, {
		cwd: f.worktree,
		env: profile.environment,
		input: '{"type":"get_commands"}\n',
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(child.status, 0, child.stderr || child.stdout);
	const responses = child.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
	const commands = responses.find((entry) => entry.command === "get_commands" && entry.success)?.data?.commands ?? [];
	const names = new Set(commands.map((entry: { name: string }) => entry.name));
	assert.ok(names.has("generated-worker-canary"));
	assert.ok(!names.has("default-canary"));
	assert.ok(!names.has("project-canary"));
	const observed = JSON.parse(await readFile(observedPath, "utf8"));
	assert.equal(observed.home, profile.manifest.paths.home);
	assert.equal(observed.agent, profile.manifest.paths.agent);
	assert.equal(observed.sessions, profile.manifest.paths.sessions);
	assert.deepEqual(observed.providers, ["openai-codex"]);
	assert.equal(observed.defaultMarker, undefined);
});
