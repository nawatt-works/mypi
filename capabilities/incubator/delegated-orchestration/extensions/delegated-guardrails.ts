import { registerGuardrails } from "@nawatt-works/mypi-safety-guardrails";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDelegatedPolicyResolver, type DelegatedPolicyResolver } from "./delegated-policy-resolver.ts";
import type { CommandReviewRegistry } from "./command-review-registry.ts";
import type { PolicyLayers } from "./orchestration-policy.ts";
import type { AuthorityRegistry } from "./orchestration-registry.ts";

/**
 * Explicit composition seam for the future production entrypoint. It is not a
 * Pi auto-loaded extension: the caller must supply Coordinator-owned authority
 * and review registries, preventing an ambient Worker setting from selecting a
 * resolver or carrying a grant.
 */
export function registerDelegatedGuardrails(input: {
	pi: ExtensionAPI;
	authority: AuthorityRegistry;
	reviews: CommandReviewRegistry;
	layers?: PolicyLayers;
	now?: () => string;
}): DelegatedPolicyResolver {
	const resolver = createDelegatedPolicyResolver({
		authority: input.authority,
		reviews: input.reviews,
		layers: input.layers,
		now: input.now,
	});
	registerGuardrails(input.pi, { resolver });
	return resolver;
}
