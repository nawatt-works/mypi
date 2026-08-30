import { createHmac, randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MutationFinding } from "./detector.ts";
import type { GuardrailCategory, GuardrailResolutionOutcome } from "./resolution.ts";

export type GuardrailAuditKey = Buffer;

export function createGuardrailAuditKey(): GuardrailAuditKey {
	return randomBytes(32);
}

function digest(key: GuardrailAuditKey, value: string): string {
	return createHmac("sha256", key).update(`mypi-guardrail-audit-v1\0${value}`).digest("hex");
}

export function guardrailDecisionDigest(
	key: GuardrailAuditKey,
	category: GuardrailCategory,
	findings: readonly MutationFinding[],
	workspaceRoot: string,
	cwd: string,
): string {
	const normalized = findings.map((finding) => ({
		kind: finding.kind,
		target: finding.target ? digest(key, finding.target) : undefined,
		targetExpression: finding.targetExpression ? digest(key, finding.targetExpression) : undefined,
		detail: finding.detail ? digest(key, finding.detail) : undefined,
	})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	return digest(key, JSON.stringify({ category, workspaceRoot: digest(key, workspaceRoot), cwd: digest(key, cwd), findings: normalized }));
}

export function recordGuardrailAudit(
	key: GuardrailAuditKey,
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
		workspaceRootDigest: digest(key, entry.workspaceRoot),
		cwdDigest: digest(key, entry.cwd),
		at: entry.at,
	});
	pi.events.emit("mypi:guardrail-decision", redacted);
	pi.appendEntry?.("mypi-guardrail-decision-v1", redacted);
}
