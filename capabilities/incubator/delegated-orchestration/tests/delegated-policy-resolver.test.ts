import assert from "node:assert/strict";
import test from "node:test";
import type { GuardrailResolutionRequest } from "@nawatt-works/mypi-safety-guardrails";
import { analyzeCommand, type CommandPolicyRequest } from "../extensions/command-policy.ts";
import { createCommandReviewRegistry } from "../extensions/command-review-registry.ts";
import { registerDelegatedGuardrails } from "../extensions/delegated-guardrails.ts";
import { createDelegatedPolicyResolver } from "../extensions/delegated-policy-resolver.ts";
import { createAuthorityRegistry } from "../extensions/orchestration-registry.ts";
import type { DelegationMandate, PolicyLayers } from "../extensions/orchestration-policy.ts";

const NOW = "2026-08-30T01:00:00.000Z";
const POLICY_DIGEST = "a".repeat(64);

function mandate(): DelegationMandate {
	return {
		version: 1,
		id: "mandate-a",
		cwd: "/repo",
		goal: "finish bounded delegated work",
		definitionOfDone: ["verified artifact"],
		allowedHarnesses: ["pi-agent-teams"],
		maxConcurrentWorkers: 2,
		maxAgentLaunches: 4,
		writePolicy: "worktree-only",
		shellNetwork: "deny",
		secrets: "deny",
		uploads: "deny",
		humanOnly: ["push-deploy-publish", "external-destructive", "security-tradeoff"],
		createdAt: "2026-08-30T00:00:00.000Z",
		expiresAt: "2026-08-30T02:00:00.000Z",
	};
}

function setup(layers?: PolicyLayers) {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const pi = { appendEntry(customType: string, data: unknown) { entries.push({ customType, data }); } };
	const authority = createAuthorityRegistry(pi as any);
	authority.activateMandate(mandate(), NOW);
	authority.recordProfile({
		profileId: "pi-profile-v1",
		profileVersion: "1",
		backend: "pi-agent-teams",
		digest: "b".repeat(64),
		policyDigest: POLICY_DIGEST,
		verified: true,
	}, "2026-08-30T01:00:01.000Z");
	const reviews = createCommandReviewRegistry(pi as any, authority);
	const resolver = createDelegatedPolicyResolver({ authority, reviews, layers, now: () => "2026-08-30T01:01:30.000Z" });
	return { entries, authority, reviews, resolver };
}

function request(): CommandPolicyRequest {
	return {
		workerId: "worker-a",
		sessionId: "session-a",
		mandateId: "mandate-a",
		profileId: "pi-profile-v1",
		policyVersion: POLICY_DIGEST,
		workspaceRoot: "/private/worktrees/run-a/worker-a",
		cwd: "/private/worktrees/run-a/worker-a",
	};
}

function guardrailRequest(category: GuardrailResolutionRequest["category"]): GuardrailResolutionRequest {
	const kind = category === "external-upload" ? "external-upload" : category === "secret-read" ? "secret-read" : "external-write";
	return {
		category,
		cwd: "/repo",
		hasUI: true,
		findings: [{ kind, reason: "probe", target: category === "secret-read" ? "/repo/.env" : "/outside/file" }],
	};
}

test("hard-denies delegated secret reads and uploads without asking UI", async () => {
	const { authority, resolver } = setup();
	for (const category of ["secret-read", "external-upload"] as const) {
		const decision = await resolver.resolve(guardrailRequest(category));
		assert.equal(decision.outcome, "DENY");
	}
	assert.equal(authority.state().audit.filter((entry) => entry.type === "worker-blocked").length, 2);
});

test("composed delegated guardrail path blocks without opening Worker UI", async () => {
	const { authority, reviews } = setup();
	const handlers = new Map<string, (...args: any[]) => any>();
	let uiCalls = 0;
	registerDelegatedGuardrails({
		pi: {
			on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
			events: { emit() {} },
		} as any,
		authority,
		reviews,
		now: () => "2026-08-30T01:01:30.000Z",
	});
	const result = await handlers.get("tool_call")?.(
		{ toolName: "read", input: { path: ".env" } },
		{ cwd: "/repo", hasUI: true, ui: { async select() { uiCalls += 1; return "Allow once"; } } },
	);
	assert.equal(result?.block, true);
	assert.equal(uiCalls, 0);
	assert.match(result?.reason ?? "", /secret is hard denied/);
});

test("denies external mutations outside the mandate instead of widening manual session scope", async () => {
	const { resolver } = setup();
	const decision = await resolver.resolve(guardrailRequest("external-mutation"));
	assert.equal(decision.outcome, "DENY");
	assert.match(decision.reason, /external filesystem access is denied/);
});

test("consumes an exact REVIEW grant once and never treats it as bearer authority", () => {
	const { authority, reviews, resolver } = setup();
	const analysis = analyzeCommand("rm -rf build/cache", {
		workspaceRoot: request().workspaceRoot,
		cwd: request().cwd,
	});
	assert.equal(analysis.recommendedOutcome, "REVIEW");
	const before = resolver.resolveCommand(request(), analysis, "2026-08-30T01:01:20.000Z");
	assert.equal(before.outcome, "REVIEW");
	assert.equal(before.executionAllowed, false);
	reviews.issue(request(), analysis, { now: "2026-08-30T01:01:25.000Z", ttlMs: 60_000 });
	const allowed = resolver.resolveCommand(request(), analysis, "2026-08-30T01:01:30.000Z");
	assert.equal(allowed.outcome, "ALLOW");
	assert.equal(allowed.executionAllowed, true);
	assert.equal(allowed.reviewed, true);
	assert.equal(authority.state().audit.at(-1)?.type, "review-grant-consumed");
	const replay = resolver.resolveCommand(request(), analysis, "2026-08-30T01:01:31.000Z");
	assert.equal(replay.outcome, "REVIEW");
	assert.equal(replay.executionAllowed, false);
	assert.equal(replay.reviewed, false);
});

test("HUMAN and DENY policy ceilings cannot be overridden by an active grant", () => {
	const layers: PolicyLayers = {
		global: { version: "global-v1", decisions: { command: "HUMAN" }, reason: "managed human ceiling" },
	};
	const { reviews, resolver } = setup(layers);
	const analysis = analyzeCommand("rm -rf build/cache", { workspaceRoot: request().workspaceRoot, cwd: request().cwd });
	reviews.issue(request(), analysis, { now: "2026-08-30T01:01:25.000Z", ttlMs: 60_000 });
	const decision = resolver.resolveCommand(request(), analysis, "2026-08-30T01:01:30.000Z");
	assert.equal(decision.outcome, "HUMAN");
	assert.equal(decision.executionAllowed, false);
	assert.equal(decision.reviewed, false);
	assert.equal(reviews.state("2026-08-30T01:01:31.000Z").records[0]?.status, "active");

	const hard = analyzeCommand("git push origin main", { workspaceRoot: request().workspaceRoot, cwd: request().cwd });
	const hardDecision = resolver.resolveCommand(request(), hard, "2026-08-30T01:01:32.000Z");
	assert.equal(hardDecision.outcome, "HUMAN");
	assert.equal(hardDecision.executionAllowed, false);
});

test("fails closed without active trusted authority", async () => {
	const { authority, resolver } = setup();
	authority.finishMandate("cancelled", "2026-08-30T01:01:00.000Z");
	const mutation = await resolver.resolve(guardrailRequest("external-mutation"));
	assert.equal(mutation.outcome, "DENY");
	assert.match(mutation.reason, /requires an active mandate/);
	const analysis = analyzeCommand("echo ok", { workspaceRoot: request().workspaceRoot, cwd: request().cwd });
	const command = resolver.resolveCommand(request(), analysis, "2026-08-30T01:01:30.000Z");
	assert.equal(command.outcome, "DENY");
	assert.equal(command.executionAllowed, false);
});
