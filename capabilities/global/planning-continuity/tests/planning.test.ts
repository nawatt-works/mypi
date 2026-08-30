import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import planningWorkflow, {
	buildPlanningGuidance,
	parseContinuityCommand,
	requestPlannotatorPlanMode,
	resolveWorkspacePlanPath,
	restorePlanningState,
} from "../extensions/index.ts";

test("parses continuity modes and aliases", () => {
	assert.deepEqual(parseContinuityCommand(""), { kind: "show" });
	assert.deepEqual(parseContinuityCommand("on"), { kind: "set", mode: "automatic" });
	assert.deepEqual(parseContinuityCommand("off"), { kind: "set", mode: "off" });
	assert.deepEqual(parseContinuityCommand("ask"), { kind: "invalid" });
});

test("validates caller-selected paths without choosing a directory", () => {
	assert.equal(resolveWorkspacePlanPath("workflow/artifacts/plan.md", "/workspace").relativePath, "workflow/artifacts/plan.md");
	assert.throws(() => resolveWorkspacePlanPath("../plan.md", "/workspace"), /inside the workspace/);
	assert.throws(() => resolveWorkspacePlanPath(".git/plan.md", "/workspace"), /inside .git/);
	assert.throws(() => resolveWorkspacePlanPath("plan.txt", "/workspace"), /\.md or \.mdx/);
});

test("restores mode and the latest active plan from Pi session entries", () => {
	const legacyPlan = {
		filePath: "workflow/artifacts/plan.md",
		title: "Workflow plan",
		reason: "หลาย phase",
	};
	assert.deepEqual(restorePlanningState([
		{ type: "custom", customType: "mypi-continuity-mode", data: { mode: "off" } },
		{ type: "custom", customType: "mypi-work-plan", data: { action: "activate", plan: legacyPlan } },
	]), {
		mode: "off",
		activePlan: {
			id: "legacy:workflow/artifacts/plan.md",
			storage: "workspace",
			...legacyPlan,
		},
	});
	assert.deepEqual(restorePlanningState([
		{ type: "custom", customType: "mypi-work-plan", data: { action: "activate", plan: legacyPlan } },
		{ type: "custom", customType: "mypi-work-plan", data: { action: "finish", filePath: legacyPlan.filePath } },
	]), { mode: "automatic", activePlan: undefined });

	const firstSnapshot = {
		id: "session-1",
		storage: "session",
		title: "Refactor",
		reason: "ต้องทำหลายขั้น",
		snapshot: "Next: inspect callers",
	};
	const latestSnapshot = { ...firstSnapshot, snapshot: "Verified callers; next: update tests" };
	assert.deepEqual(restorePlanningState([
		{ type: "custom", customType: "mypi-work-plan", data: { action: "activate", plan: firstSnapshot } },
		{ type: "custom", customType: "mypi-work-plan", data: { action: "update", plan: latestSnapshot } },
	]), { mode: "automatic", activePlan: latestSnapshot });
	assert.deepEqual(restorePlanningState([
		{ type: "custom", customType: "mypi-work-plan", data: { action: "activate", plan: firstSnapshot } },
		{ type: "custom", customType: "mypi-work-plan", data: { action: "finish", planId: firstSnapshot.id } },
	]), { mode: "automatic", activePlan: undefined });
});

test("separates automatic continuity guidance from optional Plannotator review", () => {
	assert.equal(buildPlanningGuidance("off"), "");
	const idle = buildPlanningGuidance("automatic", undefined, 67.8);
	assert.match(idle, /mypi_start_work_plan/);
	assert.match(idle, /separate decision/);
	assert.match(idle, /about 68%/);
	assert.match(idle, /omit `filePath` and provide a concise `snapshot`/);
	assert.match(idle, /Do not invent a workspace path merely for AI self-tracking/);

	const active = buildPlanningGuidance("automatic", {
		id: "workspace-1",
		storage: "workspace",
		filePath: "workflow/artifacts/plan.md",
		title: "Workflow plan",
		reason: "หลาย phase",
	});
	assert.match(active, /workflow\/artifacts\/plan\.md/);
	assert.match(active, /never creates, rewrites, relocates, indexes, or deletes/);

	const session = buildPlanningGuidance("automatic", {
		id: "session-1",
		storage: "session",
		title: "Internal tracking",
		reason: "เสี่ยงโดน compact",
		snapshot: "Done: inspect API. Next: implement update tool.",
	});
	assert.match(session, /stored in the Pi session, not a workspace artifact/);
	assert.match(session, /mypi_update_work_plan/);
	assert.match(session, /Done: inspect API\. Next: implement update tool\./);
	assert.match(session, /not confidential storage/);
});

test("keeps AI-only work state in the Pi session and outside Plannotator", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "my-pi-session-plan-"));
	const handlers = new Map<string, Array<(...args: any[]) => any>>();
	const tools = new Map<string, any>();
	const entries: unknown[] = [];
	let activeTools: string[] = [];
	let plannotatorRequests = 0;
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
		events: { emit() { plannotatorRequests += 1; } },
		getActiveTools() { return [...activeTools]; },
		setActiveTools(next: string[]) { activeTools = [...next]; },
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
	};
	const ctx = {
		cwd: workspace,
		hasUI: false,
		ui: { notify() {} },
		sessionManager: { getBranch: () => entries },
		getContextUsage: () => ({ percent: 72 }),
	};

	try {
		planningWorkflow(api as any);
		for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
		const start = tools.get("mypi_start_work_plan");
		const review = tools.get("mypi_use_plannotator");
		await assert.rejects(
			review.execute("id", { reason: "review without artifact" }, undefined, undefined, ctx),
			/requires an explicit workspace plan path/,
		);
		await assert.rejects(
			start.execute("id", {
				title: "Missing snapshot",
				reason: "invalid session input",
			}, undefined, undefined, ctx),
			/session plan snapshot is required/i,
		);
		await assert.rejects(
			start.execute("id", {
				title: "Ambiguous",
				reason: "invalid mixed input",
				filePath: "plan.md",
				snapshot: "Next: should reject",
			}, undefined, undefined, ctx),
			/Choose one storage mode/,
		);
		const started = await start.execute("id", {
			title: "Internal refactor tracking",
			reason: "ต้องรอดจาก context compaction",
			snapshot: "Goal: refactor safely. Done: inspected callers. Next: update implementation.",
		}, undefined, undefined, ctx);
		assert.equal(started.details.plan.storage, "session");
		assert.equal(started.details.fileChanged, false);
		assert.deepEqual(activeTools.includes("mypi_start_work_plan"), false);
		assert.deepEqual(activeTools.includes("mypi_update_work_plan"), true);
		assert.deepEqual(activeTools.includes("mypi_finish_work_plan"), true);
		assert.deepEqual(activeTools.includes("mypi_use_plannotator"), false);
		assert.deepEqual(readdirSync(workspace), [], "session mode must not create any workspace artifact");

		const beforeStart = handlers.get("before_agent_start")?.[0];
		const initialPrompt = await beforeStart?.({ systemPrompt: "base" }, ctx);
		assert.match(initialPrompt.systemPrompt, /Goal: refactor safely/);
		assert.equal(plannotatorRequests, 0, "session plans must not query or enter Plannotator");

		const update = tools.get("mypi_update_work_plan");
		await update.execute("id", {
			snapshot: "Goal: refactor safely. Done: implementation. Verified: unit test. Next: docs.",
		}, undefined, undefined, ctx);
		const restored = restorePlanningState(entries);
		assert.equal(restored.activePlan?.storage, "session");
		assert.equal(restored.activePlan?.storage === "session" ? restored.activePlan.snapshot : "", "Goal: refactor safely. Done: implementation. Verified: unit test. Next: docs.");
		const updatedPrompt = await beforeStart?.({ systemPrompt: "base" }, ctx);
		assert.match(updatedPrompt.systemPrompt, /Verified: unit test\. Next: docs\./);

		await assert.rejects(
			review.execute("id", { reason: "review" }, undefined, undefined, ctx),
			/Plannotator requires a workspace plan/,
		);
		await assert.rejects(
			update.execute("id", { snapshot: "x".repeat(8_001) }, undefined, undefined, ctx),
			/must not exceed 8000 characters/,
		);

		const finish = tools.get("mypi_finish_work_plan");
		const finished = await finish.execute("id", {
			outcome: "complete",
			summary: "verified",
		}, undefined, undefined, ctx);
		assert.equal(finished.details.plan.storage, "session");
		assert.equal(restorePlanningState(entries).activePlan, undefined);
		assert.deepEqual(activeTools.includes("mypi_start_work_plan"), true);
		assert.deepEqual(activeTools.includes("mypi_update_work_plan"), false);
		assert.deepEqual(activeTools.includes("mypi_use_plannotator"), true);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
});

test("tracks an owner-selected path without creating, rewriting, or deleting it", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "my-pi-planning-workflow-"));
	const handlers = new Map<string, Array<(...args: any[]) => any>>();
	const tools = new Map<string, any>();
	const entries: unknown[] = [];
	let activeTools: string[] = [];
	let plannotatorPhase: "idle" | "planning" | "executing" = "idle";
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
				if (request.payload.mode === "enter") plannotatorPhase = "planning";
				request.respond({
					status: "handled",
					result: { phase: plannotatorPhase },
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
		const callerPath = "development/artifacts/implementation-plan.md";
		const startResult = await start.execute("id", {
			title: "Implementation plan",
			reason: "เป็น artifact ของ workflow",
			filePath: callerPath,
		}, undefined, undefined, ctx);
		assert.equal(startResult.details.fileChanged, false);
		assert.equal(startResult.details.plan.storage, "workspace");
		assert.equal(activeTools.includes("mypi_update_work_plan"), false);
		assert.equal(activeTools.includes("mypi_use_plannotator"), true);
		assert.equal(existsSync(join(workspace, callerPath)), false, "the extension must not create the artifact");

		const beforeStart = handlers.get("before_agent_start")?.[0];
		const prompt = await beforeStart?.({ systemPrompt: "base" }, ctx);
		assert.match(prompt.systemPrompt, /development\/artifacts\/implementation-plan\.md/);

		const finish = tools.get("mypi_finish_work_plan");
		const firstFinish = await finish.execute("id", {
			outcome: "complete",
			summary: "verified",
		}, undefined, undefined, ctx);
		assert.equal(firstFinish.details.fileChanged, false);
		assert.equal(existsSync(join(workspace, callerPath)), false);

		mkdirSync(join(workspace, "development/artifacts"), { recursive: true });
		writeFileSync(join(workspace, callerPath), "# Owner format\n\nDo not rewrite.\n", "utf8");
		await start.execute("id", {
			title: "Implementation plan",
			reason: "เป็น artifact ของ workflow",
			filePath: callerPath,
		}, undefined, undefined, ctx);
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
		const apiDetectedPlanningPrompt = await beforeStart?.({ systemPrompt: "base" }, ctx);
		assert.match(apiDetectedPlanningPrompt.systemPrompt, /Active Plannotator path/);
		assert.match(apiDetectedPlanningPrompt.systemPrompt, /plannotator_submit_plan/);
		const callerFinish = await finish.execute("id", {
			outcome: "complete",
			summary: "verified",
		}, undefined, undefined, ctx);
		assert.equal(callerFinish.details.fileChanged, false);
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
