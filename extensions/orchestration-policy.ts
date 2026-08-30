import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

export const ORCHESTRATION_POLICY_VERSION = "delegated-v1";
export const MAX_CONCURRENT_WORKERS = 3;
export const MAX_AGENT_LAUNCHES = 32;

export type PolicyOutcome = "ALLOW" | "REVIEW" | "HUMAN" | "DENY";
export type HumanOnlyBoundary =
	| "architecture-change"
	| "scope-expansion"
	| "security-tradeoff"
	| "external-destructive"
	| "push-deploy-publish";

export type DelegationMandate = {
	version: 1;
	id: string;
	cwd: string;
	goal: string;
	definitionOfDone: string[];
	allowedHarnesses: string[];
	maxConcurrentWorkers: number;
	maxAgentLaunches?: number;
	writePolicy: "worktree-only" | "read-only";
	shellNetwork: "deny" | { allowDomains: string[] };
	secrets: "deny";
	uploads: "deny";
	humanOnly: HumanOnlyBoundary[];
	createdAt: string;
	expiresAt?: string;
};

export type MandateValidation =
	| { ok: true; value: DelegationMandate }
	| { ok: false; errors: string[] };

export type ActionContext = {
	mandateId: string;
	authorityCwd: string;
	workerId?: string;
};

export type OrchestrationAction =
	| (ActionContext & {
		kind: "spawn";
		harness: string;
		writing: boolean;
		concurrentWorkers: number;
		agentLaunches: number;
	})
	| (ActionContext & {
		kind: "filesystem";
		operation: "read" | "write";
		targetScope: "worktree" | "harness-temp" | "external" | "secret";
	})
	| (ActionContext & { kind: "shell-network"; domain?: string })
	| (ActionContext & { kind: "secret"; operation: "read" | "write" })
	| (ActionContext & { kind: "upload"; target: "local-file" })
	| (ActionContext & {
		kind: "external-mutation";
		category: "push-deploy-publish" | "external-destructive" | "remote-code-execution" | "other";
	})
	| (ActionContext & { kind: "decision"; category: HumanOnlyBoundary })
	| (ActionContext & { kind: "command"; analyzerOutcome: PolicyOutcome; findingCodes: string[] })
	| (ActionContext & { kind: "routine"; capability: string });

export type PolicyConstraint = {
	version: string;
	decisions?: Partial<Record<OrchestrationAction["kind"], PolicyOutcome>>;
	defaultOutcome?: PolicyOutcome;
	reason: string;
};

export type PolicyLayers = {
	global?: PolicyConstraint;
	trustedProject?: PolicyConstraint;
	workerProfile?: PolicyConstraint;
	task?: PolicyConstraint;
};

export type PolicyTrace = {
	source: "hard-deny" | "global" | "trusted-project" | "mandate" | "worker-profile" | "task";
	outcome: PolicyOutcome;
	reason: string;
	version?: string;
	applied: boolean;
};

export type PolicyDecision = {
	outcome: PolicyOutcome;
	executionAllowed: boolean;
	reviewableByCoordinator: boolean;
	requiresHuman: boolean;
	source: PolicyTrace["source"];
	reason: string;
	policyVersion: string;
	policyDigest?: string;
	mandateDigest?: string;
	trace: PolicyTrace[];
};

const HUMAN_BOUNDARIES = new Set<HumanOnlyBoundary>([
	"architecture-change",
	"scope-expansion",
	"security-tradeoff",
	"external-destructive",
	"push-deploy-publish",
]);
const OUTCOME_RANK: Record<PolicyOutcome, number> = { ALLOW: 0, REVIEW: 1, HUMAN: 2, DENY: 3 };
const MANDATE_KEYS = new Set([
	"version", "id", "cwd", "goal", "definitionOfDone", "allowedHarnesses", "maxConcurrentWorkers",
	"maxAgentLaunches", "writePolicy", "shellNetwork", "secrets", "uploads", "humanOnly", "createdAt", "expiresAt",
]);
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|token|secret|password|credential|cookie|private[_-]?key)/i;
const SENSITIVE_FLAG = /^(?:--?(?:api[-_]?key|token|password|secret|credential|authorization)|--header)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown, label: string, errors: string[], opts: { min?: number; max?: number } = {}): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		errors.push(`${label} must be an array of strings`);
		return [];
	}
	const values = value.map((item) => item.trim());
	if (values.some((item) => item.length === 0)) errors.push(`${label} contains an empty value`);
	if (new Set(values).size !== values.length) errors.push(`${label} contains duplicate values`);
	if (opts.min !== undefined && values.length < opts.min) errors.push(`${label} must contain at least ${opts.min} item(s)`);
	if (opts.max !== undefined && values.length > opts.max) errors.push(`${label} must contain at most ${opts.max} item(s)`);
	return values;
}

function parseIso(value: unknown, label: string, errors: string[]): string | undefined {
	if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
		errors.push(`${label} must be an ISO timestamp`);
		return undefined;
	}
	return new Date(value).toISOString();
}

function normalizeDomain(value: string): string | null {
	const domain = value.trim().toLowerCase().replace(/\.$/, "");
	if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(domain)) return null;
	return domain;
}

export function validateMandate(input: unknown, options: { now?: string } = {}): MandateValidation {
	const errors: string[] = [];
	if (!isRecord(input)) return { ok: false, errors: ["mandate must be an object"] };
	const unknownKeys = Object.keys(input).filter((key) => !MANDATE_KEYS.has(key));
	if (unknownKeys.length) errors.push(`mandate contains unknown keys: ${unknownKeys.sort().join(",")}`);
	if (input.version !== 1) errors.push("mandate version must be 1");
	if (typeof input.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(input.id)) errors.push("mandate id is invalid");
	if (typeof input.cwd !== "string" || !isAbsolute(input.cwd)) errors.push("mandate cwd must be absolute");
	if (typeof input.goal !== "string" || input.goal.trim().length < 1 || input.goal.length > 2_000) errors.push("mandate goal is invalid");
	const definitionOfDone = uniqueStrings(input.definitionOfDone, "definitionOfDone", errors, { min: 1, max: 32 });
	const allowedHarnesses = uniqueStrings(input.allowedHarnesses, "allowedHarnesses", errors, { min: 1, max: 16 });
	if (allowedHarnesses.some((item) => !/^[a-z][a-z0-9-]{0,31}$/.test(item))) errors.push("allowedHarnesses contains an invalid harness id");
	if (!Number.isSafeInteger(input.maxConcurrentWorkers) || Number(input.maxConcurrentWorkers) < 1 || Number(input.maxConcurrentWorkers) > MAX_CONCURRENT_WORKERS) {
		errors.push(`maxConcurrentWorkers must be an integer from 1 to ${MAX_CONCURRENT_WORKERS}`);
	}
	if (input.maxAgentLaunches !== undefined &&
		(!Number.isSafeInteger(input.maxAgentLaunches) || Number(input.maxAgentLaunches) < Number(input.maxConcurrentWorkers) || Number(input.maxAgentLaunches) > MAX_AGENT_LAUNCHES)) {
		errors.push(`maxAgentLaunches must be an integer from maxConcurrentWorkers to ${MAX_AGENT_LAUNCHES}`);
	}
	if (input.writePolicy !== "worktree-only" && input.writePolicy !== "read-only") errors.push("writePolicy is invalid");
	let shellNetwork: DelegationMandate["shellNetwork"] = "deny";
	if (input.shellNetwork === "deny") {
		shellNetwork = "deny";
	} else if (isRecord(input.shellNetwork) && Object.keys(input.shellNetwork).length === 1 && "allowDomains" in input.shellNetwork) {
		const rawDomains = uniqueStrings(input.shellNetwork.allowDomains, "shellNetwork.allowDomains", errors, { min: 1, max: 64 });
		const normalized = rawDomains.map(normalizeDomain);
		if (normalized.some((domain) => domain === null)) errors.push("shellNetwork.allowDomains contains an invalid exact domain");
		const domains = normalized.filter((domain): domain is string => domain !== null);
		if (new Set(domains).size !== domains.length) errors.push("shellNetwork.allowDomains contains duplicate normalized domains");
		shellNetwork = { allowDomains: domains };
	} else {
		errors.push("shellNetwork must be deny or an exact allowDomains object");
	}
	if (input.secrets !== "deny") errors.push("secrets must be deny");
	if (input.uploads !== "deny") errors.push("uploads must be deny");
	const humanOnlyRaw = uniqueStrings(input.humanOnly, "humanOnly", errors, { max: HUMAN_BOUNDARIES.size });
	if (humanOnlyRaw.some((item) => !HUMAN_BOUNDARIES.has(item as HumanOnlyBoundary))) errors.push("humanOnly contains an invalid boundary");
	const createdAt = parseIso(input.createdAt, "createdAt", errors);
	const expiresAt = input.expiresAt === undefined ? undefined : parseIso(input.expiresAt, "expiresAt", errors);
	const now = Date.parse(options.now ?? new Date().toISOString());
	if (!Number.isFinite(now)) errors.push("validation now must be an ISO timestamp");
	if (createdAt && Number.isFinite(now) && Date.parse(createdAt) > now + 5 * 60_000) errors.push("mandate createdAt is in the future");
	if (createdAt && expiresAt && Date.parse(expiresAt) <= Date.parse(createdAt)) errors.push("expiresAt must be later than createdAt");
	if (expiresAt && Number.isFinite(now) && Date.parse(expiresAt) <= now) errors.push("mandate is stale");
	if (errors.length) return { ok: false, errors };

	return {
		ok: true,
		value: {
			version: 1,
			id: input.id as string,
			cwd: resolve(input.cwd as string),
			goal: (input.goal as string).trim(),
			definitionOfDone,
			allowedHarnesses,
			maxConcurrentWorkers: input.maxConcurrentWorkers as number,
			...(input.maxAgentLaunches === undefined ? {} : { maxAgentLaunches: input.maxAgentLaunches as number }),
			writePolicy: input.writePolicy as DelegationMandate["writePolicy"],
			shellNetwork,
			secrets: "deny",
			uploads: "deny",
			humanOnly: humanOnlyRaw as HumanOnlyBoundary[],
			createdAt: createdAt as string,
			...(expiresAt ? { expiresAt } : {}),
		},
	};
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function mandateDigest(mandate: DelegationMandate): string {
	return createHash("sha256").update(JSON.stringify(canonicalize(mandate))).digest("hex");
}

function mandateDecision(mandate: DelegationMandate, action: OrchestrationAction): { outcome: PolicyOutcome; reason: string } {
	if (action.mandateId !== mandate.id || resolve(action.authorityCwd) !== mandate.cwd) {
		return { outcome: "DENY", reason: "action context does not match the active mandate" };
	}
	switch (action.kind) {
		case "spawn": {
			if (!mandate.allowedHarnesses.includes(action.harness)) return { outcome: "DENY", reason: "harness is outside the mandate" };
			if (!Number.isSafeInteger(action.concurrentWorkers) || action.concurrentWorkers < 0 || action.concurrentWorkers >= mandate.maxConcurrentWorkers) {
				return { outcome: "DENY", reason: "concurrent Worker ceiling reached" };
			}
			const launchLimit = mandate.maxAgentLaunches ?? MAX_AGENT_LAUNCHES;
			if (!Number.isSafeInteger(action.agentLaunches) || action.agentLaunches < 0 || action.agentLaunches >= launchLimit) {
				return { outcome: "DENY", reason: "agent launch ceiling reached" };
			}
			if (action.writing && mandate.writePolicy === "read-only") return { outcome: "DENY", reason: "mandate is read-only" };
			return { outcome: "ALLOW", reason: "spawn is within mandate ceilings" };
		}
		case "filesystem":
			if (action.targetScope === "secret") return { outcome: "DENY", reason: "secret paths are denied" };
			if (action.targetScope === "external") return { outcome: "DENY", reason: "external filesystem access is denied" };
			if (action.operation === "write" && mandate.writePolicy === "read-only") return { outcome: "DENY", reason: "mandate is read-only" };
			return { outcome: "ALLOW", reason: "filesystem operation is inside the Worker boundary" };
		case "shell-network":
			if (mandate.shellNetwork === "deny") return { outcome: "DENY", reason: "shell network is denied" };
			if (!action.domain) return { outcome: "DENY", reason: "network destination is unknown" };
			return mandate.shellNetwork.allowDomains.includes(action.domain.toLowerCase().replace(/\.$/, ""))
				? { outcome: "ALLOW", reason: "network domain is exactly allowlisted" }
				: { outcome: "DENY", reason: "network domain is outside the exact allowlist" };
		case "secret":
			return { outcome: "DENY", reason: "secrets are denied" };
		case "upload":
			return { outcome: "DENY", reason: "local-file uploads are denied" };
		case "external-mutation": {
			if (action.category === "remote-code-execution") return { outcome: "DENY", reason: "remote code execution is hard denied" };
			const boundary = action.category === "other" ? null : action.category;
			return boundary && mandate.humanOnly.includes(boundary)
				? { outcome: "HUMAN", reason: `${boundary} is reserved for the user` }
				: { outcome: "DENY", reason: "external mutation is not authorized by the mandate" };
		}
		case "decision":
			return mandate.humanOnly.includes(action.category)
				? { outcome: "HUMAN", reason: `${action.category} is reserved for the user` }
				: { outcome: "DENY", reason: "the mandate does not authorize this decision" };
		case "command":
			return { outcome: action.analyzerOutcome, reason: `trusted command analyzer returned ${action.analyzerOutcome}` };
		case "routine":
			return { outcome: "ALLOW", reason: `routine capability ${action.capability} is inside the mandate` };
	}
}

export function validateOrchestrationAction(action: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(action)) return ["action must be an object"];
	if (typeof action.mandateId !== "string" || !action.mandateId) errors.push("action mandateId is invalid");
	if (typeof action.authorityCwd !== "string" || !isAbsolute(action.authorityCwd)) errors.push("action authorityCwd must be absolute");
	const kind = action.kind;
	if (!["spawn", "filesystem", "shell-network", "secret", "upload", "external-mutation", "decision", "command", "routine"].includes(String(kind))) {
		errors.push("action kind is invalid");
		return errors;
	}
	if (kind === "spawn") {
		if (typeof action.harness !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(action.harness)) errors.push("spawn harness is invalid");
		if (typeof action.writing !== "boolean") errors.push("spawn writing must be boolean");
		for (const field of ["concurrentWorkers", "agentLaunches"] as const) {
			if (!Number.isSafeInteger(action[field]) || Number(action[field]) < 0) errors.push(`spawn ${field} is invalid`);
		}
	} else if (kind === "filesystem") {
		if (action.operation !== "read" && action.operation !== "write") errors.push("filesystem operation is invalid");
		if (!["worktree", "harness-temp", "external", "secret"].includes(String(action.targetScope))) errors.push("filesystem targetScope is invalid");
	} else if (kind === "shell-network") {
		if (action.domain !== undefined && (typeof action.domain !== "string" || normalizeDomain(action.domain) === null)) errors.push("shell-network domain is invalid");
	} else if (kind === "secret") {
		if (action.operation !== "read" && action.operation !== "write") errors.push("secret operation is invalid");
	} else if (kind === "upload") {
		if (action.target !== "local-file") errors.push("upload target is invalid");
	} else if (kind === "external-mutation") {
		if (!["push-deploy-publish", "external-destructive", "remote-code-execution", "other"].includes(String(action.category))) errors.push("external mutation category is invalid");
	} else if (kind === "decision") {
		if (!HUMAN_BOUNDARIES.has(action.category as HumanOnlyBoundary)) errors.push("decision category is invalid");
	} else if (kind === "command") {
		if (!["ALLOW", "REVIEW", "HUMAN", "DENY"].includes(String(action.analyzerOutcome))) errors.push("command analyzerOutcome is invalid");
		if (!Array.isArray(action.findingCodes) || !action.findingCodes.every((item) => typeof item === "string")) errors.push("command findingCodes is invalid");
	} else if (kind === "routine") {
		if (typeof action.capability !== "string" || !action.capability.trim()) errors.push("routine capability is invalid");
	}
	return errors;
}

function hardDecision(action: OrchestrationAction): { outcome: "DENY"; reason: string } | null {
	if (action.kind === "secret" || action.kind === "upload") return { outcome: "DENY", reason: `${action.kind} is hard denied` };
	if (action.kind === "filesystem" && action.targetScope === "secret") return { outcome: "DENY", reason: "secret filesystem access is hard denied" };
	if (action.kind === "external-mutation" && action.category === "remote-code-execution") {
		return { outcome: "DENY", reason: "remote code execution is hard denied" };
	}
	if (action.kind === "command" && action.analyzerOutcome === "DENY") return { outcome: "DENY", reason: "command hardline deny" };
	return null;
}

function decisionForLayer(layer: PolicyConstraint | undefined, kind: OrchestrationAction["kind"]): PolicyOutcome | undefined {
	return layer?.decisions?.[kind] ?? layer?.defaultOutcome;
}

function validatePolicyLayer(layer: PolicyConstraint | undefined, label: string): string[] {
	if (!layer) return [];
	const errors: string[] = [];
	if (typeof layer.version !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(layer.version)) errors.push(`${label} version is invalid`);
	if (typeof layer.reason !== "string" || !layer.reason.trim() || layer.reason.length > 1_000) errors.push(`${label} reason is invalid`);
	if (layer.defaultOutcome !== undefined && !["ALLOW", "REVIEW", "HUMAN", "DENY"].includes(layer.defaultOutcome)) errors.push(`${label} defaultOutcome is invalid`);
	if (layer.decisions !== undefined) {
		if (!isRecord(layer.decisions)) errors.push(`${label} decisions must be an object`);
		else {
			for (const [kind, outcome] of Object.entries(layer.decisions)) {
				if (!["spawn", "filesystem", "shell-network", "secret", "upload", "external-mutation", "decision", "command", "routine"].includes(kind) ||
					!["ALLOW", "REVIEW", "HUMAN", "DENY"].includes(String(outcome))) errors.push(`${label} decision ${kind} is invalid`);
			}
		}
	}
	return errors;
}

function resolvedPolicyDigest(mandateHash: string, layers: PolicyLayers): string {
	return createHash("sha256").update(JSON.stringify(canonicalize({
		policyVersion: ORCHESTRATION_POLICY_VERSION,
		mandateDigest: mandateHash,
		layers,
	}))).digest("hex");
}

export function evaluateOrchestrationPolicy(input: {
	mandate: unknown;
	action: OrchestrationAction;
	layers?: PolicyLayers;
	now?: string;
}): PolicyDecision {
	const validated = validateMandate(input.mandate, { now: input.now });
	const actionErrors = validateOrchestrationAction(input.action);
	const layers = input.layers ?? {};
	const layerErrors = [
		...validatePolicyLayer(layers.global, "global policy"),
		...validatePolicyLayer(layers.trustedProject, "trusted project policy"),
		...validatePolicyLayer(layers.workerProfile, "Worker profile"),
		...validatePolicyLayer(layers.task, "task policy"),
	];
	if (!validated.ok || actionErrors.length > 0 || layerErrors.length > 0) {
		return {
			outcome: "DENY",
			executionAllowed: false,
			reviewableByCoordinator: false,
			requiresHuman: false,
			source: "mandate",
			reason: `invalid policy request: ${[...(validated.ok ? [] : validated.errors), ...actionErrors, ...layerErrors].join("; ")}`,
			policyVersion: ORCHESTRATION_POLICY_VERSION,
			trace: [{ source: "mandate", outcome: "DENY", reason: [...(validated.ok ? [] : validated.errors), ...actionErrors, ...layerErrors].join("; "), applied: true }],
		};
	}
	const mandate = validated.value;
	const mandateHash = mandateDigest(mandate);
	const policyHash = resolvedPolicyDigest(mandateHash, layers);
	const hard = hardDecision(input.action);
	if (hard) {
		return {
			outcome: "DENY",
			executionAllowed: false,
			reviewableByCoordinator: false,
			requiresHuman: false,
			source: "hard-deny",
			reason: hard.reason,
			policyVersion: ORCHESTRATION_POLICY_VERSION,
			policyDigest: policyHash,
			mandateDigest: mandateHash,
			trace: [{ source: "hard-deny", outcome: "DENY", reason: hard.reason, version: ORCHESTRATION_POLICY_VERSION, applied: true }],
		};
	}

	let outcome: PolicyOutcome = "ALLOW";
	let source: PolicyTrace["source"] = "mandate";
	let reason = "default allow pending mandate evaluation";
	const trace: PolicyTrace[] = [];
	let winnerSet = false;
	const apply = (nextSource: PolicyTrace["source"], nextOutcome: PolicyOutcome | undefined, nextReason: string, version?: string) => {
		if (!nextOutcome) return;
		const applied = !winnerSet || OUTCOME_RANK[nextOutcome] > OUTCOME_RANK[outcome];
		trace.push({ source: nextSource, outcome: nextOutcome, reason: nextReason, ...(version ? { version } : {}), applied });
		if (applied) {
			winnerSet = true;
			outcome = nextOutcome;
			source = nextSource;
			reason = nextReason;
		}
	};
	apply("global", decisionForLayer(layers.global, input.action.kind), layers.global?.reason ?? "global policy", layers.global?.version);
	apply("trusted-project", decisionForLayer(layers.trustedProject, input.action.kind), layers.trustedProject?.reason ?? "trusted project policy", layers.trustedProject?.version);
	const mandateResult = mandateDecision(mandate, input.action);
	apply("mandate", mandateResult.outcome, mandateResult.reason, mandateHash);
	apply("worker-profile", decisionForLayer(layers.workerProfile, input.action.kind), layers.workerProfile?.reason ?? "Worker profile", layers.workerProfile?.version);
	apply("task", decisionForLayer(layers.task, input.action.kind), layers.task?.reason ?? "task-local policy", layers.task?.version);

	return {
		outcome,
		executionAllowed: outcome === "ALLOW",
		reviewableByCoordinator: outcome === "REVIEW",
		requiresHuman: outcome === "HUMAN",
		source,
		reason,
		policyVersion: ORCHESTRATION_POLICY_VERSION,
		policyDigest: policyHash,
		mandateDigest: mandateHash,
		trace,
	};
}

export function mandateNarrows(previous: DelegationMandate, next: DelegationMandate): { narrows: boolean; expansions: string[] } {
	const expansions: string[] = [];
	if (next.cwd !== previous.cwd) expansions.push("cwd");
	if (next.goal !== previous.goal) expansions.push("goal");
	if (JSON.stringify(next.definitionOfDone) !== JSON.stringify(previous.definitionOfDone)) expansions.push("definitionOfDone");
	if (next.allowedHarnesses.some((harness) => !previous.allowedHarnesses.includes(harness))) expansions.push("allowedHarnesses");
	if (next.maxConcurrentWorkers > previous.maxConcurrentWorkers) expansions.push("maxConcurrentWorkers");
	const previousLaunches = previous.maxAgentLaunches ?? MAX_AGENT_LAUNCHES;
	const nextLaunches = next.maxAgentLaunches ?? MAX_AGENT_LAUNCHES;
	if (nextLaunches > previousLaunches) expansions.push("maxAgentLaunches");
	if (previous.writePolicy === "read-only" && next.writePolicy === "worktree-only") expansions.push("writePolicy");
	if (previous.shellNetwork === "deny" && next.shellNetwork !== "deny") expansions.push("shellNetwork");
	if (previous.shellNetwork !== "deny" && next.shellNetwork !== "deny" &&
		next.shellNetwork.allowDomains.some((domain) => !previous.shellNetwork.allowDomains.includes(domain))) expansions.push("shellNetwork.allowDomains");
	if (next.humanOnly.some((boundary) => !previous.humanOnly.includes(boundary))) expansions.push("humanOnly");
	if (previous.expiresAt && !next.expiresAt) expansions.push("expiresAt");
	if (previous.expiresAt && next.expiresAt && Date.parse(next.expiresAt) > Date.parse(previous.expiresAt)) expansions.push("expiresAt");
	return { narrows: expansions.length === 0, expansions };
}

function redactString(value: string): string {
	return value
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
		.replace(/((?:api[_-]?key|token|secret|password|credential|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function redactLaunchArgs(args: unknown[]): unknown[] {
	const output: unknown[] = [];
	let redactNext = false;
	for (const item of args) {
		if (redactNext) {
			output.push("[REDACTED]");
			redactNext = false;
			continue;
		}
		if (typeof item !== "string") {
			output.push(redactForAudit(item));
			continue;
		}
		if (SENSITIVE_FLAG.test(item)) {
			output.push(item);
			redactNext = true;
			continue;
		}
		const assignment = item.match(/^([^=]+)=(.*)$/);
		if (assignment && SENSITIVE_KEY.test(assignment[1])) output.push(`${assignment[1]}=[REDACTED]`);
		else output.push(redactString(item));
	}
	return output;
}

export function redactForAudit(value: unknown, depth = 0): unknown {
	if (depth > 8) return "[TRUNCATED]";
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.slice(0, 256).map((item) => redactForAudit(item, depth + 1));
	if (!isRecord(value)) return value;
	const output: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort().slice(0, 256)) {
		if (SENSITIVE_KEY.test(key)) output[key] = "[REDACTED]";
		else if (key === "launchArgs" && Array.isArray(value[key])) output[key] = redactLaunchArgs(value[key]);
		else output[key] = redactForAudit(value[key], depth + 1);
	}
	return output;
}
