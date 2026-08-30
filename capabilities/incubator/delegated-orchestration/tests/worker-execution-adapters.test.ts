import assert from "node:assert/strict";
import test from "node:test";
import {
	executionModeForUpstreamWorkspace,
	resolveWorkerExecutionAdapter,
	WORKER_EXECUTION_ADAPTERS,
} from "../extensions/worker-execution-adapters.ts";

test("defines disjoint exact read-only and worktree-write contracts", () => {
	assert.deepEqual(WORKER_EXECUTION_ADAPTERS["read-only"], {
		id: "read-only-v1",
		workspaceMode: "read-only",
		upstreamWorkspaceMode: "shared",
		builtinTools: ["read"],
		backendTools: ["team_message"],
		mount: { kind: "none", appliesTo: "scoped-read", source: "leader-workspace", target: null, access: "read-only-api" },
		policy: { filesystem: "workspace-read-only", command: "none", network: "none", uploads: false },
	});
	assert.deepEqual(WORKER_EXECUTION_ADAPTERS["worktree-write"], {
		id: "worktree-write-v1",
		workspaceMode: "worktree-write",
		upstreamWorkspaceMode: "worktree",
		builtinTools: ["read", "bash", "edit", "write"],
		backendTools: ["team_message"],
		mount: { kind: "bind", appliesTo: "bash", source: "worker-worktree", target: "/workspace", access: "rw" },
		policy: { filesystem: "worktree-write", command: "command-policy-v1", network: "none", uploads: false },
	});
	assert.deepEqual(new Set(WORKER_EXECUTION_ADAPTERS["read-only"].builtinTools), new Set(["read"]));
	assert.equal(WORKER_EXECUTION_ADAPTERS["read-only"].builtinTools.includes("bash"), false);
});

test("maps only exact upstream workspace modes and fails closed otherwise", () => {
	assert.equal(executionModeForUpstreamWorkspace("shared"), "read-only");
	assert.equal(executionModeForUpstreamWorkspace("worktree"), "worktree-write");
	assert.equal(resolveWorkerExecutionAdapter("read-only").mount.kind, "none");
	assert.equal(resolveWorkerExecutionAdapter("worktree-write").mount.access, "rw");
	assert.throws(() => executionModeForUpstreamWorkspace("in-place"), /unsupported/);
	assert.throws(() => resolveWorkerExecutionAdapter("mutable-shared"), /unsupported/);
});
