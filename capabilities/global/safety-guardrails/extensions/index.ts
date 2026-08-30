import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGuardrailAuditKey, guardrailDecisionDigest, recordGuardrailAudit } from "./audit.ts";
import { analyzeToolCall, type MutationFinding } from "./detector.ts";
import {
	clearGuardrailDenial,
	createGuardrailSessionState,
	hasActiveGuardrailGrant,
	isGuardrailCircuitOpen,
	issueGuardrailSessionGrant,
	manualGuardrailResolver,
	recordGuardrailDenial,
	resetGuardrailSessionState,
	type GuardrailCategory,
	type GuardrailPolicyResolver,
	type GuardrailResolution,
	type GuardrailResolutionRequest,
} from "./resolution.ts";
import { displayGuardrailFinding, guardrailSessionDirectoryKey, renderGuardrailHumanDecision } from "./ui.ts";
import { assertWorkspaceExecutionCwd, createWorkspaceAuthority, type WorkspaceAuthority } from "./workspace.ts";

export * from "./audit.ts";
export * from "./detector.ts";
export * from "./resolution.ts";
export * from "./ui.ts";
export * from "./workspace.ts";

export type GuardrailToolContract = "fetch-content" | "shell" | "path-aware" | "remote-mutation";

export type GuardrailsOptions = {
	resolver?: GuardrailPolicyResolver;
	/** Trusted immutable root. Otherwise the nearest Git root or launch cwd is frozen at session start. */
	workspaceRoot?: string;
	/** Explicit semantics for custom tools whose names/descriptions are insufficient to classify safely. */
	toolContracts?: Readonly<Record<string, GuardrailToolContract>>;
	/** Additional trusted absolute roots. Default temporary access is otherwise session-private. */
	allowedWriteRoots?: readonly string[];
	/** Clock injection for deterministic grant expiry and audit tests. */
	now?: () => string;
};

function nonInteractiveReason(category: GuardrailCategory, findings: readonly MutationFinding[]): string {
	const summary = findings.map(displayGuardrailFinding).join("\n\n");
	if (category === "external-upload") return `Blocked local file upload in non-interactive mode.\n${summary}`;
	if (category === "secret-read") return `Blocked secret file read in non-interactive mode.\n${summary}`;
	if (category === "remote-mutation") return `Blocked external service mutation in non-interactive mode.\n${summary}`;
	return `Blocked external file mutation in non-interactive mode.\n${summary}`;
}

async function resolveGuardrailStage(input: {
	pi: Pick<ExtensionAPI, "events">;
	ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;
	resolver: GuardrailPolicyResolver;
	category: GuardrailCategory;
	findings: readonly MutationFinding[];
	workspaceRoot: string;
	cwd: string;
}): Promise<GuardrailResolution> {
	const request: GuardrailResolutionRequest = Object.freeze({
		category: input.category,
		findings: Object.freeze(input.findings.map((finding) => Object.freeze({ ...finding }))),
		workspaceRoot: input.workspaceRoot,
		cwd: input.cwd,
		hasUI: input.ctx.hasUI,
	});
	let policy: GuardrailResolution;
	try {
		policy = await input.resolver.resolve(request);
	} catch (error) {
		return { outcome: "DENY", reason: `guardrail policy resolver failed closed: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (!policy || !["ALLOW_ONCE", "ALLOW_SESSION", "DENY", "HUMAN"].includes(policy.outcome) || typeof policy.reason !== "string") {
		return { outcome: "DENY", reason: "guardrail policy resolver returned an invalid decision" };
	}
	if (input.category === "remote-mutation" && policy.outcome === "ALLOW_SESSION") {
		return { outcome: "DENY", reason: "session-wide external service mutation authority is forbidden" };
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
	let workspaceAuthority: WorkspaceAuthority | undefined;
	let workspaceAuthorityError: string | undefined;
	let sessionTemporaryRoot: string | undefined;
	let allowedWriteRoots: readonly string[] = [];
	let auditKey = createGuardrailAuditKey();
	const now = () => options.now?.() ?? new Date().toISOString();

	const recordGrantReuse = (input: {
		category: Exclude<GuardrailCategory, "remote-mutation">;
		findings: readonly MutationFinding[];
		workspaceRoot: string;
		cwd: string;
	}): void => {
		if (input.findings.length === 0) return;
		const decisionDigest = guardrailDecisionDigest(auditKey, input.category, input.findings, input.workspaceRoot, input.cwd);
		recordGuardrailAudit(auditKey, pi, { category: input.category, outcome: "GRANT_REUSED", decisionDigest, findingKinds: input.findings.map((finding) => finding.kind), workspaceRoot: input.workspaceRoot, cwd: input.cwd, at: now() });
	};

	const resolveAuditedStage = async (input: {
		ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;
		category: GuardrailCategory;
		findings: readonly MutationFinding[];
		workspaceRoot: string;
		cwd: string;
	}): Promise<GuardrailResolution> => {
		const decisionDigest = guardrailDecisionDigest(auditKey, input.category, input.findings, input.workspaceRoot, input.cwd);
		if (isGuardrailCircuitOpen(state, decisionDigest)) {
			recordGuardrailAudit(auditKey, pi, { category: input.category, outcome: "CIRCUIT_BREAKER", decisionDigest, findingKinds: input.findings.map((finding) => finding.kind), workspaceRoot: input.workspaceRoot, cwd: input.cwd, at: now() });
			return { outcome: "DENY", reason: "repeated denial circuit breaker is open for this exact action" };
		}
		const decision = await resolveGuardrailStage({ pi, ctx: input.ctx, resolver, category: input.category, findings: input.findings, workspaceRoot: input.workspaceRoot, cwd: input.cwd });
		if (decision.outcome === "DENY") recordGuardrailDenial(state, decisionDigest);
		else clearGuardrailDenial(state, decisionDigest);
		recordGuardrailAudit(auditKey, pi, { category: input.category, outcome: decision.outcome, decisionDigest, findingKinds: input.findings.map((finding) => finding.kind), workspaceRoot: input.workspaceRoot, cwd: input.cwd, at: now() });
		return decision;
	};

	pi.on("session_start", (_event, ctx) => {
		resetGuardrailSessionState(state);
		auditKey = createGuardrailAuditKey();
		try {
			workspaceAuthority = createWorkspaceAuthority(ctx.cwd, options.workspaceRoot);
			for (const root of options.allowedWriteRoots ?? []) if (!isAbsolute(root)) throw new Error("allowedWriteRoots must contain only absolute paths");
			if (sessionTemporaryRoot) rmSync(sessionTemporaryRoot, { recursive: true, force: true });
			sessionTemporaryRoot = mkdtempSync(join(tmpdir(), "mypi-guardrails-"));
			chmodSync(sessionTemporaryRoot, 0o700);
			allowedWriteRoots = Object.freeze([...(options.allowedWriteRoots ?? []), sessionTemporaryRoot]);
			workspaceAuthorityError = undefined;
		} catch (error) {
			workspaceAuthority = undefined;
			if (sessionTemporaryRoot) rmSync(sessionTemporaryRoot, { recursive: true, force: true });
			sessionTemporaryRoot = undefined;
			allowedWriteRoots = [];
			workspaceAuthorityError = error instanceof Error ? error.message : String(error);
		}
		fetchContentToolNames.clear();
		fetchContentToolNames.add("fetch_content");
		for (const [name, contract] of Object.entries(options.toolContracts ?? {})) {
			if (contract === "fetch-content") fetchContentToolNames.add(name);
		}
		for (const tool of pi.getAllTools()) {
			const description = tool.description.toLowerCase();
			if (description.includes("fetch url(s) and extract readable content") && description.includes("local video")) {
				fetchContentToolNames.add(tool.name);
			}
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		try {
			if (workspaceAuthorityError) return { block: true, reason: `Guardrail workspace authority failed closed: ${workspaceAuthorityError}` };
			workspaceAuthority ??= createWorkspaceAuthority(ctx.cwd, options.workspaceRoot);
			const executionCwd = assertWorkspaceExecutionCwd(workspaceAuthority, ctx.cwd);
			const input = event.input as Record<string, unknown>;
			const contract = options.toolContracts?.[event.toolName];
			const policyToolName = fetchContentToolNames.has(event.toolName) ? "fetch_content" : contract === "shell" ? "bash" : event.toolName;
			const policyInput = contract === "shell" ? { command: input.command ?? input.cmd } : input;
			if (contract === "shell" && typeof policyInput.command !== "string") {
				return { block: true, reason: `Guardrail shell contract for ${event.toolName} has no inspectable command` };
			}
			const findings = contract === "remote-mutation"
				? [{ kind: "remote-mutation" as const, reason: `${event.toolName} is declared as an external service mutation` }]
				: analyzeToolCall(policyToolName, policyInput, executionCwd, workspaceAuthority.workspaceRoot, allowedWriteRoots);
			if (findings.length === 0) return;

		const approvedUploadsThisCall = new Set<string>();
		const reusedUploadFindings: MutationFinding[] = [];
		let approvedRemoteMutationThisCall = false;
		const pendingUploads = findings.filter((finding) => {
			if (finding.kind !== "external-upload") return false;
			if (finding.target && hasActiveGuardrailGrant(state, "external-upload", finding.target, now())) {
				approvedUploadsThisCall.add(finding.target);
				reusedUploadFindings.push(finding);
				return false;
			}
			return true;
		});
		recordGrantReuse({ category: "external-upload", findings: reusedUploadFindings, workspaceRoot: workspaceAuthority.workspaceRoot, cwd: executionCwd });
		if (pendingUploads.length > 0) {
			const uploadTargets = new Set(pendingUploads.map((finding) => finding.target).filter((target): target is string => Boolean(target)));
			const uploadStageFindings = findings.filter((finding) =>
				pendingUploads.includes(finding) || finding.kind === "remote-mutation" ||
				(finding.kind === "secret-read" && finding.target !== undefined && uploadTargets.has(finding.target)));
			const decision = await resolveAuditedStage({ ctx, category: "external-upload", findings: uploadStageFindings, workspaceRoot: workspaceAuthority.workspaceRoot, cwd: executionCwd });
			if (decision.outcome === "DENY") return { block: true, reason: blockedReason("external-upload", decision, uploadStageFindings) };
			approvedRemoteMutationThisCall = uploadStageFindings.some((finding) => finding.kind === "remote-mutation");
			for (const finding of pendingUploads) {
				if (!finding.target) continue;
				approvedUploadsThisCall.add(finding.target);
				if (decision.outcome === "ALLOW_SESSION") issueGuardrailSessionGrant(state, { category: "external-upload", resource: finding.target, scope: "exact-file", now: now() });
			}
		}

		const reusedSecretFindings: MutationFinding[] = [];
		const pendingSecretReads = findings.filter((finding) => {
			if (finding.kind !== "secret-read") return false;
			if (finding.target && hasActiveGuardrailGrant(state, "secret-read", finding.target, now())) {
				reusedSecretFindings.push(finding);
				return false;
			}
			return !finding.target || !approvedUploadsThisCall.has(finding.target);
		});
		recordGrantReuse({ category: "secret-read", findings: reusedSecretFindings, workspaceRoot: workspaceAuthority.workspaceRoot, cwd: executionCwd });
		if (pendingSecretReads.length > 0) {
			const decision = await resolveAuditedStage({ ctx, category: "secret-read", findings: pendingSecretReads, workspaceRoot: workspaceAuthority.workspaceRoot, cwd: executionCwd });
			if (decision.outcome === "DENY") return { block: true, reason: blockedReason("secret-read", decision, pendingSecretReads) };
			if (decision.outcome === "ALLOW_SESSION") {
				for (const finding of pendingSecretReads) if (finding.target) issueGuardrailSessionGrant(state, { category: "secret-read", resource: finding.target, scope: "exact-file", now: now() });
			}
		}

		const remoteMutations = approvedRemoteMutationThisCall ? [] : findings.filter((finding) => finding.kind === "remote-mutation");
		if (remoteMutations.length > 0) {
			const decision = await resolveAuditedStage({ ctx, category: "remote-mutation", findings: remoteMutations, workspaceRoot: workspaceAuthority.workspaceRoot, cwd: executionCwd });
			if (decision.outcome === "DENY") return { block: true, reason: blockedReason("remote-mutation", decision, remoteMutations) };
		}

		const reusedMutationFindings: MutationFinding[] = [];
		const pendingMutations = findings.filter((finding) => {
			if (finding.kind === "secret-read" || finding.kind === "external-upload" || finding.kind === "remote-mutation") return false;
			const key = guardrailSessionDirectoryKey(finding);
			if (key && hasActiveGuardrailGrant(state, "external-mutation", key, now())) {
				reusedMutationFindings.push(finding);
				return false;
			}
			return true;
		});
		recordGrantReuse({ category: "external-mutation", findings: reusedMutationFindings, workspaceRoot: workspaceAuthority.workspaceRoot, cwd: executionCwd });
		if (pendingMutations.length === 0) return;
		const decision = await resolveAuditedStage({ ctx, category: "external-mutation", findings: pendingMutations, workspaceRoot: workspaceAuthority.workspaceRoot, cwd: executionCwd });
		if (decision.outcome === "DENY") return { block: true, reason: blockedReason("external-mutation", decision, pendingMutations) };
		if (decision.outcome === "ALLOW_SESSION") {
			for (const finding of pendingMutations) {
				const key = guardrailSessionDirectoryKey(finding);
				if (key) issueGuardrailSessionGrant(state, { category: "external-mutation", resource: key, scope: "exact-directory", now: now() });
			}
		}
		} catch (error) {
			return { block: true, reason: `Guardrail detection failed closed: ${error instanceof Error ? error.message : String(error)}` };
		}
	});

	pi.on("session_shutdown", () => {
		if (sessionTemporaryRoot) rmSync(sessionTemporaryRoot, { recursive: true, force: true });
		sessionTemporaryRoot = undefined;
		allowedWriteRoots = [];
		workspaceAuthority = undefined;
	});
}

export default function guardrails(pi: ExtensionAPI): void {
	registerGuardrails(pi);
}
