import assert from "node:assert/strict";
import test from "node:test";
import {
	evaluateOrchestrationPolicy,
	mandateDigest,
	mandateNarrows,
	redactForAudit,
	validateMandate,
	validateOrchestrationAction,
	type DelegationMandate,
	type OrchestrationAction,
	type PolicyOutcome,
} from "../extensions/orchestration-policy.ts";

const NOW = "2026-08-30T01:00:00.000Z";
const CWD = "/repo";

function mandate(overrides: Partial<DelegationMandate> = {}): DelegationMandate {
	return {
		version: 1,
		id: "mandate-a",
		cwd: CWD,
		goal: "แก้และตรวจ fixture ภายในขอบเขต",
		definitionOfDone: ["tests pass", "artifact verified"],
		allowedHarnesses: ["pi"],
		maxConcurrentWorkers: 2,
		maxAgentLaunches: 5,
		writePolicy: "worktree-only",
		shellNetwork: "deny",
		secrets: "deny",
		uploads: "deny",
		humanOnly: ["architecture-change", "scope-expansion", "security-tradeoff", "external-destructive", "push-deploy-publish"],
		createdAt: "2026-08-30T00:00:00.000Z",
		expiresAt: "2026-08-30T02:00:00.000Z",
		...overrides,
	};
}

function context() {
	return { mandateId: "mandate-a", authorityCwd: CWD };
}

function decide(action: OrchestrationAction, input: Record<string, unknown> = {}) {
	return evaluateOrchestrationPolicy({ mandate: mandate(), action, now: NOW, ...input });
}

test("validates and canonicalizes a bounded mandate deterministically", () => {
	const raw = mandate({
		cwd: "/repo/../repo",
		shellNetwork: { allowDomains: ["API.Example.COM."] },
	});
	const validated = validateMandate(raw, { now: NOW });
	assert.equal(validated.ok, true);
	if (!validated.ok) return;
	assert.equal(validated.value.cwd, "/repo");
	assert.deepEqual(validated.value.shellNetwork, { allowDomains: ["api.example.com"] });
	assert.equal(mandateDigest(validated.value), mandateDigest({ ...validated.value }));
	assert.match(mandateDigest(validated.value), /^[a-f0-9]{64}$/);
});

test("fails closed on malformed, overbroad, future, or stale mandates", () => {
	for (const [label, value] of [
		["unknown key", { ...mandate(), unexpected: true }],
		["relative cwd", { ...mandate(), cwd: "repo" }],
		["worker ceiling", { ...mandate(), maxConcurrentWorkers: 4 }],
		["secret access", { ...mandate(), secrets: "allow" }],
		["uploads", { ...mandate(), uploads: "allow" }],
		["future", { ...mandate(), createdAt: "2026-08-30T01:10:01.000Z", expiresAt: "2026-08-30T02:00:00.000Z" }],
		["stale", { ...mandate(), expiresAt: "2026-08-30T00:30:00.000Z" }],
		["wildcard domain", { ...mandate(), shellNetwork: { allowDomains: ["*.example.com"] } }],
	] as const) {
		const result = validateMandate(value, { now: NOW });
		assert.equal(result.ok, false, label);
	}
});

test("allows routine scoped work and enforces spawn ceilings and harnesses", () => {
	assert.equal(decide({ ...context(), kind: "routine", capability: "test" }).outcome, "ALLOW");
	assert.equal(decide({ ...context(), kind: "spawn", harness: "pi", writing: true, concurrentWorkers: 1, agentLaunches: 4 }).outcome, "ALLOW");
	assert.equal(decide({ ...context(), kind: "spawn", harness: "codex", writing: false, concurrentWorkers: 0, agentLaunches: 0 }).outcome, "DENY");
	assert.match(decide({ ...context(), kind: "spawn", harness: "pi", writing: true, concurrentWorkers: 2, agentLaunches: 2 }).reason, /ceiling/);
	assert.equal(evaluateOrchestrationPolicy({
		mandate: mandate({ writePolicy: "read-only" }), now: NOW,
		action: { ...context(), kind: "spawn", harness: "pi", writing: true, concurrentWorkers: 0, agentLaunches: 0 },
	}).outcome, "DENY");
});

test("denies secrets, uploads, external paths and shell network by default", () => {
	const actions: OrchestrationAction[] = [
		{ ...context(), kind: "secret", operation: "read" },
		{ ...context(), kind: "upload", target: "local-file" },
		{ ...context(), kind: "filesystem", operation: "write", targetScope: "external" },
		{ ...context(), kind: "filesystem", operation: "read", targetScope: "secret" },
		{ ...context(), kind: "shell-network", domain: "example.com" },
	];
	for (const action of actions) {
		const decision = decide(action);
		assert.equal(decision.outcome, "DENY");
		assert.equal(decision.executionAllowed, false);
	}
});

test("uses exact shell-network allowlists and fails closed on unknown destinations", () => {
	const allowed = mandate({ shellNetwork: { allowDomains: ["api.example.com"] } });
	const evaluate = (domain?: string) => evaluateOrchestrationPolicy({
		mandate: allowed,
		action: { ...context(), kind: "shell-network", ...(domain ? { domain } : {}) },
		now: NOW,
	});
	assert.equal(evaluate("API.EXAMPLE.COM.").outcome, "ALLOW");
	assert.equal(evaluate("sub.api.example.com").outcome, "DENY");
	assert.equal(evaluate().outcome, "DENY");
});

test("routes only named human boundaries to HUMAN and never executes them", () => {
	for (const category of ["push-deploy-publish", "external-destructive"] as const) {
		const decision = decide({ ...context(), kind: "external-mutation", category });
		assert.equal(decision.outcome, "HUMAN");
		assert.equal(decision.requiresHuman, true);
		assert.equal(decision.executionAllowed, false);
	}
	const architecture = decide({ ...context(), kind: "decision", category: "architecture-change" });
	assert.equal(architecture.outcome, "HUMAN");
	assert.equal(decide({ ...context(), kind: "external-mutation", category: "remote-code-execution" }).source, "hard-deny");
	assert.equal(evaluateOrchestrationPolicy({
		mandate: mandate({ humanOnly: [] }), now: NOW,
		action: { ...context(), kind: "decision", category: "architecture-change" },
	}).outcome, "DENY", "omitting a human grant narrows to DENY; it never becomes ALLOW");
});

test("lower policy layers can only narrow higher authority", () => {
	const outcomes: PolicyOutcome[] = ["ALLOW", "REVIEW", "HUMAN", "DENY"];
	const rank: Record<PolicyOutcome, number> = { ALLOW: 0, REVIEW: 1, HUMAN: 2, DENY: 3 };
	for (const global of outcomes) {
		for (const task of outcomes) {
			const decision = decide(
				{ ...context(), kind: "routine", capability: "test" },
				{ layers: {
					global: { version: "g1", defaultOutcome: global, reason: "global" },
					task: { version: "t1", defaultOutcome: task, reason: "task" },
				} },
			);
			const expected = rank[global] >= rank[task] ? global : task;
			assert.equal(decision.outcome, expected, `${global} then ${task}`);
			assert.match(decision.policyDigest ?? "", /^[a-f0-9]{64}$/);
			if (rank[task] < rank[global]) assert.equal(decision.source, "global", "a task cannot widen global authority");
		}
	}
});

test("hardline command deny survives every REVIEW/HUMAN/ALLOW layer", () => {
	const decision = decide(
		{ ...context(), kind: "command", analyzerOutcome: "DENY", findingCodes: ["workspace-root-destruction"] },
		{ layers: {
			global: { version: "g1", defaultOutcome: "ALLOW", reason: "allow" },
			trustedProject: { version: "p1", defaultOutcome: "REVIEW", reason: "review" },
			workerProfile: { version: "w1", defaultOutcome: "HUMAN", reason: "human" },
		} },
	);
	assert.equal(decision.outcome, "DENY");
	assert.equal(decision.source, "hard-deny");
	assert.equal(decision.reviewableByCoordinator, false);
});

test("mandate replacement accepts narrowing and reports every expansion", () => {
	const previous = mandate();
	const narrower = mandate({
		id: "mandate-b",
		allowedHarnesses: ["pi"],
		maxConcurrentWorkers: 1,
		maxAgentLaunches: 3,
		writePolicy: "read-only",
		shellNetwork: "deny",
		humanOnly: ["architecture-change"],
		expiresAt: "2026-08-30T01:30:00.000Z",
	});
	assert.deepEqual(mandateNarrows(previous, narrower), { narrows: true, expansions: [] });
	const expanded = mandateNarrows(narrower, mandate({ id: "mandate-c", allowedHarnesses: ["pi", "codex"], maxConcurrentWorkers: 2 }));
	assert.equal(expanded.narrows, false);
	assert.ok(expanded.expansions.includes("allowedHarnesses"));
	assert.ok(expanded.expansions.includes("maxConcurrentWorkers"));
	assert.ok(expanded.expansions.includes("writePolicy"));
});

test("malformed action contexts fail closed before policy resolution", () => {
	assert.ok(validateOrchestrationAction({ kind: "spawn" }).length > 0);
	const decision = evaluateOrchestrationPolicy({
		mandate: mandate(),
		action: { ...context(), kind: "spawn", harness: "pi", writing: true, concurrentWorkers: -1, agentLaunches: 0 } as OrchestrationAction,
		now: NOW,
	});
	assert.equal(decision.outcome, "DENY");
	assert.match(decision.reason, /invalid policy request/);
	const malformedLayer = evaluateOrchestrationPolicy({
		mandate: mandate(),
		action: { ...context(), kind: "routine", capability: "test" },
		now: NOW,
		layers: { global: { version: "", reason: "", defaultOutcome: "ALLOW" } },
	});
	assert.equal(malformedLayer.outcome, "DENY");
	assert.match(malformedLayer.reason, /global policy/);
});

test("redacts secret-bearing audit fields and launch arguments recursively", () => {
	const redacted = redactForAudit({
		token: "top-secret",
		nested: { Authorization: "Bearer abc.def", note: "token=visible-nope" },
		launchArgs: ["--model", "m", "--api-key", "abc", "API_TOKEN=xyz", "--flag"],
	}) as any;
	assert.equal(redacted.token, "[REDACTED]");
	assert.equal(redacted.nested.Authorization, "[REDACTED]");
	assert.match(redacted.nested.note, /\[REDACTED\]/);
	assert.deepEqual(redacted.launchArgs, ["--model", "m", "--api-key", "[REDACTED]", "API_TOKEN=[REDACTED]", "--flag"]);
	assert.ok(!JSON.stringify(redacted).includes("abc"));
	assert.ok(!JSON.stringify(redacted).includes("xyz"));
});
