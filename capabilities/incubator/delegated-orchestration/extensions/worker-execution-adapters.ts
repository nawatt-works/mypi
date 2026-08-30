export type WorkerExecutionMode = "read-only" | "worktree-write";

export type WorkerExecutionAdapterContract = Readonly<{
	id: "read-only-v1" | "worktree-write-v1";
	workspaceMode: WorkerExecutionMode;
	upstreamWorkspaceMode: "shared" | "worktree";
	builtinTools: readonly ("read" | "bash" | "edit" | "write")[];
	backendTools: readonly ["team_message"];
	mount: Readonly<{
		kind: "none" | "bind";
		appliesTo: "scoped-read" | "bash";
		source: "leader-workspace" | "worker-worktree";
		target: null | "/workspace";
		access: "read-only-api" | "rw";
	}>;
	policy: Readonly<{
		filesystem: "workspace-read-only" | "worktree-write";
		command: "none" | "command-policy-v1";
		network: "none";
		uploads: false;
	}>;
}>;

const READ_ONLY: WorkerExecutionAdapterContract = Object.freeze({
	id: "read-only-v1",
	workspaceMode: "read-only",
	upstreamWorkspaceMode: "shared",
	builtinTools: Object.freeze(["read"]),
	backendTools: Object.freeze(["team_message"]),
	mount: Object.freeze({ kind: "none", appliesTo: "scoped-read", source: "leader-workspace", target: null, access: "read-only-api" }),
	policy: Object.freeze({ filesystem: "workspace-read-only", command: "none", network: "none", uploads: false }),
});

const WORKTREE_WRITE: WorkerExecutionAdapterContract = Object.freeze({
	id: "worktree-write-v1",
	workspaceMode: "worktree-write",
	upstreamWorkspaceMode: "worktree",
	builtinTools: Object.freeze(["read", "bash", "edit", "write"]),
	backendTools: Object.freeze(["team_message"]),
	mount: Object.freeze({ kind: "bind", appliesTo: "bash", source: "worker-worktree", target: "/workspace", access: "rw" }),
	policy: Object.freeze({ filesystem: "worktree-write", command: "command-policy-v1", network: "none", uploads: false }),
});

export const WORKER_EXECUTION_ADAPTERS: Readonly<Record<WorkerExecutionMode, WorkerExecutionAdapterContract>> = Object.freeze({
	"read-only": READ_ONLY,
	"worktree-write": WORKTREE_WRITE,
});

export function resolveWorkerExecutionAdapter(mode: string): WorkerExecutionAdapterContract {
	if (mode !== "read-only" && mode !== "worktree-write") throw new Error("unsupported Worker execution mode");
	return WORKER_EXECUTION_ADAPTERS[mode];
}

export function executionModeForUpstreamWorkspace(mode: string): WorkerExecutionMode {
	if (mode === "shared") return "read-only";
	if (mode === "worktree") return "worktree-write";
	throw new Error("unsupported upstream Worker workspace mode");
}
