import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MutationFinding } from "./detector.ts";
import type { GuardrailCategory, GuardrailResolutionOutcome } from "./resolution.ts";

function digest(value: string): string {
	return createHash("sha256").update(`mypi-guardrail-audit-v1\0${value}`).digest("hex");
}

export function guardrailDecisionDigest(
	category: GuardrailCategory,
	findings: readonly MutationFinding[],
	workspaceRoot: string,
	cwd: string,
): string {
	const normalized = findings.map((finding) => ({
		kind: finding.kind,
		target: finding.target ? digest(finding.target) : undefined,
		targetExpression: finding.targetExpression ? digest(finding.targetExpression) : undefined,
		detail: finding.detail ? digest(finding.detail) : undefined,
	})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	return digest(JSON.stringify({ category, workspaceRoot: digest(workspaceRoot), cwd: digest(cwd), findings: normalized }));
}

export function recordGuardrailAudit(
	pi: Pick<ExtensionAPI, "events"> & Partial<Pick<ExtensionAPI, "appendEntry">>,
	entry: {
		category: GuardrailCategory;
		outcome: GuardrailResolutionOutcome | "GRANT_REUSED" | "CIRCUIT_BREAKER";
		decisionDigest: string;
		findingKinds: readonly string[];
		workspaceRoot: string;
		cwd: string;
		at: string;
	},
): void {
	const redacted = Object.freeze({
		version: 1,
		category: entry.category,
		outcome: entry.outcome,
		decisionDigest: entry.decisionDigest,
		findingKinds: [...new Set(entry.findingKinds)].sort(),
		workspaceRootDigest: digest(entry.workspaceRoot),
		cwdDigest: digest(entry.cwd),
		at: entry.at,
	});
	pi.events.emit("mypi:guardrail-decision", redacted);
	pi.appendEntry?.("mypi-guardrail-decision-v1", redacted);
}
