import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const STEER = "Steer — ส่งหลัง turn/tool ปัจจุบัน";
const FOLLOW_UP = "Wait — รอจน AI ทำงานเดิมครบ";
const CANCEL = "Cancel — ยังไม่ส่ง";

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

	pi.on("session_start", (_event, ctx) => {
		activeContext = ctx;
		if (installed || !ctx.hasUI) return;
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
					text.length > 0 &&
					!isCommand &&
					!hasAutocomplete
				) {
					dialogOpen = true;
					void (async () => {
						try {
							const choice = await current.ui.select(
								"AI is working — how should this message be delivered?",
								[STEER, FOLLOW_UP, CANCEL],
							);
							if (choice === CANCEL || choice === undefined) return;

							editor.addToHistory?.(text);
							editor.setText("");
							pi.sendUserMessage(text, {
								deliverAs: choice === FOLLOW_UP ? "followUp" : "steer",
							});
						} catch (error) {
							editor.setText(text);
							current.ui.notify(
								`Could not queue message: ${error instanceof Error ? error.message : String(error)}`,
								"error",
							);
						} finally {
							dialogOpen = false;
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
