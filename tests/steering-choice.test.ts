import assert from "node:assert/strict";
import test from "node:test";
import steeringChoice from "../extensions/steering-choice.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("lets a queued Wait message be edited or cancelled without aborting the agent", async () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	const sent: Array<{ text: string; options?: { deliverAs?: string } }> = [];
	const selections = [
		"Wait — รอจน AI ทำงานเดิมครบ",
		"Edit — นำข้อความกลับมาแก้ไข",
		"Wait — รอจน AI ทำงานเดิมครบ",
		"Cancel Wait — ยกเลิกข้อความที่กำลังรอ",
		"Wait — รอจน AI ทำงานเดิมครบ",
	];
	let editorFactory: ((...args: any[]) => any) | undefined;
	let editorText = "review this";
	let idle = false;
	let abortCount = 0;

	const editor = {
		autocompleteState: undefined,
		getText: () => editorText,
		setText: (text: string) => {
			editorText = text;
		},
		handleInput: () => {},
	};
	const context = {
		hasUI: true,
		isIdle: () => idle,
		abort: () => {
			abortCount += 1;
		},
		ui: {
			getEditorComponent: () => () => editor,
			setEditorComponent: (factory: (...args: any[]) => any) => {
				editorFactory = factory;
			},
			select: async () => selections.shift(),
			setStatus: () => {},
			notify: () => {},
		},
	};
	const pi = {
		on(name: string, handler: (...args: any[]) => any) {
			handlers.set(name, handler);
		},
		sendUserMessage(text: string, options?: { deliverAs?: string }) {
			sent.push({ text, options });
		},
	};

	steeringChoice(pi as any);
	handlers.get("session_start")?.({}, context);
	const activeEditor = editorFactory?.({}, {}, { matches: (data: string) => data === "ENTER" });

	activeEditor.handleInput("ENTER");
	await tick();
	assert.equal(editorText, "");
	assert.deepEqual(sent, []);

	activeEditor.handleInput("ENTER");
	await tick();
	assert.equal(editorText, "review this");
	assert.deepEqual(sent, []);

	activeEditor.handleInput("ENTER");
	await tick();
	assert.equal(editorText, "");

	activeEditor.handleInput("ENTER");
	await tick();
	assert.equal(editorText, "");
	assert.deepEqual(sent, []);
	assert.equal(abortCount, 0);

	editorText = "send after completion";
	activeEditor.handleInput("ENTER");
	await tick();
	idle = true;
	handlers.get("agent_settled")?.({}, context);
	assert.deepEqual(sent, [{ text: "send after completion", options: undefined }]);
	assert.equal(abortCount, 0);
});
