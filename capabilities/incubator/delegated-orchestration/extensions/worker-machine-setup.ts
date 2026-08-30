import {
	createHash,
	generateKeyPairSync,
	randomBytes,
	sign,
	verify,
} from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WorkerCredential } from "./worker-profile-runtime.ts";

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MACHINE_CHILDREN = [
	"claimed-leases",
	"consumed-leases",
	"coordination",
	"credential-leases",
	"credential-source",
	"lease-authority",
	"runs",
] as const;

export type WorkerMachineManifest = {
	schemaVersion: 1;
	kind: "mypi-worker-machine";
	profileVersion: "1";
	runtimeRoot: string;
	sourceAgentDir: string;
	providerId: string;
	credentialType: WorkerCredential["type"];
	credentialRevision: number;
	leasePublicKeyPath: string;
	leasePublicKeySha256: string;
	createdAt: string;
	updatedAt: string;
	setupDigest: string;
};

export type WorkerMachineVerification = {
	verified: boolean;
	mismatches: string[];
	manifest?: WorkerMachineManifest;
};

export type ProviderCredentialInfo = {
	providerId: string;
	type: WorkerCredential["type"];
};

type CredentialSource = {
	schemaVersion: 1;
	providerId: string;
	revision: number;
	credential: WorkerCredential;
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
	if (encoded === undefined) throw new Error("machine setup value must be JSON serializable");
	return encoded;
}

function requireAbsolute(label: string, value: string): string {
	if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path`);
	return resolve(value);
}

function requireIdentifier(label: string, value: string): string {
	if (!IDENTIFIER.test(value)) throw new Error(`${label} must be a bounded identifier`);
	return value;
}

function pathContains(parent: string, child: string): boolean {
	const relation = relative(parent, child);
	return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function requireDisjoint(leftLabel: string, left: string, rightLabel: string, right: string): void {
	if (pathContains(left, right) || pathContains(right, left)) throw new Error(`${leftLabel} and ${rightLabel} must be disjoint`);
}

function validateCredential(value: unknown): WorkerCredential {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker credential must be an object");
	const credential = structuredClone(value) as WorkerCredential;
	if (credential.type === "api_key") {
		if (credential.key !== undefined && (typeof credential.key !== "string" || credential.key.length === 0)) {
			throw new Error("api-key credential key must be non-empty");
		}
		if (credential.env !== undefined) {
			if (!credential.env || typeof credential.env !== "object" || Array.isArray(credential.env)) throw new Error("credential env must be an object");
			for (const [key, item] of Object.entries(credential.env)) {
				requireIdentifier("credential env key", key);
				if (typeof item !== "string" || item.length === 0) throw new Error("credential env values must be non-empty strings");
			}
		}
		if (!credential.key && (!credential.env || Object.keys(credential.env).length === 0)) throw new Error("api-key credential is empty");
	} else if (credential.type === "oauth") {
		if (typeof credential.refresh !== "string" || credential.refresh.length === 0 ||
			typeof credential.access !== "string" || credential.access.length === 0 ||
			!Number.isFinite(credential.expires)) throw new Error("OAuth credential is incomplete");
	} else {
		throw new Error("unsupported Worker credential type");
	}
	canonicalJson(credential);
	return credential;
}

async function requireDirectory(label: string, value: string, privateMode: boolean): Promise<string> {
	const requested = requireAbsolute(label, value);
	const info = await lstat(requested);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory`);
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`${label} has a different owner`);
	if (privateMode && process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (info.mode & 0o700) !== 0o700)) {
		throw new Error(`${label} must be private and owner-accessible`);
	}
	return realpath(requested);
}

async function requirePrivateFile(label: string, value: string): Promise<{ path: string; content: Buffer }> {
	const requested = requireAbsolute(label, value);
	const info = await lstat(requested);
	if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a real file`);
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`${label} has a different owner`);
	if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (info.mode & 0o600) !== 0o600)) {
		throw new Error(`${label} must use private owner read/write permissions`);
	}
	if (info.size > 1024 * 1024) throw new Error(`${label} exceeds the size limit`);
	const path = await realpath(requested);
	if (path !== requested) throw new Error(`${label} path is not canonical`);
	return { path, content: await readFile(path) };
}

function parseAuthStore(raw: Buffer): Record<string, WorkerCredential> {
	let parsed: unknown;
	try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw new Error("source auth.json is malformed"); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("source auth.json must be an object");
	const result: Record<string, WorkerCredential> = {};
	for (const [providerId, credential] of Object.entries(parsed as Record<string, unknown>)) {
		result[requireIdentifier("providerId", providerId)] = validateCredential(credential);
	}
	return result;
}

function parseCredentialSource(raw: Buffer): CredentialSource {
	let parsed: unknown;
	try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw new Error("Worker credential source is malformed"); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Worker credential source must be an object");
	const record = parsed as Record<string, unknown>;
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["credential", "providerId", "revision", "schemaVersion"])) {
		throw new Error("Worker credential source has an invalid shape");
	}
	if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
		throw new Error("Worker credential source metadata is invalid");
	}
	return {
		schemaVersion: 1,
		providerId: requireIdentifier("providerId", String(record.providerId)),
		revision: Number(record.revision),
		credential: validateCredential(record.credential),
	};
}

function manifestPayload(manifest: Omit<WorkerMachineManifest, "setupDigest">): unknown {
	return manifest;
}

function withSetupDigest(manifest: Omit<WorkerMachineManifest, "setupDigest">): WorkerMachineManifest {
	return { ...manifest, setupDigest: sha256(canonicalJson(manifestPayload(manifest))) };
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
	await chmod(path, 0o600);
}

async function writePrivateText(path: string, value: string | Buffer): Promise<void> {
	await writeFile(path, value, { mode: 0o600, flag: "wx" });
	await chmod(path, 0o600);
}

async function readManifest(runtimeRoot: string): Promise<WorkerMachineManifest> {
	const { content } = await requirePrivateFile("machine manifest", join(runtimeRoot, "machine.json"));
	let parsed: unknown;
	try { parsed = JSON.parse(content.toString("utf8")); } catch { throw new Error("machine manifest is malformed"); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("machine manifest must be an object");
	const expectedFields = [
		"createdAt", "credentialRevision", "credentialType", "kind", "leasePublicKeyPath", "leasePublicKeySha256",
		"profileVersion", "providerId", "runtimeRoot", "schemaVersion", "setupDigest", "sourceAgentDir", "updatedAt",
	].sort();
	if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedFields)) throw new Error("machine manifest has an invalid shape");
	return parsed as WorkerMachineManifest;
}

async function verifyCredentialSource(input: {
	runtimeRoot: string;
	providerId: string;
	revision: number;
	credentialType: WorkerCredential["type"];
}): Promise<void> {
	const root = await requireDirectory("credential source root", join(input.runtimeRoot, "credential-source"), true);
	const entries = await readdir(root);
	if (JSON.stringify(entries.sort()) !== JSON.stringify([`${input.providerId}.auth.json`])) throw new Error("credential source root contains unexpected entries");
	const source = parseCredentialSource((await requirePrivateFile("Worker credential source", join(root, entries[0]!))).content);
	if (source.providerId !== input.providerId || source.revision !== input.revision || source.credential.type !== input.credentialType) {
		throw new Error("Worker credential source identity does not match the machine manifest");
	}
}

export function defaultWorkerRuntimeRoot(home = homedir()): string {
	return resolve(home, ".local", "state", "mypi", "worker-runtime-v1");
}

export async function listProviderCredentials(sourceAgentDir: string): Promise<ProviderCredentialInfo[]> {
	const agentDir = await requireDirectory("sourceAgentDir", sourceAgentDir, false);
	const store = parseAuthStore((await requirePrivateFile("source auth.json", join(agentDir, "auth.json"))).content);
	return Object.entries(store).sort(([a], [b]) => a.localeCompare(b)).map(([providerId, credential]) => ({ providerId, type: credential.type }));
}

export async function loadProviderCredential(sourceAgentDir: string, providerId: string): Promise<WorkerCredential> {
	const agentDir = await requireDirectory("sourceAgentDir", sourceAgentDir, false);
	const id = requireIdentifier("providerId", providerId);
	const store = parseAuthStore((await requirePrivateFile("source auth.json", join(agentDir, "auth.json"))).content);
	const credential = store[id];
	if (!credential) throw new Error(`source auth.json has no credential for ${id}`);
	return structuredClone(credential);
}

export async function initializeWorkerMachine(input: {
	runtimeRoot: string;
	sourceAgentDir: string;
	providerId: string;
	credential: WorkerCredential;
	now?: Date;
}): Promise<WorkerMachineManifest> {
	const requestedRuntimeRoot = requireAbsolute("runtimeRoot", input.runtimeRoot);
	const parent = dirname(requestedRuntimeRoot);
	await mkdir(parent, { recursive: true, mode: 0o700 });
	const canonicalParent = await requireDirectory("runtime parent", parent, false);
	const runtimeRoot = join(canonicalParent, basename(requestedRuntimeRoot));
	const sourceAgentDir = await requireDirectory("sourceAgentDir", input.sourceAgentDir, false);
	requireDisjoint("runtimeRoot", runtimeRoot, "sourceAgentDir", sourceAgentDir);
	const providerId = requireIdentifier("providerId", input.providerId);
	const credential = validateCredential(input.credential);
	try {
		await lstat(runtimeRoot);
		const existing = await verifyWorkerMachine({ runtimeRoot, sourceAgentDir, providerId });
		if (!existing.verified || !existing.manifest) throw new Error(`existing Worker machine is not verified: ${existing.mismatches.join(",")}`);
		return existing.manifest;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const sourceCredential = await loadProviderCredential(sourceAgentDir, providerId);
	if (canonicalJson(sourceCredential) !== canonicalJson(credential)) throw new Error("projected credential does not match the explicit source profile");
	const staging = join(canonicalParent, `.worker-runtime-v1.setup-${randomBytes(12).toString("hex")}`);
	await mkdir(staging, { mode: 0o700 });
	let renamed = false;
	try {
		for (const child of MACHINE_CHILDREN) await mkdir(join(staging, child), { mode: 0o700 });
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
		const publicPem = publicKey.export({ type: "spki", format: "pem" });
		await writePrivateText(join(staging, "lease-authority", "private.pem"), privatePem);
		await writePrivateText(join(staging, "lease-authority", "public.pem"), publicPem);
		await writePrivateJson(join(staging, "credential-source", `${providerId}.auth.json`), {
			schemaVersion: 1,
			providerId,
			revision: 1,
			credential,
		});
		const timestamp = (input.now ?? new Date()).toISOString();
		const manifest = withSetupDigest({
			schemaVersion: 1,
			kind: "mypi-worker-machine",
			profileVersion: "1",
			runtimeRoot,
			sourceAgentDir,
			providerId,
			credentialType: credential.type,
			credentialRevision: 1,
			leasePublicKeyPath: join(runtimeRoot, "lease-authority", "public.pem"),
			leasePublicKeySha256: sha256(publicPem),
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		await writePrivateJson(join(staging, "machine.json"), manifest);
		await rename(staging, runtimeRoot);
		renamed = true;
		const verification = await verifyWorkerMachine({ runtimeRoot, sourceAgentDir, providerId, expectedSetupDigest: manifest.setupDigest });
		if (!verification.verified || !verification.manifest) throw new Error(`new Worker machine failed verification: ${verification.mismatches.join(",")}`);
		return verification.manifest;
	} catch (error) {
		await rm(renamed ? runtimeRoot : staging, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

export async function verifyWorkerMachine(input: {
	runtimeRoot: string;
	sourceAgentDir: string;
	providerId: string;
	expectedSetupDigest?: string;
}): Promise<WorkerMachineVerification> {
	const mismatches: string[] = [];
	let runtimeRoot: string;
	let sourceAgentDir: string;
	let manifest: WorkerMachineManifest;
	try {
		runtimeRoot = await requireDirectory("runtimeRoot", input.runtimeRoot, true);
		sourceAgentDir = await requireDirectory("sourceAgentDir", input.sourceAgentDir, false);
		requireDisjoint("runtimeRoot", runtimeRoot, "sourceAgentDir", sourceAgentDir);
		manifest = await readManifest(runtimeRoot);
	} catch (error) {
		return { verified: false, mismatches: [`preflight:${error instanceof Error ? error.message : String(error)}`] };
	}
	if (input.expectedSetupDigest !== undefined && (!DIGEST.test(input.expectedSetupDigest) || manifest.setupDigest !== input.expectedSetupDigest)) {
		return { verified: false, mismatches: ["authority-setup-digest"] };
	}
	if (manifest.schemaVersion !== 1 || manifest.kind !== "mypi-worker-machine" || manifest.profileVersion !== "1") mismatches.push("schema");
	if (manifest.runtimeRoot !== runtimeRoot) mismatches.push("runtime-root");
	if (manifest.sourceAgentDir !== sourceAgentDir) mismatches.push("source-agent-dir");
	if (manifest.providerId !== input.providerId || !IDENTIFIER.test(manifest.providerId)) mismatches.push("provider-id");
	if (manifest.credentialType !== "api_key" && manifest.credentialType !== "oauth") mismatches.push("credential-type");
	if (!DIGEST.test(manifest.leasePublicKeySha256)) mismatches.push("public-key-digest-format");
	const createdAt = Date.parse(manifest.createdAt);
	const updatedAt = Date.parse(manifest.updatedAt);
	if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) mismatches.push("timestamps");
	if (!Number.isSafeInteger(manifest.credentialRevision) || manifest.credentialRevision < 1) mismatches.push("credential-revision");
	if (manifest.leasePublicKeyPath !== join(runtimeRoot, "lease-authority", "public.pem")) mismatches.push("public-key-path");
	const { setupDigest: _setupDigest, ...payload } = manifest;
	if (!DIGEST.test(manifest.setupDigest) || manifest.setupDigest !== sha256(canonicalJson(payload))) mismatches.push("setup-digest");
	try {
		const topEntries = await readdir(runtimeRoot);
		const expected = [...MACHINE_CHILDREN, "machine.json"].sort();
		if (JSON.stringify(topEntries.sort()) !== JSON.stringify(expected)) mismatches.push("unexpected-runtime-entry");
		for (const child of MACHINE_CHILDREN) await requireDirectory(`runtime child ${child}`, join(runtimeRoot, child), true);
		const authorityRoot = await requireDirectory("lease authority root", join(runtimeRoot, "lease-authority"), true);
		const authorityEntries = await readdir(authorityRoot);
		if (JSON.stringify(authorityEntries.sort()) !== JSON.stringify(["private.pem", "public.pem"])) mismatches.push("unexpected-authority-entry");
		const privateKey = (await requirePrivateFile("lease private key", join(authorityRoot, "private.pem"))).content;
		const publicKey = (await requirePrivateFile("lease public key", join(authorityRoot, "public.pem"))).content;
		if (sha256(publicKey) !== manifest.leasePublicKeySha256) mismatches.push("public-key-digest");
		const challenge = Buffer.from("mypi-worker-machine-key-pair-v1");
		if (!verify(null, challenge, publicKey, sign(null, challenge, privateKey))) mismatches.push("key-pair");
		await verifyCredentialSource({
			runtimeRoot,
			providerId: manifest.providerId,
			revision: manifest.credentialRevision,
			credentialType: manifest.credentialType,
		});
	} catch (error) {
		mismatches.push(`artifact:${error instanceof Error ? error.message : String(error)}`);
	}
	return { verified: mismatches.length === 0, mismatches, manifest: mismatches.length === 0 ? manifest : undefined };
}

async function hasWorkerState(runtimeRoot: string): Promise<boolean> {
	for (const root of ["credential-leases", "claimed-leases", "runs"] as const) {
		const queue = [join(runtimeRoot, root)];
		while (queue.length > 0) {
			const current = queue.pop()!;
			for (const entry of await readdir(current, { withFileTypes: true })) {
				const path = join(current, entry.name);
				if (entry.isSymbolicLink()) throw new Error("Worker state contains a symlink");
				if (entry.isDirectory()) queue.push(path);
				else if (entry.isFile()) return true;
				else throw new Error("Worker state contains an unsupported entry");
			}
		}
	}
	return false;
}

export async function recoverWorkerMachine(input: {
	runtimeRoot: string;
	sourceAgentDir: string;
	providerId: string;
	expectedSetupDigest: string;
	now?: Date;
}): Promise<WorkerMachineManifest> {
	const runtimeRoot = await requireDirectory("runtimeRoot", input.runtimeRoot, true);
	const sourceAgentDir = await requireDirectory("sourceAgentDir", input.sourceAgentDir, false);
	requireDisjoint("runtimeRoot", runtimeRoot, "sourceAgentDir", sourceAgentDir);
	const providerId = requireIdentifier("providerId", input.providerId);
	const manifest = await readManifest(runtimeRoot);
	if (!DIGEST.test(input.expectedSetupDigest) || manifest.setupDigest !== input.expectedSetupDigest) {
		throw new Error("Worker machine recovery authority digest mismatch");
	}
	const { setupDigest: _digest, ...payload } = manifest;
	if (manifest.setupDigest !== sha256(canonicalJson(payload)) || manifest.runtimeRoot !== runtimeRoot ||
		manifest.sourceAgentDir !== sourceAgentDir || manifest.providerId !== providerId) {
		throw new Error("Worker machine manifest is not a trusted recovery base");
	}
	if (await hasWorkerState(runtimeRoot)) throw new Error("Worker machine cannot recover while Worker state exists");
	const credentialPath = join(runtimeRoot, "credential-source", `${providerId}.auth.json`);
	const source = parseCredentialSource((await requirePrivateFile("Worker credential source", credentialPath)).content);
	if (source.providerId !== providerId) throw new Error("Worker credential source provider does not match recovery authority");
	if (source.revision === manifest.credentialRevision) {
		const current = await verifyWorkerMachine({ ...input, expectedSetupDigest: manifest.setupDigest });
		if (!current.verified || !current.manifest) throw new Error(`Worker machine recovery found unresolved drift: ${current.mismatches.join(",")}`);
		return current.manifest;
	}
	if (source.revision !== manifest.credentialRevision + 1) throw new Error("Worker credential source revision cannot be recovered automatically");
	const next = withSetupDigest({
		...payload,
		credentialType: source.credential.type,
		credentialRevision: source.revision,
		updatedAt: (input.now ?? new Date()).toISOString(),
	});
	const manifestPath = join(runtimeRoot, "machine.json");
	const manifestTemp = `${manifestPath}.recover-${randomBytes(12).toString("hex")}`;
	try {
		await writePrivateJson(manifestTemp, next);
		await rename(manifestTemp, manifestPath);
	} catch (error) {
		await rm(manifestTemp, { force: true }).catch(() => undefined);
		throw error;
	}
	const verification = await verifyWorkerMachine({ ...input, expectedSetupDigest: next.setupDigest });
	if (!verification.verified || !verification.manifest) throw new Error(`recovered Worker machine failed verification: ${verification.mismatches.join(",")}`);
	return verification.manifest;
}

export async function rotateWorkerCredential(input: {
	runtimeRoot: string;
	sourceAgentDir: string;
	providerId: string;
	expectedSetupDigest: string;
	credential: WorkerCredential;
	now?: Date;
}): Promise<WorkerMachineManifest> {
	const verification = await verifyWorkerMachine(input);
	if (!verification.verified || !verification.manifest) throw new Error(`Worker machine is not verified: ${verification.mismatches.join(",")}`);
	const manifest = verification.manifest;
	if (await hasWorkerState(manifest.runtimeRoot)) throw new Error("Worker credential cannot rotate while Worker state exists");
	const credential = validateCredential(input.credential);
	const sourceCredential = await loadProviderCredential(manifest.sourceAgentDir, manifest.providerId);
	if (canonicalJson(sourceCredential) !== canonicalJson(credential)) throw new Error("rotated credential does not match the explicit source profile");
	const revision = manifest.credentialRevision + 1;
	const credentialPath = join(manifest.runtimeRoot, "credential-source", `${manifest.providerId}.auth.json`);
	const credentialTemp = `${credentialPath}.rotate-${randomBytes(12).toString("hex")}`;
	const manifestPath = join(manifest.runtimeRoot, "machine.json");
	const manifestTemp = `${manifestPath}.rotate-${randomBytes(12).toString("hex")}`;
	const { setupDigest: _previousDigest, ...current } = manifest;
	const next = withSetupDigest({
		...current,
		credentialType: credential.type,
		credentialRevision: revision,
		updatedAt: (input.now ?? new Date()).toISOString(),
	});
	try {
		await writePrivateJson(credentialTemp, { schemaVersion: 1, providerId: manifest.providerId, revision, credential });
		await writePrivateJson(manifestTemp, next);
		await rename(credentialTemp, credentialPath);
		await rename(manifestTemp, manifestPath);
	} catch (error) {
		await rm(credentialTemp, { force: true }).catch(() => undefined);
		await rm(manifestTemp, { force: true }).catch(() => undefined);
		throw error;
	}
	const result = await verifyWorkerMachine({ ...input, expectedSetupDigest: next.setupDigest });
	if (!result.verified || !result.manifest) throw new Error(`rotated Worker machine failed verification: ${result.mismatches.join(",")}`);
	return result.manifest;
}
