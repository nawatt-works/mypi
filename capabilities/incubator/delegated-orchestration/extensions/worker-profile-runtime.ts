import { createHash, timingSafeEqual } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import {
	access,
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type WorkerCredential =
	| { type: "api_key"; key?: string; env?: Record<string, string> }
	| ({ type: "oauth"; refresh: string; access: string; expires: number } & Record<string, unknown>);

export type WorkerCredentialProjection = {
	providerId: string;
	credential: WorkerCredential;
};

export type PiWorkerProfileTemplate = {
	schemaVersion: 1;
	profileId: string;
	profileVersion: string;
	workspaceMode: "read-only" | "worktree-write";
	providerId: string;
	modelId: string;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	tools: string[];
	extensions: string[];
};

export type MaterializedWorkerProfileManifest = {
	schemaVersion: 1;
	kind: "mypi-generated-worker-profile";
	runId: string;
	workerId: string;
	profileId: string;
	profileVersion: string;
	templateDigest: string;
	profileDigest: string;
	workspaceMode: "read-only" | "worktree-write";
	worktree: string;
	paths: {
		workerRoot: string;
		home: string;
		agent: string;
		sessions: string;
		temp: string;
		manifest: string;
	};
	provider: {
		id: string;
		modelId: string;
		thinkingLevel: PiWorkerProfileTemplate["thinkingLevel"];
		credentialType: WorkerCredential["type"];
	};
	resources: {
		tools: string[];
		extensions: Array<{ path: string; sha256: string }>;
	};
	launchArgs: string[];
	environmentKeys: string[];
	settingsSha256: string;
	trustSha256: string;
};

export type MaterializedWorkerProfile = {
	manifest: MaterializedWorkerProfileManifest;
	environment: Readonly<Record<string, string>>;
};

export type WorkerProfileVerification = {
	verified: boolean;
	mismatches: string[];
};

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const SAFE_ENVIRONMENT_KEYS = [
	"PATH",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"TERM",
	"COLORTERM",
	"NO_COLOR",
	"FORCE_COLOR",
	"CI",
	"PI_OFFLINE",
] as const;
const GENERATED_ENVIRONMENT_KEYS = [
	"HOME",
	"MYPI_WORKER",
	"MYPI_WORKER_PROFILE_DIGEST",
	"MYPI_WORKER_PROFILE_MANIFEST",
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"TEMP",
	"TMP",
	"TMPDIR",
] as const;
const GENERATED_ENVIRONMENT_KEY_SET = new Set<string>(GENERATED_ENVIRONMENT_KEYS);
const FORBIDDEN_AMBIENT_ENVIRONMENT = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

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
	if (encoded === undefined) throw new Error("profile values must be JSON serializable");
	return encoded;
}

function requireIdentifier(label: string, value: string): string {
	if (!IDENTIFIER.test(value)) throw new Error(`${label} must be a bounded identifier`);
	return value;
}

function requireAbsolute(label: string, value: string): string {
	if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
	return resolve(value);
}

function pathContains(parent: string, child: string): boolean {
	const relation = relative(parent, child);
	return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function requireDisjoint(labelA: string, pathA: string, labelB: string, pathB: string): void {
	if (pathContains(pathA, pathB) || pathContains(pathB, pathA)) {
		throw new Error(`${labelA} and ${labelB} must be disjoint`);
	}
}

function requireUnique(label: string, values: readonly string[]): string[] {
	if (values.length === 0) throw new Error(`${label} must not be empty`);
	const normalized = values.map((value, index) => requireIdentifier(`${label}[${index}]`, value));
	if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
	return normalized;
}

function validateCredential(input: WorkerCredentialProjection, providerId: string): WorkerCredentialProjection {
	if (requireIdentifier("credential.providerId", input.providerId) !== providerId) {
		throw new Error("credential provider must match the Worker provider");
	}
	const credential = structuredClone(input.credential);
	if (!credential || typeof credential !== "object") throw new Error("credential must be an object");
	if (credential.type === "api_key") {
		if (credential.key !== undefined && (typeof credential.key !== "string" || credential.key.length === 0)) {
			throw new Error("api-key credential key must be a non-empty string");
		}
		if (credential.env !== undefined) {
			if (!credential.env || typeof credential.env !== "object" || Array.isArray(credential.env)) {
				throw new Error("api-key credential env must be an object");
			}
			for (const [key, value] of Object.entries(credential.env)) {
				requireIdentifier("credential env key", key);
				if (typeof value !== "string" || value.length === 0) throw new Error("credential env values must be non-empty strings");
			}
		}
		if (!credential.key && (!credential.env || Object.keys(credential.env).length === 0)) {
			throw new Error("api-key credential must contain a key or provider environment");
		}
	} else if (credential.type === "oauth") {
		if (!credential.refresh || !credential.access || !Number.isFinite(credential.expires)) {
			throw new Error("OAuth credential requires refresh, access, and finite expiry");
		}
	} else {
		throw new Error("unsupported Worker credential type");
	}
	canonicalJson(credential);
	return { providerId, credential };
}

async function canonicalExistingDirectory(label: string, path: string): Promise<string> {
	const absolute = requireAbsolute(label, path);
	const info = await lstat(absolute);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory`);
	return realpath(absolute);
}

async function ensurePrivateDirectory(path: string, create = true): Promise<void> {
	if (create) await mkdir(path, { recursive: true, mode: 0o700 });
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`runtime path is not a real directory: ${path}`);
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`runtime path has a different owner: ${path}`);
	if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error(`runtime path must not be group/world accessible: ${path}`);
}

async function ensurePrivateChildDirectory(parent: string, name: string): Promise<string> {
	const canonicalParent = await realpath(parent);
	const child = join(canonicalParent, name);
	try {
		await mkdir(child, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	await ensurePrivateDirectory(child, false);
	const canonicalChild = await realpath(child);
	if (dirname(canonicalChild) !== canonicalParent) throw new Error(`runtime child escaped its parent: ${child}`);
	return canonicalChild;
}

async function writePrivateJson(path: string, value: unknown): Promise<string> {
	const content = `${JSON.stringify(value, null, 2)}\n`;
	await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
	await chmod(path, 0o600);
	return sha256(content);
}

function settingsFor(template: PiWorkerProfileTemplate): Record<string, unknown> {
	return {
		defaultProvider: template.providerId,
		defaultModel: template.modelId,
		defaultThinkingLevel: template.thinkingLevel,
		packages: [],
	};
}

function launchArgsFor(input: {
	template: PiWorkerProfileTemplate;
	workerId: string;
	sessionDir: string;
	extensions: string[];
}): string[] {
	const args = [
		"--mode", "rpc",
		"--name", `mypi-worker:${input.workerId}`,
		"--session-dir", input.sessionDir,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--tools", input.template.tools.join(","),
		"--provider", input.template.providerId,
		"--model", input.template.modelId,
		"--thinking", input.template.thinkingLevel,
	];
	for (const extension of input.extensions) args.push("--extension", extension);
	return args;
}

function profileDigestPayload(manifest: Omit<MaterializedWorkerProfileManifest, "profileDigest">): unknown {
	return manifest;
}

function environmentFor(input: {
	base: NodeJS.ProcessEnv;
	home: string;
	agent: string;
	sessions: string;
	temp: string;
	manifest: string;
	profileDigest: string;
}): Readonly<Record<string, string>> {
	const environment: Record<string, string> = {};
	for (const key of SAFE_ENVIRONMENT_KEYS) {
		const value = input.base[key];
		if (value) environment[key] = value;
	}
	if (!environment.PATH) throw new Error("Worker environment requires PATH");
	for (const key of Object.keys(input.base)) {
		if (FORBIDDEN_AMBIENT_ENVIRONMENT.test(key) && input.base[key]) {
			// Deliberately observed and dropped. Credential projection is file-backed.
			continue;
		}
	}
	Object.assign(environment, {
		HOME: input.home,
		MYPI_WORKER: "1",
		MYPI_WORKER_PROFILE_DIGEST: input.profileDigest,
		MYPI_WORKER_PROFILE_MANIFEST: input.manifest,
		PI_CODING_AGENT_DIR: input.agent,
		PI_CODING_AGENT_SESSION_DIR: input.sessions,
		TEMP: input.temp,
		TMP: input.temp,
		TMPDIR: input.temp,
	});
	return Object.freeze(Object.fromEntries(Object.entries(environment).sort(([a], [b]) => a.localeCompare(b))));
}

export async function materializeWorkerProfile(input: {
	runtimeRoot: string;
	defaultAgentDir?: string;
	runId: string;
	workerId: string;
	worktree: string;
	template: PiWorkerProfileTemplate;
	credential: WorkerCredentialProjection;
	environment?: NodeJS.ProcessEnv;
}): Promise<MaterializedWorkerProfile> {
	const runtimeRoot = requireAbsolute("runtimeRoot", input.runtimeRoot);
	const defaultAgentDir = await canonicalExistingDirectory(
		"defaultAgentDir",
		input.defaultAgentDir ?? join(homedir(), ".pi", "agent"),
	);
	const runId = requireIdentifier("runId", input.runId);
	const workerId = requireIdentifier("workerId", input.workerId);
	if (input.template.schemaVersion !== 1) throw new Error("unsupported Worker profile template schema");
	if (input.template.workspaceMode !== "read-only" && input.template.workspaceMode !== "worktree-write") {
		throw new Error("unsupported Worker workspace mode");
	}
	if (!THINKING_LEVELS.has(input.template.thinkingLevel)) throw new Error("unsupported Worker thinking level");
	const profileId = requireIdentifier("template.profileId", input.template.profileId);
	const profileVersion = requireIdentifier("template.profileVersion", input.template.profileVersion);
	const providerId = requireIdentifier("template.providerId", input.template.providerId);
	requireIdentifier("template.modelId", input.template.modelId);
	const tools = requireUnique("template.tools", input.template.tools);
	const credential = validateCredential(input.credential, providerId);
	const worktree = await canonicalExistingDirectory("worktree", input.worktree);

	// Machine setup owns creation of this private root. Per-Worker materialization
	// must never create a caller-selected path before boundary validation.
	await ensurePrivateDirectory(runtimeRoot, false);
	const canonicalRuntimeRoot = await realpath(runtimeRoot);
	requireDisjoint("runtimeRoot", canonicalRuntimeRoot, "defaultAgentDir", defaultAgentDir);
	requireDisjoint("runtimeRoot", canonicalRuntimeRoot, "worktree", worktree);

	const extensionArtifacts: Array<{ path: string; sha256: string }> = [];
	for (const [index, extensionPath] of input.template.extensions.entries()) {
		const absolute = requireAbsolute(`template.extensions[${index}]`, extensionPath);
		const info = await lstat(absolute);
		if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Worker extension must be a real file: ${absolute}`);
		const canonical = await realpath(absolute);
		extensionArtifacts.push({ path: canonical, sha256: sha256(await readFile(canonical)) });
	}
	if (extensionArtifacts.length === 0) throw new Error("template.extensions must not be empty");
	if (new Set(extensionArtifacts.map((entry) => entry.path)).size !== extensionArtifacts.length) {
		throw new Error("template.extensions must not contain duplicates");
	}

	const normalizedTemplate: PiWorkerProfileTemplate = {
		...structuredClone(input.template),
		profileId,
		profileVersion,
		providerId,
		tools,
		extensions: extensionArtifacts.map((entry) => entry.path),
	};
	const templateDigest = sha256(canonicalJson({ ...normalizedTemplate, extensions: extensionArtifacts }));
	const runsRoot = await ensurePrivateChildDirectory(canonicalRuntimeRoot, "runs");
	const runRoot = await ensurePrivateChildDirectory(runsRoot, runId);
	const workersRoot = await ensurePrivateChildDirectory(runRoot, "workers");
	const workerRoot = join(workersRoot, workerId);
	try {
		await mkdir(workerRoot, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Worker runtime already exists: ${workerRoot}`);
		throw error;
	}

	try {
		const home = join(workerRoot, "home");
		const agent = join(workerRoot, "agent");
		const sessions = join(workerRoot, "sessions");
		const temp = join(workerRoot, "tmp");
		const manifestPath = join(workerRoot, "manifest.json");
		for (const path of [home, agent, sessions, temp]) await mkdir(path, { mode: 0o700 });

		const settingsSha256 = await writePrivateJson(join(agent, "settings.json"), settingsFor(normalizedTemplate));
		const trustSha256 = await writePrivateJson(join(agent, "trust.json"), { [worktree]: false });
		await writePrivateJson(join(agent, "auth.json"), { [providerId]: credential.credential });

		const launchArgs = launchArgsFor({
			template: normalizedTemplate,
			workerId,
			sessionDir: sessions,
			extensions: extensionArtifacts.map((entry) => entry.path),
		});
		const unsignedManifest: Omit<MaterializedWorkerProfileManifest, "profileDigest"> = {
			schemaVersion: 1,
			kind: "mypi-generated-worker-profile",
			runId,
			workerId,
			profileId,
			profileVersion,
			templateDigest,
			workspaceMode: normalizedTemplate.workspaceMode,
			worktree,
			paths: { workerRoot, home, agent, sessions, temp, manifest: manifestPath },
			provider: {
				id: providerId,
				modelId: normalizedTemplate.modelId,
				thinkingLevel: normalizedTemplate.thinkingLevel,
				credentialType: credential.credential.type,
			},
			resources: { tools, extensions: extensionArtifacts },
			launchArgs,
			environmentKeys: [...SAFE_ENVIRONMENT_KEYS, ...GENERATED_ENVIRONMENT_KEYS]
				.filter((key) => GENERATED_ENVIRONMENT_KEY_SET.has(key) || Boolean((input.environment ?? process.env)[key]))
				.sort(),
			settingsSha256,
			trustSha256,
		};
		const profileDigest = sha256(canonicalJson(profileDigestPayload(unsignedManifest)));
		const manifest: MaterializedWorkerProfileManifest = { ...unsignedManifest, profileDigest };
		await writePrivateJson(manifestPath, manifest);
		const environment = environmentFor({
			base: input.environment ?? process.env,
			home,
			agent,
			sessions,
			temp,
			manifest: manifestPath,
			profileDigest,
		});
		if (JSON.stringify(Object.keys(environment).sort()) !== JSON.stringify(manifest.environmentKeys)) {
			throw new Error("generated Worker environment does not match the manifest");
		}
		return { manifest: structuredClone(manifest), environment };
	} catch (error) {
		await rm(workerRoot, { recursive: true, force: true });
		throw error;
	}
}

function credentialContentEqual(actual: unknown, expected: WorkerCredential): boolean {
	const left = Buffer.from(canonicalJson(actual));
	const right = Buffer.from(canonicalJson(expected));
	return left.length === right.length && timingSafeEqual(left, right);
}

async function privateMode(path: string, kind: "directory" | "file"): Promise<boolean> {
	const info = await lstat(path);
	if (info.isSymbolicLink()) return false;
	if (kind === "directory" ? !info.isDirectory() : !info.isFile()) return false;
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) return false;
	if (process.platform === "win32") return true;
	const requiredOwnerMode = kind === "directory" ? 0o700 : 0o600;
	return (info.mode & 0o077) === 0 && (info.mode & requiredOwnerMode) === requiredOwnerMode;
}

export async function verifyMaterializedWorkerProfile(input: {
	profile: MaterializedWorkerProfile;
	expectedProfileDigest: string;
	expectedCredential: WorkerCredentialProjection;
	defaultAgentDir?: string;
}): Promise<WorkerProfileVerification> {
	const { manifest, environment } = input.profile;
	const mismatches: string[] = [];
	if (manifest.schemaVersion !== 1 || manifest.kind !== "mypi-generated-worker-profile") mismatches.push("manifest-schema");
	if (manifest.profileDigest !== input.expectedProfileDigest) mismatches.push("requested-profile-digest");
	const { profileDigest: _profileDigest, ...unsignedManifest } = manifest;
	if (sha256(canonicalJson(profileDigestPayload(unsignedManifest))) !== manifest.profileDigest) mismatches.push("profile-digest");
	// Never follow paths from a manifest that is not the exact authority-bound
	// object requested by the Coordinator.
	if (mismatches.length > 0) return { verified: false, mismatches };

	let workerRoot: string;
	try {
		workerRoot = requireAbsolute("workerRoot", manifest.paths.workerRoot);
		const expectedPaths = {
			workerRoot,
			home: join(workerRoot, "home"),
			agent: join(workerRoot, "agent"),
			sessions: join(workerRoot, "sessions"),
			temp: join(workerRoot, "tmp"),
			manifest: join(workerRoot, "manifest.json"),
		};
		if (canonicalJson(manifest.paths) !== canonicalJson(expectedPaths)) mismatches.push("path-layout");
	} catch {
		return { verified: false, mismatches: ["path-layout"] };
	}
	if (mismatches.length > 0) return { verified: false, mismatches };

	const requestedDefaultAgentDir = requireAbsolute("defaultAgentDir", input.defaultAgentDir ?? join(homedir(), ".pi", "agent"));
	let defaultAgentDir = requestedDefaultAgentDir;
	try {
		defaultAgentDir = await realpath(requestedDefaultAgentDir);
	} catch {
		mismatches.push("default-agent-missing");
	}
	if (pathContains(defaultAgentDir, workerRoot) || pathContains(workerRoot, defaultAgentDir)) mismatches.push("default-agent-overlap");
	if (pathContains(manifest.worktree, workerRoot) || pathContains(workerRoot, manifest.worktree)) mismatches.push("worktree-profile-overlap");
	try {
		const worktreeInfo = await lstat(manifest.worktree);
		if (worktreeInfo.isSymbolicLink() || !worktreeInfo.isDirectory() || await realpath(manifest.worktree) !== manifest.worktree) {
			mismatches.push("worktree-identity");
		} else {
			await access(manifest.worktree, constants.R_OK);
			if (manifest.workspaceMode === "worktree-write") await access(manifest.worktree, constants.W_OK);
		}
	} catch {
		mismatches.push("worktree-access");
	}
	const expectedEnvironment = environmentFor({
		base: environment,
		home: manifest.paths.home,
		agent: manifest.paths.agent,
		sessions: manifest.paths.sessions,
		temp: manifest.paths.temp,
		manifest: manifest.paths.manifest,
		profileDigest: manifest.profileDigest,
	});
	if (canonicalJson(environment) !== canonicalJson(expectedEnvironment)) mismatches.push("environment");
	if (JSON.stringify(Object.keys(environment).sort()) !== JSON.stringify(manifest.environmentKeys)) mismatches.push("environment-keys");
	if (Object.keys(environment).some((key) => !GENERATED_ENVIRONMENT_KEY_SET.has(key) && FORBIDDEN_AMBIENT_ENVIRONMENT.test(key))) {
		mismatches.push("ambient-secret-environment");
	}

	for (const path of [manifest.paths.workerRoot, manifest.paths.home, manifest.paths.agent, manifest.paths.sessions, manifest.paths.temp]) {
		try {
			if (!(await privateMode(path, "directory"))) mismatches.push(`private-directory:${path}`);
		} catch {
			mismatches.push(`missing-directory:${path}`);
		}
	}
	for (const path of [manifest.paths.manifest, join(manifest.paths.agent, "settings.json"), join(manifest.paths.agent, "trust.json"), join(manifest.paths.agent, "auth.json")]) {
		try {
			if (!(await privateMode(path, "file"))) mismatches.push(`private-file:${path}`);
		} catch {
			mismatches.push(`missing-file:${path}`);
		}
	}
	// Do not parse or follow any profile file until path layout, ownership and
	// permissions are all known-good.
	if (mismatches.length > 0) return { verified: false, mismatches };

	try {
		const diskManifest = JSON.parse(await readFile(manifest.paths.manifest, "utf8"));
		if (canonicalJson(diskManifest) !== canonicalJson(manifest)) mismatches.push("manifest-content");
	} catch {
		mismatches.push("manifest-json");
	}
	try {
		const settingsRaw = await readFile(join(manifest.paths.agent, "settings.json"));
		if (sha256(settingsRaw) !== manifest.settingsSha256) mismatches.push("settings-digest");
		const settings = JSON.parse(settingsRaw.toString("utf8"));
		if (canonicalJson(settings) !== canonicalJson({
			defaultProvider: manifest.provider.id,
			defaultModel: manifest.provider.modelId,
			defaultThinkingLevel: manifest.provider.thinkingLevel,
			packages: [],
		})) mismatches.push("settings-content");
	} catch {
		mismatches.push("settings-json");
	}
	try {
		const trustRaw = await readFile(join(manifest.paths.agent, "trust.json"));
		if (sha256(trustRaw) !== manifest.trustSha256) mismatches.push("trust-digest");
		const trust = JSON.parse(trustRaw.toString("utf8"));
		if (canonicalJson(trust) !== canonicalJson({ [manifest.worktree]: false })) mismatches.push("trust-content");
	} catch {
		mismatches.push("trust-json");
	}
	try {
		const auth = JSON.parse(await readFile(join(manifest.paths.agent, "auth.json"), "utf8"));
		if (!auth || typeof auth !== "object" || Array.isArray(auth) || Object.keys(auth).length !== 1) {
			mismatches.push("credential-scope");
		} else if (!(manifest.provider.id in auth) || auth[manifest.provider.id]?.type !== manifest.provider.credentialType) {
			mismatches.push("credential-identity");
		}
		const expected = validateCredential(input.expectedCredential, manifest.provider.id);
		const actual = auth?.[manifest.provider.id];
		if (actual === undefined || !credentialContentEqual(actual, expected.credential)) mismatches.push("credential-content");
	} catch {
		mismatches.push("credential-json");
	}
	try {
		const rootEntries = (await readdir(workerRoot)).sort();
		if (canonicalJson(rootEntries) !== canonicalJson(["agent", "home", "manifest.json", "sessions", "tmp"])) {
			mismatches.push("unexpected-runtime-artifacts");
		}
		const agentEntries = (await readdir(manifest.paths.agent)).sort();
		if (canonicalJson(agentEntries) !== canonicalJson(["auth.json", "settings.json", "trust.json"])) {
			mismatches.push("unexpected-agent-artifacts");
		}
		for (const path of [manifest.paths.home, manifest.paths.sessions, manifest.paths.temp]) {
			if ((await readdir(path)).length !== 0) mismatches.push(`unexpected-preflight-content:${path}`);
		}
	} catch {
		mismatches.push("artifact-enumeration");
	}
	for (const extension of manifest.resources.extensions) {
		try {
			const info = lstatSync(extension.path);
			if (info.isSymbolicLink() || !info.isFile() || realpathSync(extension.path) !== extension.path) {
				mismatches.push(`extension-identity:${extension.path}`);
			} else if (sha256(await readFile(extension.path)) !== extension.sha256) {
				mismatches.push(`extension-digest:${extension.path}`);
			}
		} catch {
			mismatches.push(`extension-missing:${extension.path}`);
		}
	}
	const launch = manifest.launchArgs.join("\0");
	for (const required of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
		if (!manifest.launchArgs.includes(required)) mismatches.push(`launch:${required}`);
	}
	if (launch.includes(defaultAgentDir)) mismatches.push("launch-default-agent");
	return { verified: mismatches.length === 0, mismatches };
}

export async function cleanupMaterializedWorkerProfile(profile: MaterializedWorkerProfile): Promise<void> {
	const { manifest } = profile;
	const workerRoot = requireAbsolute("workerRoot", manifest.paths.workerRoot);
	const manifestPath = requireAbsolute("manifestPath", manifest.paths.manifest);
	if (dirname(manifestPath) !== workerRoot) throw new Error("Worker manifest is outside its runtime root");
	const rootInfo = await lstat(workerRoot);
	if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || await realpath(workerRoot) !== workerRoot) {
		throw new Error("refusing to clean a non-canonical Worker runtime root");
	}
	if (!(await privateMode(manifestPath, "file"))) throw new Error("refusing to clean through an untrusted Worker manifest");
	const disk = JSON.parse(await readFile(manifestPath, "utf8")) as MaterializedWorkerProfileManifest;
	if (
		disk.kind !== "mypi-generated-worker-profile" ||
		disk.runId !== manifest.runId ||
		disk.workerId !== manifest.workerId ||
		disk.profileDigest !== manifest.profileDigest ||
		disk.paths.workerRoot !== workerRoot
	) {
		throw new Error("refusing to clean a Worker profile with mismatched identity");
	}
	await rm(workerRoot, { recursive: true, force: false });
}
