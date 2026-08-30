import type { MutationFinding } from "./detector.ts";

export type GuardrailCategory = "external-upload" | "secret-read" | "external-mutation";
export type GuardrailResolutionOutcome = "ALLOW_ONCE" | "ALLOW_SESSION" | "DENY" | "HUMAN";

export type GuardrailResolutionRequest = Readonly<{
	category: GuardrailCategory;
	findings: readonly MutationFinding[];
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

export type GuardrailSessionState = {
	allowedDirectories: Set<string>;
	allowedSecretFiles: Set<string>;
	allowedUploadFiles: Set<string>;
};

export function createGuardrailSessionState(): GuardrailSessionState {
	return {
		allowedDirectories: new Set<string>(),
		allowedSecretFiles: new Set<string>(),
		allowedUploadFiles: new Set<string>(),
	};
}

export function resetGuardrailSessionState(state: GuardrailSessionState): void {
	state.allowedDirectories.clear();
	state.allowedSecretFiles.clear();
	state.allowedUploadFiles.clear();
}

/** Default Pi behavior remains interactive and human-owned. */
export const manualGuardrailResolver: GuardrailPolicyResolver = Object.freeze({
	resolve(request) {
		return request.hasUI
			? { outcome: "HUMAN", reason: "manual guardrail mode requires an explicit user decision" }
			: { outcome: "DENY", reason: `${request.category} is blocked in non-interactive mode` };
	},
});
