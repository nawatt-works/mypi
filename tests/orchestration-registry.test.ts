import assert from "node:assert/strict";
import test from "node:test";
import {
	REGISTRY_ENTRY,
	createWorkerRegistry,
	isValidWorkerName,
	normalizeWorkerName,
	reconcileWorkers,
	resolveIdentity,
	restoreRegistry,
	type WorkerRecord,
} from "../extensions/orchestration-registry.ts";

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
