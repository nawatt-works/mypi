import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";

/**
 * Pure Phase 0 command-policy fixture. It has no Pi registration or execution
 * side effects and is not a sandbox. Production wiring must pair it with the
 * verified Worker profile and keep grants in Coordinator-owned registry state.
 */
export type CommandPolicyOutcome = "ALLOW" | "REVIEW" | "DENY" | "HUMAN";

export type CommandFindingCode =
	| "parser-limit"
	| "malformed-shell"
	| "dynamic-command-word"
	| "command-substitution"
	| "nested-shell"
	| "dynamic-code-execution"
	| "privilege-escalation"
	| "hardline-filesystem-destruction"
	| "hardline-device-write"
	| "hardline-host-control"
	| "hardline-denial-of-service"
	| "workspace-root-destruction"
	| "external-filesystem-mutation"
	| "recursive-delete"
	| "repository-history-destruction"
	| "policy-tampering"
	| "remote-code-execution"
	| "remote-mutation";

export type CommandFinding = {
	code: CommandFindingCode;
	outcome: Exclude<CommandPolicyOutcome, "ALLOW">;
	reason: string;
	resource?: string;
};

export type CommandAnalysisOptions = {
	workspaceRoot: string;
	cwd: string;
	workspaceAliases?: readonly string[];
	protectedPaths?: readonly string[];
	protectedEnvironmentVariables?: readonly string[];
	maxCommandLength?: number;
	maxSegments?: number;
	maxTokens?: number;
	maxNesting?: number;
};

export type CommandAnalysis = {
	version: 1;
	commandDigest: string;
	workspaceRoot: string;
	cwd: string;
	findings: CommandFinding[];
	resources: string[];
	recommendedOutcome: CommandPolicyOutcome;
	metrics: {
		characters: number;
		segments: number;
		tokens: number;
		maxNesting: number;
	};
};

export type CommandPolicyRequest = {
	workerId: string;
	sessionId: string;
	mandateId: string;
	profileId: string;
	policyVersion: string;
	workspaceRoot: string;
	cwd: string;
};

/**
 * A grant is trusted registry state, not an authorization bearer token.
 * The exact binding prevents accidental/stale replay; the production registry
 * must keep grants out of Worker-controlled storage.
 */
export type CommandReviewGrant = {
	version: 1;
	grantId: string;
	bindingDigest: string;
	commandDigest: string;
	workerId: string;
	sessionId: string;
	mandateId: string;
	profileId: string;
	policyVersion: string;
	workspaceRoot: string;
	cwd: string;
	findingCodes: CommandFindingCode[];
	resources: string[];
	issuedAt: string;
	expiresAt: string;
};

export type CommandPolicyDecision = {
	outcome: CommandPolicyOutcome;
	executionAllowed: boolean;
	reviewed: boolean;
	grantId?: string;
	reasons: string[];
};

const DEFAULT_MAX_COMMAND_LENGTH = 32_768;
const DEFAULT_MAX_SEGMENTS = 128;
const DEFAULT_MAX_TOKENS = 1_024;
const DEFAULT_MAX_NESTING = 16;
const MAX_REVIEW_GRANT_TTL_MS = 15 * 60 * 1_000;

const DEFAULT_WORKSPACE_ALIASES = ["/workspace"] as const;
const DEFAULT_PROTECTED_ENVIRONMENT_VARIABLES = [
	"HERMES_YOLO_MODE",
	"MYPI_WORKER_POLICY",
	"MYPI_WORKER_POLICY_PATH",
	"MYPI_WORKER_PROFILE",
] as const;

const SYSTEM_ROOTS = new Set([
	"/bin",
	"/boot",
	"/dev",
	"/etc",
	"/home",
	"/lib",
	"/lib64",
	"/private/etc",
	"/private/home",
	"/private/var",
	"/root",
	"/sbin",
	"/usr",
	"/var",
]);

const MUTATING_COMMANDS = new Set([
	"chmod",
	"chown",
	"cp",
	"dd",
	"install",
	"ln",
	"mkdir",
	"mv",
	"perl",
	"python",
	"python3",
	"rm",
	"rmdir",
	"ruby",
	"sed",
	"tee",
	"touch",
	"truncate",
	"unlink",
]);

const SHELL_CARRIERS = new Set(["bash", "dash", "ksh", "sh", "zsh"]);
const INLINE_INTERPRETERS = new Set(["node", "perl", "python", "python3", "ruby"]);
const WRAPPER_COMMANDS = new Set(["command", "exec", "nohup", "setsid", "time"]);

const ANSI_PATTERN = /(?:\u001B|\u009B)(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/gu;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

type ShellToken = {
	value: string;
	dynamic: boolean;
	operator?: boolean;
};

type ParseResult = {
	segments: ShellToken[][];
	subcommands: string[];
	malformed: string[];
	tokenCount: number;
	maxNesting: number;
};

type AnalysisState = {
	workspaceRoot: string;
	cwd: string;
	workspaceAliases: string[];
	protectedPaths: string[];
	protectedEnvironmentVariables: Set<string>;
	maxCommandLength: number;
	maxSegments: number;
	maxTokens: number;
	maxNesting: number;
	findings: CommandFinding[];
	metrics: CommandAnalysis["metrics"];
};

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function requireAbsolutePath(label: string, value: string): string {
	if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
	return resolve(value);
}

function requirePositiveInteger(label: string, value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
	return value;
}

function normalizeCommand(command: string): { text: string; hadNull: boolean } {
	const hadNull = command.includes("\0");
	return {
		text: command
			.replace(ANSI_PATTERN, "")
			.replaceAll("\0", "")
			.normalize("NFKC")
			.replaceAll("\r\n", "\n")
			.replaceAll("\r", "\n"),
		hadNull,
	};
}

function maskQuotedProse(command: string): string {
	let quote: "'" | '"' | undefined;
	let result = "";
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]!;
		if (quote) {
			if (character === "\\" && quote === '"' && index + 1 < command.length) {
				result += "  ";
				index += 1;
				continue;
			}
			if (character === quote) {
				result += character;
				quote = undefined;
			} else {
				result += " ";
			}
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			result += character;
			continue;
		}
		result += character;
	}
	return result;
}

function deobfuscateDetectionText(command: string): string {
	return command
		.replace(/\\([^\n])/g, "$1")
		.replaceAll("''", "")
		.replaceAll('""', "");
}

function scanSubstitution(text: string, start: number): { content: string; end: number; depth: number } | undefined {
	let depth = 1;
	let maxDepth = 1;
	let quote: "'" | '"' | undefined;
	for (let index = start + 2; index < text.length; index += 1) {
		const character = text[index]!;
		if (quote === "'") {
			if (character === "'") quote = undefined;
			continue;
		}
		if (quote === '"') {
			if (character === "\\") {
				index += 1;
				continue;
			}
			if (character === '"') quote = undefined;
			continue;
		}
		if (character === "'") {
			quote = "'";
			continue;
		}
		if (character === '"') {
			quote = '"';
			continue;
		}
		if (character === "\\") {
			index += 1;
			continue;
		}
		if (character === "$" && text[index + 1] === "(") {
			depth += 1;
			maxDepth = Math.max(maxDepth, depth);
			index += 1;
			continue;
		}
		if (character === "(") {
			depth += 1;
			maxDepth = Math.max(maxDepth, depth);
			continue;
		}
		if (character === ")") {
			depth -= 1;
			if (depth === 0) return { content: text.slice(start + 2, index), end: index + 1, depth: maxDepth };
		}
	}
	return undefined;
}

function scanBackticks(text: string, start: number): { content: string; end: number } | undefined {
	for (let index = start + 1; index < text.length; index += 1) {
		if (text[index] === "\\") {
			index += 1;
			continue;
		}
		if (text[index] === "`") return { content: text.slice(start + 1, index), end: index + 1 };
	}
	return undefined;
}

function scanVariable(text: string, start: number): { expression: string; end: number; knownPathVariable: boolean } {
	const braced = text[start + 1] === "{";
	let end = start + (braced ? 2 : 1);
	while (end < text.length && (braced ? text[end] !== "}" : /[A-Za-z0-9_]/.test(text[end]!))) end += 1;
	if (braced && text[end] === "}") end += 1;
	const expression = text.slice(start, end);
	return {
		expression,
		end,
		knownPathVariable: ["$PWD", "${PWD}", "$HOME", "${HOME}"].includes(expression),
	};
}

function parseShell(text: string): ParseResult {
	const segments: ShellToken[][] = [];
	const subcommands: string[] = [];
	const malformed: string[] = [];
	let currentSegment: ShellToken[] = [];
	let tokenValue = "";
	let tokenDynamic = false;
	let quote: "'" | '"' | undefined;
	let maxNesting = 0;

	const flushToken = () => {
		if (tokenValue || tokenDynamic) currentSegment.push({ value: tokenValue, dynamic: tokenDynamic });
		tokenValue = "";
		tokenDynamic = false;
	};
	const flushSegment = () => {
		flushToken();
		if (currentSegment.length > 0) segments.push(currentSegment);
		currentSegment = [];
	};
	const pushOperator = (operator: string) => {
		flushToken();
		currentSegment.push({ value: operator, dynamic: false, operator: true });
	};

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index]!;
		if (quote === "'") {
			if (character === "'") quote = undefined;
			else tokenValue += character;
			continue;
		}
		if (quote === '"') {
			if (character === '"') {
				quote = undefined;
				continue;
			}
			if (character === "\\") {
				if (index + 1 >= text.length) {
					malformed.push("trailing escape in double quote");
					continue;
				}
				tokenValue += text[index + 1]!;
				index += 1;
				continue;
			}
			if (character === "$" && text[index + 1] === "(") {
				const substitution = scanSubstitution(text, index);
				if (!substitution) {
					malformed.push("unterminated command substitution");
					break;
				}
				subcommands.push(substitution.content);
				tokenValue += "$()";
				tokenDynamic = true;
				maxNesting = Math.max(maxNesting, substitution.depth);
				index = substitution.end - 1;
				continue;
			}
			if (character === "`") {
				const substitution = scanBackticks(text, index);
				if (!substitution) {
					malformed.push("unterminated backtick substitution");
					break;
				}
				subcommands.push(substitution.content);
				tokenValue += "``";
				tokenDynamic = true;
				maxNesting = Math.max(maxNesting, 1);
				index = substitution.end - 1;
				continue;
			}
			if (character === "$" && /[A-Za-z_{]/.test(text[index + 1] ?? "")) {
				const variable = scanVariable(text, index);
				tokenValue += variable.expression;
				if (!variable.knownPathVariable) tokenDynamic = true;
				index = variable.end - 1;
				continue;
			}
			tokenValue += character;
			continue;
		}

		if (character === "'") {
			quote = "'";
			continue;
		}
		if (character === '"') {
			quote = '"';
			continue;
		}
		if (character === "\\") {
			if (index + 1 >= text.length) {
				malformed.push("trailing escape");
				continue;
			}
			tokenValue += text[index + 1]!;
			index += 1;
			continue;
		}
		if ((character === "$" || character === "<" || character === ">") && text[index + 1] === "(") {
			const substitution = scanSubstitution(text, index);
			if (!substitution) {
				malformed.push("unterminated command substitution");
				break;
			}
			subcommands.push(substitution.content);
			tokenValue += "$()";
			tokenDynamic = true;
			maxNesting = Math.max(maxNesting, substitution.depth);
			index = substitution.end - 1;
			continue;
		}
		if (character === "`") {
			const substitution = scanBackticks(text, index);
			if (!substitution) {
				malformed.push("unterminated backtick substitution");
				break;
			}
			subcommands.push(substitution.content);
			tokenValue += "``";
			tokenDynamic = true;
			maxNesting = Math.max(maxNesting, 1);
			index = substitution.end - 1;
			continue;
		}
		if (character === "$" && /[A-Za-z_{]/.test(text[index + 1] ?? "")) {
			const variable = scanVariable(text, index);
			tokenValue += variable.expression;
			if (!variable.knownPathVariable) tokenDynamic = true;
			index = variable.end - 1;
			continue;
		}
		if (/\s/.test(character)) {
			if (character === "\n") flushSegment();
			else flushToken();
			continue;
		}
		if (character === "#" && tokenValue === "") {
			while (index < text.length && text[index] !== "\n") index += 1;
			flushSegment();
			continue;
		}
		if (character === "&" && text[index + 1] === ">") {
			pushOperator("&>");
			index += 1;
			continue;
		}
		if (character === ";" || character === "|" || character === "&") {
			flushSegment();
			if (text[index + 1] === character) index += 1;
			continue;
		}
		if (character === ">" || character === "<") {
			const operator = text[index + 1] === character || (character === ">" && text[index + 1] === "|")
				? character + text[index + 1]
				: character;
			pushOperator(operator);
			if (operator.length === 2) index += 1;
			continue;
		}
		tokenValue += character;
	}
	if (quote) malformed.push(`unterminated ${quote === "'" ? "single" : "double"} quote`);
	flushSegment();
	return {
		segments,
		subcommands,
		malformed,
		tokenCount: segments.reduce((total, segment) => total + segment.length, 0),
		maxNesting,
	};
}

function addFinding(state: AnalysisState, finding: CommandFinding): void {
	if (state.findings.some((item) =>
		item.code === finding.code && item.outcome === finding.outcome && item.resource === finding.resource
	)) return;
	state.findings.push(finding);
}

function outcomeFor(findings: readonly CommandFinding[]): CommandPolicyOutcome {
	if (findings.some((finding) => finding.outcome === "DENY")) return "DENY";
	if (findings.some((finding) => finding.outcome === "HUMAN")) return "HUMAN";
	if (findings.some((finding) => finding.outcome === "REVIEW")) return "REVIEW";
	return "ALLOW";
}

function isWithin(path: string, root: string): boolean {
	const offset = relative(root, path);
	return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function expandPolicyPath(value: string, state: AnalysisState): string | undefined {
	let candidate = value.trim();
	if (!candidate || candidate.includes("$()") || candidate.includes("``")) return undefined;
	candidate = candidate
		.replace(/^\$\{PWD\}(?=\/|$)|^\$PWD(?=\/|$)/, state.cwd)
		.replace(/^\$\{HOME\}(?=\/|$)|^\$HOME(?=\/|$)|^~(?=\/|$)/, "/home/worker");
	for (const alias of state.workspaceAliases) {
		if (candidate === alias || candidate.startsWith(`${alias}/`)) {
			return resolve(state.workspaceRoot, candidate.slice(alias.length).replace(/^\//, ""));
		}
	}
	if (isAbsolute(candidate)) return resolve(candidate);
	return resolve(state.cwd, candidate);
}

function commandView(segment: readonly ShellToken[]): { command?: ShellToken; args: ShellToken[]; sudo: boolean } {
	const tokens = segment.filter((token) => !token.operator);
	let index = 0;
	let sudo = false;
	while (index < tokens.length) {
		const value = tokens[index]!.value;
		if (ASSIGNMENT_PATTERN.test(value)) {
			index += 1;
			continue;
		}
		const name = basename(value).toLowerCase();
		if (name === "sudo") {
			sudo = true;
			index += 1;
			while (index < tokens.length && tokens[index]!.value.startsWith("-")) index += 1;
			continue;
		}
		if (name === "env") {
			index += 1;
			while (index < tokens.length && (tokens[index]!.value.startsWith("-") || ASSIGNMENT_PATTERN.test(tokens[index]!.value))) index += 1;
			continue;
		}
		if (WRAPPER_COMMANDS.has(name)) {
			index += 1;
			while (index < tokens.length && tokens[index]!.value.startsWith("-")) index += 1;
			continue;
		}
		return { command: tokens[index], args: tokens.slice(index + 1), sudo };
	}
	return { args: [], sudo };
}

function isRootLikeDeleteTarget(target: string): boolean {
	const normalized = target.replace(/\/+/g, "/").replace(/\/\*$/, "");
	if (!normalized.startsWith("/")) return false;
	return normalized.split("/").every((part) => part === "" || part === "." || part === "..");
}

function isWorkspaceSweep(value: string, resolvedPath: string | undefined, state: AnalysisState): boolean {
	if (resolvedPath === state.workspaceRoot) return true;
	const normalized = value.replace(/^\.\//, "");
	if (state.cwd === state.workspaceRoot && ["*", ".*", ".??*"].includes(normalized)) return true;
	return state.workspaceAliases.some((alias) => value === alias || value === `${alias}/*` || value === `${alias}/.*`);
}

function protectedResource(path: string, state: AnalysisState): string | undefined {
	return state.protectedPaths.find((protectedPath) => isWithin(path, protectedPath));
}

function detectPolicyTampering(
	segment: readonly ShellToken[],
	commandName: string,
	args: readonly ShellToken[],
	state: AnalysisState,
): void {
	const targets: ShellToken[] = [];
	for (let index = 0; index < segment.length - 1; index += 1) {
		if (segment[index]!.operator && segment[index]!.value.includes(">")) targets.push(segment[index + 1]!);
	}
	const positional = args.filter((token) => !token.value.startsWith("-"));
	if (["cp", "install", "ln"].includes(commandName)) {
		const targetDirectoryIndex = args.findIndex((token) => token.value === "-t" || token.value === "--target-directory");
		const joinedTarget = args.find((token) => token.value.startsWith("--target-directory="));
		if (targetDirectoryIndex >= 0 && args[targetDirectoryIndex + 1]) targets.push(args[targetDirectoryIndex + 1]!);
		else if (joinedTarget) targets.push({ ...joinedTarget, value: joinedTarget.value.slice("--target-directory=".length) });
		else if (positional.length > 0) targets.push(positional.at(-1)!);
	} else if (commandName === "mv") {
		targets.push(...positional);
	} else if (commandName === "dd") {
		targets.push(...args.filter((token) => token.value.startsWith("of=")).map((token) => ({ ...token, value: token.value.slice(3) })));
	} else if (commandName === "sed") {
		if (args.some((token) => token.value === "--in-place" || /^-i/.test(token.value))) targets.push(...positional.slice(1));
	} else if (["perl", "ruby"].includes(commandName)) {
		if (args.some((token) => /^-.*i/.test(token.value))) targets.push(...positional.slice(1));
	} else if (MUTATING_COMMANDS.has(commandName)) {
		targets.push(...positional);
	}
	for (const target of targets) {
		if (target.dynamic) {
			addFinding(state, {
				code: "external-filesystem-mutation",
				outcome: "DENY",
				reason: "mutation target is dynamically constructed and cannot be scoped safely",
			});
			continue;
		}
		const path = expandPolicyPath(target.value, state);
		if (!path) continue;
		const protectedPath = protectedResource(path, state);
		if (protectedPath) {
			addFinding(state, {
				code: "policy-tampering",
				outcome: "DENY",
				reason: "command may modify a protected policy or repository-control path",
				resource: protectedPath,
			});
		}
	}
}

function detectEmbeddedPolicyReference(
	segment: readonly ShellToken[],
	commandName: string,
	state: AnalysisState,
): void {
	if (commandName !== "eval" && !INLINE_INTERPRETERS.has(commandName)) return;
	const payload = segment.filter((token) => !token.operator).map((token) => token.value).join(" ");
	const protectedPath = state.protectedPaths.find((path) => payload.includes(path));
	if (protectedPath || /(?:^|[\s/'"`])\.git(?:[\/\s'"`]|$)/.test(payload)) {
		addFinding(state, {
			code: "policy-tampering",
			outcome: "DENY",
			reason: "dynamic code references a protected policy or repository-control path",
			resource: protectedPath ?? resolve(state.workspaceRoot, ".git"),
		});
	}
}

function detectEnvSplitExecution(segment: readonly ShellToken[], state: AnalysisState, depth: number): void {
	const tokens = segment.filter((token) => !token.operator);
	const envIndex = tokens.findIndex((token) => basename(token.value).toLowerCase() === "env");
	if (envIndex < 0) return;
	const flagIndex = tokens.findIndex((token, index) => index > envIndex && ["-S", "--split-string"].includes(token.value));
	const joined = tokens.find((token, index) => index > envIndex && token.value.startsWith("--split-string="));
	const payload = flagIndex >= 0 ? tokens[flagIndex + 1] : joined
		? { ...joined, value: joined.value.slice("--split-string=".length) }
		: undefined;
	if (!payload && flagIndex < 0 && !joined) return;
	addFinding(state, {
		code: "nested-shell",
		outcome: "REVIEW",
		reason: "env split-string constructs a nested executable command",
		resource: "shell:env",
	});
	if (!payload || payload.dynamic) {
		addFinding(state, {
			code: "dynamic-command-word",
			outcome: "DENY",
			reason: "env split-string payload is missing or dynamically constructed",
		});
		return;
	}
	analyzeNested(payload.value, state, depth + 1);
}

function detectEnvironmentTampering(segment: readonly ShellToken[], state: AnalysisState): void {
	const tokens = segment.filter((token) => !token.operator);
	const candidates: string[] = [];
	let index = 0;
	while (index < tokens.length && ASSIGNMENT_PATTERN.test(tokens[index]!.value)) {
		candidates.push(tokens[index]!.value);
		index += 1;
	}
	const commandName = basename(tokens[index]?.value ?? "").toLowerCase();
	if (commandName === "env") {
		index += 1;
		while (index < tokens.length && (tokens[index]!.value.startsWith("-") || ASSIGNMENT_PATTERN.test(tokens[index]!.value))) {
			if (ASSIGNMENT_PATTERN.test(tokens[index]!.value)) candidates.push(tokens[index]!.value);
			index += 1;
		}
	} else if (commandName === "export" || commandName === "unset") {
		candidates.push(...tokens.slice(index + 1).map((token) => token.value));
	}
	for (const candidate of candidates) {
		const name = candidate.split("=", 1)[0]!;
		if (state.protectedEnvironmentVariables.has(name)) {
			addFinding(state, {
				code: "policy-tampering",
				outcome: "DENY",
				reason: `command attempts to set protected policy environment variable ${name}`,
				resource: `env:${name}`,
			});
		}
	}
}

function detectRm(args: readonly ShellToken[], state: AnalysisState): void {
	const recursive = args.some((token) =>
		token.value === "--recursive" || /^-[^-]*[rR]/.test(token.value)
	);
	const targets = args.filter((token) => token.value !== "--" && !token.value.startsWith("-"));
	for (const target of targets) {
		const value = target.value;
		if (target.dynamic) {
			addFinding(state, {
				code: "external-filesystem-mutation",
				outcome: "DENY",
				reason: "delete target is dynamically constructed and cannot be scoped safely",
			});
			continue;
		}
		const path = expandPolicyPath(value, state);
		if (!recursive) {
			if (path && !isWithin(path, state.workspaceRoot)) {
				addFinding(state, {
					code: "external-filesystem-mutation",
					outcome: "DENY",
					reason: "delete target is outside the Worker worktree",
					resource: path,
				});
			}
			continue;
		}
		if (isRootLikeDeleteTarget(value) || path === "/" || value === "$HOME" || value === "${HOME}" || value === "~") {
			addFinding(state, {
				code: "hardline-filesystem-destruction",
				outcome: "DENY",
				reason: "recursive delete targets a filesystem or home root",
				resource: path,
			});
			continue;
		}
		if (path && [...SYSTEM_ROOTS].some((root) => path === root || isWithin(path, root))) {
			addFinding(state, {
				code: "hardline-filesystem-destruction",
				outcome: "DENY",
				reason: "recursive delete targets a protected system tree",
				resource: path,
			});
			continue;
		}
		if (path && isWorkspaceSweep(value, path, state)) {
			addFinding(state, {
				code: "workspace-root-destruction",
				outcome: "DENY",
				reason: "recursive delete would wipe the Worker worktree or its contents",
				resource: state.workspaceRoot,
			});
			continue;
		}
		if (!path || !isWithin(path, state.workspaceRoot)) {
			addFinding(state, {
				code: "external-filesystem-mutation",
				outcome: "DENY",
				reason: "recursive delete target is dynamic or outside the Worker worktree",
				resource: path,
			});
			continue;
		}
		addFinding(state, {
			code: "recursive-delete",
			outcome: "REVIEW",
			reason: "bounded recursive deletion requires an exact Coordinator review grant",
			resource: path,
		});
	}
}

function hasFlag(args: readonly ShellToken[], longName: string, shortName: string): boolean {
	return args.some((token) => token.value === longName || new RegExp(`^-[^-]*${shortName}`).test(token.value));
}

function detectGit(args: readonly ShellToken[], state: AnalysisState): void {
	const gitVerbs = new Set(["branch", "checkout", "clean", "push", "reset"]);
	const verb = args.map((token) => token.value.toLowerCase()).find((value) => gitVerbs.has(value));
	if (!verb) return;
	if (verb === "push") {
		addFinding(state, {
			code: "remote-mutation",
			outcome: "HUMAN",
			reason: "git push mutates a remote repository and is human-only",
			resource: "remote:git",
		});
		return;
	}
	if (
		(verb === "reset" && args.some((token) => token.value === "--hard")) ||
		(verb === "clean" && hasFlag(args, "--force", "f")) ||
		(verb === "checkout" && args.some((token) => token.value === "--")) ||
		(verb === "branch" && args.some((token) => token.value === "-D"))
	) {
		addFinding(state, {
			code: "repository-history-destruction",
			outcome: "DENY",
			reason: "command discards repository state or force-deletes local history",
			resource: state.workspaceRoot,
		});
	}
}

function detectRemoteMutation(commandName: string, args: readonly ShellToken[], state: AnalysisState): void {
	const rawValues = args.map((token) => token.value);
	const values = rawValues.map((value) => value.toLowerCase());
	const firstVerb = values.find((value) => !value.startsWith("-"));
	let remote = false;
	if (["npm", "pnpm", "yarn"].includes(commandName) && values.includes("publish")) remote = true;
	if (commandName === "docker" && values.some((value) => ["push", "login", "context"].includes(value))) remote = true;
	if (commandName === "kubectl" && values.some((value) => ["apply", "create", "delete", "patch", "replace", "rollout", "scale", "set"].includes(value))) remote = true;
	if (commandName === "terraform" && values.some((value) => ["apply", "destroy", "import"].includes(value))) remote = true;
	if (commandName === "gh" && ["release", "repo", "pr"].includes(firstVerb ?? "") && values.some((value) => ["create", "delete", "merge"].includes(value))) remote = true;
	if (commandName === "curl") {
		for (let index = 0; index < rawValues.length; index += 1) {
			const value = rawValues[index]!;
			if (["-d", "-F", "-T", "--data", "--data-binary", "--data-raw", "--form", "--upload-file"].includes(value) ||
				/^(?:--data(?:-binary|-raw)?|--form|--upload-file)=/.test(value)) remote = true;
			if (value === "-X" || value === "--request") {
				const method = (rawValues[index + 1] ?? "").toUpperCase();
				if (method && !["GET", "HEAD", "OPTIONS"].includes(method)) remote = true;
			}
			const joinedMethod = value.match(/^(?:-X|--request=)(.+)$/)?.[1]?.toUpperCase();
			if (joinedMethod && !["GET", "HEAD", "OPTIONS"].includes(joinedMethod)) remote = true;
		}
	}
	if (commandName === "wget" && rawValues.some((value) =>
		/^(?:--method=(?!GET|HEAD|OPTIONS)|--post-data(?:=|$)|--post-file(?:=|$))/i.test(value)
	)) remote = true;
	if (["aws", "az", "gcloud"].includes(commandName) && values.some((value) =>
		["apply", "create", "delete", "deploy", "destroy", "publish", "put", "remove", "rm", "set", "update"].includes(value)
	)) remote = true;
	if (remote) {
		addFinding(state, {
			code: "remote-mutation",
			outcome: "HUMAN",
			reason: "command may mutate an external service and is human-only",
			resource: `remote:${commandName}`,
		});
	}
}

function detectHardline(commandName: string, args: readonly ShellToken[], normalized: string, state: AnalysisState): void {
	if (commandName === "mkfs" || commandName.startsWith("mkfs.") || ["wipefs", "fdisk", "parted"].includes(commandName)) {
		addFinding(state, {
			code: "hardline-device-write",
			outcome: "DENY",
			reason: "filesystem or partition-table destruction is never delegated",
			resource: "device:block",
		});
	}
	if (commandName === "dd" && args.some((token) => /^of=\/dev\/(?:sd|nvme|hd|mmcblk|vd|xvd)/i.test(token.value))) {
		addFinding(state, {
			code: "hardline-device-write",
			outcome: "DENY",
			reason: "raw block-device writes are never delegated",
			resource: "device:block",
		});
	}
	if (["halt", "poweroff", "reboot", "shutdown", "telinit"].includes(commandName) ||
		(commandName === "systemctl" && args.some((token) => ["halt", "kexec", "poweroff", "reboot"].includes(token.value)))) {
		addFinding(state, {
			code: "hardline-host-control",
			outcome: "DENY",
			reason: "host shutdown or reboot is never delegated",
			resource: "host:power",
		});
	}
	if ((commandName === "kill" && args.some((token) => token.value === "-1")) || /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*}\s*;\s*:/.test(normalized)) {
		addFinding(state, {
			code: "hardline-denial-of-service",
			outcome: "DENY",
			reason: "system-wide process kill or fork bomb is never delegated",
			resource: "host:processes",
		});
	}
	if (/\b(?:curl|wget)\b[^\n|]*\|\s*(?:bash|dash|ksh|sh|zsh)\b/i.test(normalized) ||
		/\b(?:base16|base32|base64)\b[^\n|]*(?:--decode|-d)[^\n|]*\|\s*(?:bash|dash|ksh|sh|zsh)\b/i.test(normalized) ||
		/\b(?:bash|dash|ksh|sh|zsh)\b[^\n]*<\s*\(\s*(?:curl|wget)\b/i.test(normalized)) {
		addFinding(state, {
			code: "remote-code-execution",
			outcome: "DENY",
			reason: "piping remote or encoded content into a shell is never delegated",
			resource: "shell:remote-code",
		});
	}
}

function analyzeNested(command: string, state: AnalysisState, depth: number): void {
	if (depth > state.maxNesting) {
		addFinding(state, {
			code: "parser-limit",
			outcome: "DENY",
			reason: `nested command depth exceeds ${state.maxNesting}`,
		});
		return;
	}
	const normalized = normalizeCommand(command);
	if (normalized.hadNull) {
		addFinding(state, {
			code: "malformed-shell",
			outcome: "DENY",
			reason: "command contains a null byte",
		});
	}
	if (normalized.text.length > state.maxCommandLength) {
		addFinding(state, {
			code: "parser-limit",
			outcome: "DENY",
			reason: `command length exceeds ${state.maxCommandLength}`,
		});
		return;
	}
	const parsed = parseShell(normalized.text);
	const hardlineText = deobfuscateDetectionText(maskQuotedProse(normalized.text));
	state.metrics.characters += normalized.text.length;
	state.metrics.segments += parsed.segments.length;
	state.metrics.tokens += parsed.tokenCount;
	state.metrics.maxNesting = Math.max(state.metrics.maxNesting, depth + parsed.maxNesting);
	if (parsed.segments.length > state.maxSegments || state.metrics.segments > state.maxSegments ||
		parsed.tokenCount > state.maxTokens || state.metrics.tokens > state.maxTokens ||
		parsed.maxNesting + depth > state.maxNesting) {
		addFinding(state, {
			code: "parser-limit",
			outcome: "DENY",
			reason: "command shape exceeds parser complexity budget",
		});
		return;
	}
	for (const reason of parsed.malformed) {
		addFinding(state, { code: "malformed-shell", outcome: "DENY", reason });
	}

	for (const segment of parsed.segments) {
		detectEnvironmentTampering(segment, state);
		detectEnvSplitExecution(segment, state, depth);
		const view = commandView(segment);
		if (!view.command) continue;
		if (view.sudo) {
			addFinding(state, {
				code: "privilege-escalation",
				outcome: "DENY",
				reason: "privilege escalation is not available to delegated Workers",
				resource: "host:privilege",
			});
		}
		if (view.command.dynamic) {
			addFinding(state, {
				code: "dynamic-command-word",
				outcome: "DENY",
				reason: "the executable name is constructed dynamically and cannot be classified safely",
			});
			continue;
		}
		const commandName = basename(view.command.value).toLowerCase();
		detectPolicyTampering(segment, commandName, view.args, state);
		detectEmbeddedPolicyReference(segment, commandName, state);
		detectHardline(commandName, view.args, hardlineText, state);
		if (commandName === "rm") detectRm(view.args, state);
		if (commandName === "busybox" && view.args.length > 0) {
			analyzeNested(view.args.map((token) => token.value).join(" "), state, depth + 1);
		}
		if (commandName === "git") detectGit(view.args, state);
		detectRemoteMutation(commandName, view.args, state);

		if (commandName === "eval") {
			addFinding(state, {
				code: "dynamic-command-word",
				outcome: "DENY",
				reason: "eval constructs executable shell syntax dynamically",
			});
		}
		if (SHELL_CARRIERS.has(commandName) && view.args.some((token) => /^-[^-]*c/.test(token.value))) {
			addFinding(state, {
				code: "nested-shell",
				outcome: "REVIEW",
				reason: "nested shell execution requires exact review of the payload",
				resource: `shell:${commandName}`,
			});
			const flagIndex = view.args.findIndex((token) => /^-[^-]*c/.test(token.value));
			const payloadIndex = view.args[flagIndex + 1]?.value === "--" ? flagIndex + 2 : flagIndex + 1;
			const payload = view.args[payloadIndex];
			if (!payload || payload.dynamic) {
				addFinding(state, {
					code: "dynamic-command-word",
					outcome: "DENY",
					reason: "nested shell payload is missing or dynamically constructed",
				});
			} else {
				analyzeNested(payload.value, state, depth + 1);
			}
		}
		if (INLINE_INTERPRETERS.has(commandName) && view.args.some((token) => ["-c", "-e", "--eval"].includes(token.value))) {
			addFinding(state, {
				code: "dynamic-code-execution",
				outcome: "REVIEW",
				reason: "inline interpreter code can bypass shell-string classification",
				resource: `interpreter:${commandName}`,
			});
		}
		if (commandName === "find" && view.args.some((token) => token.value === "-delete" || token.value === "-exec")) {
			const roots = view.args.filter((token) => !token.value.startsWith("-")).slice(0, 1);
			if (roots.length === 0) roots.push({ value: ".", dynamic: false });
			for (const root of roots) {
				const path = root.dynamic ? undefined : expandPolicyPath(root.value, state);
				if (root.dynamic || !path || !isWithin(path, state.workspaceRoot)) {
					addFinding(state, {
						code: "external-filesystem-mutation",
						outcome: "DENY",
						reason: "find destructive root is dynamic or outside the Worker worktree",
						resource: path,
					});
				} else if (path === state.workspaceRoot) {
					addFinding(state, {
						code: "workspace-root-destruction",
						outcome: "DENY",
						reason: "find destructive action would traverse the Worker worktree root",
						resource: path,
					});
				} else {
					addFinding(state, {
						code: "recursive-delete",
						outcome: "REVIEW",
						reason: "find destructive actions require bounded review",
						resource: path,
					});
				}
			}
			const execIndex = view.args.findIndex((token) => token.value === "-exec");
			if (execIndex >= 0 && view.args[execIndex + 1]) {
				analyzeNested(view.args.slice(execIndex + 1).map((token) => token.value).join(" "), state, depth + 1);
			}
		}
		if (commandName === "xargs") {
			const nestedIndex = view.args.findIndex((token) => !token.value.startsWith("-"));
			if (nestedIndex >= 0) {
				const nestedCommand = view.args.slice(nestedIndex).map((token) => token.value).join(" ");
				if (basename(view.args[nestedIndex]!.value).toLowerCase() === "rm") {
					addFinding(state, {
						code: "recursive-delete",
						outcome: "DENY",
						reason: "xargs supplies deletion targets dynamically and cannot be bounded safely",
						resource: state.cwd,
					});
				}
				analyzeNested(nestedCommand, state, depth + 1);
			}
		}
		if ((view.command.value.startsWith("./") || view.command.value.startsWith("../") || /\.(?:bash|sh|zsh)$/.test(view.command.value)) && !SHELL_CARRIERS.has(commandName)) {
			addFinding(state, {
				code: "dynamic-code-execution",
				outcome: "REVIEW",
				reason: "executing a Worker-controlled local program requires exact review",
				resource: expandPolicyPath(view.command.value, state),
			});
		}
	}
	for (const subcommand of parsed.subcommands) {
		addFinding(state, {
			code: "command-substitution",
			outcome: "REVIEW",
			reason: "command substitution executes a nested command before the outer command",
		});
		analyzeNested(subcommand, state, depth + 1);
	}
}

function normalizedOptions(options: CommandAnalysisOptions): AnalysisState {
	const workspaceRoot = requireAbsolutePath("workspaceRoot", options.workspaceRoot);
	const cwd = requireAbsolutePath("cwd", options.cwd);
	if (!isWithin(cwd, workspaceRoot)) throw new Error("cwd must be inside workspaceRoot");
	const workspaceAliases = [...(options.workspaceAliases ?? DEFAULT_WORKSPACE_ALIASES)].map((path, index) =>
		requireAbsolutePath(`workspaceAliases[${index}]`, path)
	);
	const protectedPaths = [resolve(workspaceRoot, ".git"), ...(options.protectedPaths ?? []).map((path) =>
		isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path)
	)];
	return {
		workspaceRoot,
		cwd,
		workspaceAliases,
		protectedPaths: [...new Set(protectedPaths)],
		protectedEnvironmentVariables: new Set([
			...DEFAULT_PROTECTED_ENVIRONMENT_VARIABLES,
			...(options.protectedEnvironmentVariables ?? []),
		]),
		maxCommandLength: requirePositiveInteger("maxCommandLength", options.maxCommandLength ?? DEFAULT_MAX_COMMAND_LENGTH),
		maxSegments: requirePositiveInteger("maxSegments", options.maxSegments ?? DEFAULT_MAX_SEGMENTS),
		maxTokens: requirePositiveInteger("maxTokens", options.maxTokens ?? DEFAULT_MAX_TOKENS),
		maxNesting: requirePositiveInteger("maxNesting", options.maxNesting ?? DEFAULT_MAX_NESTING),
		findings: [],
		metrics: { characters: 0, segments: 0, tokens: 0, maxNesting: 0 },
	};
}

export function analyzeCommand(command: string, options: CommandAnalysisOptions): CommandAnalysis {
	if (typeof command !== "string") throw new Error("command must be a string");
	const state = normalizedOptions(options);
	analyzeNested(command, state, 0);
	const resources = [...new Set(state.findings.flatMap((finding) => finding.resource ? [finding.resource] : []))].sort();
	return {
		version: 1,
		commandDigest: sha256(`mypi-command-v1\0${command}`),
		workspaceRoot: state.workspaceRoot,
		cwd: state.cwd,
		findings: state.findings,
		resources,
		recommendedOutcome: outcomeFor(state.findings),
		metrics: state.metrics,
	};
}

function validateRequest(request: CommandPolicyRequest, analysis: CommandAnalysis): string[] {
	const reasons: string[] = [];
	for (const key of ["workerId", "sessionId", "mandateId", "profileId", "policyVersion"] as const) {
		const value = request[key];
		if (!value || !IDENTIFIER_PATTERN.test(value)) reasons.push(`invalid ${key}`);
	}
	let workspaceRoot: string | undefined;
	let cwd: string | undefined;
	try {
		workspaceRoot = requireAbsolutePath("workspaceRoot", request.workspaceRoot);
		cwd = requireAbsolutePath("cwd", request.cwd);
	} catch (error) {
		reasons.push(String(error));
	}
	if (workspaceRoot !== analysis.workspaceRoot) reasons.push("workspaceRoot does not match analysis");
	if (cwd !== analysis.cwd) reasons.push("cwd does not match analysis");
	return reasons;
}

function reviewBindingDigest(
	request: CommandPolicyRequest,
	analysis: CommandAnalysis,
	metadata: { grantId: string; issuedAt: string; expiresAt: string },
): string {
	return sha256(JSON.stringify({
		version: 1,
		grantId: metadata.grantId,
		issuedAt: metadata.issuedAt,
		expiresAt: metadata.expiresAt,
		commandDigest: analysis.commandDigest,
		workerId: request.workerId,
		sessionId: request.sessionId,
		mandateId: request.mandateId,
		profileId: request.profileId,
		policyVersion: request.policyVersion,
		workspaceRoot: analysis.workspaceRoot,
		cwd: analysis.cwd,
		findingCodes: [...new Set(analysis.findings.map((finding) => finding.code))].sort(),
		resources: analysis.resources,
	}));
}

export function createCommandReviewGrant(
	request: CommandPolicyRequest,
	analysis: CommandAnalysis,
	input: { grantId: string; issuedAt: string; expiresAt: string },
): CommandReviewGrant {
	const requestErrors = validateRequest(request, analysis);
	if (requestErrors.length > 0) throw new Error(`invalid command review request: ${requestErrors.join(", ")}`);
	if (analysis.recommendedOutcome !== "REVIEW") {
		throw new Error(`review grants can cover REVIEW only, received ${analysis.recommendedOutcome}`);
	}
	if (!IDENTIFIER_PATTERN.test(input.grantId)) throw new Error("grantId must be a non-empty identifier");
	const issuedAtMs = Date.parse(input.issuedAt);
	const expiresAtMs = Date.parse(input.expiresAt);
	if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) {
		throw new Error("review grant timestamps are invalid");
	}
	if (expiresAtMs - issuedAtMs > MAX_REVIEW_GRANT_TTL_MS) throw new Error("review grant TTL exceeds 15 minutes");
	const issuedAt = new Date(issuedAtMs).toISOString();
	const expiresAt = new Date(expiresAtMs).toISOString();
	return {
		version: 1,
		grantId: input.grantId,
		bindingDigest: reviewBindingDigest(request, analysis, { grantId: input.grantId, issuedAt, expiresAt }),
		commandDigest: analysis.commandDigest,
		workerId: request.workerId,
		sessionId: request.sessionId,
		mandateId: request.mandateId,
		profileId: request.profileId,
		policyVersion: request.policyVersion,
		workspaceRoot: analysis.workspaceRoot,
		cwd: analysis.cwd,
		findingCodes: [...new Set(analysis.findings.map((finding) => finding.code))].sort(),
		resources: [...analysis.resources],
		issuedAt,
		expiresAt,
	};
}

export function verifyCommandReviewGrant(
	request: CommandPolicyRequest,
	analysis: CommandAnalysis,
	grant: CommandReviewGrant,
	now: string,
): { valid: boolean; reasons: string[] } {
	const reasons = validateRequest(request, analysis);
	if (grant.version !== 1) reasons.push("unsupported grant version");
	if (analysis.recommendedOutcome !== "REVIEW") reasons.push("analysis is not reviewable");
	if (grant.bindingDigest !== reviewBindingDigest(request, analysis, {
		grantId: grant.grantId,
		issuedAt: grant.issuedAt,
		expiresAt: grant.expiresAt,
	})) reasons.push("binding digest mismatch");
	if (grant.commandDigest !== analysis.commandDigest) reasons.push("command digest mismatch");
	const expectedFindingCodes = [...new Set(analysis.findings.map((finding) => finding.code))].sort();
	if (JSON.stringify(grant.findingCodes) !== JSON.stringify(expectedFindingCodes)) reasons.push("finding codes mismatch");
	if (JSON.stringify(grant.resources) !== JSON.stringify(analysis.resources)) reasons.push("resources mismatch");
	for (const key of ["workerId", "sessionId", "mandateId", "profileId", "policyVersion", "workspaceRoot", "cwd"] as const) {
		if (grant[key] !== (key === "workspaceRoot" ? analysis.workspaceRoot : key === "cwd" ? analysis.cwd : request[key])) {
			reasons.push(`${key} mismatch`);
		}
	}
	const nowMs = Date.parse(now);
	const issuedAtMs = Date.parse(grant.issuedAt);
	const expiresAtMs = Date.parse(grant.expiresAt);
	if (!Number.isFinite(nowMs)) reasons.push("invalid current time");
	if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) reasons.push("invalid grant timestamps");
	if (Number.isFinite(nowMs) && Number.isFinite(issuedAtMs) && nowMs < issuedAtMs) reasons.push("grant is not active yet");
	if (Number.isFinite(nowMs) && Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs) reasons.push("grant expired");
	if (Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs - issuedAtMs > MAX_REVIEW_GRANT_TTL_MS) {
		reasons.push("grant TTL exceeds 15 minutes");
	}
	return { valid: reasons.length === 0, reasons };
}

export function resolveCommandPolicy(
	request: CommandPolicyRequest,
	analysis: CommandAnalysis,
	options: { grant?: CommandReviewGrant; now: string },
): CommandPolicyDecision {
	const requestErrors = validateRequest(request, analysis);
	if (requestErrors.length > 0) {
		return { outcome: "DENY", executionAllowed: false, reviewed: false, reasons: requestErrors };
	}
	if (analysis.recommendedOutcome === "ALLOW") {
		return { outcome: "ALLOW", executionAllowed: true, reviewed: false, reasons: [] };
	}
	if (analysis.recommendedOutcome === "DENY" || analysis.recommendedOutcome === "HUMAN") {
		return {
			outcome: analysis.recommendedOutcome,
			executionAllowed: false,
			reviewed: false,
			reasons: analysis.findings
				.filter((finding) => finding.outcome === analysis.recommendedOutcome)
				.map((finding) => finding.reason),
		};
	}
	if (!options.grant) {
		return {
			outcome: "REVIEW",
			executionAllowed: false,
			reviewed: false,
			reasons: analysis.findings.filter((finding) => finding.outcome === "REVIEW").map((finding) => finding.reason),
		};
	}
	const verification = verifyCommandReviewGrant(request, analysis, options.grant, options.now);
	if (!verification.valid) {
		return { outcome: "REVIEW", executionAllowed: false, reviewed: false, reasons: verification.reasons };
	}
	return {
		outcome: "ALLOW",
		executionAllowed: true,
		reviewed: true,
		grantId: options.grant.grantId,
		reasons: [],
	};
}
