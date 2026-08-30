import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDelegatedGuardrails } from "./delegated-guardrails.ts";
import type { DelegatedPolicyResolver } from "./delegated-policy-resolver.ts";
import type { CommandReviewRegistry } from "./command-review-registry.ts";
import type { PolicyLayers } from "./orchestration-policy.ts";
import type { AuthorityRegistry } from "./orchestration-registry.ts";
import type { DelegatedWorkspaceAuthority } from "./delegated-workspace-authority.ts";
import orchestration from "./orchestration.ts";

export const DELEGATED_PRODUCTION_ENV = "MYPI_DELEGATED_AUTONOMY_PRODUCTION";

export type DelegatedProductionRegistration = Readonly<{
	activated: boolean;
	resolver?: DelegatedPolicyResolver;
}>;

export function delegatedProductionRequested(environment: NodeJS.ProcessEnv): boolean {
	const value = environment[DELEGATED_PRODUCTION_ENV];
	if (value === undefined || value === "" || value === "0") return false;
	if (value === "1") return true;
	throw new Error(`${DELEGATED_PRODUCTION_ENV} must be absent, 0, or 1`);
}

/**
 * Disabled-by-default production composition seam.
 *
 * This module is exported for an explicit isolated-profile loader and is not a
 * Pi package resource. The caller must omit the stable manual guardrail entry;
 * loading both would create two independent policy handlers.
 */
export function registerDelegatedProductionCandidate(input: {
	pi: ExtensionAPI;
	authority: AuthorityRegistry;
	reviews: CommandReviewRegistry;
	workspaces: DelegatedWorkspaceAuthority;
	manualGuardrailsLoaded: false;
	environment: NodeJS.ProcessEnv;
	layers?: PolicyLayers;
	now?: () => string;
	registerOrchestration?: (pi: ExtensionAPI) => void;
}): DelegatedProductionRegistration {
	if (!delegatedProductionRequested(input.environment)) return Object.freeze({ activated: false });
	if (input.manualGuardrailsLoaded !== false) throw new Error("delegated production requires the stable manual guardrail entry to be omitted");
	const authorityState = input.authority.state();
	if (authorityState.failClosedReason) throw new Error(`delegated production authority is fail closed: ${authorityState.failClosedReason}`);
	if (!authorityState.activeMandate) throw new Error("delegated production requires an active trusted mandate");
	if (!authorityState.profiles.some((profile) => profile.mandateId === authorityState.activeMandate?.id && profile.verified)) {
		throw new Error("delegated production requires a verified profile authority reference");
	}
	const reviewState = input.reviews.state(input.now?.());
	if (reviewState.failClosedReason) throw new Error(`delegated production review registry is fail closed: ${reviewState.failClosedReason}`);
	if (typeof input.workspaces.authorize !== "function" || typeof input.workspaces.registerVerified !== "function" ||
		typeof input.workspaces.release !== "function" || typeof input.workspaces.list !== "function" || !Array.isArray(input.workspaces.list())) {
		throw new Error("delegated production workspace authority contract is invalid");
	}
	const resolver = registerDelegatedGuardrails({
		pi: input.pi,
		authority: input.authority,
		reviews: input.reviews,
		workspaces: input.workspaces,
		layers: input.layers,
		now: input.now,
	});
	(input.registerOrchestration ?? orchestration)(input.pi);
	return Object.freeze({ activated: true, resolver });
}
