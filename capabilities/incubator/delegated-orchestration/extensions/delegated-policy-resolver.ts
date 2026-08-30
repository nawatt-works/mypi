import type {
	GuardrailPolicyResolver,
	GuardrailResolution,
	GuardrailResolutionRequest,
} from "@nawatt-works/mypi-safety-guardrails";
import {
	resolveCommandPolicy,
	type CommandAnalysis,
	type CommandPolicyDecision,
	type CommandPolicyRequest,
	type CommandReviewGrant,
} from "./command-policy.ts";
import type { CommandReviewRegistry } from "./command-review-registry.ts";
import {
	evaluateOrchestrationPolicy,
	type OrchestrationAction,
	type PolicyDecision,
	type PolicyLayers,
} from "./orchestration-policy.ts";
import type { AuthorityRegistry, OrchestrationAuthorityState } from "./orchestration-registry.ts";
import type { DelegatedWorkspaceAuthority } from "./delegated-workspace-authority.ts";

export type DelegatedPolicyResolver = GuardrailPolicyResolver & {
	issueReview(request: CommandPolicyRequest, analysis: CommandAnalysis, options?: { now?: string; ttlMs?: number }): CommandReviewGrant;
	resolveCommand(request: CommandPolicyRequest, analysis: CommandAnalysis, now?: string): CommandPolicyDecision;
};

export type DelegatedPolicyResolverOptions = {
	authority: AuthorityRegistry;
	reviews: CommandReviewRegistry;
	workspaces: DelegatedWorkspaceAuthority;
	layers?: PolicyLayers;
	now?: () => string;
};

function authorityState(authority: AuthorityRegistry): OrchestrationAuthorityState {
	const state = authority.state();
	if (state.failClosedReason) throw new Error(`delegated authority is fail closed: ${state.failClosedReason}`);
	if (!state.activeMandate) throw new Error("delegated policy resolver requires an active mandate");
	return state;
}

function mutationAction(request: GuardrailResolutionRequest, state: OrchestrationAuthorityState): OrchestrationAction {
	const mandate = state.activeMandate!;
	const common = { mandateId: mandate.id, authorityCwd: mandate.cwd };
	if (request.category === "external-upload") return { ...common, kind: "upload", target: "local-file" };
	if (request.category === "secret-read") return { ...common, kind: "secret", operation: "read" };
	if (request.category === "remote-mutation") return { ...common, kind: "external-mutation", category: "push-deploy-publish" };
	return { ...common, kind: "filesystem", operation: "write", targetScope: "external" };
}

function guardrailDecision(decision: PolicyDecision): GuardrailResolution {
	if (decision.outcome === "ALLOW") return { outcome: "ALLOW_ONCE", reason: decision.reason };
	if (decision.outcome === "HUMAN") return { outcome: "DENY", reason: `human-only escalation required: ${decision.reason}` };
	if (decision.outcome === "REVIEW") {
		// Mutation findings have no exact-context grant schema. A command REVIEW
		// must use resolveCommand() and the trusted consume-once command registry.
		return { outcome: "DENY", reason: "mutation REVIEW has no trusted exact-context grant registry" };
	}
	return { outcome: "DENY", reason: decision.reason };
}

function policyCommandAction(request: CommandPolicyRequest, analysis: CommandAnalysis, state: OrchestrationAuthorityState): OrchestrationAction {
	return {
		kind: "command",
		mandateId: request.mandateId,
		authorityCwd: state.activeMandate!.cwd,
		workerId: request.workerId,
		analyzerOutcome: analysis.recommendedOutcome,
		findingCodes: analysis.findings.map((finding) => finding.code),
	};
}

function effectiveReviewAnalysis(analysis: CommandAnalysis, policy: PolicyDecision): CommandAnalysis {
	if (analysis.recommendedOutcome === "REVIEW") return analysis;
	if (policy.outcome !== "REVIEW") throw new Error("policy does not require Coordinator review");
	return {
		...analysis,
		findings: [...analysis.findings, {
			code: "policy-review",
			outcome: "REVIEW",
			reason: `trusted policy layer requires review: ${policy.reason}`,
		}],
		recommendedOutcome: "REVIEW",
	};
}

function blockedCommand(decision: PolicyDecision): CommandPolicyDecision {
	return {
		outcome: decision.outcome,
		executionAllowed: false,
		reviewed: false,
		reasons: [decision.reason],
	};
}

export function createDelegatedPolicyResolver(options: DelegatedPolicyResolverOptions): DelegatedPolicyResolver {
	const now = () => options.now?.() ?? new Date().toISOString();
	return Object.freeze({
		resolve(request) {
			try {
				const state = authorityState(options.authority);
				const decision = evaluateOrchestrationPolicy({
					mandate: state.activeMandate,
					action: mutationAction(request, state),
					layers: options.layers,
					now: now(),
				});
				const result = guardrailDecision(decision);
				options.authority.recordAudit({
					type: result.outcome === "ALLOW_ONCE" ? "verification" : "worker-blocked",
					actor: "system",
					outcome: decision.outcome,
					details: {
						category: request.category,
						findingKinds: [...new Set(request.findings.map((finding) => finding.kind))].sort(),
						policyDigest: decision.policyDigest,
						source: decision.source,
					},
				}, now());
				return result;
			} catch (error) {
				return { outcome: "DENY", reason: `delegated policy resolution failed closed: ${error instanceof Error ? error.message : String(error)}` };
			}
		},

		issueReview(request, analysis, issueOptions = {}) {
			const at = issueOptions.now ?? now();
			const state = authorityState(options.authority);
			const workspace = options.workspaces.authorize(request, state);
			if (!workspace.authorized) throw new Error(`delegated workspace authority denied review: ${workspace.reason}`);
			const policy = evaluateOrchestrationPolicy({
				mandate: state.activeMandate,
				action: policyCommandAction(request, analysis, state),
				layers: options.layers,
				now: at,
			});
			if (policy.outcome !== "REVIEW") throw new Error(`cannot issue delegated review for ${policy.outcome}`);
			return options.reviews.issue(request, effectiveReviewAnalysis(analysis, policy), {
				now: at,
				...(issueOptions.ttlMs === undefined ? {} : { ttlMs: issueOptions.ttlMs }),
			});
		},

		resolveCommand(request, analysis, nowValue) {
			const at = nowValue ?? now();
			let state: OrchestrationAuthorityState;
			try {
				state = authorityState(options.authority);
			} catch (error) {
				return { outcome: "DENY", executionAllowed: false, reviewed: false, reasons: [`delegated command resolution failed closed: ${String(error)}`] };
			}
			const workspace = options.workspaces.authorize(request, state);
			if (!workspace.authorized) {
				return { outcome: "DENY", executionAllowed: false, reviewed: false, reasons: [`delegated workspace authority denied command: ${workspace.reason}`] };
			}
			const policy = evaluateOrchestrationPolicy({
				mandate: state.activeMandate,
				action: policyCommandAction(request, analysis, state),
				layers: options.layers,
				now: at,
			});
			if (policy.outcome === "DENY" || policy.outcome === "HUMAN") {
				try {
					options.authority.recordAudit({
						type: "worker-blocked",
						actor: "system",
						workerId: request.workerId,
						outcome: policy.outcome,
						actionDigest: analysis.commandDigest,
						details: { findingCodes: analysis.findings.map((finding) => finding.code).sort(), source: policy.source },
					}, at);
					return blockedCommand(policy);
				} catch (error) {
					return { outcome: "DENY", executionAllowed: false, reviewed: false, reasons: [`blocked-command audit failed closed: ${String(error)}`] };
				}
			}
			if (policy.outcome === "ALLOW") return resolveCommandPolicy(request, analysis, { now: at });
			try {
				const reviewAnalysis = effectiveReviewAnalysis(analysis, policy);
				const decision = options.reviews.consume(request, reviewAnalysis, at);
				if (decision.executionAllowed && decision.reviewed) {
					options.authority.recordAudit({
						type: "review-grant-consumed",
						actor: "coordinator",
						workerId: request.workerId,
						outcome: "ALLOW",
						actionDigest: reviewAnalysis.commandDigest,
						details: { grantId: decision.grantId, findingCodes: reviewAnalysis.findings.map((finding) => finding.code).sort() },
					}, at);
				} else {
					options.authority.recordAudit({
						type: "worker-blocked",
						actor: "system",
						workerId: request.workerId,
						outcome: decision.outcome,
						actionDigest: reviewAnalysis.commandDigest,
						details: { findingCodes: reviewAnalysis.findings.map((finding) => finding.code).sort(), reviewGrantMatched: false },
					}, at);
				}
				return decision;
			} catch (error) {
				return { outcome: "DENY", executionAllowed: false, reviewed: false, reasons: [`exact REVIEW consumption failed closed: ${String(error)}`] };
			}
		},
	});
}
