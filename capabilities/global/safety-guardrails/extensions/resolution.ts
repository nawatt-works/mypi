import type { MutationFinding } from "./detector.ts";

export type GuardrailCategory = "external-upload" | "secret-read" | "external-mutation" | "remote-mutation";
export type GuardrailResolutionOutcome = "ALLOW_ONCE" | "ALLOW_SESSION" | "DENY" | "HUMAN";

export type GuardrailResolutionRequest = Readonly<{
	category: GuardrailCategory;
	findings: readonly MutationFinding[];
	workspaceRoot: string;
	cwd: string;
	hasUI: boolean;
}>;

export type GuardrailResolution = Readonly<{
	outcome: GuardrailResolutionOutcome;
	reason: string;
}>;

export type GuardrailPolicyResolver = {
	resolve(request: GuardrailResolutionRequest): GuardrailResolution | Promise<GuardrailResolution>;
};

export type GuardrailSessionGrant = Readonly<{
	version: 1;
	category: Exclude<GuardrailCategory, "remote-mutation">;
	resource: string;
	scope: "exact-file" | "exact-directory";
	issuedAt: string;
	expiresAt: string;
	remainingUses: "session";
}>;

export type GuardrailSessionState = {
	grants: Map<string, GuardrailSessionGrant>;
	denialCounts: Map<string, number>;
};

export const MAX_GUARDRAIL_SESSION_GRANT_TTL_MS = 60 * 60 * 1_000;
export const GUARDRAIL_DENIAL_CIRCUIT_BREAKER = 3;

function grantKey(category: GuardrailSessionGrant["category"], resource: string): string {
	return `${category}\0${resource}`;
}

export function createGuardrailSessionState(): GuardrailSessionState {
	return {
		grants: new Map<string, GuardrailSessionGrant>(),
		denialCounts: new Map<string, number>(),
	};
}

export function resetGuardrailSessionState(state: GuardrailSessionState): void {
	state.grants.clear();
	state.denialCounts.clear();
}

export function issueGuardrailSessionGrant(
	state: GuardrailSessionState,
	input: {
		category: GuardrailSessionGrant["category"];
		resource: string;
		scope: GuardrailSessionGrant["scope"];
		now?: string;
		ttlMs?: number;
	},
): GuardrailSessionGrant {
	if (!["external-upload", "secret-read", "external-mutation"].includes(input.category)) {
		throw new Error(`guardrail grant category cannot authorize ${input.category}`);
	}
	const issuedAtMs = Date.parse(input.now ?? new Date().toISOString());
	if (!Number.isFinite(issuedAtMs)) throw new Error("guardrail grant issuedAt is invalid");
	const ttlMs = input.ttlMs ?? MAX_GUARDRAIL_SESSION_GRANT_TTL_MS;
	if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_GUARDRAIL_SESSION_GRANT_TTL_MS) {
		throw new Error(`guardrail grant ttl must be between 1 and ${MAX_GUARDRAIL_SESSION_GRANT_TTL_MS}`);
	}
	const grant = Object.freeze({
		version: 1 as const,
		category: input.category,
		resource: input.resource,
		scope: input.scope,
		issuedAt: new Date(issuedAtMs).toISOString(),
		expiresAt: new Date(issuedAtMs + ttlMs).toISOString(),
		remainingUses: "session" as const,
	});
	state.grants.set(grantKey(grant.category, grant.resource), grant);
	return grant;
}

export function hasActiveGuardrailGrant(
	state: GuardrailSessionState,
	category: GuardrailSessionGrant["category"],
	resource: string,
	now = new Date().toISOString(),
): boolean {
	const key = grantKey(category, resource);
	const grant = state.grants.get(key);
	if (!grant) return false;
	const at = Date.parse(now);
	if (!Number.isFinite(at) || at >= Date.parse(grant.expiresAt)) {
		state.grants.delete(key);
		return false;
	}
	return true;
}

export function recordGuardrailDenial(state: GuardrailSessionState, decisionDigest: string): number {
	const count = (state.denialCounts.get(decisionDigest) ?? 0) + 1;
	state.denialCounts.set(decisionDigest, count);
	return count;
}

export function clearGuardrailDenial(state: GuardrailSessionState, decisionDigest: string): void {
	state.denialCounts.delete(decisionDigest);
}

export function isGuardrailCircuitOpen(state: GuardrailSessionState, decisionDigest: string): boolean {
	return (state.denialCounts.get(decisionDigest) ?? 0) >= GUARDRAIL_DENIAL_CIRCUIT_BREAKER;
}

/** Default Pi behavior remains interactive and human-owned. */
export const manualGuardrailResolver: GuardrailPolicyResolver = Object.freeze({
	resolve(request) {
		return request.hasUI
			? { outcome: "HUMAN", reason: "manual guardrail mode requires an explicit user decision" }
			: { outcome: "DENY", reason: `${request.category} is blocked in non-interactive mode` };
	},
});
