import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	configureWorkspaceRuntime,
	workspaceTemporaryDirectory,
} from "../extensions/workspace-runtime.ts";
import {
	buildAutoPlanGuidance,
	parseAutoPlanCommand,
	requestPlannotatorPlanMode,
	restoredAutoPlanMode,
} from "../extensions/auto-plannotator.ts";
import { augmentPlannotatorPrompt } from "../extensions/plannotator-workflow.ts";

const runtimeTestRoot = join(process.cwd(), ".runtime", "tests");
mkdirSync(runtimeTestRoot, { recursive: true });

test("configures all common temp variables inside the workspace", () => {
	const workspace = mkdtempSync(join(runtimeTestRoot, "workspace-runtime-"));
	const environment: NodeJS.ProcessEnv = {};
	const temporaryDirectory = configureWorkspaceRuntime(workspace, environment);

	assert.equal(temporaryDirectory, workspaceTemporaryDirectory(workspace));
	assert.equal(environment.TMPDIR, temporaryDirectory);
	assert.equal(environment.TMP, temporaryDirectory);
	assert.equal(environment.TEMP, temporaryDirectory);
});

test("adds workbench planning rules only during Plannotator phases", () => {
	const planning = augmentPlannotatorPrompt("base\n[PLANNOTATOR - PLANNING PHASE]");
	const executing = augmentPlannotatorPrompt("base\n[PLANNOTATOR - EXECUTING PLAN]");
	const idle = augmentPlannotatorPrompt("base");

	assert.match(planning, /\.workbench\/plans/);
	assert.match(planning, /Markdown checkbox/);
	assert.match(executing, /Handoff/);
	assert.match(executing, /\.runtime\//);
	assert.equal(idle, "base");
});

test("parses AI-selected planning modes and aliases", () => {
	assert.deepEqual(parseAutoPlanCommand(""), { kind: "show" });
	assert.deepEqual(parseAutoPlanCommand("on"), { kind: "set", mode: "automatic" });
	assert.deepEqual(parseAutoPlanCommand("ask"), { kind: "set", mode: "suggest" });
	assert.deepEqual(parseAutoPlanCommand("off"), { kind: "set", mode: "off" });
	assert.deepEqual(parseAutoPlanCommand("sometimes"), { kind: "invalid" });
});

test("restores the latest valid AI-selected planning mode", () => {
	const entries = [
		{ type: "custom", customType: "mypi-auto-plan-mode", data: { mode: "off" } },
		{ type: "custom", customType: "unrelated", data: { mode: "automatic" } },
		{ type: "custom", customType: "mypi-auto-plan-mode", data: { mode: "suggest" } },
	];
	assert.equal(restoredAutoPlanMode(entries), "suggest");
	assert.equal(restoredAutoPlanMode([]), "automatic");
});

test("adds selective planning guidance and highlights high context usage", () => {
	assert.equal(buildAutoPlanGuidance("off", 80), "");
	assert.match(buildAutoPlanGuidance("automatic", 30), /only tool call/);
	assert.doesNotMatch(buildAutoPlanGuidance("automatic", 30), /Current context usage/);
	assert.match(buildAutoPlanGuidance("suggest", 67.8), /confirmation/);
	assert.match(buildAutoPlanGuidance("suggest", 67.8), /about 68%/);
});

test("requests Plannotator plan mode through the shared event bus", async () => {
	const response = await requestPlannotatorPlanMode(
		{
			emit(channel, data) {
				assert.equal(channel, "plannotator:request");
				const request = data as {
					action: string;
					payload: { mode: string };
					respond: (result: unknown) => void;
				};
				assert.equal(request.action, "plan-mode");
				assert.equal(request.payload.mode, "enter");
				request.respond({ status: "handled", result: { phase: "planning" } });
			},
		},
		"enter",
		50,
	);

	assert.deepEqual(response, { status: "handled", result: { phase: "planning" } });
});

test("times out when Plannotator is unavailable", async () => {
	const response = await requestPlannotatorPlanMode({ emit() {} }, "status", 5);
	assert.equal(response.status, "unavailable");
});
