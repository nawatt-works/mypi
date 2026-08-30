import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { analyzeToolCall, type MutationFinding } from "./detector.ts";
import {
	createGuardrailSessionState,
	manualGuardrailResolver,
	resetGuardrailSessionState,
	type GuardrailCategory,
	type GuardrailPolicyResolver,
	type GuardrailResolution,
	type GuardrailResolutionRequest,
} from "./resolution.ts";
import { displayGuardrailFinding, guardrailSessionDirectoryKey, renderGuardrailHumanDecision } from "./ui.ts";

export * from "./detector.ts";
export * from "./resolution.ts";
export * from "./ui.ts";

export type GuardrailsOptions = {
	resolver?: GuardrailPolicyResolver;
};

function nonInteractiveReason(category: GuardrailCategory, findings: readonly MutationFinding[]): string {
	const summary = findings.map(displayGuardrailFinding).join("\n\n");
	if (category === "external-upload") return `Blocked local file upload in non-interactive mode.\n${summary}`;
	if (category === "secret-read") return `Blocked secret file read in non-interactive mode.\n${summary}`;
	return `Blocked external file mutation in non-interactive mode.\n${summary}`;
}

async function resolveGuardrailStage(input: {
	pi: Pick<ExtensionAPI, "events">;
	ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;
	resolver: GuardrailPolicyResolver;
	category: GuardrailCategory;
	findings: readonly MutationFinding[];
}): Promise<GuardrailResolution> {
	const request: GuardrailResolutionRequest = Object.freeze({
		category: input.category,
		findings: Object.freeze(input.findings.map((finding) => Object.freeze({ ...finding }))),
		cwd: input.ctx.cwd,
		hasUI: input.ctx.hasUI,
	});
	const policy = await input.resolver.resolve(request);
	if (!policy || !["ALLOW_ONCE", "ALLOW_SESSION", "DENY", "HUMAN"].includes(policy.outcome) || typeof policy.reason !== "string") {
		return { outcome: "DENY", reason: "guardrail policy resolver returned an invalid decision" };
	}
	if (policy.outcome === "DENY" && !input.ctx.hasUI && input.resolver === manualGuardrailResolver) {
		return { outcome: "DENY", reason: nonInteractiveReason(input.category, input.findings) };
	}
	if (policy.outcome !== "HUMAN") return policy;
	if (!input.ctx.hasUI) return { outcome: "DENY", reason: nonInteractiveReason(input.category, input.findings) };
	return renderGuardrailHumanDecision(input.pi, input.ctx, request);
}

function blockedReason(category: GuardrailCategory, decision: GuardrailResolution, findings: readonly MutationFinding[]): string {
	if (decision.reason.startsWith("User rejected") || decision.reason.startsWith("Blocked ")) return decision.reason;
	const summary = findings.map(displayGuardrailFinding).join("\n\n");
	return `Guardrail policy denied ${category}: ${decision.reason}\n${summary}`;
}

export function registerGuardrails(pi: ExtensionAPI, options: GuardrailsOptions = {}): void {
	const resolver = options.resolver ?? manualGuardrailResolver;
	const state = createGuardrailSessionState();
	const fetchContentToolNames = new Set(["fetch_content"]);

	pi.on("session_start", () => {
		resetGuardrailSessionState(state);
		fetchContentToolNames.clear();
		fetchContentToolNames.add("fetch_content");
		for (const tool of pi.getAllTools()) {
			const description = tool.description.toLowerCase();
			if (description.includes("fetch url(s) and extract readable content") && description.includes("local video")) {
				fetchContentToolNames.add(tool.name);
			}
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		const policyToolName = fetchContentToolNames.has(event.toolName) ? "fetch_content" : event.toolName;
		const findings = analyzeToolCall(policyToolName, event.input as Record<string, unknown>, ctx.cwd);
		if (findings.length === 0) return;

		const approvedUploadsThisCall = new Set<string>();
		const pendingUploads = findings.filter((finding) => {
			if (finding.kind !== "external-upload") return false;
			if (finding.target && state.allowedUploadFiles.has(finding.target)) {
				approvedUploadsThisCall.add(finding.target);
				return false;
			}
			return true;
		});
		if (pendingUploads.length > 0) {
			const decision = await resolveGuardrailStage({ pi, ctx, resolver, category: "external-upload", findings: pendingUploads });
			if (decision.outcome === "DENY") return { block: true, reason: blockedReason("external-upload", decision, pendingUploads) };
			for (const finding of pendingUploads) {
				if (!finding.target) continue;
				approvedUploadsThisCall.add(finding.target);
				if (decision.outcome === "ALLOW_SESSION") state.allowedUploadFiles.add(finding.target);
			}
		}

		const pendingSecretReads = findings.filter((finding) => finding.kind === "secret-read" &&
			(!finding.target || (!state.allowedSecretFiles.has(finding.target) && !approvedUploadsThisCall.has(finding.target))));
		if (pendingSecretReads.length > 0) {
			const decision = await resolveGuardrailStage({ pi, ctx, resolver, category: "secret-read", findings: pendingSecretReads });
			if (decision.outcome === "DENY") return { block: true, reason: blockedReason("secret-read", decision, pendingSecretReads) };
			if (decision.outcome === "ALLOW_SESSION") {
				for (const finding of pendingSecretReads) if (finding.target) state.allowedSecretFiles.add(finding.target);
			}
		}

		const pendingMutations = findings.filter((finding) => {
			if (finding.kind === "secret-read" || finding.kind === "external-upload") return false;
			const key = guardrailSessionDirectoryKey(finding);
			return !key || !state.allowedDirectories.has(key);
		});
		if (pendingMutations.length === 0) return;
		const decision = await resolveGuardrailStage({ pi, ctx, resolver, category: "external-mutation", findings: pendingMutations });
		if (decision.outcome === "DENY") return { block: true, reason: blockedReason("external-mutation", decision, pendingMutations) };
		if (decision.outcome === "ALLOW_SESSION") {
			for (const finding of pendingMutations) {
				const key = guardrailSessionDirectoryKey(finding);
				if (key) state.allowedDirectories.add(key);
			}
		}
	});
}

export default function guardrails(pi: ExtensionAPI): void {
	registerGuardrails(pi);
}
