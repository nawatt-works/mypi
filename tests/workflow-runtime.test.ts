import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	configureWorkspaceRuntime,
	workspaceTemporaryDirectory,
} from "../extensions/workspace-runtime.ts";
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
