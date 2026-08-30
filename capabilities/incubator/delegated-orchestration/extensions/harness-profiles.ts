import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

export type DelegatedEnvironment = Readonly<Record<string, string>>;

export type BoundaryEvidence = {
	routine: boolean;
	tests: boolean;
	environmentIsolated: boolean;
	secretDenied: boolean;
	hostCredentialsDenied: boolean;
	worktreeReadIsolation: boolean;
	externalWriteDenied: boolean;
	networkDenied: boolean;
	noRoutinePrompt: boolean;
};

export type ProfileVerification = {
	verified: boolean;
	mismatches: string[];
};

export type CodexDelegatedProfile = {
	kind: "codex";
	cliVersion: string;
	model: string;
	effort: string;
	cwd: string;
	codexHome: string;
	args: string[];
	environment: DelegatedEnvironment;
	configToml: string;
	configSha256: string;
	requiredHelpFlags: string[];
};

export type ClaudeDelegatedProfile = {
	kind: "claude";
	cliVersion: string;
	model: string;
	effort: string;
	cwd: string;
	args: string[];
	environment: DelegatedEnvironment;
	settingsJson: string;
	settingsSha256: string;
	requiredHelpFlags: string[];
};

const FORBIDDEN_ARGUMENTS = new Set([
	"--dangerously-bypass-approvals-and-sandbox",
	"--dangerously-bypass-hook-trust",
	"--dangerously-skip-permissions",
	"--allow-dangerously-skip-permissions",
	"--permission-mode=bypassPermissions",
]);

const PROCESS_ENVIRONMENT_KEYS = [
	"HOME",
	"PATH",
	"USER",
	"LOGNAME",
	"SHELL",
	"TERM",
	"LANG",
	"LC_ALL",
	"TMPDIR",
	// Required by the official Herdr Claude SessionStart integration.
	"HERDR_ENV",
	"HERDR_SOCKET_PATH",
	"HERDR_PANE_ID",
] as const;

function requireIdentifier(label: string, value: string): string {
	const normalized = value.trim();
	if (!normalized || /\s/.test(normalized)) throw new Error(`${label} must be a non-empty identifier`);
	return normalized;
}

function requireAbsolutePath(label: string, value: string): string {
	if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
	return resolve(value);
}

function requireSupportedVersion(kind: "codex" | "claude", version: string): string {
	const normalized = version.trim();
	const supported = kind === "codex" ? /^0\.150\.1$/ : /^2\.1\.251$/;
	if (!supported.test(normalized)) throw new Error(`unsupported ${kind} version: ${version}`);
	return normalized;
}

function quoteToml(value: string): string {
	return JSON.stringify(value);
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function orderedEnvironment(source: NodeJS.ProcessEnv, additions: Record<string, string> = {}): DelegatedEnvironment {
	const environment: Record<string, string> = {};
	for (const key of PROCESS_ENVIRONMENT_KEYS) {
		const value = source[key];
		if (value !== undefined && value !== "") environment[key] = value;
	}
	for (const [key, value] of Object.entries(additions).sort(([a], [b]) => a.localeCompare(b))) {
		if (!value) throw new Error(`${key} must not be empty`);
		environment[key] = value;
	}
	if (!environment.HOME) throw new Error("HOME is required for a delegated harness profile");
	if (!environment.PATH) throw new Error("PATH is required for a delegated harness profile");
	return Object.freeze(environment);
}

export function assertSafeHarnessArgs(args: readonly string[]): void {
	for (const argument of args) {
		const matchesForbiddenFlag = [...FORBIDDEN_ARGUMENTS].some(
			(flag) => argument === flag || argument.startsWith(`${flag}=`),
		);
		if (matchesForbiddenFlag || argument.includes("bypassPermissions")) {
			throw new Error(`forbidden delegated harness argument: ${argument}`);
		}
	}
}

export function missingRequiredHelpFlags(help: string, requiredFlags: readonly string[]): string[] {
	return requiredFlags.filter((flag) => !help.includes(flag));
}

export function buildCodexDelegatedProfile(input: {
	cliVersion: string;
	model: string;
	effort: string;
	cwd: string;
	codexHome: string;
	shellHome: string;
	tempDir: string;
	credentialFilePaths?: string[];
	environment?: NodeJS.ProcessEnv;
}): CodexDelegatedProfile {
	const cliVersion = requireSupportedVersion("codex", input.cliVersion);
	const model = requireIdentifier("model", input.model);
	const effort = requireIdentifier("effort", input.effort);
	const cwd = requireAbsolutePath("cwd", input.cwd);
	const codexHome = requireAbsolutePath("codexHome", input.codexHome);
	const shellHome = requireAbsolutePath("shellHome", input.shellHome);
	const tempDir = requireAbsolutePath("tempDir", input.tempDir);
	const environment = orderedEnvironment(input.environment ?? process.env, { CODEX_HOME: codexHome });
	const shellPath = environment.PATH;
	const credentialFiles = [
		".ssh", ".aws", ".gnupg", ".config/gcloud", ".kube", ".docker",
		".claude/.credentials.json", ".codex/auth.json", ".git-credentials", ".netrc",
	].map((path) => resolve(environment.HOME, path));
	for (const [index, path] of (input.credentialFilePaths ?? []).entries()) {
		credentialFiles.push(requireAbsolutePath(`credentialFilePaths[${index}]`, path));
	}
	const credentialDenyLines = credentialFiles.map((path) => `${quoteToml(path)} = "deny"`);

	const configToml = [
		`model = ${quoteToml(model)}`,
		`model_reasoning_effort = ${quoteToml(effort)}`,
		'approval_policy = "on-request"',
		'approvals_reviewer = "auto_review"',
		'default_permissions = "mypi_workspace"',
		"",
		"[shell_environment_policy]",
		'inherit = "none"',
		"ignore_default_excludes = false",
		`set = { PATH = ${quoteToml(shellPath)}, HOME = ${quoteToml(shellHome)}, TMPDIR = ${quoteToml(tempDir)}, LANG = "en_US.UTF-8", LC_ALL = "en_US.UTF-8" }`,
		"",
		"[permissions.mypi_workspace]",
		'extends = ":workspace"',
		"",
		"[permissions.mypi_workspace.filesystem]",
		'":tmpdir" = "write"',
		'":slash_tmp" = "deny"',
		...credentialDenyLines,
		"",
		'[permissions.mypi_workspace.filesystem.":workspace_roots"]',
		'"." = "write"',
		'"**/.env" = "deny"',
		'"**/.env.*" = "deny"',
		'"**/*.pem" = "deny"',
		'"**/*.key" = "deny"',
		"",
		"[permissions.mypi_workspace.network]",
		"enabled = false",
		"",
		"[features]",
		"apps = false",
		"browser_use = false",
		"browser_use_external = false",
		"computer_use = false",
		"hooks = false",
		"multi_agent = false",
		"plugins = false",
		"recommended_plugins = false",
		"memories = false",
		"",
	].join("\n");

	const args = [
		"--strict-config",
		"--model", model,
		"-c", `model_reasoning_effort=${quoteToml(effort)}`,
		"--no-alt-screen",
	];
	assertSafeHarnessArgs(args);
	return {
		kind: "codex",
		cliVersion,
		model,
		effort,
		cwd,
		codexHome,
		args,
		environment,
		configToml,
		configSha256: sha256(configToml),
		requiredHelpFlags: ["--strict-config", "--model", "--no-alt-screen"],
	};
}

export function verifyCodexProfile(input: {
	requested: CodexDelegatedProfile;
	observed: {
		cliVersion: string;
		model: string;
		effort: string;
		cwd: string;
		approvalPolicy: string;
		sandboxPolicy: {
			type: string;
			networkAccess: boolean;
			excludeSlashTmp: boolean;
		};
		interactiveReady: boolean;
		lifecycleSessionId?: string;
		configSha256: string;
	};
	boundary: BoundaryEvidence;
}): ProfileVerification {
	const { requested, observed, boundary } = input;
	const mismatches: string[] = [];
	if (observed.cliVersion !== requested.cliVersion) mismatches.push("cli-version");
	if (observed.model !== requested.model) mismatches.push("model");
	if (observed.effort !== requested.effort) mismatches.push("effort");
	if (resolve(observed.cwd) !== requested.cwd) mismatches.push("cwd");
	if (observed.approvalPolicy !== "on-request") mismatches.push("approval-policy");
	if (observed.sandboxPolicy.type !== "workspace-write") mismatches.push("sandbox-type");
	if (observed.sandboxPolicy.networkAccess !== false) mismatches.push("sandbox-network");
	if (observed.sandboxPolicy.excludeSlashTmp !== true) mismatches.push("sandbox-slash-tmp");
	if (!observed.interactiveReady) mismatches.push("interactive-readiness");
	if (!observed.lifecycleSessionId) mismatches.push("lifecycle-session");
	if (observed.configSha256 !== requested.configSha256) mismatches.push("config-digest");
	for (const [key, passed] of Object.entries(boundary)) if (!passed) mismatches.push(`boundary:${key}`);
	return { verified: mismatches.length === 0, mismatches };
}

export function buildClaudeDelegatedProfile(input: {
	cliVersion: string;
	model: string;
	effort: string;
	cwd: string;
	settingsPath: string;
	herdrHookPath: string;
	credentialFilePaths?: string[];
	environment?: NodeJS.ProcessEnv;
}): ClaudeDelegatedProfile {
	const cliVersion = requireSupportedVersion("claude", input.cliVersion);
	const model = requireIdentifier("model", input.model);
	const effort = requireIdentifier("effort", input.effort);
	const cwd = requireAbsolutePath("cwd", input.cwd);
	const settingsPath = requireAbsolutePath("settingsPath", input.settingsPath);
	const herdrHookPath = requireAbsolutePath("herdrHookPath", input.herdrHookPath);
	const extraCredentialFiles = (input.credentialFilePaths ?? []).map((path, index) =>
		requireAbsolutePath(`credentialFilePaths[${index}]`, path));
	const environment = orderedEnvironment(input.environment ?? process.env);
	const settings = {
		permissions: {
			deny: ["Read(./.env)", "Read(./.env.*)", "Write(./.env)", "Write(./.env.*)"],
		},
		sandbox: {
			enabled: true,
			autoAllowBashIfSandboxed: true,
			allowUnsandboxedCommands: false,
			failIfUnavailable: true,
			filesystem: { denyRead: [".env", ".env.*"] },
			network: { deniedDomains: ["*"] },
			credentials: {
				files: [
					"~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gcloud", "~/.kube", "~/.docker",
					"~/.claude/.credentials.json", "~/.codex/auth.json", "~/.git-credentials", "~/.netrc",
					...extraCredentialFiles,
				].map((path) => ({ path, mode: "deny" })),
				envVars: [
					"ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
					"AWS_SESSION_TOKEN", "AZURE_DEVOPS_EXT_PAT", "GITHUB_TOKEN", "GH_TOKEN",
					"GOOGLE_APPLICATION_CREDENTIALS", "NPM_TOKEN",
				].map((name) => ({ name, mode: "deny" })),
			},
		},
		hooks: {
			SessionStart: [{
				matcher: "*",
				hooks: [{ type: "command", command: `bash ${shellQuote(herdrHookPath)} session`, timeout: 10 }],
			}],
		},
	};
	const settingsJson = `${JSON.stringify(settings, null, 2)}\n`;
	const tools = "Read,Edit,Write,Bash";
	const args = [
		"--model", model,
		"--effort", effort,
		"--permission-mode", "dontAsk",
		"--restricted",
		"--setting-sources", "",
		"--disable-slash-commands",
		"--no-chrome",
		"--strict-mcp-config",
		"--mcp-config", '{"mcpServers":{}}',
		"--settings", settingsPath,
		"--tools", tools,
		"--allowedTools", tools,
	];
	assertSafeHarnessArgs(args);
	return {
		kind: "claude",
		cliVersion,
		model,
		effort,
		cwd,
		args,
		environment,
		settingsJson,
		settingsSha256: sha256(settingsJson),
		requiredHelpFlags: [
			"--permission-mode", "--restricted", "--setting-sources", "--strict-mcp-config",
			"--settings", "--tools", "--allowedTools",
		],
	};
}

export function verifyClaudeProfile(input: {
	requested: ClaudeDelegatedProfile;
	observed: {
		cliVersion: string;
		model: string;
		permissionMode: string;
		cwd: string;
		tools: string[];
		interactiveReady: boolean;
		lifecycleSessionId?: string;
		settingsSha256: string;
	};
	boundary: BoundaryEvidence;
}): ProfileVerification {
	const { requested, observed, boundary } = input;
	const mismatches: string[] = [];
	if (observed.cliVersion !== requested.cliVersion) mismatches.push("cli-version");
	if (observed.model !== requested.model) mismatches.push("model");
	if (observed.permissionMode !== "dontAsk") mismatches.push("permission-mode");
	if (resolve(observed.cwd) !== requested.cwd) mismatches.push("cwd");
	if ([...observed.tools].sort().join(",") !== ["Bash", "Edit", "Read", "Write"].join(",")) mismatches.push("tools");
	if (!observed.interactiveReady) mismatches.push("interactive-readiness");
	if (!observed.lifecycleSessionId) mismatches.push("lifecycle-session");
	if (observed.settingsSha256 !== requested.settingsSha256) mismatches.push("settings-digest");
	for (const [key, passed] of Object.entries(boundary)) if (!passed) mismatches.push(`boundary:${key}`);
	return { verified: mismatches.length === 0, mismatches };
}
