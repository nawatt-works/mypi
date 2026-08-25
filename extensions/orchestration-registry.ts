import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runHerdr } from "./herdr-client.ts";

export const REGISTRY_ENTRY = "mypi-worker-registry";

/** Herdr's own constraint on agent names, enforced before spawning. */
const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_NAME_LENGTH = 32;

export type WorkerStatus = "spawning" | "live" | "gone";

/**
 * Whether the harness the Coordinator asked for is the one actually running.
 * `unknown` is a real answer and must never be upgraded by a task label, a
 * prompt, or something the Worker said about itself.
 */
export type IdentityState = "confirmed" | "mismatch" | "unknown";

/**
 * How the observed kind was established. A kind whose lifecycle integration is
 * missing can only ever be recognised from the screen, which is weaker.
 */
export type IdentityEvidence = "lifecycle" | "detection" | "none";

/**
 * A pointer to something a Worker produced. The registry stores the reference
 * and why the next Worker should read it, never the content: artifacts keep the
 * path, schema and lifecycle of whoever owns them.
 */
export type ArtifactRef = {
	kind: "path" | "branch" | "commit";
	value: string;
	purpose: string;
	producedBy?: string;
};

export type WorktreeRef = {
	path: string;
	branch?: string;
	workspaceId?: string;
};

export type WorkerRecord = {
	name: string;
	task: string;
	requestedHarness: string;
	observedKind?: string;
	identity: IdentityState;
	identityEvidence: IdentityEvidence;
	/** Session reference from the harness's lifecycle integration, when it has reported one. */
	sessionRef?: string;
	/** What `sessionRef` points at: Pi reports a session path, Claude a session id. */
	sessionRefKind?: string;
	status: WorkerStatus;
	paneId?: string;
	cwd?: string;
	worktree?: WorktreeRef;
	artifacts: ArtifactRef[];
	/** Herdr's lifecycle counter, used to tell a delivered prompt from a silent drop. */
	lastSeq?: number;
	/** The counter as it stood when work was last assigned, for "did anything happen since". */
	seqAtHandoff?: number;
	createdAt: string;
	updatedAt: string;
};

/** The fields of `herdr agent list` this registry depends on. */
export type HerdrAgentSnapshot = {
	name?: string;
	agent?: string;
	pane_id?: string;
	cwd?: string;
	agent_status?: string;
	state_change_seq?: number;
	agent_session?: { value?: string; kind?: string };
};

/**
 * How much evidence the Coordinator owes the user before reporting done. Kept
 * apart from the execution decision on purpose: a one-Worker task can still
 * need independent review, and a three-Worker task may not.
 */
export type AssuranceLevel = "coordinator" | "independent-review" | "human-approval";

export type AssuranceState = {
	level: AssuranceLevel;
	reason: string;
	/** Workers whose collected evidence passed, in order. */
	verifiedBy: string[];
};

export const DEFAULT_ASSURANCE: AssuranceState = {
	level: "coordinator",
	reason: "ค่าเริ่มต้น: Coordinator ตรวจหลักฐานเองเพียงพอ",
	verifiedBy: [],
};

export type RegisterWorkerInput = {
	name: string;
	task: string;
	requestedHarness: string;
	paneId?: string;
	cwd?: string;
	worktree?: WorktreeRef;
};

type RegistryEvent =
	| { action: "register"; worker: WorkerRecord }
	| { action: "update"; name: string; patch: Partial<WorkerRecord> }
	| { action: "artifact"; name: string; artifact: ArtifactRef }
	| { action: "release"; name: string }
	| { action: "assurance"; level: AssuranceLevel; reason: string }
	| { action: "verified"; name: string };

/**
 * Turn any label into a name Herdr accepts, unique among the names already
 * taken. Herdr rejects anything outside `[a-z][a-z0-9_-]{0,31}` and requires
 * uniqueness among live agents.
 */
export function normalizeWorkerName(desired: string, taken: Iterable<string> = []): string {
	const used = new Set(taken);
	const cleaned = desired
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
	// A name that survives with no letters left carries no meaning; label it plainly.
	let base = cleaned === "" ? "worker" : cleaned;
	if (!/^[a-z]/.test(base)) base = `w-${base}`;
	base = base.slice(0, MAX_NAME_LENGTH).replace(/-+$/, "");

	if (!used.has(base)) return base;
	for (let suffix = 2; suffix < 1000; suffix += 1) {
		const tail = `-${suffix}`;
		const candidate = `${base.slice(0, MAX_NAME_LENGTH - tail.length)}${tail}`;
		if (!used.has(candidate)) return candidate;
	}
	throw new Error(`Could not derive a free worker name from "${desired}"`);
}

export function isValidWorkerName(name: string): boolean {
	return NAME_PATTERN.test(name);
}

export function resolveIdentity(requested: string, observed: string | undefined): IdentityState {
	if (!observed) return "unknown";
	return observed === requested ? "confirmed" : "mismatch";
}

function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Replay the session's registry entries. Pi keeps them in the session branch, so
 * the mapping survives compaction and resume without a file in the workspace.
 */
export function restoreRegistry(entries: readonly unknown[]): WorkerRecord[] {
	const workers = new Map<string, WorkerRecord>();
	for (const rawEntry of entries) {
		const entry = rawEntry as { type?: string; customType?: string; data?: RegistryEvent };
		if (entry.type !== "custom" || entry.customType !== REGISTRY_ENTRY) continue;
		const data = entry.data;
		if (!data || typeof data !== "object") continue;

		if (data.action === "assurance" || data.action === "verified") continue;
		if (data.action === "register" && data.worker?.name) {
			workers.set(data.worker.name, { ...data.worker, artifacts: [...(data.worker.artifacts ?? [])] });
			continue;
		}
		const existing = "name" in data && data.name ? workers.get(data.name) : undefined;
		if (!existing) continue;

		if (data.action === "update") {
			workers.set(existing.name, { ...existing, ...data.patch, name: existing.name });
		} else if (data.action === "artifact" && data.artifact) {
			workers.set(existing.name, {
				...existing,
				artifacts: [...existing.artifacts, data.artifact],
			});
		} else if (data.action === "release") {
			workers.delete(existing.name);
		}
	}
	return [...workers.values()];
}

/**
 * Fold a live `herdr agent list` into the stored records. Herdr owns process
 * truth: a worker missing from the listing is gone, whatever the session said.
 */
export function reconcileWorkers(
	records: readonly WorkerRecord[],
	agents: readonly HerdrAgentSnapshot[],
): WorkerRecord[] {
	const byName = new Map<string, HerdrAgentSnapshot>();
	for (const agent of agents) {
		if (agent.name) byName.set(agent.name, agent);
	}

	return records.map((record) => {
		const agent = byName.get(record.name);
		if (!agent) {
			// A worker that never reported a pane may still be starting up.
			const status: WorkerStatus = record.status === "spawning" ? "spawning" : "gone";
			return { ...record, status, observedKind: undefined, identity: "unknown", identityEvidence: "none" };
		}
		// A lifecycle integration reports identity only once the worker has run a
		// turn, so `detection` right after spawn can still become `lifecycle`.
		const sessionRef = agent.agent_session?.value;
		return {
			...record,
			status: "live",
			observedKind: agent.agent,
			identity: resolveIdentity(record.requestedHarness, agent.agent),
			identityEvidence: sessionRef ? "lifecycle" : "detection",
			sessionRef,
			sessionRefKind: agent.agent_session?.kind,
			paneId: agent.pane_id ?? record.paneId,
			cwd: agent.cwd ?? record.cwd,
			lastSeq: agent.state_change_seq ?? record.lastSeq,
		};
	});
}

/** Replay only the assurance decisions from a session branch. */
export function restoreAssurance(entries: readonly unknown[]): AssuranceState {
	let state: AssuranceState = { ...DEFAULT_ASSURANCE, verifiedBy: [] };
	for (const rawEntry of entries) {
		const entry = rawEntry as { type?: string; customType?: string; data?: RegistryEvent };
		if (entry.type !== "custom" || entry.customType !== REGISTRY_ENTRY) continue;
		const data = entry.data;
		if (data?.action === "assurance") {
			state = { level: data.level, reason: data.reason, verifiedBy: state.verifiedBy };
		} else if (data?.action === "verified" && !state.verifiedBy.includes(data.name)) {
			state = { ...state, verifiedBy: [...state.verifiedBy, data.name] };
		}
	}
	return state;
}

/**
 * Whether the agreed assurance level has been met. `human-approval` never
 * settles on its own: only the user can close it.
 */
export function assuranceMet(state: AssuranceState): boolean {
	if (state.level === "human-approval") return false;
	if (state.level === "independent-review") return new Set(state.verifiedBy).size >= 2;
	return state.verifiedBy.length > 0;
}

export type WorkerRegistry = {
	list(): WorkerRecord[];
	get(name: string): WorkerRecord | undefined;
	register(input: RegisterWorkerInput): WorkerRecord;
	update(name: string, patch: Partial<WorkerRecord>): WorkerRecord | undefined;
	addArtifact(name: string, artifact: ArtifactRef): WorkerRecord | undefined;
	release(name: string): void;
	restore(entries: readonly unknown[]): void;
	assurance(): AssuranceState;
	setAssurance(level: AssuranceLevel, reason: string): AssuranceState;
	recordVerified(name: string): AssuranceState;
	/** Refresh observed identity and liveness from Herdr. */
	refresh(): Promise<WorkerRecord[]>;
};

/**
 * Session-scoped mapping between a task, its Herdr agent, pane, worktree and
 * the artifacts it produced. State is appended to the Pi session and rebuilt
 * from Herdr, so nothing is written into the workspace.
 */
export function createWorkerRegistry(pi: Pick<ExtensionAPI, "appendEntry" | "exec">): WorkerRegistry {
	let workers: WorkerRecord[] = [];
	let assurance: AssuranceState = { ...DEFAULT_ASSURANCE, verifiedBy: [] };

	const record = (event: RegistryEvent) => pi.appendEntry(REGISTRY_ENTRY, event);
	const find = (name: string) => workers.find((worker) => worker.name === name);

	function replace(next: WorkerRecord): WorkerRecord {
		workers = workers.map((worker) => (worker.name === next.name ? next : worker));
		return next;
	}

	return {
		list: () => [...workers],
		get: (name) => find(name),

		register(input) {
			if (!isValidWorkerName(input.name)) {
				throw new Error(`Worker name "${input.name}" is not a valid Herdr agent name`);
			}
			if (find(input.name)) {
				throw new Error(`Worker "${input.name}" is already registered in this session`);
			}
			const timestamp = nowIso();
			const worker: WorkerRecord = {
				name: input.name,
				task: input.task,
				requestedHarness: input.requestedHarness,
				identity: "unknown",
				identityEvidence: "none",
				status: "spawning",
				paneId: input.paneId,
				cwd: input.cwd,
				worktree: input.worktree,
				artifacts: [],
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			workers = [...workers, worker];
			record({ action: "register", worker });
			return worker;
		},

		update(name, patch) {
			const existing = find(name);
			if (!existing) return undefined;
			const next = { ...existing, ...patch, name: existing.name, updatedAt: nowIso() };
			record({ action: "update", name, patch: { ...patch, updatedAt: next.updatedAt } });
			return replace(next);
		},

		addArtifact(name, artifact) {
			const existing = find(name);
			if (!existing) return undefined;
			const next = {
				...existing,
				artifacts: [...existing.artifacts, artifact],
				updatedAt: nowIso(),
			};
			record({ action: "artifact", name, artifact });
			return replace(next);
		},

		release(name) {
			if (!find(name)) return;
			workers = workers.filter((worker) => worker.name !== name);
			record({ action: "release", name });
		},

		restore(entries) {
			workers = restoreRegistry(entries);
			assurance = restoreAssurance(entries);
		},

		assurance: () => ({ ...assurance, verifiedBy: [...assurance.verifiedBy] }),

		setAssurance(level, reason) {
			assurance = { level, reason, verifiedBy: assurance.verifiedBy };
			record({ action: "assurance", level, reason });
			return { ...assurance, verifiedBy: [...assurance.verifiedBy] };
		},

		recordVerified(name) {
			if (!assurance.verifiedBy.includes(name)) {
				assurance = { ...assurance, verifiedBy: [...assurance.verifiedBy, name] };
				record({ action: "verified", name });
			}
			return { ...assurance, verifiedBy: [...assurance.verifiedBy] };
		},

		async refresh() {
			const result = await runHerdr(pi, ["agent", "list"]);
			if (!result.ok) return [...workers];
			const agents = (result.result as { agents?: HerdrAgentSnapshot[] } | undefined)?.agents ?? [];
			workers = reconcileWorkers(workers, agents);
			return [...workers];
		},
	};
}
