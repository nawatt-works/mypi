import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ContinuityMode = "automatic" | "off";
export type PlannotatorPhase = "idle" | "planning" | "executing";
export type PlanOwnership = "managed" | "caller";

export type ActiveWorkPlan = {
	filePath: string;
	title: string;
	reason: string;
	ownership: PlanOwnership;
};

type PlannotatorPlanMode = "enter" | "exit" | "toggle" | "status";
type PlannotatorPlanModeResult = { phase: PlannotatorPhase };
type PlannotatorResponse<T> =
	| { status: "handled"; result: T }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

type EventBus = {
	emit(channel: string, data: unknown): void;
};

type ContinuityCommand =
	| { kind: "show" }
	| { kind: "set"; mode: ContinuityMode }
	| { kind: "invalid" };

type RestoredPlanningState = {
	mode: ContinuityMode;
	activePlan?: ActiveWorkPlan;
};

const DEFAULT_MODE: ContinuityMode = "automatic";
const START_TOOL = "mypi_start_work_plan";
const FINISH_TOOL = "mypi_finish_work_plan";
const REVIEW_TOOL = "mypi_use_plannotator";
const MODE_ENTRY = "mypi-continuity-mode";
const PLAN_ENTRY = "mypi-work-plan";
const MANAGED_PLAN_DIRECTORY = ".workbench/continuity";
const PLANNING_MARKER = "[PLANNOTATOR - PLANNING PHASE]";
const EXECUTING_MARKER = "[PLANNOTATOR - EXECUTING PLAN]";
const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
const PLANNOTATOR_TIMEOUT_MS = 5_000;

export function parseContinuityCommand(input: string): ContinuityCommand {
	const value = input.trim().toLowerCase();
	if (!value || value === "status") return { kind: "show" };
	if (value === "automatic" || value === "auto" || value === "on") {
		return { kind: "set", mode: "automatic" };
	}
	if (value === "off") return { kind: "set", mode: "off" };
	return { kind: "invalid" };
}

export function slugifyPlanTitle(title: string): string {
	const slug = title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "work-plan";
}

function compactLocalTimestamp(now: Date): string {
	const number = (value: number) => String(value).padStart(2, "0");
	return [
		now.getFullYear(),
		number(now.getMonth() + 1),
		number(now.getDate()),
		"-",
		number(now.getHours()),
		number(now.getMinutes()),
	].join("");
}

function readableLocalTimestamp(now: Date): string {
	const compact = compactLocalTimestamp(now);
	return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)} ${compact.slice(9, 11)}:${compact.slice(11, 13)}`;
}

export function defaultContinuityPath(title: string, now = new Date()): string {
	return `${MANAGED_PLAN_DIRECTORY}/${compactLocalTimestamp(now)}-${slugifyPlanTitle(title)}.md`;
}

export function resolveWorkspacePlanPath(filePath: string, cwd: string): {
	absolutePath: string;
	relativePath: string;
} {
	const trimmed = filePath.trim();
	if (!trimmed) throw new Error("Plan path is empty.");
	const absolutePath = resolve(cwd, trimmed);
	const relativePath = relative(resolve(cwd), absolutePath);
	if (
		!relativePath ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error("Plan path must resolve inside the workspace.");
	}
	if (relativePath === ".git" || relativePath.startsWith(`.git${sep}`)) {
		throw new Error("Plan path must not be inside .git.");
	}
	const extension = extname(absolutePath).toLowerCase();
	if (extension !== ".md" && extension !== ".mdx") {
		throw new Error("Plan path must end in .md or .mdx.");
	}
	return {
		absolutePath,
		relativePath: relativePath.split(sep).join("/"),
	};
}

function isActiveWorkPlan(value: unknown): value is ActiveWorkPlan {
	if (typeof value !== "object" || value === null) return false;
	const plan = value as Partial<ActiveWorkPlan>;
	return (
		typeof plan.filePath === "string" &&
		typeof plan.title === "string" &&
		typeof plan.reason === "string" &&
		(plan.ownership === "managed" || plan.ownership === "caller")
	);
}

export function restorePlanningState(entries: readonly unknown[]): RestoredPlanningState {
	let mode = DEFAULT_MODE;
	let activePlan: ActiveWorkPlan | undefined;
	for (const rawEntry of entries) {
		const entry = rawEntry as {
			type?: string;
			customType?: string;
			data?: { mode?: unknown; action?: unknown; plan?: unknown; filePath?: unknown };
		};
		if (entry.type !== "custom") continue;
		if (entry.customType === MODE_ENTRY) {
			if (entry.data?.mode === "automatic" || entry.data?.mode === "off") {
				mode = entry.data.mode;
			}
			continue;
		}
		if (entry.customType !== PLAN_ENTRY) continue;
		if (entry.data?.action === "activate" && isActiveWorkPlan(entry.data.plan)) {
			activePlan = entry.data.plan;
		} else if (
			entry.data?.action === "finish" &&
			typeof entry.data.filePath === "string" &&
			activePlan?.filePath === entry.data.filePath
		) {
			activePlan = undefined;
		}
	}
	return { mode, activePlan };
}

export function buildPlanningGuidance(
	mode: ContinuityMode,
	activePlan?: ActiveWorkPlan,
	contextPercent?: number | null,
): string {
	if (activePlan) {
		const ownership = activePlan.ownership === "caller"
			? "This is caller-owned workflow/skill content: preserve its schema and location; never delete or relocate it automatically."
			: "This is a managed working ledger: keep it concise and close it only after the requested outcome and verification are complete.";
		return `## Active work continuity\n\n- Source of truth: \`${activePlan.filePath}\`\n- Read it before continuing implementation, especially after compaction or resume.\n- Update completed work, decisions, verification evidence, blockers, and the exact next action after each material phase.\n- ${ownership}\n- Use \`${FINISH_TOOL}\` only when the work is genuinely complete or intentionally cancelled.\n- Plannotator review is independent; call \`${REVIEW_TOOL}\` only when human review or approval adds value.`;
	}
	if (mode === "off") return "";

	const contextWarning =
		typeof contextPercent === "number" && contextPercent >= 60
			? `\n- Current context usage is about ${Math.round(contextPercent)}%; establish continuity before a long implementation if important state could be lost.`
			: "";

	return `## Work planning and continuity\n\nBefore substantial implementation, independently decide whether the task needs a workspace-backed continuity ledger. Call \`${START_TOOL}\` as the only tool call in its batch when strong signals apply:\n- several dependent phases, subsystems, or verification steps remain;\n- the user split the task but the assigned part is still large;\n- work will span many turns or must survive compaction/session continuation;\n- decisions, blockers, or partial verification would be costly to reconstruct.\n\nIf a workflow or skill specifies an artifact path, pass that exact workspace-relative Markdown path as \`filePath\`. Otherwise omit \`filePath\` and the tool will create a managed working ledger. Do not create one for small localized work, ordinary Q&A, or disposable exploration.\n\nHuman plan review is a separate decision. Call \`${REVIEW_TOOL}\` only when approval or annotations would materially improve the work; a large task does not automatically require Plannotator. Respect explicit user overrides.${contextWarning}`;
}

export function requestPlannotatorPlanMode(
	events: EventBus,
	mode: PlannotatorPlanMode,
	timeoutMs = PLANNOTATOR_TIMEOUT_MS,
): Promise<PlannotatorResponse<PlannotatorPlanModeResult>> {
	return new Promise((resolveResponse) => {
		let settled = false;
		const finish = (response: PlannotatorResponse<PlannotatorPlanModeResult>) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveResponse(response);
		};
		const timer = setTimeout(() => {
			finish({ status: "unavailable", error: "Plannotator did not respond before timeout." });
		}, timeoutMs);

		events.emit(PLANNOTATOR_REQUEST_CHANNEL, {
			requestId: randomUUID(),
			action: "plan-mode",
			payload: { mode },
			respond: finish,
		});
	});
}

function responseError(response: PlannotatorResponse<PlannotatorPlanModeResult>): string {
	if (response.status === "handled") return "";
	return response.error ?? "Plannotator is unavailable.";
}

function planSkeleton(title: string, reason: string, now = new Date()): string {
	const timestamp = readableLocalTimestamp(now);
	return `# ${title}\n\n> **Status:** active<br>\n> **Created:** ${timestamp}<br>\n> **Updated:** ${timestamp}<br>\n> **Purpose:** ${reason}\n\n## Goal\n\n${reason}\n\n## Constraints\n\n- เติมข้อจำกัดที่ต้องรักษาก่อนลงมือ\n\n## Progress\n\n- [ ] แบ่งงานเป็นขั้นตอนและระบุ verification\n\n## Decisions\n\n- ยังไม่มี\n\n## Verification\n\n- ยังไม่ได้ตรวจ\n\n## Next\n\n- แตกขั้นตอนแรกที่ลงมือทำได้ แล้วอัปเดตไฟล์นี้หลังจบแต่ละช่วง\n`;
}

export default function planningWorkflow(pi: ExtensionAPI): void {
	let mode: ContinuityMode = DEFAULT_MODE;
	let activePlan: ActiveWorkPlan | undefined;

	function setToolEnabled(toolName: string, enabled: boolean): void {
		const active = pi.getActiveTools();
		if (enabled && !active.includes(toolName)) {
			pi.setActiveTools([...active, toolName]);
		} else if (!enabled && active.includes(toolName)) {
			pi.setActiveTools(active.filter((name) => name !== toolName));
		}
	}

	function syncToolVisibility(): void {
		// `off` disables only model-initiated planning guidance. Keep the tool
		// available so an explicit user, skill, or workflow can still select a plan.
		setToolEnabled(START_TOOL, !activePlan);
		setToolEnabled(FINISH_TOOL, activePlan !== undefined);
		setToolEnabled(REVIEW_TOOL, true);
	}

	function persistPlan(action: "activate" | "finish", plan?: ActiveWorkPlan, summary?: string): void {
		pi.appendEntry(PLAN_ENTRY, action === "activate"
			? { action, plan }
			: { action, filePath: activePlan?.filePath, summary });
	}

	async function activatePlan(input: {
		cwd: string;
		title: string;
		reason: string;
		filePath?: string;
	}): Promise<{ plan: ActiveWorkPlan; created: boolean }> {
		if (activePlan) {
			if (input.filePath) {
				const requested = resolveWorkspacePlanPath(input.filePath, input.cwd).relativePath;
				if (requested !== activePlan.filePath) {
					throw new Error(`Another work plan is already active: ${activePlan.filePath}`);
				}
			}
			return { plan: activePlan, created: false };
		}
		const ownership: PlanOwnership = input.filePath ? "caller" : "managed";
		const requestedPath = input.filePath ?? defaultContinuityPath(input.title);
		const resolved = resolveWorkspacePlanPath(requestedPath, input.cwd);
		let created = false;
		if (!existsSync(resolved.absolutePath)) {
			await mkdir(dirname(resolved.absolutePath), { recursive: true, mode: 0o700 });
			await writeFile(resolved.absolutePath, planSkeleton(input.title, input.reason), "utf8");
			created = true;
		}

		activePlan = {
			filePath: resolved.relativePath,
			title: input.title.trim(),
			reason: input.reason.trim(),
			ownership,
		};
		persistPlan("activate", activePlan);
		syncToolVisibility();
		return { plan: activePlan, created };
	}

	pi.registerTool({
		name: START_TOOL,
		label: "Start Work Plan",
		description:
			"Create or register a workspace-backed continuity plan before substantial multi-phase work. Use a workflow/skill-provided filePath verbatim when supplied; otherwise omit it for a managed working ledger. This does not open Plannotator.",
		parameters: Type.Object({
			title: Type.String({ minLength: 1, description: "Short descriptive title for the work" }),
			reason: Type.String({ minLength: 1, description: "Why this task needs continuity across turns or compaction" }),
			filePath: Type.Optional(Type.String({
				description: "Caller-selected workspace-relative .md/.mdx artifact path; omit for a managed continuity ledger",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const input = params as { title: string; reason: string; filePath?: string };
			const result = await activatePlan({ cwd: ctx.cwd, ...input });
			return {
				content: [{
					type: "text",
					text: `Active work plan: ${result.plan.filePath}\n${result.created ? "สร้าง skeleton แล้ว" : "ใช้ไฟล์เดิมโดยไม่เขียนทับ"} ให้เปิดอ่านและเติม steps, constraints, verification และ exact next action ก่อน implementation จากนั้นอัปเดตหลังจบแต่ละ phase`,
				}],
				details: { mode, activated: true, created: result.created, plan: result.plan },
			};
		},
	});

	pi.registerTool({
		name: FINISH_TOOL,
		label: "Finish Work Plan",
		description:
			"Close the active continuity plan only after implementation and verification are genuinely complete, or when the work is intentionally cancelled. Managed ledgers are deleted; caller-owned workflow artifacts are retained.",
		parameters: Type.Object({
			outcome: Type.Union([Type.Literal("complete"), Type.Literal("cancelled")]),
			summary: Type.String({ description: "Concise final outcome or cancellation reason" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!activePlan) {
				return {
					content: [{ type: "text", text: "ไม่มี active work plan" }],
					details: { closed: false },
				};
			}
			const closingPlan = activePlan;
			let deleted = false;
			if (closingPlan.ownership === "managed") {
				const resolved = resolveWorkspacePlanPath(closingPlan.filePath, ctx.cwd);
				const managedRoot = resolve(ctx.cwd, MANAGED_PLAN_DIRECTORY);
				const rel = relative(managedRoot, resolved.absolutePath);
				if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
					try {
						await unlink(resolved.absolutePath);
						deleted = true;
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
				}
			}
			const input = params as { outcome: "complete" | "cancelled"; summary: string };
			persistPlan("finish", undefined, input.summary);
			activePlan = undefined;
			syncToolVisibility();
			return {
				content: [{
					type: "text",
					text: deleted
						? `ปิด ${closingPlan.filePath} และลบ managed ledger แล้ว`
						: `ปิด ${closingPlan.filePath} แล้ว โดยคง caller-owned artifact ไว้`,
				}],
				details: { closed: true, deleted, outcome: input.outcome, plan: closingPlan },
			};
		},
	});

	pi.registerTool({
		name: REVIEW_TOOL,
		label: "Use Plannotator",
		description:
			"Enter Plannotator only when human review, annotations, or approval would materially improve a plan. This is independent from continuity planning. Reuse the active work plan or pass a workflow/skill-selected workspace Markdown path.",
		parameters: Type.Object({
			reason: Type.String({ minLength: 1, description: "Why human plan review adds value" }),
			filePath: Type.Optional(Type.String({
				description: "Workspace-relative .md/.mdx path; omit to reuse the active work plan or let Plannotator choose",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const input = params as { reason: string; filePath?: string };
			if (input.filePath && !activePlan) {
				await activatePlan({
					cwd: ctx.cwd,
					title: input.filePath.split("/").pop()?.replace(/\.mdx?$/i, "") || "Work plan",
					reason: input.reason,
					filePath: input.filePath,
				});
			} else if (input.filePath && activePlan) {
				const requested = resolveWorkspacePlanPath(input.filePath, ctx.cwd).relativePath;
				if (requested !== activePlan.filePath) {
					throw new Error(`Active work plan is ${activePlan.filePath}; finish it before reviewing another path.`);
				}
			}

			const status = await requestPlannotatorPlanMode(pi.events, "status");
			if (status.status !== "handled") {
				throw new Error(responseError(status));
			}
			if (status.result.phase !== "idle") {
				return {
					content: [{ type: "text", text: `Plannotator อยู่ใน phase ${status.result.phase} แล้ว` }],
					details: { entered: false, phase: status.result.phase, plan: activePlan },
				};
			}

			const entered = await requestPlannotatorPlanMode(pi.events, "enter");
			if (entered.status !== "handled") {
				throw new Error(responseError(entered));
			}
			const pathGuidance = activePlan
				? ` ใช้ไฟล์ ${activePlan.filePath} โดยคงตำแหน่งและโครงสร้างเดิม`
				: " เลือกไฟล์ Markdown ภายใน workspace ตาม convention ของ workflow ปัจจุบัน";
			return {
				content: [{
					type: "text",
					text: `เข้า Plannotator planning mode แล้ว.${pathGuidance} สำรวจและแก้ plan เท่านั้น จากนั้นเรียก plannotator_submit_plan เพื่อเปิด Browser UI`,
				}],
				details: { entered: entered.result.phase === "planning", phase: entered.result.phase, plan: activePlan, reason: input.reason },
			};
		},
	});

	pi.registerCommand("mypi-continuity", {
		description: "ตั้ง automatic continuity planning: automatic | off | status",
		getArgumentCompletions: (prefix) => {
			const values = ["automatic", "off", "status"];
			const matches = values.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const command = parseContinuityCommand(args);
			if (command.kind === "invalid") {
				ctx.ui.notify("ใช้: /mypi-continuity automatic|off|status", "warning");
				return;
			}
			if (command.kind === "set") {
				mode = command.mode;
				pi.appendEntry(MODE_ENTRY, { mode });
				syncToolVisibility();
			}
			const planStatus = activePlan ? `; active: ${activePlan.filePath}` : "; no active plan";
			ctx.ui.notify(`Continuity planning: ${mode}${planStatus}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		const restored = restorePlanningState(ctx.sessionManager.getBranch());
		mode = restored.mode;
		activePlan = restored.activePlan;
		if (activePlan) {
			const resolved = resolveWorkspacePlanPath(activePlan.filePath, ctx.cwd);
			if (!existsSync(resolved.absolutePath)) {
				pi.appendEntry(PLAN_ENTRY, { action: "finish", filePath: activePlan.filePath, summary: "Plan file no longer exists." });
				if (ctx.hasUI) ctx.ui.notify(`ไม่พบ active work plan เดิม: ${activePlan.filePath}`, "warning");
				activePlan = undefined;
			}
		}
		syncToolVisibility();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const guidance = buildPlanningGuidance(mode, activePlan, ctx.getContextUsage()?.percent);
		let plannotatorPhase: PlannotatorPhase | undefined;
		if (activePlan) {
			const status = await requestPlannotatorPlanMode(pi.events, "status", 500);
			if (status.status === "handled") plannotatorPhase = status.result.phase;
		}

		// Plannotator >=0.27 delivers phase framing as a conversation message
		// instead of modifying systemPrompt. Query its public event API first;
		// retain marker fallbacks for compatibility with older releases.
		const planning = plannotatorPhase === "planning" || event.systemPrompt.includes(PLANNING_MARKER);
		const executing = plannotatorPhase === "executing" || event.systemPrompt.includes(EXECUTING_MARKER);
		const phaseGuidance = planning && activePlan
			? `## Active Plannotator path\n\nUse \`${activePlan.filePath}\` as the plan file. Keep it at that exact path and preserve its existing structure. Submit this same path with \`plannotator_submit_plan\`.`
			: executing && activePlan
				? `## Execution continuity\n\nThe active plan remains \`${activePlan.filePath}\`. Keep its progress and exact next action current after each verified phase.`
				: "";
		const additions = [guidance, phaseGuidance].filter(Boolean);
		if (additions.length === 0) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${additions.join("\n\n")}` };
	});
}
