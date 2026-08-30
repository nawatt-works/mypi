import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	defaultWorkerRuntimeRoot,
	initializeWorkerMachine,
	listProviderCredentials,
	loadProviderCredential,
	recoverWorkerMachine,
	rotateWorkerCredential,
	verifyWorkerMachine,
} from "../extensions/worker-machine-setup.ts";

const SECRET_ONE = "worker-machine-secret-one";
const SECRET_TWO = "worker-machine-secret-two";
const PROVIDER = "openai-codex";
const FIRST = { type: "oauth" as const, refresh: `refresh-${SECRET_ONE}`, access: `access-${SECRET_ONE}`, expires: 2_000_000_000_000 };
const SECOND = { type: "api_key" as const, key: `key-${SECRET_TWO}` };

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "mypi-worker-machine-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceAgentDir = join(root, "source-agent");
	const runtimeRoot = join(root, "state", "mypi", "worker-runtime-v1");
	await mkdir(sourceAgentDir, { mode: 0o700 });
	await writeFile(join(sourceAgentDir, "auth.json"), `${JSON.stringify({ [PROVIDER]: FIRST }, null, 2)}\n`, { mode: 0o600 });
	return { root, sourceAgentDir, runtimeRoot };
}

async function initialize(t: TestContext) {
	const f = await fixture(t);
	const manifest = await initializeWorkerMachine({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		credential: FIRST,
		now: new Date("2026-08-30T16:30:00.000Z"),
	});
	return { ...f, manifest };
}

test("creates an atomic private machine hierarchy without putting credentials in its manifest", async (t) => {
	const f = await initialize(t);
	assert.equal(f.manifest.runtimeRoot, await realpath(f.runtimeRoot));
	assert.equal(f.manifest.providerId, PROVIDER);
	assert.equal(f.manifest.credentialRevision, 1);
	assert.ok(!JSON.stringify(f.manifest).includes(SECRET_ONE));
	assert.ok(!(await readFile(join(f.runtimeRoot, "machine.json"), "utf8")).includes(SECRET_ONE));
	assert.ok((await readFile(join(f.runtimeRoot, "credential-source", `${PROVIDER}.auth.json`), "utf8")).includes(SECRET_ONE));
	assert.deepEqual((await readdir(f.runtimeRoot)).sort(), [
		"claimed-leases", "consumed-leases", "coordination", "credential-leases",
		"credential-source", "lease-authority", "locks", "machine.json", "runs", "transactions",
	]);
	for (const path of [f.runtimeRoot, "claimed-leases", "consumed-leases", "coordination", "credential-leases", "credential-source", "lease-authority", "locks", "runs", "transactions"].map((item) => item === f.runtimeRoot ? item : join(f.runtimeRoot, item))) {
		assert.equal((await lstat(path)).mode & 0o077, 0, path);
	}
	for (const path of [
		join(f.runtimeRoot, "machine.json"),
		join(f.runtimeRoot, "lease-authority", "private.pem"),
		join(f.runtimeRoot, "lease-authority", "public.pem"),
		join(f.runtimeRoot, "credential-source", `${PROVIDER}.auth.json`),
	]) assert.equal((await lstat(path)).mode & 0o077, 0, path);
	assert.deepEqual(await verifyWorkerMachine({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		expectedSetupDigest: f.manifest.setupDigest,
	}), { verified: true, mismatches: [], manifest: f.manifest });
});

test("is idempotent and does not silently replace an existing credential", async (t) => {
	const f = await initialize(t);
	const second = await initializeWorkerMachine({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		credential: SECOND,
		now: new Date("2026-08-30T17:00:00.000Z"),
	});
	assert.deepEqual(second, f.manifest);
	const source = await readFile(join(f.runtimeRoot, "credential-source", `${PROVIDER}.auth.json`), "utf8");
	assert.ok(source.includes(SECRET_ONE));
	assert.ok(!source.includes(SECRET_TWO));
});

test("lists only credential metadata and loads one explicit provider", async (t) => {
	const f = await fixture(t);
	const metadata = await listProviderCredentials(f.sourceAgentDir);
	assert.deepEqual(metadata, [{ providerId: PROVIDER, type: "oauth" }]);
	assert.ok(!JSON.stringify(metadata).includes(SECRET_ONE));
	assert.deepEqual(await loadProviderCredential(f.sourceAgentDir, PROVIDER), FIRST);
	await assert.rejects(() => loadProviderCredential(f.sourceAgentDir, "anthropic"), /no credential/);
});

test("rotates only an idle authority-bound machine and advances the credential revision", async (t) => {
	const f = await initialize(t);
	await mkdir(join(f.runtimeRoot, "runs", "run-empty", "workers"), { recursive: true, mode: 0o700 });
	await writeFile(join(f.sourceAgentDir, "auth.json"), `${JSON.stringify({ [PROVIDER]: SECOND }, null, 2)}\n`, { mode: 0o600 });
	const rotated = await rotateWorkerCredential({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		expectedSetupDigest: f.manifest.setupDigest,
		credential: SECOND,
		now: new Date("2026-08-30T17:00:00.000Z"),
	});
	assert.equal(rotated.credentialRevision, 2);
	assert.equal(rotated.credentialType, "api_key");
	assert.notEqual(rotated.setupDigest, f.manifest.setupDigest);
	const source = await readFile(join(f.runtimeRoot, "credential-source", `${PROVIDER}.auth.json`), "utf8");
	assert.ok(source.includes(SECRET_TWO));
	assert.ok(!source.includes(SECRET_ONE));
	await assert.rejects(() => rotateWorkerCredential({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		expectedSetupDigest: f.manifest.setupDigest,
		credential: FIRST,
	}), /authority-setup-digest|not verified/);
});

test("blocks rotation while a lease, claim, or generated Worker artifact exists", async (t) => {
	for (const relativePath of [
		join("credential-leases", "run-1", "worker.auth.json"),
		join("claimed-leases", "lease.json"),
		join("runs", "run-1", "workers", "worker-a", "worker-profile.json"),
	]) {
		await t.test(relativePath, async (t2) => {
			const f = await initialize(t2);
			const path = join(f.runtimeRoot, relativePath);
			await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
			await writeFile(path, "state\n", { mode: 0o600 });
			await assert.rejects(() => rotateWorkerCredential({
				runtimeRoot: f.runtimeRoot,
				sourceAgentDir: f.sourceAgentDir,
				providerId: PROVIDER,
				expectedSetupDigest: f.manifest.setupDigest,
				credential: SECOND,
			}), /while Worker state exists/);
		});
	}
});

test("serializes lease authority mutations and rejects rotation while the lock is held", async (t) => {
	const f = await initialize(t);
	await writeFile(join(f.runtimeRoot, "locks", "authority.lock"), "other-process\n", { mode: 0o600 });
	await assert.rejects(() => rotateWorkerCredential({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		expectedSetupDigest: f.manifest.setupDigest,
		credential: FIRST,
	}), /authority is busy/);
	assert.equal((await readFile(join(f.runtimeRoot, "credential-source", `${PROVIDER}.auth.json`), "utf8")).includes(SECRET_ONE), true);
	await writeFile(join(f.runtimeRoot, "locks", "authority.lock"), `${JSON.stringify({ schemaVersion: 1, pid: 999_999_999, createdAt: 0, nonce: "stale" })}\n`, { mode: 0o600 });
	const rotated = await rotateWorkerCredential({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		expectedSetupDigest: f.manifest.setupDigest,
		credential: FIRST,
		now: new Date("2026-08-30T17:00:00.000Z"),
	});
	assert.equal(rotated.credentialRevision, 2);
});

test("recovers only the exact one-step credential-first rotation state", async (t) => {
	const f = await initialize(t);
	const credentialPath = join(f.runtimeRoot, "credential-source", `${PROVIDER}.auth.json`);
	await writeFile(join(f.sourceAgentDir, "auth.json"), `${JSON.stringify({ [PROVIDER]: SECOND })}\n`, { mode: 0o600 });
	await writeFile(`${credentialPath}.next`, `${JSON.stringify({ schemaVersion: 1, providerId: PROVIDER, revision: 2, credential: SECOND }, null, 2)}\n`, { mode: 0o600 });
	await rm(credentialPath);
	await writeFile(credentialPath, await readFile(`${credentialPath}.next`), { mode: 0o600 });
	await rm(`${credentialPath}.next`);
	const before = await verifyWorkerMachine({ runtimeRoot: f.runtimeRoot, sourceAgentDir: f.sourceAgentDir, providerId: PROVIDER });
	assert.equal(before.verified, false);
	const recovered = await recoverWorkerMachine({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		expectedSetupDigest: f.manifest.setupDigest,
		now: new Date("2026-08-30T17:00:00.000Z"),
	});
	assert.equal(recovered.credentialRevision, 2);
	assert.equal(recovered.credentialType, "api_key");
	await writeFile(`${credentialPath}.bad`, `${JSON.stringify({ schemaVersion: 1, providerId: PROVIDER, revision: 4, credential: FIRST })}\n`, { mode: 0o600 });
	await rm(credentialPath);
	await writeFile(credentialPath, await readFile(`${credentialPath}.bad`), { mode: 0o600 });
	await assert.rejects(() => recoverWorkerMachine({
		runtimeRoot: f.runtimeRoot,
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		expectedSetupDigest: recovered.setupDigest,
	}), /cannot be recovered automatically/);
});

test("fails closed for missing, malformed, symlinked, unsafe, or Default-linked machine state", async (t) => {
	const f = await fixture(t);
	assert.equal((await verifyWorkerMachine({ runtimeRoot: f.runtimeRoot, sourceAgentDir: f.sourceAgentDir, providerId: PROVIDER })).verified, false);
	await mkdir(f.runtimeRoot, { recursive: true, mode: 0o700 });
	await assert.rejects(() => initializeWorkerMachine({ runtimeRoot: f.runtimeRoot, sourceAgentDir: f.sourceAgentDir, providerId: PROVIDER, credential: FIRST }), /existing Worker machine is not verified/);

	const linkedRoot = join(f.root, "linked-runtime");
	await rm(f.runtimeRoot, { recursive: true, force: true });
	await mkdir(f.runtimeRoot, { recursive: true, mode: 0o700 });
	await symlink(f.runtimeRoot, linkedRoot);
	await assert.rejects(() => initializeWorkerMachine({ runtimeRoot: linkedRoot, sourceAgentDir: f.sourceAgentDir, providerId: PROVIDER, credential: FIRST }), /existing Worker machine is not verified|real directory/);

	await chmod(join(f.sourceAgentDir, "auth.json"), 0o644);
	await assert.rejects(() => listProviderCredentials(f.sourceAgentDir), /private owner read\/write/);
	await chmod(join(f.sourceAgentDir, "auth.json"), 0o600);
	await assert.rejects(() => initializeWorkerMachine({
		runtimeRoot: join(f.sourceAgentDir, "worker-runtime"),
		sourceAgentDir: f.sourceAgentDir,
		providerId: PROVIDER,
		credential: FIRST,
	}), /must be disjoint/);
});

test("detects manifest, key, credential, permission, and unexpected-entry tampering", async (t) => {
	const scenarios: Array<(runtimeRoot: string) => Promise<void>> = [
		async (root) => writeFile(join(root, "unexpected"), "x"),
		async (root) => chmod(join(root, "credential-source", `${PROVIDER}.auth.json`), 0o644),
		async (root) => writeFile(join(root, "lease-authority", "public.pem"), generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" })),
		async (root) => {
			const path = join(root, "credential-source", `${PROVIDER}.auth.json`);
			const value = JSON.parse(await readFile(path, "utf8"));
			value.revision = 9;
			await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
		},
		async (root) => {
			const path = join(root, "credential-source", `${PROVIDER}.auth.json`);
			const value = JSON.parse(await readFile(path, "utf8"));
			value.credential.access = "tampered-access";
			await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
		},
	];
	for (const [index, mutate] of scenarios.entries()) {
		await t.test(String(index), async (t2) => {
			const f = await initialize(t2);
			await mutate(f.runtimeRoot);
			const result = await verifyWorkerMachine({
				runtimeRoot: f.runtimeRoot,
				sourceAgentDir: f.sourceAgentDir,
				providerId: PROVIDER,
				expectedSetupDigest: f.manifest.setupDigest,
			});
			assert.equal(result.verified, false);
			assert.ok(result.mismatches.length > 0);
		});
	}
});

test("chooses a deterministic runtime root without consulting project paths", () => {
	assert.equal(defaultWorkerRuntimeRoot("/Users/example"), "/Users/example/.local/state/mypi/worker-runtime-v1");
});
