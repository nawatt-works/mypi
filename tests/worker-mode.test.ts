import assert from "node:assert/strict";
import test from "node:test";
import workerMode, {
	WORKER_ENV,
	WORKER_SESSION_PREFIX,
	isWorkerMode,
	workerSessionName,
} from "../extensions/worker-mode.ts";
import steeringChoice from "../extensions/steering-choice.ts";
import dependencyUpdateNotifier from "../extensions/dependency-update-notifier.ts";

type Fake = {
	pi: any;
	handlers: Map<string, (...args: any[]) => any>;
	commands: Map<string, any>;
	flags: Map<string, unknown>;
	activeTools: string[];
};

function fakePi(options: { activeTools?: string[]; sessionName?: string } = {}): Fake {
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
		getSessionName: () => options.sessionName,
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

const workerFake = (activeTools?: string[]) =>
	fakePi({ activeTools, sessionName: workerSessionName("probe") });
test("worker mode rides on the session name, which a flag sets atomically", () => {
	const named = (name?: string) => ({ getSessionName: () => name });
	assert.equal(workerSessionName("reviewer"), `${WORKER_SESSION_PREFIX}reviewer`);

	assert.equal(isWorkerMode(named(undefined), {}), false);
	assert.equal(isWorkerMode(named("my-pi"), {}), false);
	assert.equal(isWorkerMode(named(workerSessionName("reviewer")), {}), true);

	// The environment stays as a hand-run escape hatch.
	assert.equal(isWorkerMode(named(undefined), { [WORKER_ENV]: "1" }), true);
	assert.equal(isWorkerMode(named(undefined), { [WORKER_ENV]: "0" }), false);
	assert.equal(isWorkerMode({} as any, {}), false, "a host without session names must not crash");
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

	const worker = workerFake([...tools]);
	workerMode(worker.pi);
	worker.handlers.get("session_start")?.({}, {});
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

	const worker = workerFake();
	steeringChoice(worker.pi);
	worker.handlers.get("session_start")?.({}, ctx);
	assert.equal(editorFactoryInstalled, false, "worker sessions must not install the steering dialog");

	const normal = fakePi();
	steeringChoice(normal.pi);
	normal.handlers.get("session_start")?.({}, ctx);
	assert.equal(editorFactoryInstalled, true);
});

test("a worker skips the startup dependency check but keeps the explicit command", () => {
	const worker = workerFake();
	let notified = false;
	dependencyUpdateNotifier(worker.pi);
	worker.handlers.get("session_start")?.({}, {
		hasUI: true,
		ui: { notify: () => { notified = true; } },
	});
	assert.equal(notified, false);
	assert.ok(worker.commands.has("mypi-updates"));
});
