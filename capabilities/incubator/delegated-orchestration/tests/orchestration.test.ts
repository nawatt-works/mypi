import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import orchestration, {
	buildOrchestrationGuidance,
	harnessRunSettings,
	evaluateEvidence,
	parseAgentKinds,
	parseOrchestrateCommand,
	restoreOrchestrateMode,
	type OrchestrateMode,
} from "../extensions/orchestration.ts";

const HELP_TEXT = `Options:
      --kind <KIND>
          Supported agent kind and canonical executable

          [possible values: pi, claude, codex, gemini, cursor]

      --pane <ID>`;

type Call = { args: string[] };

function fakePi(options: { herdrResponses?: Record<string, unknown>; activeTools?: string[] } = {}) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, (...args: any[]) => any>();
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
	const calls: Call[] = [];
	let activeTools = options.activeTools ?? [];

	const pi = {
		on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, opts: any) => commands.set(name, opts),
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => {
			activeTools = names;
		},
		events: { emit: () => {}, on: () => {} },
		exec: async (_command: string, args: string[]) => {
			calls.push({ args });
			const key = args.slice(0, 2).join(" ");
			const stdout = options.herdrResponses?.[key];
			return {
				stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout ?? { result: { agents: [] } }),
				stderr: "",
				code: 0,
				killed: false,
			};
		},
	};
	return { pi: pi as any, tools, commands, handlers, entries, calls, activeTools: () => activeTools };
}

function withHerdrEnv<T>(run: () => T): T {
	const previous = { env: process.env.HERDR_ENV, pane: process.env.HERDR_PANE_ID };
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w7:p7";
	try {
		return run();
	} finally {
		if (previous.env === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = previous.env;
		if (previous.pane === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = previous.pane;
	}
}

function withoutHerdrEnv<T>(run: () => T): T {
	// The suite itself may be running inside a Herdr pane; do not inherit it.
	const previous = process.env.HERDR_ENV;
	delete process.env.HERDR_ENV;
	try {
		return run();
	} finally {
		if (previous !== undefined) process.env.HERDR_ENV = previous;
	}
}

test("reads the harness kinds from the installed Herdr binary", () => {
	assert.deepEqual(parseAgentKinds(HELP_TEXT), ["pi", "claude", "codex", "gemini", "cursor"]);
	assert.deepEqual(parseAgentKinds("no enum here"), []);
});

test("reads the real kind list from the installed binary", async (t) => {
	const help = await new Promise<string>((done) => {
		execFile("herdr", ["agent", "start", "--help"], (error, stdout, stderr) =>
			done(error && !stdout ? "" : `${stdout}\n${stderr}`),
		);
	});
	if (!help.includes("possible values")) return t.skip("herdr CLI not available");

	const kinds = parseAgentKinds(help);
	assert.ok(kinds.includes("pi"), "pi must be a supported kind");
	assert.ok(kinds.includes("codex"));
	assert.ok(kinds.every((kind) => /^[a-z0-9-]+$/.test(kind)), `unexpected kind formatting: ${kinds.join(", ")}`);
});

test("requires every agreed artifact, and never accepts lifecycle movement instead", () => {
	assert.equal(evaluateEvidence([]).complete, false);
	assert.equal(evaluateEvidence([{ description: "path", satisfied: false, required: true }]).complete, false);

	// A Worker whose state moved but whose deliverable is missing did not do the work.
	assert.equal(
		evaluateEvidence([
			{ description: "path", satisfied: false, required: true },
			{ description: "state moved", satisfied: true, required: false },
		]).complete,
		false,
	);
	assert.equal(
		evaluateEvidence([
			{ description: "path", satisfied: true, required: true },
			{ description: "state moved", satisfied: false, required: false },
		]).complete,
		true,
	);
	// Corroborating signals alone are never a verdict.
	assert.equal(evaluateEvidence([{ description: "state moved", satisfied: true, required: false }]).complete, false);
});

test("registers Worker setup only as a secret-safe interactive command", async () => {
	const runtime = fakePi();
	orchestration(runtime.pi);
	const command = runtime.commands.get("mypi-worker-setup");
	assert.ok(command);
	const notices: string[] = [];
	await command.handler("super-secret-value", {
		mode: "tui",
		ui: { notify: (message: string) => notices.push(message) },
	});
	assert.ok(notices.some((message) => message.includes("ห้ามส่ง path หรือ secret")));
	assert.ok(notices.every((message) => !message.includes("super-secret-value")));
	const nonInteractive: string[] = [];
	await command.handler("", {
		mode: "print",
		ui: { notify: (message: string) => nonInteractive.push(message) },
	});
	assert.ok(nonInteractive[0]?.includes("interactive TUI"));
});

test("keeps orchestration tools out of sessions that are not running under Herdr", () => {
	const outside = fakePi({ activeTools: ["read", "mypi_spawn_worker"] });
	withoutHerdrEnv(() => {
		orchestration(outside.pi);
		outside.handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [] } });
	});
	assert.deepEqual(outside.activeTools(), ["read"]);

	const inside = fakePi({ activeTools: ["read"] });
	withHerdrEnv(() => {
		orchestration(inside.pi);
		inside.handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [] } });
	});
	assert.ok(inside.activeTools().includes("mypi_spawn_worker"));
	assert.ok(inside.activeTools().includes("mypi_collect"));
});

test("previews a spawn without creating anything", async () => {
	const fake = fakePi({ herdrResponses: { "agent start": HELP_TEXT } });
	orchestration(fake.pi);
	const preview = fake.tools.get("mypi_preview_worker");

	const result = await withHerdrEnv(() =>
		preview.execute("call-1", {
			task: "สำรวจ auth flow แล้วเขียนรายงาน",
			requestedHarness: "claude",
			rationale: "ต้องการ independent context ที่ไม่ปนกับ implementation",
			expectedArtifacts: ["reports/auth.md"],
		}, undefined, undefined, { cwd: "/repo", hasUI: true }),
	);

	assert.equal(result.details.spawned, false);
	assert.equal(result.details.kindSupported, true);
	assert.match(result.details.name, /^[a-z][a-z0-9_-]{0,31}$/, "the suggested name must satisfy Herdr's rule");
	assert.match(result.content[0].text, /ยังไม่ได้สร้าง/);
	assert.equal(fake.entries.length, 0, "preview must not touch the registry");
	assert.ok(!fake.calls.some((call) => call.args[0] === "pane"), "preview must not create panes");
});

test("refuses a harness kind the installed Herdr does not support", async () => {
	const fake = fakePi({ herdrResponses: { "agent start": HELP_TEXT } });
	orchestration(fake.pi);
	const spawn = fake.tools.get("mypi_spawn_worker");

	await assert.rejects(
		withHerdrEnv(() =>
			spawn.execute("call-1", {
				task: "t",
				requestedHarness: "not-a-harness",
				rationale: "r",
			}, undefined, undefined, { cwd: "/repo", hasUI: true, ui: { confirm: async () => true } }),
		),
		/ไม่รองรับ kind/,
	);
	assert.ok(!fake.calls.some((call) => call.args[0] === "pane"), "an unsupported kind must not create a pane");
});

test("creates nothing when the user declines the spawn", async () => {
	const fake = fakePi({ herdrResponses: { "agent start": HELP_TEXT } });
	orchestration(fake.pi);
	const spawn = fake.tools.get("mypi_spawn_worker");

	const result = await withHerdrEnv(() =>
		spawn.execute("call-1", {
			task: "implement",
			requestedHarness: "codex",
			rationale: "harness เหมาะกับงานนี้กว่า",
		}, undefined, undefined, { cwd: "/repo", hasUI: true, ui: { confirm: async () => false } }),
	);

	assert.equal(result.details.spawned, false);
	assert.equal(fake.entries.length, 0, "a declined spawn must not register a worker");
	assert.ok(!fake.calls.some((call) => call.args[0] === "pane"));
});

test("requires a user to approve a spawn, so non-interactive mode is refused", async () => {
	const fake = fakePi({ herdrResponses: { "agent start": HELP_TEXT } });
	orchestration(fake.pi);
	const spawn = fake.tools.get("mypi_spawn_worker");

	await assert.rejects(
		withHerdrEnv(() =>
			spawn.execute("call-1", { task: "t", requestedHarness: "pi", rationale: "r" }, undefined, undefined, {
				cwd: "/repo",
				hasUI: false,
			}),
		),
		/non-interactive/,
	);
});

test("refuses to orchestrate when Pi is not running under Herdr", async () => {
	const fake = fakePi();
	orchestration(fake.pi);
	const preview = fake.tools.get("mypi_preview_worker");
	await withoutHerdrEnv(() => assert.rejects(
		preview.execute("call-1", { task: "t", requestedHarness: "pi", rationale: "r" }, undefined, undefined, { cwd: "/repo" }),
		/ไม่ได้รันอยู่ใต้ Herdr/,
	));
});

test("waits for a worker instead of polling its screen", async () => {
	const fake = fakePi({
		herdrResponses: {
			"agent start": HELP_TEXT,
			"agent wait": { result: { agent: { agent_status: "done" } } },
			"agent get": { result: { agent: { agent_status: "done", state_change_seq: 42 } } },
		},
	});
	orchestration(fake.pi);
	const wait = fake.tools.get("mypi_wait_worker");
	const spawnState = fake.handlers.get("session_start");
	withHerdrEnv(() => spawnState?.({}, { sessionManager: { getBranch: () => [
		{ type: "custom", customType: "mypi-worker-registry", data: { action: "register", worker: {
			name: "dev", task: "t", requestedHarness: "pi", identity: "unknown", identityEvidence: "none",
			status: "live", artifacts: [], paneId: "w7:pB", createdAt: "x", updatedAt: "x",
		} } },
	] } }));

	const result = await withHerdrEnv(() => wait.execute("1", { name: "dev" }, undefined, undefined, {}));
	assert.equal(result.details.reached, true);
	assert.equal(result.details.status, "done");
	assert.match(result.content[0].text, /mypi_collect/, "reaching a state is not evidence of finished work");

	const waitCall = fake.calls.find((call) => call.args[1] === "wait");
	assert.ok(waitCall, "must delegate the wait to herdr rather than sleeping");
	assert.ok(waitCall.args.includes("--timeout"));
});

test("reports a blocked worker's pane instead of answering for the user", async () => {
	const fake = fakePi({
		herdrResponses: {
			"agent wait": { result: { agent: { agent_status: "blocked" } } },
			"agent get": { result: { agent: { agent_status: "blocked", state_change_seq: 7 } } },
		},
	});
	orchestration(fake.pi);
	withHerdrEnv(() => fake.handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [
		{ type: "custom", customType: "mypi-worker-registry", data: { action: "register", worker: {
			name: "dev", task: "t", requestedHarness: "pi", identity: "unknown", identityEvidence: "none",
			status: "live", artifacts: [], paneId: "w7:pB", createdAt: "x", updatedAt: "x",
		} } },
	] } }));

	const result = await withHerdrEnv(() =>
		fake.tools.get("mypi_wait_worker").execute("1", { name: "dev", until: ["blocked"] }, undefined, undefined, {}),
	);
	assert.equal(result.details.status, "blocked");
	assert.match(result.content[0].text, /w7:pB/);
	assert.match(result.content[0].text, /แทนการตอบแทน/);
});

test("refuses to wait for a worker this session never registered", async () => {
	const fake = fakePi();
	orchestration(fake.pi);
	await assert.rejects(
		withHerdrEnv(() => fake.tools.get("mypi_wait_worker").execute("1", { name: "ghost" }, undefined, undefined, {})),
		/ไม่พบ Worker/,
	);
});

test("parses the per-session orchestration mode command", () => {
	assert.deepEqual(parseOrchestrateCommand(""), { kind: "show" });
	assert.deepEqual(parseOrchestrateCommand(" status "), { kind: "show" });
	assert.deepEqual(parseOrchestrateCommand("on"), { kind: "set", mode: "automatic" });
	assert.deepEqual(parseOrchestrateCommand("OFF"), { kind: "set", mode: "off" });
	assert.deepEqual(parseOrchestrateCommand("maybe"), { kind: "invalid" });
	assert.equal(restoreOrchestrateMode([
		{ type: "custom", customType: "mypi-orchestrate-mode", data: { mode: "off" } },
		{ type: "custom", customType: "mypi-orchestrate-mode", data: { mode: "automatic" } },
	]), "automatic");
	assert.equal(restoreOrchestrateMode([]), "automatic", "proposing a team is the default");
});

test("states the three levels of authority before any team exists", () => {
	const guidance = buildOrchestrationGuidance("automatic", []);
	assert.match(guidance, /the user decides who joins and approves every result/i);
	assert.match(guidance, /you coordinate and stay/i);
	assert.match(guidance, /bounded assignment without making design/i);
	assert.match(guidance, /do the work yourself and do not raise delegation/i,
		"the guidance must not push delegation when no lane is separable");
	assert.match(guidance, /mypi_preview_worker/);
});

test("switches to the roster once Workers exist, and stays silent when turned off", () => {
	const workers = [
		{ name: "auditor", status: "live", task: "วิเคราะห์ timeout\nรายละเอียด", artifacts: [] },
		{ name: "old", status: "gone", task: "จบไปแล้ว", artifacts: [] },
	] as any;

	const roster = buildOrchestrationGuidance("automatic", workers);
	assert.match(roster, /auditor \[live\]/);
	assert.ok(!roster.includes("old ["), "a worker Herdr no longer has must not be listed as active");
	assert.ok(!roster.includes("รายละเอียด"), "only the first line of a task belongs in a roster");
	assert.match(roster, /mypi_collect/);

	assert.equal(buildOrchestrationGuidance("off" as OrchestrateMode, []), "");
	assert.equal(buildOrchestrationGuidance("off" as OrchestrateMode, workers), "");
});

test("injects guidance only inside Herdr", () => {
	const inside = fakePi();
	const outside = fakePi();
	withHerdrEnv(() => {
		orchestration(inside.pi);
		inside.handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [] } });
	});
	withoutHerdrEnv(() => {
		orchestration(outside.pi);
		outside.handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [] } });
	});

	const injected = withHerdrEnv(() => inside.handlers.get("before_agent_start")?.({ systemPrompt: "BASE" }));
	assert.match(injected.systemPrompt, /^BASE/);
	assert.match(injected.systemPrompt, /Coordinating other agents/);

	const skipped = withoutHerdrEnv(() => outside.handlers.get("before_agent_start")?.({ systemPrompt: "BASE" }));
	assert.equal(skipped, undefined, "a session outside Herdr must not be told about Workers");
});

test("labels a Worker's pane with its name", async () => {
	const fake = fakePi({
		herdrResponses: {
			"agent start": HELP_TEXT,
			"pane split": { result: { pane: { pane_id: "w7:pB" } } },
		},
	});
	orchestration(fake.pi);

	await withHerdrEnv(() =>
		fake.tools.get("mypi_spawn_worker").execute("1", {
			task: "review the release candidate",
			requestedHarness: "codex",
			rationale: "fresh independent inspection",
			name: "reviewer",
		}, undefined, undefined, {
			cwd: "/repo",
			hasUI: true,
			ui: { confirm: async () => true },
		}),
	).catch(() => {
		// agent start is faked away; the rename must still have happened.
	});

	const rename = fake.calls.find((call) => call.args[0] === "pane" && call.args[1] === "rename");
	assert.ok(rename, "the pane must be renamed so the user can find the Worker");
	assert.deepEqual(rename.args, ["pane", "rename", "w7:pB", "reviewer"]);
});

test("translates model and effort into the flags each harness actually takes", () => {
	assert.deepEqual(harnessRunSettings("pi", "gpt-5.6-terra", "high"),
		{ args: ["--model", "gpt-5.6-terra", "--thinking", "high"], unsupported: [] });
	assert.deepEqual(harnessRunSettings("claude", "opus", "max"),
		{ args: ["--model", "opus", "--effort", "max"], unsupported: [] });
	assert.deepEqual(harnessRunSettings("codex", "gpt-5.6-sol", "xhigh"),
		{ args: ["--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="xhigh"'], unsupported: [] });
	assert.deepEqual(harnessRunSettings("pi"), { args: [], unsupported: [] });

	// An unknown harness must report the gap rather than be started with defaults
	// while the approval dialog claims otherwise.
	assert.deepEqual(harnessRunSettings("opencode", "some-model", "high").unsupported,
		["model (opencode)", "effort (opencode)"]);
});

test("shows model and effort in the proposal, including what a Pi worker inherits", async () => {
	const fake = fakePi({ herdrResponses: { "agent start": HELP_TEXT } });
	orchestration(fake.pi);
	const preview = fake.tools.get("mypi_preview_worker");

	const chosen = await withHerdrEnv(() => preview.execute("1", {
		task: "review", requestedHarness: "codex", rationale: "fresh eyes",
		model: "gpt-5.6-terra", effort: "high",
	}, undefined, undefined, { cwd: "/repo" }));
	assert.match(chosen.content[0].text, /- model: gpt-5\.6-terra/);
	assert.match(chosen.content[0].text, /- effort: high/);
	assert.deepEqual(chosen.details.harnessArgs, ["--model", "gpt-5.6-terra", "-c", 'model_reasoning_effort="high"']);

	const inherited = await withHerdrEnv(() => preview.execute("2", {
		task: "review", requestedHarness: "pi", rationale: "fresh eyes",
	}, undefined, undefined, { cwd: "/repo" }));
	assert.match(inherited.content[0].text, /- model: harness default/);
	assert.match(inherited.content[0].text, /- effort: harness default/);
});

test("refuses to spawn with a setting the harness cannot apply", async () => {
	const fake = fakePi({ herdrResponses: { "agent start": HELP_TEXT } });
	orchestration(fake.pi);

	await assert.rejects(
		withHerdrEnv(() => fake.tools.get("mypi_spawn_worker").execute("1", {
			task: "t", requestedHarness: "gemini", rationale: "r", effort: "high",
		}, undefined, undefined, { cwd: "/repo", hasUI: true, ui: { confirm: async () => true } })),
		/ไม่มี flag สำหรับ/,
	);
	assert.ok(!fake.calls.some((call) => call.args[0] === "pane"),
		"a setting that cannot be applied must stop before anything is created");
});

test("marks a Pi worker through its session name, never by typing into its shell", async () => {
	const fake = fakePi({
		herdrResponses: {
			"agent start": HELP_TEXT,
			"pane split": { result: { pane: { pane_id: "w7:pB" } } },
			"agent get": { result: { agent: { terminal_title: "π - mypi-worker:dev - repo" } } },
		},
	});
	orchestration(fake.pi);

	await withHerdrEnv(() => fake.tools.get("mypi_spawn_worker").execute("1", {
		task: "implement", requestedHarness: "pi", rationale: "r", name: "dev",
	}, undefined, undefined, { cwd: "/repo", hasUI: true, ui: { confirm: async () => true } }))
		.catch(() => { /* agent start is faked; only the arguments matter here */ });

	assert.ok(
		!fake.calls.some((call) => call.args[1] === "send-text" || call.args[1] === "send-keys"),
		"typing into a pane's shell can be lost before the prompt is ready",
	);
	// `agent start --help` is also recorded; the real launch carries --kind.
	const start = fake.calls.find((call) => call.args[1] === "start" && call.args.includes("--kind"));
	assert.ok(start, "the agent must be started");
	const separator = start.args.indexOf("--");
	assert.ok(separator > -1, "harness arguments must follow --");
	assert.deepEqual(start.args.slice(separator + 1, separator + 3), ["--name", "mypi-worker:dev"]);
});

test("closes a Worker that started without the worker-mode marker", async () => {
	const fake = fakePi({
		herdrResponses: {
			"agent start": HELP_TEXT,
			"pane split": { result: { pane: { pane_id: "w7:pB" } } },
			// The title lacks the marker: the setting did not take.
			"agent get": { result: { agent: { terminal_title: "π - repo" } } },
		},
	});
	orchestration(fake.pi);

	await assert.rejects(
		withHerdrEnv(() => fake.tools.get("mypi_spawn_worker").execute("1", {
			task: "implement", requestedHarness: "pi", rationale: "r", name: "dev",
		}, undefined, undefined, { cwd: "/repo", hasUI: true, ui: { confirm: async () => true } })),
		/ยืนยัน worker mode ไม่ได้/,
	);
	assert.ok(
		fake.calls.some((call) => call.args[0] === "pane" && call.args[1] === "close"),
		"a Worker that cannot be verified must not be left running",
	);
});

test("rejects a described model instead of hanging the harness on it", () => {
	// pi does not fail fast on an unmatched --model: it hangs, and the spawn only
	// surfaces as a startup timeout a minute later.
	assert.throws(() => harnessRunSettings("pi", "inherit default"), /ไม่ใช่ identifier/);
	assert.throws(() => harnessRunSettings("pi", undefined, "harness default"), /ไม่ใช่ identifier/);
	assert.throws(() => harnessRunSettings("pi", " "), /ไม่ใช่ identifier/);
	assert.deepEqual(harnessRunSettings("pi", "gpt-5.6-terra").args, ["--model", "gpt-5.6-terra"]);
	assert.deepEqual(harnessRunSettings("pi").args, [], "omitting the field is how a default is inherited");
});
