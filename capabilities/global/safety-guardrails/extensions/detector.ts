import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type MutationKind = "external-write" | "unknown-write" | "secret-read" | "external-upload" | "remote-mutation";

export type MutationFinding = {
	kind: MutationKind;
	reason: string;
	target?: string;
	targetExpression?: string;
	targetLabel?: string;
	detail?: string;
	detailLabel?: string;
	workingDirectory?: string;
	targetIsDirectory?: boolean;
};

type ShellState = {
	cwd?: string;
	cwdExpression?: string;
	vars: Map<string, string | undefined>;
	allowedWriteRoots: readonly string[];
};

const DIRECT_MUTATION_TOOLS = new Set([
	"write",
	"edit",
	"delete",
	"remove",
	"unlink",
	"mkdir",
	"move",
	"copy",
]);

const READ_ONLY_TOOLS = new Set(["find", "ls", "glob"]);
const CONTENT_READ_TOOLS = new Set(["read", "grep"]);
const SESSION_ALLOW_ONCE = "Allow once";
const SESSION_ALLOW_SECRET = "Allow this secret file for this session";
const SESSION_ALLOW_UPLOAD = "Allow this file upload for this session";
const DENY = "Deny";
const STARTUP_TEMPORARY_DIRECTORY = tmpdir();
const MAX_SHELL_CHARACTERS = 32_768;
const MAX_SHELL_SEGMENTS = 128;
const MAX_SHELL_TOKENS = 1_024;
const MAX_SHELL_NESTING = 16;

const PATH_FIELD_PATTERN = /(?:^|[_-])(?:path|paths|file|files|filename|directory|dir|destination|dest|target|source|src|uri)(?:$|[_-])/i;
const DESTINATION_FIELD_PATTERN = /(?:^|[_-])(?:destination|dest|target|output|out|to|new[_-]?path|save[_-]?path)(?:$|[_-])/i;
const READ_TOOL_PATTERN = /(?:^|[_-])(?:read|get|load|open|fetch|inspect|parse|analyze|search|upload|attach|send)(?:$|[_-])/i;
const FILE_MUTATION_TOOL_PATTERN = /(?:^|[_-])(?:write|edit|patch|replace|delete|remove|unlink|move|rename|copy|mkdir|create|save|download|extract|export|generate|screenshot)(?:$|[_-])/i;
const FILE_MUTATION_CONTEXT_PATTERN = /(?:^|[_-])(?:file|directory|folder|path|filesystem|fs)(?:$|[_-])/i;
const FILE_UPLOAD_TOOL_PATTERN = /(?:^|[_-])(?:upload|attach|send[_-]?file)(?:$|[_-])/i;
const SENSITIVE_ENV_NAME_PATTERN = /(?:^|_)(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE[_-]?KEY|AUTH)(?:_|$)/i;
const LOCAL_VIDEO_EXTENSION_PATTERN = /\.(?:mp4|mov|webm|avi|mpeg|mpg|wmv|flv|3gp|3gpp)$/i;
const COMMAND_TOOL_PATTERN = /(?:^|[_:-])(?:(?:bash|shell|terminal)(?:[_:-](?:exec(?:ute)?|run|command|cmd))?|(?:exec(?:ute)?|run)[_-]?(?:command|cmd)?|command[_-]?(?:exec(?:ute)?|run))(?:$|[_:-])/i;

const SHELL_CONTENT_READ_COMMANDS = new Set([
	".",
	"awk",
	"base64",
	"bat",
	"cat",
	"cut",
	"grep",
	"head",
	"jq",
	"less",
	"more",
	"od",
	"rg",
	"sed",
	"sort",
	"source",
	"strings",
	"tail",
	"uniq",
	"xxd",
	"yq",
]);

const SAFE_SECRET_TEMPLATE_SUFFIXES = [
	".example",
	".sample",
	".template",
	".dist",
];

const SENSITIVE_FILE_PATTERNS = [
	/^\.env(?:\..+)?$/i,
	/^(?:credentials?|secrets?)(?:\.[^.]+)?$/i,
	/^service[-_.]?account(?:\.[^.]+)?$/i,
	/^application_default_credentials\.json$/i,
	/^auth\.json$/i,
	/^\.git-credentials$/i,
	/^\.(?:bash|zsh|fish)_history$/i,
	/^(?:id_)?(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
	/\.(?:key|pem|p12|pfx|jks|keystore|kdbx|age|gpg)$/i,
	/^\.(?:npmrc|pypirc|netrc)$/i,
];

const SENSITIVE_PATH_PATTERNS = [
	/(?:^|\/)\.ssh\/(?![^/]+\.pub$)/i,
	/(?:^|\/)\.aws\/credentials$/i,
	/(?:^|\/)\.config\/gcloud\/application_default_credentials\.json$/i,
	/(?:^|\/)\.docker\/config\.json$/i,
	/(?:^|\/)\.kube\/config$/i,
	/(?:^|\/)\.config\/gh\/hosts\.yml$/i,
	/(?:^|\/)\.(?:pi\/agent|codex)\/auth\.json$/i,
	/(?:^|\/)(?:Google\/Chrome|Chromium|BraveSoftware\/Brave-Browser|Microsoft Edge)\/[^/]+\/(?:Cookies|Login Data|Web Data)$/i,
];

const MUTATION_COMMANDS = new Set([
	"chmod",
	"chown",
	"chgrp",
	"cp",
	"install",
	"ln",
	"mkdir",
	"mkfifo",
	"mknod",
	"mv",
	"patch",
	"rm",
	"rmdir",
	"rsync",
	"scp",
	"tee",
	"touch",
	"truncate",
	"unlink",
]);

const INLINE_CODE_FLAGS: Record<string, Set<string>> = {
	bash: new Set(["-c"]),
	dash: new Set(["-c"]),
	eval: new Set(),
	ksh: new Set(["-c"]),
	node: new Set(["-e", "--eval"]),
	perl: new Set(["-e", "-E"]),
	python: new Set(["-c"]),
	python3: new Set(["-c"]),
	ruby: new Set(["-e"]),
	sh: new Set(["-c"]),
	zsh: new Set(["-c"]),
};

const GIT_MUTATION_SUBCOMMANDS = new Set([
	"add",
	"am",
	"apply",
	"checkout",
	"cherry-pick",
	"clean",
	"commit",
	"merge",
	"mv",
	"rebase",
	"reset",
	"restore",
	"revert",
	"rm",
	"switch",
]);

function expandHome(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return join(homedir(), value.slice(2));
	return value;
}

function normalizeFileReference(value: string): string {
	const trimmed = value.trim().replace(/^@(?=[/~.])/, "");
	if (!trimmed.startsWith("file://")) return trimmed;
	try {
		return decodeURIComponent(new URL(trimmed).pathname);
	} catch {
		return trimmed;
	}
}

function canonicalizeMissingPath(input: string): string {
	const absolute = resolve(expandHome(input));
	if (existsSync(absolute)) return realpathSync.native(absolute);

	let cursor = dirname(absolute);
	while (cursor !== dirname(cursor) && !existsSync(cursor)) cursor = dirname(cursor);
	if (!existsSync(cursor)) return absolute;

	const canonicalParent = realpathSync.native(cursor);
	return resolve(canonicalParent, relative(cursor, absolute));
}

export function resolvePolicyPath(input: string, cwd: string): string {
	const expanded = expandHome(normalizeFileReference(input));
	return canonicalizeMissingPath(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

export function isInsideWorkspace(input: string, cwd: string, workspaceRoot = cwd): boolean {
	const workspace = canonicalizeMissingPath(workspaceRoot);
	const target = resolvePolicyPath(input, cwd);
	const rel = relative(workspace, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isSameOrInside(target: string, directory: string): boolean {
	const rel = relative(directory, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function isNullDevicePath(input: string, cwd: string): boolean {
	return resolvePolicyPath(input, cwd) === resolvePolicyPath("/dev/null", "/");
}

export function isHarnessTemporaryPath(input: string, cwd: string): boolean {
	const target = resolvePolicyPath(input, cwd);
	const root = resolvePolicyPath(STARTUP_TEMPORARY_DIRECTORY, "/");
	return isSameOrInside(target, root);
}

function isPermittedWriteTarget(
	input: string,
	cwd: string,
	workspaceRoot = cwd,
	allowedWriteRoots: readonly string[] = [],
): boolean {
	const target = resolvePolicyPath(input, cwd);
	return (
		isInsideWorkspace(target, cwd, workspaceRoot) ||
		allowedWriteRoots.some((root) => isSameOrInside(target, resolvePolicyPath(root, cwd))) ||
		isNullDevicePath(target, cwd)
	);
}

export function isSensitivePath(input: string): boolean {
	const normalized = expandHome(normalizeFileReference(input)).replaceAll("\\", "/").replace(/\/+$/, "");
	const name = basename(normalized);
	const lowerName = name.toLowerCase();

	if (lowerName.endsWith(".pub")) return false;
	if (SAFE_SECRET_TEMPLATE_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) return false;
	if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
	return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isSensitivePolicyPath(input: string, cwd: string): boolean {
	if (isSensitivePath(input)) return true;
	return isSensitivePath(resolvePolicyPath(input, cwd));
}

function secretReadFinding(rawTarget: string, state: ShellState, reason: string): MutationFinding | undefined {
	const expanded = expandKnownVariables(normalizeFileReference(rawTarget), state);
	if (expanded === undefined || !state.cwd) return;
	const target = resolvePolicyPath(expanded, state.cwd);
	if (!isSensitivePath(expanded) && !isSensitivePath(target)) return;
	return {
		kind: "secret-read",
		reason,
		target,
	};
}

function externalUploadFinding(rawTarget: string, state: ShellState, reason: string): MutationFinding {
	const expanded = expandKnownVariables(normalizeFileReference(rawTarget), state);
	if (expanded === undefined || !state.cwd) {
		return {
			kind: "external-upload",
			reason: `${reason}; source is computed dynamically`,
		};
	}
	return {
		kind: "external-upload",
		reason,
		target: resolvePolicyPath(expanded, state.cwd),
	};
}

function looksLikeRemotePath(value: string): boolean {
	return /^[^/@\s]+@[^:\s]+:.+/.test(value) || /^[^/:\s]+:.+/.test(value);
}

function isLocalReference(value: string): boolean {
	const normalized = normalizeFileReference(value);
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) return false;
	return normalized.length > 0 && !looksLikeRemotePath(normalized);
}

function containsDynamicShell(value: string): boolean {
	return /(?:\$(?!HOME(?:\/|$)|PWD(?:\/|$))|`)/.test(value);
}

function expandKnownVariables(value: string, state: ShellState): string | undefined {
	let unresolved = false;
	const expanded = value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (_all, a, b) => {
		const name = (a ?? b) as string;
		if (name === "HOME") return homedir();
		if (name === "PWD" && state.cwd) return state.cwd;
		const known = state.vars.get(name);
		if (known === undefined) {
			unresolved = true;
			return "";
		}
		return known;
	});
	if (unresolved || containsDynamicShell(expanded)) return undefined;
	return expanded;
}

function tokenizeShell(segment: string): string[] {
	const tokens: string[] = [];
	let token = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;

	const push = () => {
		if (token.length > 0) tokens.push(token);
		token = "";
	};

	for (let i = 0; i < segment.length; i += 1) {
		const char = segment[i]!;
		if (escaped) {
			token += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			else token += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			push();
			continue;
		}
		if (char === ">" || char === "<") {
			push();
			let operator = char;
			while (segment[i + 1] === char || segment[i + 1] === "|" || segment[i + 1] === "&") {
				operator += segment[i + 1];
				i += 1;
			}
			if (tokens.length > 0 && /^\d+$/.test(tokens[tokens.length - 1]!)) {
				operator = `${tokens.pop()}${operator}`;
			}
			tokens.push(operator);
			continue;
		}
		token += char;
	}
	push();
	return tokens;
}

function splitShellSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let parenDepth = 0;

	const push = () => {
		const value = current.trim();
		if (value) segments.push(value);
		current = "";
	};

	for (let i = 0; i < command.length; i += 1) {
		const char = command[i]!;
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			current += char;
			escaped = true;
			continue;
		}
		if (quote) {
			current += char;
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		if (char === "(") {
			parenDepth += 1;
			current += char;
			continue;
		}
		if (char === ")" && parenDepth > 0) {
			parenDepth -= 1;
			current += char;
			continue;
		}
		if (parenDepth === 0 && (char === ";" || char === "\n" || char === "|" || char === "&")) {
			push();
			if (command[i + 1] === char) i += 1;
			continue;
		}
		current += char;
	}
	push();
	return segments;
}

function extractCommandSubstitutions(command: string): string[] {
	const results: string[] = [];
	for (let i = 0; i < command.length; i += 1) {
		if (command[i] === "`") {
			const end = command.indexOf("`", i + 1);
			if (end > i) {
				results.push(command.slice(i + 1, end));
				i = end;
			}
			continue;
		}
		if (command[i] !== "$" || command[i + 1] !== "(") continue;
		let depth = 1;
		let quote: "'" | '"' | undefined;
		let escaped = false;
		for (let j = i + 2; j < command.length; j += 1) {
			const char = command[j]!;
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\" && quote !== "'") {
				escaped = true;
				continue;
			}
			if (quote) {
				if (char === quote) quote = undefined;
				continue;
			}
			if (char === "'" || char === '"') {
				quote = char;
				continue;
			}
			if (char === "(") depth += 1;
			if (char === ")") depth -= 1;
			if (depth === 0) {
				results.push(command.slice(i + 2, j));
				i = j;
				break;
			}
		}
	}
	return results;
}

function externalFinding(
	rawTarget: string,
	state: ShellState,
	workspace: string,
	reason: string,
	targetLabel?: string,
): MutationFinding | undefined {
	const expanded = expandKnownVariables(rawTarget, state);
	if (expanded === undefined || !state.cwd) {
		return {
			kind: "unknown-write",
			reason: `${reason}; destination is computed dynamically`,
			targetExpression: rawTarget,
			targetLabel,
		};
	}
	const target = resolvePolicyPath(expanded, state.cwd);
	if (isPermittedWriteTarget(target, state.cwd, workspace, state.allowedWriteRoots)) return;
	return { kind: "external-write", reason, target, targetLabel };
}

function mutationOperands(command: string, args: string[]): string[] {
	const positional = args.filter((arg) => !arg.startsWith("-"));
	switch (command) {
		case "cp":
		case "install":
		case "mv":
		case "rsync":
		case "scp":
			return positional.length > 0 ? [positional[positional.length - 1]!] : [];
		case "chmod":
		case "chown":
		case "chgrp":
			return positional.slice(1);
		case "patch": {
			const outputIndex = args.findIndex((arg) => arg === "-o" || arg === "--output");
			return outputIndex >= 0 && args[outputIndex + 1] ? [args[outputIndex + 1]!] : [];
		}
		default:
			return positional;
	}
}

export function isRemoteMutationCommand(commandName: string, rawArgs: readonly string[]): boolean {
	const command = commandName.toLowerCase();
	const values = rawArgs.map((value) => value.toLowerCase());
	const firstVerb = values.find((value) => !value.startsWith("-"));
	if (["npm", "pnpm", "yarn"].includes(command) && values.includes("publish")) return true;
	if (command === "docker" && values.some((value) => ["push", "login", "context"].includes(value))) return true;
	if (command === "kubectl" && values.some((value) => ["apply", "create", "delete", "patch", "replace", "rollout", "scale", "set"].includes(value))) return true;
	if (command === "terraform" && values.some((value) => ["apply", "destroy", "import"].includes(value))) return true;
	if (command === "git" && values.includes("push")) return true;
	if (command === "gh" && (
		(["release", "repo", "pr"].includes(firstVerb ?? "") && values.some((value) => ["create", "delete", "merge"].includes(value))) ||
		(firstVerb === "workflow" && values.includes("run")) ||
		(firstVerb === "api" && rawArgs.some((value, index) => {
			if (["-X", "--method"].includes(value)) return !["GET", "HEAD", "OPTIONS"].includes((rawArgs[index + 1] ?? "").toUpperCase());
			const method = value.match(/^--(?:method|request)=(.+)$/i)?.[1]?.toUpperCase();
			return Boolean(method && !["GET", "HEAD", "OPTIONS"].includes(method));
		}))
	)) return true;
	if (command === "curl") {
		for (let index = 0; index < rawArgs.length; index += 1) {
			const value = rawArgs[index]!;
			if (["-d", "-F", "-T", "--data", "--data-binary", "--data-raw", "--form", "--upload-file"].includes(value) ||
				/^(?:--data(?:-binary|-raw)?|--form|--upload-file)=/.test(value)) return true;
			if (["-X", "--request"].includes(value)) {
				const method = (rawArgs[index + 1] ?? "").toUpperCase();
				if (method && !["GET", "HEAD", "OPTIONS"].includes(method)) return true;
			}
			const method = value.match(/^(?:-X|--request=)(.+)$/)?.[1]?.toUpperCase();
			if (method && !["GET", "HEAD", "OPTIONS"].includes(method)) return true;
		}
	}
	if (command === "wget" && rawArgs.some((value) =>
		/^(?:--method=(?!GET|HEAD|OPTIONS)|--post-data(?:=|$)|--post-file(?:=|$))/i.test(value)
	)) return true;
	if (["aws", "az", "gcloud"].includes(command) && values.some((value) =>
		["apply", "copy", "cp", "create", "delete", "deploy", "destroy", "publish", "put", "remove", "rm", "set", "sync", "update", "upload"].includes(value)
	)) return true;
	if (["vercel", "netlify", "wrangler", "firebase", "flyctl", "heroku", "railway", "serverless", "sls"].includes(command) &&
		values.some((value) => ["deploy", "destroy", "publish", "remove", "rollback", "promote"].includes(value))) return true;
	if (command === "helm" && values.some((value) => ["install", "rollback", "uninstall", "upgrade"].includes(value))) return true;
	if ((command === "cargo" && values.includes("publish")) ||
		(command === "twine" && values.includes("upload")) ||
		(command === "gem" && values.includes("push")) ||
		(command === "dotnet" && values.includes("push"))) return true;
	return false;
}

function remoteMutationFinding(command: string, args: string[]): MutationFinding | undefined {
	if (!isRemoteMutationCommand(command, args)) return;
	return { kind: "remote-mutation", reason: `${command} may mutate an external service and requires explicit human approval` };
}

function analyzeSegment(segment: string, state: ShellState, workspace: string): MutationFinding[] {
	const findings: MutationFinding[] = [];
	const tokens = tokenizeShell(segment);
	if (tokens.length === 0) return findings;

	for (let i = 0; i < tokens.length - 1; i += 1) {
		if (/^(?:\d*)?>/.test(tokens[i]!)) {
			const finding = externalFinding(tokens[i + 1]!, state, workspace, "shell output redirect writes outside workspace");
			if (finding) findings.push(finding);
		}
		if (/^(?:\d*)?</.test(tokens[i]!)) {
			const finding = secretReadFinding(tokens[i + 1]!, state, "shell input redirect reads a secret file");
			if (finding) findings.push(finding);
		}
	}

	let cursor = 0;
	if (tokens[cursor] === "export") cursor += 1;
	while (cursor < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cursor]!)) {
		const token = tokens[cursor]!;
		const equals = token.indexOf("=");
		const name = token.slice(0, equals);
		const value = token.slice(equals + 1);
		state.vars.set(name, expandKnownVariables(value, state));
		cursor += 1;
	}
	if (cursor >= tokens.length) return findings;

	const command = basename(tokens[cursor]!).toLowerCase();
	const args = tokens.slice(cursor + 1).filter((arg) => !/^(?:\d*)?[<>]/.test(arg));
	const remoteFinding = remoteMutationFinding(command, args);
	if (remoteFinding) findings.push(remoteFinding);

	const referencedEnvironmentNames = new Set<string>();
	for (const match of segment.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) referencedEnvironmentNames.add(match[1]!);
	for (const match of segment.matchAll(/\$\{([^}]*)\}/g)) {
		const expression = match[1] ?? "";
		const name = expression.match(/^!?([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
		if (name) referencedEnvironmentNames.add(name);
		if (expression.startsWith("!")) findings.push({
			kind: "secret-read",
			reason: "shell performs indirect environment-variable expansion",
		});
	}
	for (const name of referencedEnvironmentNames) {
		if (SENSITIVE_ENV_NAME_PATTERN.test(name)) {
			findings.push({
				kind: "secret-read",
				reason: `shell reads sensitive environment variable ${name}`,
			});
		}
	}
	if (
		(command === "env" && args.every((arg) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) ||
		(command === "printenv" && (args.length === 0 || args.some((arg) => SENSITIVE_ENV_NAME_PATTERN.test(arg)))) ||
		(command === "set" && args.length === 0) ||
		(command === "export" && args.includes("-p"))
	) {
		findings.push({
			kind: "secret-read",
			reason: `${command} may expose sensitive environment variables`,
		});
	}

	if (command === "cd") {
		const destination = args.find((arg) => !arg.startsWith("-")) ?? homedir();
		const expanded = expandKnownVariables(destination, state);
		state.cwdExpression = expanded === undefined ? destination : undefined;
		state.cwd = expanded === undefined || !state.cwd ? undefined : resolvePolicyPath(expanded, state.cwd);
		return findings;
	}

	if (SHELL_CONTENT_READ_COMMANDS.has(command)) {
		for (const arg of args) {
			if (arg.startsWith("-")) continue;
			const finding = secretReadFinding(arg, state, `${command} reads a secret file`);
			if (finding) findings.push(finding);
		}
	}

	const inlineFlags = INLINE_CODE_FLAGS[command];
	if (inlineFlags && (inlineFlags.size === 0 || args.some((arg) => inlineFlags.has(arg)))) {
		const inlineFlagIndex = args.findIndex((arg) => inlineFlags.has(arg));
		const inlineCode = inlineFlags.size === 0
			? args.join(" ")
			: args[inlineFlagIndex + 1];
		findings.push({
			kind: "unknown-write",
			reason: `${command} executes dynamic code that may write outside workspace`,
			detail: inlineCode || segment,
			detailLabel: `Executed ${command} code`,
			workingDirectory: state.cwd,
		});
		return findings;
	}

	if (command === "git") {
		let gitCwd = state.cwd;
		let gitCwdExpression = state.cwdExpression;
		const cIndex = args.findIndex((arg) => arg === "-C");
		if (cIndex >= 0 && args[cIndex + 1]) {
			const rawGitCwd = args[cIndex + 1]!;
			const expanded = expandKnownVariables(rawGitCwd, state);
			gitCwdExpression = expanded === undefined ? rawGitCwd : undefined;
			gitCwd = expanded === undefined || !state.cwd ? undefined : resolvePolicyPath(expanded, state.cwd);
		}
		const subcommand = args.find((arg, index) => {
			if (arg.startsWith("-")) return false;
			if (cIndex >= 0 && index === cIndex + 1) return false;
			return true;
		});
		if (subcommand && GIT_MUTATION_SUBCOMMANDS.has(subcommand)) {
			if (!gitCwd) {
				findings.push({
					kind: "unknown-write",
					reason: `git ${subcommand} runs from a dynamic directory`,
					targetExpression: gitCwdExpression,
					targetLabel: "Git working directory",
					detail: segment,
					detailLabel: "Git command",
				});
			} else if (!isInsideWorkspace(gitCwd, workspace)) {
				findings.push({
					kind: "external-write",
					reason: `git ${subcommand} modifies a repository outside workspace`,
					target: gitCwd,
					targetLabel: "Git working directory",
				});
			}
		}
		return findings;
	}

	if (command === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i"))) {
		const candidates = args.filter((arg) => !arg.startsWith("-"));
		const target = candidates[candidates.length - 1];
		if (!target) {
			findings.push({ kind: "unknown-write", reason: "sed -i target could not be determined" });
		} else {
			const finding = externalFinding(target, state, workspace, "sed -i modifies a file outside workspace");
			if (finding) findings.push(finding);
		}
		return findings;
	}

	if (command === "dd") {
		const output = args.find((arg) => arg.startsWith("of="));
		if (output) {
			const finding = externalFinding(output.slice(3), state, workspace, "dd writes outside workspace");
			if (finding) findings.push(finding);
		}
		return findings;
	}

	if (command === "curl" || command === "wget") {
		const writesUsingRemoteName =
			(command === "curl" && args.some((arg) => arg === "-O" || arg === "--remote-name")) ||
			(command === "wget" && !args.some((arg) =>
				arg === "-O" ||
				arg === "--output-document" ||
				arg.startsWith("--output-document=")
			));
		if (writesUsingRemoteName && state.cwd && !isPermittedWriteTarget(state.cwd, state.cwd, workspace, state.allowedWriteRoots)) {
			findings.push({
				kind: "external-write",
				reason: `${command} downloads into a directory outside workspace`,
				target: state.cwd,
				targetIsDirectory: true,
			});
		}

		for (let index = 0; index < args.length; index += 1) {
			const arg = args[index]!;
			const next = args[index + 1];
			const isOutputFlag =
				arg === "-o" ||
				arg === "--output" ||
				(command === "wget" && arg === "-O") ||
				arg === "--output-document";
			const inlineOutput = arg.match(/^--(?:output|output-document)=(.+)$/);
			const output = inlineOutput?.[1] ?? (isOutputFlag ? next : undefined);
			if (output && output !== "-") {
				const finding = externalFinding(
					output,
					state,
					workspace,
					`${command} downloads a file outside workspace`,
				);
				if (finding) findings.push(finding);
			}

			const uploadFlag =
				arg === "-T" ||
				arg === "--upload-file" ||
				arg === "--data" ||
				arg === "-d" ||
				arg === "--data-binary" ||
				arg === "--data-urlencode" ||
				arg === "--form" ||
				arg === "-F";
			const inlineUpload = arg.match(/^--(?:upload-file|data|data-binary|data-urlencode|form)=(.+)$/)?.[1];
			const uploadValue = inlineUpload ?? (uploadFlag ? next : undefined);
			const fileReference = uploadValue?.match(/(?:^|=)@(.+)$/)?.[1] ??
				((arg === "-T" || arg === "--upload-file") && uploadValue ? uploadValue : undefined);
			if (fileReference && isLocalReference(fileReference)) {
				findings.push(externalUploadFinding(
					fileReference,
					state,
					`${command} uploads a local file to an external destination`,
				));
			}
		}
		return findings;
	}

	if ((command === "scp" || command === "rsync") && args.length >= 2) {
		const positional = args.filter((arg) => !arg.startsWith("-"));
		const destination = positional[positional.length - 1];
		if (destination && looksLikeRemotePath(destination)) {
			for (const source of positional.slice(0, -1)) {
				if (isLocalReference(source)) {
					findings.push(externalUploadFinding(
						source,
						state,
						`${command} uploads a local file to a remote destination`,
					));
				}
			}
			return findings;
		}
	}

	if (!MUTATION_COMMANDS.has(command)) return findings;

	const operands = mutationOperands(command, args);
	if (operands.length === 0) {
		findings.push({ kind: "unknown-write", reason: `${command} destination could not be determined` });
		return findings;
	}
	for (const operand of operands) {
		const targetLabel = command === "rm" || command === "rmdir" || command === "unlink"
			? "File or directory to delete"
			: undefined;
		const finding = externalFinding(
			operand,
			state,
			workspace,
			`${command} modifies a path outside workspace`,
			targetLabel,
		);
		if (finding) findings.push(finding);
	}
	return findings;
}

function analyzeShellMutationsUnfinalized(
	command: string,
	cwd: string,
	workspace = cwd,
	allowedWriteRoots: readonly string[] = [],
	depth = 0,
): MutationFinding[] {
	if (command.length > MAX_SHELL_CHARACTERS || depth > MAX_SHELL_NESTING) {
		return [{ kind: "unknown-write", reason: "shell command exceeds the guardrail parser complexity budget" }];
	}
	const nestedCommands = extractCommandSubstitutions(command);
	const segments = splitShellSegments(command);
	const tokenCount = segments.reduce((count, segment) => count + tokenizeShell(segment).length, 0);
	if (segments.length > MAX_SHELL_SEGMENTS || tokenCount > MAX_SHELL_TOKENS || nestedCommands.length > MAX_SHELL_SEGMENTS) {
		return [{ kind: "unknown-write", reason: "shell command exceeds the guardrail parser complexity budget" }];
	}
	const state: ShellState = {
		cwd: resolvePolicyPath(cwd, cwd),
		vars: new Map(),
		allowedWriteRoots,
	};
	const findings: MutationFinding[] = [];
	for (const nested of nestedCommands) {
		findings.push(...analyzeShellMutationsUnfinalized(nested, state.cwd ?? cwd, workspace, allowedWriteRoots, depth + 1));
	}
	for (const segment of segments) {
		findings.push(...analyzeSegment(segment, state, workspace));
	}
	return deduplicateFindings(findings);
}

export function analyzeShellMutations(
	command: string,
	cwd: string,
	workspace = cwd,
	allowedWriteRoots: readonly string[] = [],
): MutationFinding[] {
	return finalizeFindings(analyzeShellMutationsUnfinalized(command, cwd, workspace, allowedWriteRoots));
}

function finalizeFindings(findings: MutationFinding[]): MutationFinding[] {
	const completed = [...findings];
	for (const finding of findings) {
		if (finding.kind !== "external-upload" || !finding.target || !isSensitivePath(finding.target)) continue;
		completed.push({
			kind: "secret-read",
			reason: "external upload reads a sensitive local file",
			target: finding.target,
		});
	}
	return deduplicateFindings(completed);
}

function deduplicateFindings(findings: MutationFinding[]): MutationFinding[] {
	const seen = new Set<string>();
	return findings.filter((finding) => {
		const key = `${finding.kind}:${finding.target ?? ""}:${finding.targetExpression ?? ""}:${finding.detail ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

type PathArgument = {
	field: string;
	value: string;
};

function normalizedFieldName(field: string): string {
	return field
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.toLowerCase();
}

function collectPathArguments(
	value: unknown,
	field = "",
	results: PathArgument[] = [],
): PathArgument[] {
	if (typeof value === "string") {
		if (PATH_FIELD_PATTERN.test(normalizedFieldName(field)) || value.startsWith("file://")) {
			results.push({ field: normalizedFieldName(field), value });
		}
		return results;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectPathArguments(item, field, results);
		return results;
	}
	if (!value || typeof value !== "object") return results;
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		collectPathArguments(nested, key, results);
	}
	return results;
}

function parseNestedToolArguments(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined || value === "") return {};
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value !== "string") return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

function analyzePathAwareCustomTool(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
	workspaceRoot: string,
	allowedWriteRoots: readonly string[],
): MutationFinding[] {
	const normalizedToolName = normalizedFieldName(toolName);
	const pathArguments = collectPathArguments(input).filter(({ value }) => isLocalReference(value));
	const findings: MutationFinding[] = [];
	const hasCommandField = Object.hasOwn(input, "command") || Object.hasOwn(input, "cmd");
	if (COMMAND_TOOL_PATTERN.test(toolName) || hasCommandField) {
		const command = input.command ?? input.cmd;
		if (typeof command === "string") findings.push(...analyzeShellMutationsUnfinalized(command, cwd, workspaceRoot, allowedWriteRoots));
		else findings.push({ kind: "unknown-write", reason: `${toolName} executes commands, but its command arguments could not be inspected` });
	}

	if (READ_TOOL_PATTERN.test(normalizedToolName)) {
		for (const { value } of pathArguments) {
			if (!isSensitivePolicyPath(value, cwd)) continue;
			findings.push({
				kind: "secret-read",
				reason: `${toolName} reads a secret file`,
				target: resolvePolicyPath(value, cwd),
			});
		}
	}

	if (FILE_UPLOAD_TOOL_PATTERN.test(normalizedToolName)) {
		const state: ShellState = { cwd, vars: new Map(), allowedWriteRoots: [] };
		const uploadSources = pathArguments.filter(({ field, value }) => {
			return (
				/(?:^|_)(?:local_path|file_path|source|src|file|files)(?:_|$)/.test(field) ||
				value.startsWith("/") ||
				value.startsWith("./") ||
				value.startsWith("../") ||
				value.startsWith("~/") ||
				value.startsWith("file://")
			);
		});
		for (const { value } of uploadSources) {
			findings.push(externalUploadFinding(
				value,
				state,
				`${toolName} uploads a local file to an external service`,
			));
		}
	}

	const isFileMutation =
		FILE_MUTATION_TOOL_PATTERN.test(normalizedToolName) &&
		(
			FILE_MUTATION_CONTEXT_PATTERN.test(normalizedToolName) ||
			normalizedToolName === "apply_patch" ||
			pathArguments.some(({ field }) => DESTINATION_FIELD_PATTERN.test(field))
		);
	if (!isFileMutation) return deduplicateFindings(findings);

	let destinations = pathArguments;
	if (/(?:^|_)(?:copy|move|rename|download|extract|export|generate|screenshot)(?:_|$)/.test(normalizedToolName)) {
		const explicitDestinations = pathArguments.filter(({ field }) => DESTINATION_FIELD_PATTERN.test(field));
		destinations = explicitDestinations.length > 0
			? explicitDestinations
			: pathArguments.slice(-1);
	}

	if (destinations.length === 0) {
		findings.push({
			kind: "unknown-write",
			reason: `${toolName} may modify files, but its destination could not be determined`,
		});
		return deduplicateFindings(findings);
	}

	for (const { value } of destinations) {
		if (isPermittedWriteTarget(value, cwd, workspaceRoot, allowedWriteRoots)) continue;
		findings.push({
			kind: "external-write",
			reason: `${toolName} modifies a path outside workspace`,
			target: resolvePolicyPath(value, cwd),
		});
	}
	return deduplicateFindings(findings);
}

function analyzeApplyPatch(input: Record<string, unknown>, cwd: string, workspaceRoot: string, allowedWriteRoots: readonly string[]): MutationFinding[] {
	const patch = input.patch ?? input.input;
	if (typeof patch !== "string") {
		return [{
			kind: "unknown-write",
			reason: "apply_patch target paths could not be inspected",
		}];
	}

	const paths = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
		.map((match) => match[1]?.trim())
		.filter((value): value is string => Boolean(value));
	if (paths.length === 0) {
		return [{
			kind: "unknown-write",
			reason: "apply_patch target paths could not be inspected",
		}];
	}
	return deduplicateFindings(paths.flatMap((path): MutationFinding[] => {
		if (isPermittedWriteTarget(path, cwd, workspaceRoot, allowedWriteRoots)) return [];
		return [{
			kind: "external-write",
			reason: "apply_patch modifies a path outside workspace",
			target: resolvePolicyPath(path, cwd),
		}];
	}));
}

function analyzeFetchContent(input: Record<string, unknown>, cwd: string, workspaceRoot: string, allowedWriteRoots: readonly string[]): MutationFinding[] {
	const rawUrls: unknown[] = [input.url];
	if (Array.isArray(input.urls)) rawUrls.push(...input.urls);
	const urls = rawUrls.filter((value): value is string => typeof value === "string");
	const findings: MutationFinding[] = [];
	const hasTimestamp = typeof input.timestamp === "string" && input.timestamp.trim().length > 0;
	const hasFrameSampling = typeof input.frames === "number" && Number.isInteger(input.frames) && input.frames > 1;
	const performsLocalOnlyFrameExtraction = hasTimestamp || hasFrameSampling;

	for (const url of urls) {
		const normalized = normalizeFileReference(url);
		const isExplicitLocalFile =
			url.startsWith("/") ||
			url.startsWith("./") ||
			url.startsWith("../") ||
			url.startsWith("~/") ||
			url.startsWith("file://");
		if (isExplicitLocalFile) {
			if (isSensitivePolicyPath(normalized, cwd)) {
				findings.push({
					kind: "secret-read",
					reason: "fetch_content reads a secret local file",
					target: resolvePolicyPath(normalized, cwd),
				});
			}
			if (!performsLocalOnlyFrameExtraction && LOCAL_VIDEO_EXTENSION_PATTERN.test(normalized)) {
				findings.push({
					kind: "external-upload",
					reason: "fetch_content may upload a local video to an external AI provider",
					target: resolvePolicyPath(normalized, cwd),
				});
			}
			continue;
		}

		try {
			const parsed = new URL(url);
			if (
				(parsed.protocol === "http:" || parsed.protocol === "https:") &&
				parsed.pathname.toLowerCase().endsWith(".pdf")
			) {
				const target = join(homedir(), "Downloads");
				if (!isPermittedWriteTarget(target, cwd, workspaceRoot, allowedWriteRoots)) findings.push({
					kind: "external-write",
					reason: "fetch_content PDF extraction writes Markdown outside workspace",
					target,
					targetIsDirectory: true,
				});
			}
		} catch {
			// Invalid URLs are rejected by fetch_content itself.
		}
	}
	return deduplicateFindings(findings);
}

function analyzeToolCallUnfinalized(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
	workspaceRoot: string,
	allowedWriteRoots: readonly string[],
): MutationFinding[] {
	if (CONTENT_READ_TOOLS.has(toolName)) {
		const rawPaths = [input.path, input.filePath, input.target];
		if (Array.isArray(input.paths)) rawPaths.push(...input.paths);

		return deduplicateFindings(
			rawPaths.flatMap((rawPath): MutationFinding[] => {
				if (typeof rawPath !== "string" || !isSensitivePolicyPath(rawPath, cwd)) return [];
				return [{
					kind: "secret-read",
					reason: `${toolName} reads a secret file`,
					target: resolvePolicyPath(rawPath, cwd),
				}];
			}),
		);
	}
	if (READ_ONLY_TOOLS.has(toolName)) return [];

	if (DIRECT_MUTATION_TOOLS.has(toolName)) {
		const pathArguments = collectPathArguments(input).filter(({ value }) => isLocalReference(value));
		let destinations = pathArguments;
		if (toolName === "move" || toolName === "copy") {
			const explicitDestinations = pathArguments.filter(({ field }) => DESTINATION_FIELD_PATTERN.test(field));
			destinations = explicitDestinations.length > 0
				? explicitDestinations
				: pathArguments.slice(-1);
		}
		if (destinations.length === 0) {
			return [{ kind: "unknown-write", reason: `${toolName} target path is missing or dynamic` }];
		}
		return deduplicateFindings(destinations.flatMap(({ value }): MutationFinding[] => {
			if (isPermittedWriteTarget(value, cwd, workspaceRoot, allowedWriteRoots)) return [];
			return [{
				kind: "external-write",
				reason: `${toolName} modifies a path outside workspace`,
				target: resolvePolicyPath(value, cwd),
			}];
		}));
	}

	if (toolName === "bash" && typeof input.command === "string") {
		return analyzeShellMutationsUnfinalized(input.command, cwd, workspaceRoot, allowedWriteRoots);
	}
	if (toolName === "exec_command" && typeof input.cmd === "string") {
		const workdir = typeof input.workdir === "string" ? resolvePolicyPath(input.workdir, cwd) : cwd;
		return analyzeShellMutationsUnfinalized(input.cmd, workdir, workspaceRoot, allowedWriteRoots);
	}

	if (toolName === "apply_patch") {
		return analyzeApplyPatch(input, cwd, workspaceRoot, allowedWriteRoots);
	}

	if (toolName === "mcp" && typeof input.tool === "string") {
		const nestedInput = parseNestedToolArguments(input.args);
		if (!nestedInput) {
			return [{
				kind: "unknown-write",
				reason: `MCP tool ${input.tool} has arguments that guardrails cannot inspect`,
			}];
		}
		if (normalizedFieldName(input.tool).endsWith("apply_patch")) {
			return analyzeApplyPatch(nestedInput, cwd, workspaceRoot, allowedWriteRoots);
		}
		return analyzePathAwareCustomTool(`mcp:${input.tool}`, nestedInput, cwd, workspaceRoot, allowedWriteRoots);
	}

	if (toolName === "fetch_content") {
		return analyzeFetchContent(input, cwd, workspaceRoot, allowedWriteRoots);
	}

	if (toolName === "chrome_devtools_screenshot" && typeof input.savePath === "string") {
		if (isPermittedWriteTarget(input.savePath, cwd, workspaceRoot, allowedWriteRoots)) return [];
		return [{
			kind: "external-write",
			reason: "chrome_devtools_screenshot saves an image outside workspace",
			target: resolvePolicyPath(input.savePath, cwd),
		}];
	}

	return analyzePathAwareCustomTool(toolName, input, cwd, workspaceRoot, allowedWriteRoots);
}

export function analyzeToolCall(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
	workspaceRoot = cwd,
	allowedWriteRoots: readonly string[] = [],
): MutationFinding[] {
	return finalizeFindings(analyzeToolCallUnfinalized(toolName, input, cwd, workspaceRoot, allowedWriteRoots));
}

