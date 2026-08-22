import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import planningWorkflow, {
	buildPlanningGuidance,
	defaultContinuityPath,
	parseContinuityCommand,
	requestPlannotatorPlanMode,
	resolveWorkspacePlanPath,
	restorePlanningState,
	slugifyPlanTitle,
} from "../extensions/planning-workflow.ts";

test("parses continuity modes and aliases", () => {
	assert.deepEqual(parseContinuityCommand(""), { kind: "show" });
	assert.deepEqual(parseContinuityCommand("on"), { kind: "set", mode: "automatic" });
	assert.deepEqual(parseContinuityCommand("off"), { kind: "set", mode: "off" });
	assert.deepEqual(parseContinuityCommand("ask"), { kind: "invalid" });
});

test("builds readable managed paths and validates caller-selected paths", () => {
	assert.equal(slugifyPlanTitle("Refactor Auth / Phase 2"), "refactor-auth-phase-2");
	assert.equal(
		defaultContinuityPath("Refactor Auth", new Date(2026, 7, 22, 12, 45)),
		".workbench/continuity/20260822-1245-refactor-auth.md",
	);
	assert.equal(resolveWorkspacePlanPath("workflow/artifacts/plan.md", "/workspace").relativePath, "workflow/artifacts/plan.md");
	assert.throws(() => resolveWorkspacePlanPath("../plan.md", "/workspace"), /inside the workspace/);
	assert.throws(() => resolveWorkspacePlanPath(".git/plan.md", "/workspace"), /inside .git/);
	assert.throws(() => resolveWorkspacePlanPath("plan.txt", "/workspace"), /\.md or \.mdx/);
});

test("restores mode and the latest active plan from Pi session entries", () => {
	const plan = {
		filePath: "workflow/artifacts/plan.md",
		title: "Workflow plan",
		reason: "หลาย phase",
		ownership: "caller" as const,
	};
	assert.deepEqual(restorePlanningState([
		{ type: "custom", customType: "mypi-continuity-mode", data: { mode: "off" } },
		{ type: "custom", customType: "mypi-work-plan", data: { action: "activate", plan } },
	]), { mode: "off", activePlan: plan });
	assert.deepEqual(restorePlanningState([
		{ type: "custom", customType: "mypi-work-plan", data: { action: "activate", plan } },
		{ type: "custom", customType: "mypi-work-plan", data: { action: "finish", filePath: plan.filePath } },
	]), { mode: "automatic", activePlan: undefined });
});

test("separates automatic continuity guidance from optional Plannotator review", () => {
	assert.equal(buildPlanningGuidance("off"), "");
	const idle = buildPlanningGuidance("automatic", undefined, 67.8);
	assert.match(idle, /mypi_start_work_plan/);
	assert.match(idle, /separate decision/);
	assert.match(idle, /about 68%/);

	const active = buildPlanningGuidance("automatic", {
		filePath: "workflow/artifacts/plan.md",
		title: "Workflow plan",
		reason: "หลาย phase",
		ownership: "caller",
	});
	assert.match(active, /workflow\/artifacts\/plan\.md/);
	assert.match(active, /never delete or relocate/);
});

test("creates and cleans managed ledgers while retaining caller-owned artifacts", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "my-pi-planning-workflow-"));
	const handlers = new Map<string, Array<(...args: any[]) => any>>();
	const tools = new Map<string, any>();
	const entries: unknown[] = [];
	let activeTools: string[] = [];
	const api = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
			activeTools.push(tool.name);
		},
		registerCommand() {},
		on(name: string, handler: (...args: any[]) => any) {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
		},
		events: {
			emit(_channel: string, data: unknown) {
				const request = data as {
					payload: { mode: string };
					respond: (result: unknown) => void;
				};
				request.respond({
					status: "handled",
					result: { phase: request.payload.mode === "enter" ? "planning" : "idle" },
				});
			},
		},
		getActiveTools() { return [...activeTools]; },
		setActiveTools(next: string[]) { activeTools = [...next]; },
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
	};

	try {
		planningWorkflow(api as any);
		entries.push({ type: "custom", customType: "mypi-continuity-mode", data: { mode: "off" } });
		const ctx = {
			cwd: workspace,
			hasUI: false,
			ui: { notify() {} },
			sessionManager: { getBranch: () => entries },
			getContextUsage: () => ({ percent: 10 }),
		};
		for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
		assert.equal(activeTools.includes("mypi_start_work_plan"), true, "off disables automatic guidance, not caller-driven plans");

		const start = tools.get("mypi_start_work_plan");
		const managedResult = await start.execute("id", {
			title: "Large refactor",
			reason: "ต้องทำหลาย phase",
		}, undefined, undefined, ctx);
		const managedPath = managedResult.details.plan.filePath as string;
		assert.match(managedPath, /^\.workbench\/continuity\//);
		assert.equal(existsSync(join(workspace, managedPath)), true);
		assert.match(readFileSync(join(workspace, managedPath), "utf8"), /## Next/);

		const beforeStart = handlers.get("before_agent_start")?.[0];
		const prompt = await beforeStart?.({ systemPrompt: "base" }, ctx);
		assert.match(prompt.systemPrompt, new RegExp(managedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

		const finish = tools.get("mypi_finish_work_plan");
		const managedFinish = await finish.execute("id", {
			outcome: "complete",
			summary: "verified",
		}, undefined, undefined, ctx);
		assert.equal(managedFinish.details.deleted, true);
		assert.equal(existsSync(join(workspace, managedPath)), false);

		const callerPath = "development/artifacts/implementation-plan.md";
		await start.execute("id", {
			title: "Implementation plan",
			reason: "เป็น artifact ของ workflow",
			filePath: callerPath,
		}, undefined, undefined, ctx);
		assert.equal(existsSync(join(workspace, callerPath)), true);
		const planningPrompt = await beforeStart?.({
			systemPrompt: "base\n[PLANNOTATOR - PLANNING PHASE]",
		}, ctx);
		assert.match(planningPrompt.systemPrompt, /Use `development\/artifacts\/implementation-plan\.md`/);
		assert.match(planningPrompt.systemPrompt, /plannotator_submit_plan/);
		const review = tools.get("mypi_use_plannotator");
		const reviewResult = await review.execute("id", {
			reason: "ต้องตรวจ dependency และ verification ก่อนลงมือ",
		}, undefined, undefined, ctx);
		assert.equal(reviewResult.details.entered, true);
		assert.equal(reviewResult.details.plan.filePath, callerPath);
		const callerFinish = await finish.execute("id", {
			outcome: "complete",
			summary: "verified",
		}, undefined, undefined, ctx);
		assert.equal(callerFinish.details.deleted, false);
		assert.equal(existsSync(join(workspace, callerPath)), true);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
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
