import assert from "node:assert/strict";
import test from "node:test";
import {
	AUTHORITY_ENTRY,
	REGISTRY_ENTRY,
	createAuthorityRegistry,
	createWorkerRegistry,
	isValidWorkerName,
	normalizeWorkerName,
	reconcileWorkers,
	resolveIdentity,
	restoreRegistry,
	assuranceMet,
	restoreAssurance,
	restoreAuthorityRegistry,
	type WorkerRecord,
} from "../extensions/orchestration-registry.ts";
import type { DelegationMandate } from "../extensions/orchestration-policy.ts";

function fakePi(agentListStdout?: string) {
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
	const pi = {
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		exec: async () => ({
			stdout: agentListStdout ?? '{"id":"cli:agent:list","result":{"agents":[]}}',
			stderr: "",
			code: 0,
			killed: false,
		}),
	};
	return { pi: pi as any, entries };
}

test("derives names Herdr will accept and keeps them unique", () => {
	assert.equal(normalizeWorkerName("Researcher: auth flow"), "researcher-auth-flow");
	assert.equal(normalizeWorkerName("2nd reviewer"), "w-2nd-reviewer");
	assert.equal(normalizeWorkerName("developer", ["developer"]), "developer-2");
	assert.equal(normalizeWorkerName("developer", ["developer", "developer-2"]), "developer-3");
	assert.equal(normalizeWorkerName("!!!"), "worker");

	const long = normalizeWorkerName("a".repeat(60));
	assert.equal(long.length, 32);
	assert.ok(isValidWorkerName(long));
	assert.ok(isValidWorkerName(normalizeWorkerName("Researcher: auth flow")));
	assert.equal(isValidWorkerName("Researcher"), false);
	assert.equal(isValidWorkerName("1st"), false);
});

test("never upgrades an unverified harness to a confirmed one", () => {
	assert.equal(resolveIdentity("codex", "codex"), "confirmed");
	assert.equal(resolveIdentity("codex", "claude"), "mismatch");
	assert.equal(resolveIdentity("codex", undefined), "unknown");
});

test("rebuilds the mapping from session entries after compaction or resume", () => {
	const { pi, entries } = fakePi();
	const registry = createWorkerRegistry(pi);

	registry.register({ name: "researcher", task: "สำรวจ auth", requestedHarness: "claude", cwd: "/repo" });
	registry.update("researcher", { status: "live", paneId: "w7:p9" });
	registry.addArtifact("researcher", {
		kind: "path",
		value: "reports/auth.md",
		purpose: "ข้อสรุปที่ developer ต้องอ่านก่อน implement",
		producedBy: "researcher",
	});
	registry.register({ name: "developer", task: "implement", requestedHarness: "codex" });
	registry.release("developer");

	const restored = restoreRegistry(entries);
	assert.equal(restored.length, 1);
	assert.equal(restored[0].name, "researcher");
	assert.equal(restored[0].status, "live");
	assert.equal(restored[0].paneId, "w7:p9");
	assert.deepEqual(restored[0].artifacts.map((artifact) => artifact.value), ["reports/auth.md"]);
	assert.equal(entries[0].customType, REGISTRY_ENTRY);
});

test("ignores unrelated session entries and updates for unknown workers", () => {
	const restored = restoreRegistry([
		{ type: "custom", customType: "mypi-work-plan", data: { action: "activate" } },
		{ type: "message", customType: REGISTRY_ENTRY, data: { action: "register", worker: { name: "x" } } },
		{ type: "custom", customType: REGISTRY_ENTRY, data: { action: "update", name: "ghost", patch: { status: "live" } } },
	]);
	assert.deepEqual(restored, []);
});

test("lets Herdr decide which workers still exist", () => {
	const base: WorkerRecord = {
		name: "developer",
		task: "implement",
		requestedHarness: "codex",
		identity: "unknown",
		identityEvidence: "none",
		status: "live",
		artifacts: [],
		createdAt: "2026-08-25T00:00:00.000Z",
		updatedAt: "2026-08-25T00:00:00.000Z",
	};

	const [confirmed] = reconcileWorkers([base], [{
		name: "developer",
		agent: "codex",
		pane_id: "w7:pB",
		cwd: "/repo",
		state_change_seq: 1690,
		agent_session: { value: "/sessions/codex.jsonl", kind: "path" },
	}]);
	assert.equal(confirmed.status, "live");
	assert.equal(confirmed.identity, "confirmed");
	assert.equal(confirmed.identityEvidence, "lifecycle");
	assert.equal(confirmed.sessionRef, "/sessions/codex.jsonl");
	assert.equal(confirmed.sessionRefKind, "path");
	assert.equal(confirmed.lastSeq, 1690);

	// Before the worker runs a turn its integration has reported nothing yet.
	const [detected] = reconcileWorkers([base], [{ name: "developer", agent: "codex", pane_id: "w7:pB" }]);
	assert.equal(detected.identityEvidence, "detection");
	assert.equal(detected.identity, "confirmed");

	const [wrong] = reconcileWorkers([base], [{ name: "developer", agent: "claude", pane_id: "w7:pB" }]);
	assert.equal(wrong.identity, "mismatch");

	const [gone] = reconcileWorkers([base], []);
	assert.equal(gone.status, "gone");
	assert.equal(gone.identity, "unknown");
	assert.equal(gone.identityEvidence, "none");

	const [starting] = reconcileWorkers([{ ...base, status: "spawning" }], []);
	assert.equal(starting.status, "spawning", "a worker that has not appeared yet is not gone");
});

test("refreshes observed identity from a live agent listing", async () => {
	const listing = JSON.stringify({
		id: "cli:agent:list",
		result: {
			agents: [
				{ name: "researcher", agent: "claude", pane_id: "w7:p9", state_change_seq: 42 },
				{ agent: "pi", pane_id: "w7:p1" },
			],
		},
	});
	const { pi } = fakePi(listing);
	const registry = createWorkerRegistry(pi);
	registry.register({ name: "researcher", task: "สำรวจ", requestedHarness: "claude" });

	const refreshed = await registry.refresh();
	assert.equal(refreshed[0].status, "live");
	assert.equal(refreshed[0].observedKind, "claude");
	assert.equal(refreshed[0].identity, "confirmed");
	assert.equal(refreshed[0].identityEvidence, "detection");
	assert.equal(refreshed[0].lastSeq, 42);
});

test("keeps the stored mapping when Herdr cannot be reached", async () => {
	const entries: unknown[] = [];
	const pi = {
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		exec: async () => {
			throw new Error("spawn herdr ENOENT");
		},
	};
	const registry = createWorkerRegistry(pi as any);
	registry.register({ name: "researcher", task: "สำรวจ", requestedHarness: "claude" });

	const refreshed = await registry.refresh();
	assert.equal(refreshed.length, 1);
	assert.equal(refreshed[0].status, "spawning", "an unreachable CLI must not be read as a dead worker");
});

test("refuses names Herdr would reject and duplicate registrations", () => {
	const { pi } = fakePi();
	const registry = createWorkerRegistry(pi);
	assert.throws(() => registry.register({ name: "Researcher", task: "t", requestedHarness: "pi" }), /valid Herdr agent name/);
	registry.register({ name: "researcher", task: "t", requestedHarness: "pi" });
	assert.throws(() => registry.register({ name: "researcher", task: "t", requestedHarness: "pi" }), /already registered/);
});

test("keeps the assurance decision apart from how many workers ran", () => {
	const { pi, entries } = fakePi();
	const registry = createWorkerRegistry(pi);

	assert.equal(registry.assurance().level, "coordinator");
	assert.equal(assuranceMet(registry.assurance()), false, "no verified evidence yet");

	registry.recordVerified("implementer");
	assert.equal(assuranceMet(registry.assurance()), true);

	// Raising the bar does not discard evidence already collected.
	registry.setAssurance("independent-review", "แก้ code ที่ผู้ใช้พึ่งพา", "implementer");
	assert.deepEqual(registry.assurance().verifiedBy, ["implementer"]);
	assert.equal(assuranceMet(registry.assurance()), false, "one worker cannot review its own work");

	registry.recordVerified("reviewer");
	assert.equal(assuranceMet(registry.assurance()), true);

	// The common shape: the Coordinator implements and a single Worker reviews.
	// Counting two verifiers would make that unsatisfiable.
	const solo = createWorkerRegistry(fakePi().pi);
	solo.setAssurance("independent-review", "release gate");
	assert.equal(solo.assurance().producedBy, "coordinator");
	solo.recordVerified("release-review");
	assert.equal(assuranceMet(solo.assurance()), true, "a reviewer other than the producer is independence");

	const selfReview = createWorkerRegistry(fakePi().pi);
	selfReview.setAssurance("independent-review", "release gate", "release-review");
	selfReview.recordVerified("release-review");
	assert.equal(assuranceMet(selfReview.assurance()), false, "a worker verifying its own work is not independent");

	// A human gate never closes by itself.
	registry.setAssurance("human-approval", "ผู้ใช้ขอตรวจเอง");
	assert.equal(assuranceMet(registry.assurance()), false);

	const replayed = restoreAssurance(entries);
	assert.equal(replayed.level, "human-approval");
	assert.deepEqual(replayed.verifiedBy, ["implementer", "reviewer"]);
});

test("assurance entries never leak into the worker mapping", () => {
	const { pi, entries } = fakePi();
	const registry = createWorkerRegistry(pi);
	registry.setAssurance("independent-review", "r");
	registry.recordVerified("ghost");
	assert.deepEqual(restoreRegistry(entries), []);
});


const AUTH_NOW = "2026-08-30T01:00:00.000Z";

function authorityMandate(overrides: Partial<DelegationMandate> = {}): DelegationMandate {
	return {
		version: 1,
		id: "mandate-a",
		cwd: "/repo",
		goal: "bounded registry test",
		definitionOfDone: ["evidence verified"],
		allowedHarnesses: ["pi"],
		maxConcurrentWorkers: 2,
		maxAgentLaunches: 5,
		writePolicy: "worktree-only",
		shellNetwork: "deny",
		secrets: "deny",
		uploads: "deny",
		humanOnly: ["architecture-change", "push-deploy-publish"],
		createdAt: "2026-08-30T00:00:00.000Z",
		expiresAt: "2026-08-30T02:00:00.000Z",
		...overrides,
	};
}

test("keeps mandate, audit, and profile references in versioned session entries", () => {
	const { pi, entries } = fakePi();
	const registry = createAuthorityRegistry(pi);
	const active = registry.activateMandate(authorityMandate(), AUTH_NOW);
	assert.equal(active.id, "mandate-a");
	active.allowedHarnesses.push("codex");
	assert.deepEqual(registry.state().activeMandate?.allowedHarnesses, ["pi"], "callers cannot mutate stored authority through a returned object");
	assert.match(registry.state().activeMandateDigest ?? "", /^[a-f0-9]{64}$/);

	const audit = registry.recordAudit({
		type: "spawn-proposed",
		actor: "coordinator",
		details: { launchArgs: ["--api-key", "never-store", "--model", "m"], token: "also-secret" },
	}, "2026-08-30T01:01:00.000Z");
	assert.equal((audit.details as any).token, "[REDACTED]");
	assert.ok(!JSON.stringify(audit).includes("never-store"));

	registry.recordProfile({
		profileId: "pi-agent-teams-docker-strong-v1",
		profileVersion: "1",
		backend: "pi-agent-teams",
		digest: "a".repeat(64),
		verified: true,
	}, "2026-08-30T01:02:00.000Z");

	const restored = restoreAuthorityRegistry(entries, { now: "2026-08-30T01:03:00.000Z" });
	assert.equal(restored.failClosedReason, undefined);
	assert.equal(restored.activeMandate?.id, "mandate-a");
	assert.equal(restored.audit.length, 1);
	assert.equal(restored.profiles.length, 1);
	assert.ok(entries.every((entry) => entry.customType === AUTHORITY_ENTRY));
});

test("replacement is explicit and can only narrow active authority", () => {
	const { pi, entries } = fakePi();
	const registry = createAuthorityRegistry(pi);
	registry.activateMandate(authorityMandate(), AUTH_NOW);

	assert.throws(() => registry.activateMandate(authorityMandate({ id: "another" }), AUTH_NOW), /already active/);
	assert.throws(() => registry.replaceMandate(authorityMandate({
		id: "mandate-expanded",
		allowedHarnesses: ["pi", "codex"],
	}), "2026-08-30T01:05:00.000Z"), /expands authority/);

	const narrowed = registry.replaceMandate(authorityMandate({
		id: "mandate-narrow",
		maxConcurrentWorkers: 1,
		maxAgentLaunches: 2,
		writePolicy: "read-only",
		humanOnly: ["architecture-change"],
		expiresAt: "2026-08-30T01:30:00.000Z",
	}), "2026-08-30T01:05:00.000Z");
	assert.equal(narrowed.id, "mandate-narrow");

	const restored = restoreAuthorityRegistry(entries, { now: "2026-08-30T01:10:00.000Z" });
	assert.equal(restored.activeMandate?.id, "mandate-narrow");
	assert.equal(restored.activeMandate?.writePolicy, "read-only");
});

test("finishing a mandate clears authority without deleting its audit history", () => {
	const { pi, entries } = fakePi();
	const registry = createAuthorityRegistry(pi);
	registry.activateMandate(authorityMandate(), AUTH_NOW);
	registry.recordAudit({ type: "verification", actor: "coordinator", outcome: "ALLOW" }, "2026-08-30T01:05:00.000Z");
	registry.finishMandate("complete", "2026-08-30T01:06:00.000Z");
	assert.equal(registry.state().activeMandate, undefined);
	assert.throws(() => registry.recordAudit({ type: "verification", actor: "coordinator" }), /no active mandate/);

	const restored = restoreAuthorityRegistry(entries, { now: "2026-08-31T00:00:00.000Z" });
	assert.equal(restored.failClosedReason, undefined, "a finished historical mandate may expire without poisoning restore");
	assert.equal(restored.activeMandate, undefined);
	assert.equal(restored.audit.length, 1);
});

test("malformed, tampered, overlapping, or stale authority history fails closed", () => {
	const { pi, entries } = fakePi();
	createAuthorityRegistry(pi).activateMandate(authorityMandate(), AUTH_NOW);
	const clean = entries[0] as any;
	const cases = [
		[{ type: "custom", customType: AUTHORITY_ENTRY, data: { schemaVersion: 99, action: "activate" } }],
		[{ ...clean, data: { ...clean.data, digest: "0".repeat(64) } }],
		[clean, clean],
	] as unknown[][];
	for (const history of cases) {
		const state = restoreAuthorityRegistry(history, { now: "2026-08-30T01:10:00.000Z" });
		assert.equal(state.activeMandate, undefined);
		assert.ok(state.failClosedReason);
	}
	const stale = restoreAuthorityRegistry(entries, { now: "2026-08-30T03:00:00.000Z" });
	assert.equal(stale.activeMandate, undefined);
	assert.match(stale.failClosedReason ?? "", /stale/);
});

test("registry restore remains fail closed after a bad authority entry", () => {
	const { pi, entries } = fakePi();
	const registry = createAuthorityRegistry(pi);
	registry.restore([
		{ type: "custom", customType: AUTHORITY_ENTRY, data: { schemaVersion: 1, action: "unknown" } },
	], AUTH_NOW);
	assert.ok(registry.state().failClosedReason);
	assert.throws(() => registry.activateMandate(authorityMandate(), AUTH_NOW), /fail closed/);
	assert.equal(entries.length, 0, "a blocked registry must not append a replacement authority event");
});
