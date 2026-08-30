import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withHerdrBlocked } from "@nawatt-works/mypi-herdr-integration/client";
import type { MutationFinding } from "./detector.ts";
import type { GuardrailResolution, GuardrailResolutionRequest } from "./resolution.ts";

const SESSION_ALLOW_ONCE = "Allow once";
const SESSION_ALLOW_SECRET = "Allow this secret file for this session";
const SESSION_ALLOW_UPLOAD = "Allow this file upload for this session";
const DENY = "Deny";

export function displayGuardrailFinding(finding: MutationFinding): string {
	if (finding.target) {
		const label = finding.targetLabel ?? (finding.kind === "external-upload"
			? "Local source path"
			: finding.kind === "secret-read"
				? "Sensitive file path"
				: finding.targetIsDirectory
					? "Target directory"
					: "Target path");
		return `${finding.reason}\n\n${label}: ${finding.target}`;
	}
	if (finding.targetExpression) {
		const detail = finding.detail ? `\n\n${finding.detailLabel ?? "Details"}: ${finding.detail}` : "";
		return `${finding.reason}\n\n${finding.targetLabel ?? "Requested path"} (shell expression): ${finding.targetExpression}${detail}\n\nThe exact resolved path cannot be determined before the command runs.`;
	}
	if (finding.detail) {
		const workingDirectory = finding.workingDirectory ? `\n\nWorking directory: ${finding.workingDirectory}` : "";
		return `${finding.reason}\n\n${finding.detailLabel ?? "Details"}: ${finding.detail}${workingDirectory}\n\nThe destination cannot be proven to stay inside the workspace.`;
	}
	if (finding.kind === "secret-read") return `${finding.reason}\n\nThe sensitive source could not be determined exactly.`;
	if (finding.kind === "external-upload") return `${finding.reason}\n\nThe local source could not be determined exactly.`;
	return `${finding.reason}\n\nThe destination cannot be proven to stay inside the workspace.`;
}

export function guardrailSessionDirectoryKey(finding: MutationFinding): string | undefined {
	if (!finding.target) return;
	return finding.targetIsDirectory ? finding.target : dirname(finding.target);
}

function directoryPermissionLabel(keys: readonly string[]): string {
	if (keys.length === 1) return `Allow ${keys[0]} for this session`;
	return `Allow these directories for this session: ${keys.join(", ")}`;
}

export async function renderGuardrailHumanDecision(
	pi: Pick<ExtensionAPI, "events">,
	ctx: Pick<ExtensionContext, "ui">,
	request: GuardrailResolutionRequest,
): Promise<GuardrailResolution> {
	const summary = request.findings.map(displayGuardrailFinding).join("\n\n");
	if (request.category === "external-upload") {
		const choice = await withHerdrBlocked(pi.events, "Local file upload approval", () =>
			ctx.ui.select(`Local file upload requested\n\n${summary}`, [SESSION_ALLOW_ONCE, SESSION_ALLOW_UPLOAD, DENY]));
		if (choice === SESSION_ALLOW_UPLOAD) return { outcome: "ALLOW_SESSION", reason: "user allowed exact upload files for this session" };
		if (choice === SESSION_ALLOW_ONCE) return { outcome: "ALLOW_ONCE", reason: "user allowed upload once" };
		return { outcome: "DENY", reason: `User rejected uploading a local file.\n${summary}` };
	}
	if (request.category === "secret-read") {
		const choice = await withHerdrBlocked(pi.events, "Secret file access approval", () =>
			ctx.ui.select(`Secret file access requested\n\n${summary}`, [SESSION_ALLOW_ONCE, SESSION_ALLOW_SECRET, DENY]));
		if (choice === SESSION_ALLOW_SECRET) return { outcome: "ALLOW_SESSION", reason: "user allowed exact secret files for this session" };
		if (choice === SESSION_ALLOW_ONCE) return { outcome: "ALLOW_ONCE", reason: "user allowed secret read once" };
		return { outcome: "DENY", reason: `User rejected reading a secret file.\n${summary}` };
	}
	const directoryKeys = [...new Set(request.findings.map(guardrailSessionDirectoryKey).filter((key): key is string => Boolean(key)))];
	const allowDirectoryChoice = directoryKeys.length ? directoryPermissionLabel(directoryKeys) : undefined;
	const choices = allowDirectoryChoice ? [SESSION_ALLOW_ONCE, allowDirectoryChoice, DENY] : [SESSION_ALLOW_ONCE, DENY];
	const choice = await withHerdrBlocked(pi.events, "External file change approval", () =>
		ctx.ui.select(`External file change requested\n\n${summary}`, choices));
	if (choice === SESSION_ALLOW_ONCE) return { outcome: "ALLOW_ONCE", reason: "user allowed external mutation once" };
	if (allowDirectoryChoice !== undefined && choice === allowDirectoryChoice) {
		return { outcome: "ALLOW_SESSION", reason: "user allowed exact external directories for this session" };
	}
	return { outcome: "DENY", reason: `User rejected modification outside the workspace.\n${summary}` };
}
