import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCommand, type CommandPolicyRequest } from "../extensions/command-policy.ts";
import {
	COMMAND_REVIEW_ENTRY,
	createCommandReviewRegistry,
	restoreCommandReviewRegistry,
} from "../extensions/command-review-registry.ts";
import { createAuthorityRegistry } from "../extensions/orchestration-registry.ts";
import type { DelegationMandate } from "../extensions/orchestration-policy.ts";

const NOW = "2026-08-30T01:00:00.000Z";
const POLICY_DIGEST = "a".repeat(64);
const PROFILE_DIGEST = "b".repeat(64);

function mandate(): DelegationMandate {
	return {
		version: 1,
		id: "mandate-a",
		cwd: "/repo",
		goal: "review bounded cleanup",
		definitionOfDone: ["cleanup verified"],
		allowedHarnesses: ["pi"],
		maxConcurrentWorkers: 1,
		maxAgentLaunches: 2,
		writePolicy: "worktree-only",
		shellNetwork: "deny",
		secrets: "deny",
		uploads: "deny",
		humanOnly: ["push-deploy-publish"],
		createdAt: "2026-08-30T00:00:00.000Z",
		expiresAt: "2026-08-30T02:00:00.000Z",
	};
}

function request(overrides: Partial<CommandPolicyRequest> = {}): CommandPolicyRequest {
	return {
		workerId: "worker-a",
		sessionId: "session-a",
		mandateId: "mandate-a",
		profileId: "pi-profile-v1",
		policyVersion: POLICY_DIGEST,
		generationDigest: "c".repeat(64),
		workspaceRoot: "/repo",
		cwd: "/repo",
		...overrides,
	};
}

function reviewAnalysis(command = "rm -rf build/cache") {
	return analyzeCommand(command, { workspaceRoot: "/repo", cwd: "/repo" });
}

function setup() {
	const entries: Array<{ type: "custom"; customType: string; data: any }> = [];
	const control: { failReviewAction?: string } = {};
	const pi = {
		appendEntry(customType: string, data: any) {
			if (customType === COMMAND_REVIEW_ENTRY && control.failReviewAction === data?.action) throw new Error(`injected ${data.action} append failure`);
			entries.push({ type: "custom", customType, data });
		},
	};
	const authority = createAuthorityRegistry(pi as any);
	authority.activateMandate(mandate(), NOW);
	authority.recordProfile({
		profileId: "pi-profile-v1",
		profileVersion: "1",
		backend: "pi-agent-teams",
		digest: PROFILE_DIGEST,
		policyDigest: POLICY_DIGEST,
		verified: true,
	}, "2026-08-30T01:00:01.000Z");
	const reviews = createCommandReviewRegistry(pi as any, authority);
	return { pi, entries, authority, reviews, control };
}

test("issues an exact short-lived grant without storing the raw command", () => {
	const { entries, authority, reviews } = setup();
	const analysis = reviewAnalysis();
	assert.equal(analysis.recommendedOutcome, "REVIEW");
	const grant = reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z", ttlMs: 60_000 });
	assert.equal(grant.commandDigest, analysis.commandDigest);
	assert.equal(grant.policyVersion, POLICY_DIGEST);
	assert.match(grant.bindingDigest, /^[a-f0-9]{64}$/);
	assert.equal(reviews.state("2026-08-30T01:01:30.000Z").records[0].status, "active");
	assert.equal(entries.filter((entry) => entry.customType === COMMAND_REVIEW_ENTRY).at(-1)?.data.action, "issue");
	assert.ok(!JSON.stringify(entries).includes("rm -rf build/cache"));

	grant.resources.push("tampered");
	assert.ok(!reviews.state("2026-08-30T01:01:30.000Z").records[0].grant.resources.includes("tampered"));
	const issue = entries.find((entry) => entry.customType === COMMAND_REVIEW_ENTRY)?.data;
	assert.ok(issue);
	assert.ok(!issue.grant.resources.includes("tampered"));
});

test("consumes a matching grant once and replay returns REVIEW without execution", () => {
	const { entries, authority, reviews } = setup();
	const analysis = reviewAnalysis();
	reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z", ttlMs: 120_000 });
	const first = reviews.consume(request(), analysis, "2026-08-30T01:01:30.000Z");
	assert.equal(first.outcome, "ALLOW");
	assert.equal(first.executionAllowed, true);
	assert.equal(first.reviewed, true);
	assert.ok(first.grantId);
	assert.equal(reviews.state("2026-08-30T01:01:31.000Z").records[0].status, "consumed");
	assert.equal(entries.filter((entry) => entry.customType === COMMAND_REVIEW_ENTRY).at(-1)?.data.action, "consume");

	const replay = reviews.consume(request(), analysis, "2026-08-30T01:01:32.000Z");
	assert.equal(replay.outcome, "REVIEW");
	assert.equal(replay.executionAllowed, false);
	assert.equal(replay.reviewed, false);

	const restored = restoreCommandReviewRegistry(entries, "2026-08-30T01:01:40.000Z");
	assert.equal(restored.failClosedReason, undefined);
	assert.equal(restored.records[0].status, "consumed");
});

test("finds grants from trusted context rather than a Worker-supplied bearer id", () => {
	const { reviews } = setup();
	const analysis = reviewAnalysis();
	reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z" });
	for (const mismatch of [
		request({ workerId: "worker-b" }),
		request({ sessionId: "session-b" }),
		request({ cwd: "/repo/sub" }),
	]) {
		const mismatchDecision = reviews.consume(mismatch, analysis, "2026-08-30T01:01:30.000Z");
		assert.equal(mismatchDecision.executionAllowed, false);
		assert.equal(mismatchDecision.reviewed, false);
	}
	assert.throws(
		() => reviews.consume(request({ policyVersion: "c".repeat(64) }), analysis, "2026-08-30T01:01:30.000Z"),
		/not the authoritative profile policy/,
	);
	assert.throws(
		() => reviews.issue(request({ policyVersion: "c".repeat(64) }), analysis, { now: "2026-08-30T01:01:30.000Z" }),
		/not the authoritative profile policy/,
	);
	const differentCommand = reviewAnalysis("rm -rf build/other");
	const decision = reviews.consume(request(), differentCommand, "2026-08-30T01:01:30.000Z");
	assert.equal(decision.outcome, "REVIEW");
	assert.equal(decision.executionAllowed, false);
});

test("expired or revoked grants cannot execute", () => {
	const expiredSetup = setup();
	const analysis = reviewAnalysis();
	expiredSetup.reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z", ttlMs: 1_000 });
	assert.equal(expiredSetup.reviews.state("2026-08-30T01:01:02.000Z").records[0].status, "expired");
	assert.equal(expiredSetup.reviews.consume(request(), analysis, "2026-08-30T01:01:02.000Z").executionAllowed, false);

	const revokedSetup = setup();
	const grant = revokedSetup.reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z" });
	revokedSetup.reviews.revoke(grant.grantId, "2026-08-30T01:01:30.000Z");
	assert.equal(revokedSetup.reviews.state("2026-08-30T01:01:31.000Z").records[0].status, "revoked");
	assert.equal(revokedSetup.reviews.consume(request(), analysis, "2026-08-30T01:01:32.000Z").executionAllowed, false);
	assert.equal(revokedSetup.entries.filter((entry) => entry.customType === COMMAND_REVIEW_ENTRY).at(-1)?.data.action, "revoke");
});

test("never issues grants for ALLOW, HUMAN, DENY, unverified profiles, or non-digest policies", () => {
	const { reviews } = setup();
	const cases = [
		analyzeCommand("npm test", { workspaceRoot: "/repo", cwd: "/repo" }),
		analyzeCommand("git push origin main", { workspaceRoot: "/repo", cwd: "/repo" }),
		analyzeCommand("rm -rf /", { workspaceRoot: "/repo", cwd: "/repo" }),
	];
	for (const analysis of cases) assert.throws(() => reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z" }), /cannot issue/);
	assert.throws(() => reviews.issue(request({ profileId: "missing" }), reviewAnalysis(), { now: "2026-08-30T01:01:00.000Z" }), /verified authority reference/);
	assert.throws(() => reviews.issue(request({ policyVersion: "command-v1" }), reviewAnalysis(), { now: "2026-08-30T01:01:00.000Z" }), /policyVersion/);
});

test("duplicate active exact-context grants and tampered history fail closed", () => {
	const { entries, reviews } = setup();
	const analysis = reviewAnalysis();
	reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z" });
	assert.throws(() => reviews.issue(request(), analysis, { now: "2026-08-30T01:01:01.000Z" }), /already exists/);

	const reviewEntries = entries.filter((entry) => entry.customType === COMMAND_REVIEW_ENTRY);
	const duplicate = restoreCommandReviewRegistry([...reviewEntries, reviewEntries[0]], "2026-08-30T01:01:30.000Z");
	assert.ok(duplicate.failClosedReason);
	assert.deepEqual(duplicate.records, []);

	const tamperedEntry = structuredClone(reviewEntries[0]);
	tamperedEntry.data.grant.resources.push("/tampered");
	const tampered = restoreCommandReviewRegistry([tamperedEntry], "2026-08-30T01:01:30.000Z");
	assert.match(tampered.failClosedReason ?? "", /tampered/);
	assert.deepEqual(tampered.records, []);
});

test("an append failure makes the registry fail closed before a grant can be retried", () => {
	const { reviews, control, entries } = setup();
	const analysis = reviewAnalysis();
	reviews.issue(request(), analysis, { now: "2026-08-30T01:01:00.000Z" });
	control.failReviewAction = "consume";
	assert.throws(() => reviews.consume(request(), analysis, "2026-08-30T01:01:30.000Z"), /consume append failed/);
	assert.match(reviews.state("2026-08-30T01:01:31.000Z").failClosedReason ?? "", /consume append failed/);
	assert.throws(() => reviews.consume(request(), analysis, "2026-08-30T01:01:32.000Z"), /fail closed/);
	assert.equal(entries.filter((entry) => entry.customType === COMMAND_REVIEW_ENTRY && entry.data.action === "consume").length, 0);
});

test("registry restored from bad history remains fail closed", () => {
	const { reviews } = setup();
	reviews.restore([
		{ type: "custom", customType: COMMAND_REVIEW_ENTRY, data: { schemaVersion: 1, action: "issue", at: NOW } },
	], NOW);
	assert.ok(reviews.state(NOW).failClosedReason);
	assert.throws(() => reviews.issue(request(), reviewAnalysis(), { now: NOW }), /fail closed/);
});
