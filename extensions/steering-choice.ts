import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isWorkerMode } from "./worker-mode.ts";

const STEER = "Steer — ส่งหลัง turn/tool ปัจจุบัน";
const FOLLOW_UP = "Wait — รอจน AI ทำงานเดิมครบ";
const REPLACE_FOLLOW_UP = "Wait — แทนที่ข้อความที่กำลังรอ";
const CANCEL = "Cancel — ยังไม่ส่ง";
const EDIT_WAIT = "Edit — นำข้อความกลับมาแก้ไข";
const CANCEL_WAIT = "Cancel Wait — ยกเลิกข้อความที่กำลังรอ";
const KEEP_WAITING = "Keep Waiting — รอต่อ";
const WAIT_STATUS_KEY = "steering-choice-wait";

type EditableComponent = CustomEditor & {
	getExpandedText?: () => string;
	addToHistory?: (text: string) => void;
	autocompleteState?: unknown;
};

/**
 * While the agent is running, replace Enter's implicit steering behavior with
 * an explicit delivery choice. Idle submissions and commands retain Pi's
 * normal behavior.
 */
export default function steeringChoice(pi: ExtensionAPI) {
	let activeContext: ExtensionContext | undefined;
	let installed = false;
	let dialogOpen = false;
	let pendingFollowUp: { text: string; editor: EditableComponent } | undefined;

	const clearPendingFollowUp = (ctx: ExtensionContext) => {
		const pending = pendingFollowUp;
		pendingFollowUp = undefined;
		ctx.ui.setStatus(WAIT_STATUS_KEY, undefined);
		return pending;
	};

	const flushPendingFollowUp = (ctx: ExtensionContext) => {
		if (dialogOpen || !ctx.isIdle() || !pendingFollowUp) return;
		const pending = clearPendingFollowUp(ctx);
		if (!pending) return;
		pending.editor.addToHistory?.(pending.text);
		pi.sendUserMessage(pending.text);
	};

	pi.on("agent_settled", (_event, ctx) => {
		flushPendingFollowUp(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearPendingFollowUp(ctx);
		activeContext = undefined;
	});

	pi.on("session_start", (_event, ctx) => {
		activeContext = ctx;
		// Checked here rather than at load time: CLI flags are parsed after
		// extensions are constructed, so `getFlag` is only meaningful once a
		// session starts. A Coordinator delivers corrections with `herdr agent
		// prompt`, which submits text and Enter together; if this dialog opens
		// instead, the message is never delivered and the CLI still reports
		// success, so a worker must not install it.
		if (installed || !ctx.hasUI || isWorkerMode(pi)) return;
		installed = true;

		const previousFactory = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = (previousFactory
				? previousFactory(tui, theme, keybindings)
				: new CustomEditor(tui, theme, keybindings)) as EditableComponent;
			const originalHandleInput = editor.handleInput.bind(editor);

			editor.handleInput = (data: string) => {
				const current = activeContext;
				const text = (editor.getExpandedText?.() ?? editor.getText()).trim();
				const isSubmit = keybindings.matches(data, "tui.input.submit");
				const isCommand = text.startsWith("/") || text.startsWith("!");
				const hasAutocomplete = editor.autocompleteState != null;

				if (
					isSubmit &&
					!dialogOpen &&
					current &&
					!current.isIdle() &&
					pendingFollowUp &&
					text.length === 0 &&
					!hasAutocomplete
				) {
					dialogOpen = true;
					void (async () => {
						try {
							const choice = await current.ui.select(
								"A Wait message is queued — what would you like to do?",
								[EDIT_WAIT, CANCEL_WAIT, KEEP_WAITING],
							);
							if (choice === EDIT_WAIT) {
								const pending = clearPendingFollowUp(current);
								if (pending) editor.setText(pending.text);
							} else if (choice === CANCEL_WAIT) {
								clearPendingFollowUp(current);
								current.ui.notify("Cancelled the queued Wait message.", "info");
							}
						} catch (error) {
							current.ui.notify(
								`Could not manage Wait message: ${error instanceof Error ? error.message : String(error)}`,
								"error",
							);
						} finally {
							dialogOpen = false;
							flushPendingFollowUp(current);
						}
					})();
					return;
				}

				if (
					isSubmit &&
					!dialogOpen &&
					current &&
					!current.isIdle() &&
					text.length > 0 &&
					!isCommand &&
					!hasAutocomplete
				) {
					dialogOpen = true;
					void (async () => {
						try {
							const choice = await current.ui.select(
								"AI is working — how should this message be delivered?",
								[STEER, pendingFollowUp ? REPLACE_FOLLOW_UP : FOLLOW_UP, CANCEL],
							);
							if (choice === CANCEL || choice === undefined) return;

							editor.setText("");
							if (choice === FOLLOW_UP || choice === REPLACE_FOLLOW_UP) {
								pendingFollowUp = { text, editor };
								current.ui.setStatus(
									WAIT_STATUS_KEY,
									"Wait queued — กด Enter ตอนช่องว่างเพื่อแก้ไขหรือยกเลิก",
								);
							} else {
								editor.addToHistory?.(text);
								pi.sendUserMessage(text, { deliverAs: "steer" });
							}
						} catch (error) {
							editor.setText(text);
							current.ui.notify(
								`Could not queue message: ${error instanceof Error ? error.message : String(error)}`,
								"error",
							);
						} finally {
							dialogOpen = false;
							flushPendingFollowUp(current);
						}
					})();
					return;
				}

				originalHandleInput(data);
			};

			return editor;
		});
	});
}
