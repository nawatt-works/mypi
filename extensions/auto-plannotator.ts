import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withHerdrBlocked } from "./herdr-integration.ts";

export type AutoPlanMode = "automatic" | "suggest" | "off";
export type PlannotatorPhase = "idle" | "planning" | "executing";
type PlannotatorPlanMode = "enter" | "exit" | "toggle" | "status";
type PlannotatorPlanModeResult = { phase: PlannotatorPhase };
type PlannotatorResponse<T> =
	| { status: "handled"; result: T }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

const DEFAULT_MODE: AutoPlanMode = "automatic";
const TOOL_NAME = "mypi_use_plannotator";
const STATE_ENTRY = "mypi-auto-plan-mode";
const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
const PLANNOTATOR_TIMEOUT_MS = 5_000;

type EventBus = {
	emit(channel: string, data: unknown): void;
};

type AutoPlanCommand =
	| { kind: "show" }
	| { kind: "set"; mode: AutoPlanMode }
	| { kind: "invalid" };

export function parseAutoPlanCommand(input: string): AutoPlanCommand {
	const value = input.trim().toLowerCase();
	if (!value || value === "status") return { kind: "show" };
	if (value === "automatic" || value === "auto" || value === "on") {
		return { kind: "set", mode: "automatic" };
	}
	if (value === "suggest" || value === "ask") {
		return { kind: "set", mode: "suggest" };
	}
	if (value === "off") return { kind: "set", mode: "off" };
	return { kind: "invalid" };
}

export function buildAutoPlanGuidance(mode: AutoPlanMode, contextPercent?: number | null): string {
	if (mode === "off") return "";
	const contextWarning =
		typeof contextPercent === "number" && contextPercent >= 60
			? `\n- Current context usage is about ${Math.round(contextPercent)}%. Prefer a durable plan before a long implementation if important decisions or progress could be lost during compaction.`
			: "";
	const modeBehavior =
		mode === "suggest"
			? "The tool will ask the user for confirmation before entering planning mode."
			: "The tool may enter planning mode directly; browser approval is still required before execution.";

	return `## AI-selected durable planning

You may call \`${TOOL_NAME}\` as the only tool call in a batch before implementation when the work has become large enough to benefit from a durable, user-reviewed plan. ${modeBehavior}

Use it when one or more strong signals apply:
- implementation spans multiple dependent phases, subsystems, or verification steps;
- a migration, broad refactor, or high-risk change needs decisions and rollback awareness;
- an extended discussion is now turning into substantial implementation;
- work will likely require many agent turns or must survive context compaction/session continuation.

Do not use it for ordinary Q&A, exploration, read-only analysis, or a small localized change. Respect explicit user overrides such as "use a plan" or "do not make a plan". Do not call it when Plannotator is already planning or executing.${contextWarning}`;
}

export function requestPlannotatorPlanMode(
	events: EventBus,
	mode: PlannotatorPlanMode,
	timeoutMs = PLANNOTATOR_TIMEOUT_MS,
): Promise<PlannotatorResponse<PlannotatorPlanModeResult>> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (response: PlannotatorResponse<PlannotatorPlanModeResult>) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(response);
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

export function restoredAutoPlanMode(entries: readonly unknown[]): AutoPlanMode {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: string; customType?: string; data?: { mode?: unknown } };
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
		if (entry.data?.mode === "automatic" || entry.data?.mode === "suggest" || entry.data?.mode === "off") {
			return entry.data.mode;
		}
	}
	return DEFAULT_MODE;
}

export default function autoPlannotator(pi: ExtensionAPI): void {
	let mode: AutoPlanMode = DEFAULT_MODE;
	let plannotatorAvailable = true;

	function setToolEnabled(enabled: boolean): void {
		const active = pi.getActiveTools();
		if (enabled && !active.includes(TOOL_NAME)) {
			pi.setActiveTools([...active, TOOL_NAME]);
		} else if (!enabled && active.includes(TOOL_NAME)) {
			pi.setActiveTools(active.filter((name) => name !== TOOL_NAME));
		}
	}

	function saveMode(nextMode: AutoPlanMode): void {
		mode = nextMode;
		setToolEnabled(mode !== "off");
		pi.appendEntry(STATE_ENTRY, { mode });
	}

	pi.registerTool({
		name: TOOL_NAME,
		label: "Use Plannotator",
		description:
			"Enter Plannotator planning mode when a coding task has become a substantial multi-step effort that needs a durable reviewed plan. Call this as the only tool in its batch, before implementation—not for Q&A, exploration, or small localized edits. Respect explicit user requests to use or avoid a plan.",
		parameters: Type.Object({
			reason: Type.String({
				description: "Concise reason this task needs a durable plan rather than direct implementation",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (mode === "off") {
				return {
					content: [{ type: "text", text: "ปิดการเลือกใช้ Plannotator โดย AI สำหรับ session นี้อยู่" }],
					details: { mode, entered: false },
				};
			}

			const status = await requestPlannotatorPlanMode(pi.events, "status");
			if (status.status !== "handled") {
				plannotatorAvailable = false;
				throw new Error(responseError(status));
			}
			if (status.result.phase !== "idle") {
				return {
					content: [{ type: "text", text: `Plannotator อยู่ใน phase ${status.result.phase} แล้ว ไม่ต้องเปิดซ้ำ` }],
					details: { mode, entered: false, phase: status.result.phase },
				};
			}

			if (mode === "suggest") {
				if (!ctx.hasUI) {
					return {
						content: [{ type: "text", text: "โหมด suggest ต้องได้รับการยืนยันจากผู้ใช้ แต่ session นี้ไม่มี UI" }],
						details: { mode, entered: false },
					};
				}
				const approved = await withHerdrBlocked(pi.events, "Plannotator approval", () =>
					ctx.ui.confirm(
						"ใช้ Plannotator?",
						`AI แนะนำให้สร้าง durable plan ก่อนลงมือ\n\nเหตุผล: ${params.reason}`,
					),
				);
				if (!approved) {
					return {
						content: [{ type: "text", text: "ผู้ใช้ไม่อนุมัติให้เข้า plan mode ให้ทำงานต่อโดยไม่เปิด Plannotator" }],
						details: { mode, entered: false },
					};
				}
			}

			const entered = await requestPlannotatorPlanMode(pi.events, "enter");
			if (entered.status !== "handled") {
				plannotatorAvailable = false;
				throw new Error(responseError(entered));
			}
			if (entered.result.phase !== "planning") {
				throw new Error(`Plannotator returned unexpected phase: ${entered.result.phase}`);
			}

			return {
				content: [
					{
						type: "text",
						text: "เข้า Plannotator planning mode แล้ว ให้หยุด implementation ชั่วคราว สำรวจเฉพาะที่จำเป็น จากนั้นสร้างหรือปรับแผนเดิมใต้ .workbench/plans/ เป็น Markdown checklist ที่แบ่ง phase พร้อม verification แล้วเรียก plannotator_submit_plan เพื่อให้ผู้ใช้ตรวจใน Browser UI",
					},
				],
				details: { mode, entered: true, phase: entered.result.phase, reason: params.reason },
			};
		},
	});

	pi.registerCommand("mypi-auto-plan", {
		description: "ตั้งการให้ AI เลือกใช้ Plannotator: automatic | suggest | off | status",
		getArgumentCompletions: (prefix) => {
			const values = ["automatic", "suggest", "off", "status"];
			const matches = values.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const command = parseAutoPlanCommand(args);
			if (command.kind === "invalid") {
				ctx.ui.notify("ใช้: /mypi-auto-plan automatic|suggest|off|status", "warning");
				return;
			}
			if (command.kind === "set") saveMode(command.mode);
			ctx.ui.notify(`AI-selected Plannotator: ${mode} (มีผลใน session นี้)`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		mode = restoredAutoPlanMode(ctx.sessionManager.getBranch());
		plannotatorAvailable = true;
		if (mode === "off") setToolEnabled(false);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (mode === "off" || !plannotatorAvailable) return;
		const status = await requestPlannotatorPlanMode(pi.events, "status");
		if (status.status !== "handled") {
			plannotatorAvailable = false;
			if (ctx.hasUI) ctx.ui.notify(responseError(status), "warning");
			return;
		}
		if (status.result.phase !== "idle") return;

		const guidance = buildAutoPlanGuidance(mode, ctx.getContextUsage()?.percent);
		return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
	});
}
