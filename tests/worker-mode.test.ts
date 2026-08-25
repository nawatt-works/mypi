import assert from "node:assert/strict";
import test from "node:test";
import workerMode, { WORKER_ENV, isWorkerMode } from "../extensions/worker-mode.ts";
import steeringChoice from "../extensions/steering-choice.ts";
import dependencyUpdateNotifier from "../extensions/dependency-update-notifier.ts";

type Fake = {
	pi: any;
	handlers: Map<string, (...args: any[]) => any>;
	commands: Map<string, any>;
	flags: Map<string, unknown>;
	activeTools: string[];
};

function fakePi(options: { activeTools?: string[] } = {}): Fake {
	const handlers = new Map<string, (...args: any[]) => any>();
	const commands = new Map<string, any>();
	const flags = new Map<string, unknown>();
	const state = { activeTools: options.activeTools ?? [] };
	const pi = {
		on(name: string, handler: (...args: any[]) => any) {
			handlers.set(name, handler);
		},
		registerFlag(name: string, opts: { default?: boolean }) {
			flags.set(name, opts.default ?? false);
		},
		registerCommand(name: string, opts: unknown) {
			commands.set(name, opts);
		},
		getFlag: (name: string) => flags.get(name),
		getActiveTools: () => state.activeTools,
		setActiveTools: (names: string[]) => {
			state.activeTools = names;
		},
	};
	return {
		pi,
		handlers,
		commands,
		flags,
		get activeTools() {
			return state.activeTools;
		},
	} as Fake;
}

function withWorkerEnv<T>(run: () => T): T {
	const previous = process.env[WORKER_ENV];
	process.env[WORKER_ENV] = "1";
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env[WORKER_ENV];
		else process.env[WORKER_ENV] = previous;
	}
}
test("worker mode is off unless the coordinator exported the signal", () => {
	assert.equal(isWorkerMode({}), false);
	assert.equal(isWorkerMode({ [WORKER_ENV]: "0" }), false);
	assert.equal(isWorkerMode({ [WORKER_ENV]: "" }), false);
	assert.equal(isWorkerMode({ [WORKER_ENV]: "1" }), true);
	assert.equal(isWorkerMode({ [WORKER_ENV]: " 1 " }), true);
});

test("reports worker state through a command", async () => {
	const fake = fakePi();
	workerMode(fake.pi);
	assert.ok(fake.commands.has("mypi-worker-status"));

	const notifications: string[] = [];
	const ctx = { hasUI: true, ui: { notify: (text: string) => notifications.push(text) } };
	await fake.commands.get("mypi-worker-status").handler("", ctx);
	assert.match(notifications[0], /Worker mode is off/);
});

test("drops tools that block on a human when running as a worker", () => {
	const tools = ["read", "plannotator_submit_plan", "write"];

	const worker = fakePi({ activeTools: [...tools] });
	withWorkerEnv(() => {
		workerMode(worker.pi);
		worker.handlers.get("session_start")?.({}, {});
	});
	assert.deepEqual(worker.activeTools, ["read", "write"]);

	const normal = fakePi({ activeTools: [...tools] });
	workerMode(normal.pi);
	normal.handlers.get("session_start")?.({}, {});
	assert.deepEqual(normal.activeTools, tools);
});

test("a worker never takes over Enter, so herdr agent prompt is delivered verbatim", () => {
	let editorFactoryInstalled = false;
	const ctx = {
		hasUI: true,
		isIdle: () => false,
		ui: {
			getEditorComponent: () => () => ({}),
			setEditorComponent: () => {
				editorFactoryInstalled = true;
			},
			select: async () => undefined,
			setStatus: () => {},
			notify: () => {},
		},
	};

	const worker = fakePi();
	withWorkerEnv(() => {
		steeringChoice(worker.pi);
		worker.handlers.get("session_start")?.({}, ctx);
	});
	assert.equal(editorFactoryInstalled, false, "worker sessions must not install the steering dialog");

	const normal = fakePi();
	steeringChoice(normal.pi);
	normal.handlers.get("session_start")?.({}, ctx);
	assert.equal(editorFactoryInstalled, true);
});

test("a worker skips the startup dependency check but keeps the explicit command", () => {
	const worker = fakePi();
	let notified = false;
	withWorkerEnv(() => {
		dependencyUpdateNotifier(worker.pi);
		worker.handlers.get("session_start")?.({}, {
			hasUI: true,
			ui: { notify: () => { notified = true; } },
		});
	});
	assert.equal(notified, false);
	assert.ok(worker.commands.has("mypi-updates"));
});
