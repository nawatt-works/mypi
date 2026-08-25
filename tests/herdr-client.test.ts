import assert from "node:assert/strict";
import test from "node:test";
import {
	herdrCallerContext,
	herdrExecutable,
	isHerdrSession,
	runHerdr,
} from "../extensions/herdr-client.ts";

function execHost(result: unknown) {
	const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
	const host = {
		exec: async (command: string, args: string[], options: unknown) => {
			calls.push({ command, args, options });
			if (result instanceof Error) throw result;
			return result as any;
		},
	};
	return { host, calls };
}

test("resolves the herdr binary and the session it belongs to", () => {
	assert.equal(herdrExecutable({}), "herdr");
	assert.equal(herdrExecutable({ HERDR_BIN_PATH: " /opt/herdr " }), "/opt/herdr");
	assert.equal(isHerdrSession({}), false);
	assert.equal(isHerdrSession({ HERDR_ENV: "0" }), false);
	assert.equal(isHerdrSession({ HERDR_ENV: "1" }), true);
});

test("reads the caller's own workspace, tab and pane from the pane environment", () => {
	assert.deepEqual(
		herdrCallerContext({ HERDR_WORKSPACE_ID: "w7", HERDR_TAB_ID: "w7:t7", HERDR_PANE_ID: "w7:p9" }),
		{ workspaceId: "w7", tabId: "w7:t7", paneId: "w7:p9" },
	);
	assert.deepEqual(herdrCallerContext({ HERDR_PANE_ID: "  " }), {
		workspaceId: undefined,
		tabId: undefined,
		paneId: undefined,
	});
});

test("returns the JSON result payload so identifiers are read, not predicted", async () => {
	const { host, calls } = execHost({
		stdout: '{"id":"cli:pane:split","result":{"pane":{"pane_id":"w7:p9"},"type":"pane_info"}}',
		stderr: "",
		code: 0,
		killed: false,
	});

	const result = await runHerdr(host, ["pane", "split", "--current"], { cwd: "/repo" });
	assert.equal(result.ok, true);
	assert.deepEqual((result.result as any).pane.pane_id, "w7:p9");
	assert.equal(result.error, undefined);
	assert.deepEqual(calls[0].args, ["pane", "split", "--current"]);
	assert.deepEqual(calls[0].options, { timeout: 10_000, cwd: "/repo" });
});

test("treats a rejected command as a value, not an exception", async () => {
	// Herdr prints rejections on stderr and still exits 0.
	const { host } = execHost({
		stdout: "",
		stderr: '{"error":{"code":"agent_pane_busy","message":"pane w7:p9 is not an available shell"},"id":"cli:agent:start"}',
		code: 0,
		killed: false,
	});

	const result = await runHerdr(host, ["agent", "start", "dev", "--kind", "pi", "--pane", "w7:p9"]);
	assert.equal(result.ok, false, "an error envelope must not read as success even on exit 0");
	assert.equal(result.error?.code, "agent_pane_busy");
	assert.match(result.error?.message ?? "", /not an available shell/);
});

test("keeps plain-text output usable for commands that answer without JSON", async () => {
	const { host } = execHost({
		stdout: "pi: current (v8)\nclaude: not installed\n",
		stderr: "",
		code: 0,
		killed: false,
	});

	const result = await runHerdr(host, ["integration", "status"]);
	assert.equal(result.ok, true);
	assert.equal(result.result, undefined);
	assert.equal(result.output, "pi: current (v8)\nclaude: not installed");
});

test("reports timeouts and a missing binary without throwing", async () => {
	const timedOut = execHost({ stdout: "", stderr: "", code: 143, killed: true });
	const killed = await runHerdr(timedOut.host, ["agent", "wait", "dev"], { timeout: 5 });
	assert.equal(killed.ok, false);
	assert.equal(killed.killed, true);

	const missing = execHost(new Error("spawn herdr ENOENT"));
	const failed = await runHerdr(missing.host, ["agent", "list"]);
	assert.equal(failed.ok, false);
	assert.equal(failed.code, null);
	assert.equal(failed.error?.code, "herdr_unavailable");
	assert.match(failed.error?.message ?? "", /ENOENT/);
});
