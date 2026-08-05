import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PLANNING_MARKER = "[PLANNOTATOR - PLANNING PHASE]";
const EXECUTING_MARKER = "[PLANNOTATOR - EXECUTING PLAN]";

const PLANNING_GUIDANCE = `## my-pi project plan rules

- Store the plan at \`.workbench/plans/<descriptive-slug>.md\`; do not use \`PLAN.md\`, \`plans/\`, \`/tmp\`, or \`.runtime/\` for a durable plan.
- Begin the file with a title followed by \`Status\`, \`Created\`, \`Updated\`, and \`Purpose\` using local time in \`YYYY-MM-DD HH:mm\` format.
- Organize implementation as clearly named phases. Every executable step must be a Markdown checkbox and every phase must include its verification.
- Include Context, Approach, Files to modify, Reuse, Risks, Decisions, Steps, Verification, and Handoff sections when they are relevant.
- Reuse the same plan file for revisions. Update \`.workbench/index.md\` when that index exists or when this workflow creates it.
- Do not store secrets, raw conversation transcripts, or disposable logs in the plan.`;

const EXECUTING_GUIDANCE = `## my-pi execution and handoff rules

- Treat the plan in \`.workbench/plans/\` as the durable source of truth and the terminal checklist as the live view.
- After a step is genuinely complete and its verification passes, mark its checkbox complete in the plan and include Plannotator's \`[DONE:n]\` marker.
- Do not mark a step complete merely because code was edited. Record failed verification, blockers, decisions, and the exact next action in the plan's Handoff section.
- Update \`Status\` and \`Updated\` after a material phase change, and update \`.workbench/index.md\` when status or purpose changes.
- Put logs, generated samples, caches, and other disposable artifacts under a task-specific subdirectory of \`.runtime/\`, never under \`/tmp\` or \`/private/tmp\` explicitly.`;

export function augmentPlannotatorPrompt(systemPrompt: string): string {
	if (systemPrompt.includes(PLANNING_MARKER)) {
		return `${systemPrompt}\n\n${PLANNING_GUIDANCE}`;
	}
	if (systemPrompt.includes(EXECUTING_MARKER)) {
		return `${systemPrompt}\n\n${EXECUTING_GUIDANCE}`;
	}
	return systemPrompt;
}

function ensurePlanDirectory(ctx: ExtensionContext): void {
	try {
		mkdirSync(resolve(ctx.cwd, ".workbench", "plans"), {
			recursive: true,
			mode: 0o700,
		});
	} catch (error) {
		if (!ctx.hasUI) return;
		ctx.ui.notify(
			`my-pi could not prepare .workbench/plans: ${error instanceof Error ? error.message : String(error)}`,
			"warning",
		);
	}
}

/** Add project-local persistence rules after Plannotator builds its phase prompt. */
export default function plannotatorWorkflow(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const systemPrompt = augmentPlannotatorPrompt(event.systemPrompt);
		if (systemPrompt === event.systemPrompt) return;
		if (event.systemPrompt.includes(PLANNING_MARKER)) ensurePlanDirectory(ctx);
		return { systemPrompt };
	});
}
