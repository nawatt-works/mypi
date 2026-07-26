import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type MutationKind = "external-write" | "unknown-write" | "secret-read";

export type MutationFinding = {
	kind: MutationKind;
	reason: string;
	target?: string;
};

type ShellState = {
	cwd?: string;
	vars: Map<string, string | undefined>;
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
const SESSION_ALLOW_DIRECTORY = "Allow this directory for this session";
const SESSION_ALLOW_SECRET = "Allow this secret file for this session";
const DENY = "Deny";

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
	/^(?:id_)?(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
	/\.(?:key|pem|p12|pfx|jks|keystore)$/i,
	/^\.(?:npmrc|pypirc|netrc)$/i,
];

const SENSITIVE_PATH_PATTERNS = [
	/(?:^|\/)\.ssh\/(?![^/]+\.pub$)/i,
	/(?:^|\/)\.aws\/credentials$/i,
	/(?:^|\/)\.config\/gcloud\/application_default_credentials\.json$/i,
	/(?:^|\/)\.docker\/config\.json$/i,
	/(?:^|\/)\.kube\/config$/i,
	/(?:^|\/)\.config\/gh\/hosts\.yml$/i,
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
	const expanded = expandHome(input);
	return canonicalizeMissingPath(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

export function isInsideWorkspace(input: string, cwd: string): boolean {
	const workspace = canonicalizeMissingPath(cwd);
	const target = resolvePolicyPath(input, cwd);
	const rel = relative(workspace, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function isSensitivePath(input: string): boolean {
	const normalized = expandHome(input).replaceAll("\\", "/").replace(/\/+$/, "");
	const name = basename(normalized);
	const lowerName = name.toLowerCase();

	if (lowerName.endsWith(".pub")) return false;
	if (SAFE_SECRET_TEMPLATE_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) return false;
	if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
	return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function secretReadFinding(rawTarget: string, state: ShellState, reason: string): MutationFinding | undefined {
	const expanded = expandKnownVariables(rawTarget, state);
	if (expanded === undefined || !state.cwd || !isSensitivePath(expanded)) return;
	return {
		kind: "secret-read",
		reason,
		target: resolvePolicyPath(expanded, state.cwd),
	};
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

function externalFinding(rawTarget: string, state: ShellState, workspace: string, reason: string): MutationFinding | undefined {
	const expanded = expandKnownVariables(rawTarget, state);
	if (expanded === undefined || !state.cwd) {
		return {
			kind: "unknown-write",
			reason: `${reason}; destination is computed dynamically`,
		};
	}
	const target = resolvePolicyPath(expanded, state.cwd);
	if (isInsideWorkspace(target, workspace)) return;
	return { kind: "external-write", reason, target };
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

	const command = basename(tokens[cursor]!);
	const args = tokens.slice(cursor + 1).filter((arg) => !/^(?:\d*)?[<>]/.test(arg));

	if (command === "cd") {
		const destination = args.find((arg) => !arg.startsWith("-")) ?? homedir();
		const expanded = expandKnownVariables(destination, state);
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
		findings.push({
			kind: "unknown-write",
			reason: `${command} executes dynamic code that may write outside workspace`,
		});
		return findings;
	}

	if (command === "git") {
		let gitCwd = state.cwd;
		const cIndex = args.findIndex((arg) => arg === "-C");
		if (cIndex >= 0 && args[cIndex + 1]) {
			const expanded = expandKnownVariables(args[cIndex + 1]!, state);
			gitCwd = expanded === undefined || !state.cwd ? undefined : resolvePolicyPath(expanded, state.cwd);
		}
		const subcommand = args.find((arg, index) => {
			if (arg.startsWith("-")) return false;
			if (cIndex >= 0 && index === cIndex + 1) return false;
			return true;
		});
		if (subcommand && GIT_MUTATION_SUBCOMMANDS.has(subcommand)) {
			if (!gitCwd) {
				findings.push({ kind: "unknown-write", reason: `git ${subcommand} runs from a dynamic directory` });
			} else if (!isInsideWorkspace(gitCwd, workspace)) {
				findings.push({
					kind: "external-write",
					reason: `git ${subcommand} modifies a repository outside workspace`,
					target: gitCwd,
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

	if (!MUTATION_COMMANDS.has(command)) return findings;

	const operands = mutationOperands(command, args);
	if (operands.length === 0) {
		findings.push({ kind: "unknown-write", reason: `${command} destination could not be determined` });
		return findings;
	}
	for (const operand of operands) {
		const finding = externalFinding(operand, state, workspace, `${command} modifies a path outside workspace`);
		if (finding) findings.push(finding);
	}
	return findings;
}

export function analyzeShellMutations(command: string, cwd: string, workspace = cwd): MutationFinding[] {
	const state: ShellState = {
		cwd: resolvePolicyPath(cwd, cwd),
		vars: new Map(),
	};
	const findings: MutationFinding[] = [];
	for (const nested of extractCommandSubstitutions(command)) {
		findings.push(...analyzeShellMutations(nested, state.cwd ?? cwd, workspace));
	}
	for (const segment of splitShellSegments(command)) {
		findings.push(...analyzeSegment(segment, state, workspace));
	}
	return deduplicateFindings(findings);
}

function deduplicateFindings(findings: MutationFinding[]): MutationFinding[] {
	const seen = new Set<string>();
	return findings.filter((finding) => {
		const key = `${finding.kind}:${finding.target ?? ""}:${finding.reason}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function analyzeToolCall(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
): MutationFinding[] {
	if (CONTENT_READ_TOOLS.has(toolName)) {
		const rawPaths = [input.path, input.filePath, input.target];
		if (Array.isArray(input.paths)) rawPaths.push(...input.paths);

		return deduplicateFindings(
			rawPaths.flatMap((rawPath): MutationFinding[] => {
				if (typeof rawPath !== "string" || !isSensitivePath(rawPath)) return [];
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
		const rawPath = input.path ?? input.filePath ?? input.target;
		if (typeof rawPath !== "string") {
			return [{ kind: "unknown-write", reason: `${toolName} target path is missing or dynamic` }];
		}
		if (isInsideWorkspace(rawPath, cwd)) return [];
		return [
			{
				kind: "external-write",
				reason: `${toolName} modifies a path outside workspace`,
				target: resolvePolicyPath(rawPath, cwd),
			},
		];
	}

	if (toolName === "bash" && typeof input.command === "string") {
		return analyzeShellMutations(input.command, cwd);
	}
	if (toolName === "exec_command" && typeof input.cmd === "string") {
		const workdir = typeof input.workdir === "string" ? resolvePolicyPath(input.workdir, cwd) : cwd;
		return analyzeShellMutations(input.cmd, workdir, cwd);
	}

	return [];
}

function displayFinding(finding: MutationFinding): string {
	if (finding.target) return `${finding.reason}\n\nTarget: ${finding.target}`;
	return `${finding.reason}\n\nThe destination cannot be proven to stay inside the workspace.`;
}

function sessionDirectoryKey(finding: MutationFinding): string | undefined {
	if (!finding.target) return;
	return dirname(finding.target);
}

export default function externalWriteGate(pi: ExtensionAPI) {
	const allowedDirectories = new Set<string>();
	const allowedSecretFiles = new Set<string>();

	pi.on("session_start", () => {
		allowedDirectories.clear();
		allowedSecretFiles.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		const findings = analyzeToolCall(
			event.toolName,
			event.input as Record<string, unknown>,
			ctx.cwd,
		);
		if (findings.length === 0) return;

		const pendingSecretReads = findings.filter((finding) => {
			return finding.kind === "secret-read" && (!finding.target || !allowedSecretFiles.has(finding.target));
		});
		if (pendingSecretReads.length > 0) {
			const summary = pendingSecretReads.map(displayFinding).join("\n\n");
			if (!ctx.hasUI) {
				return {
					block: true,
					reason: `Blocked secret file read in non-interactive mode.\n${summary}`,
				};
			}

			const choice = await ctx.ui.select(
				`Secret file access requested\n\n${summary}`,
				[SESSION_ALLOW_ONCE, SESSION_ALLOW_SECRET, DENY],
			);
			if (choice === SESSION_ALLOW_SECRET) {
				for (const finding of pendingSecretReads) {
					if (finding.target) allowedSecretFiles.add(finding.target);
				}
			} else if (choice !== SESSION_ALLOW_ONCE) {
				return {
					block: true,
					reason: `User rejected reading a secret file.\n${summary}`,
				};
			}
		}

		const pending = findings.filter((finding) => {
			if (finding.kind === "secret-read") return false;
			const key = sessionDirectoryKey(finding);
			return !key || !allowedDirectories.has(key);
		});
		if (pending.length === 0) return;

		const summary = pending.map(displayFinding).join("\n\n");
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked external file mutation in non-interactive mode.\n${summary}`,
			};
		}

		const choice = await ctx.ui.select(
			`External file change requested\n\n${summary}`,
			[SESSION_ALLOW_ONCE, SESSION_ALLOW_DIRECTORY, DENY],
		);
		if (choice === SESSION_ALLOW_ONCE) return;
		if (choice === SESSION_ALLOW_DIRECTORY) {
			for (const finding of pending) {
				const key = sessionDirectoryKey(finding);
				if (key) allowedDirectories.add(key);
			}
			return;
		}

		return {
			block: true,
			reason: `User rejected modification outside the workspace.\n${summary}`,
		};
	});
}
