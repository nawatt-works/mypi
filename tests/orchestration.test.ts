import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import orchestration, { evaluateEvidence, parseAgentKinds } from "../extensions/orchestration.ts";

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
