import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runHerdr } from "./herdr-client.ts";
import {
	mandateDigest,
	mandateNarrows,
	redactForAudit,
	validateMandate,
	type DelegationMandate,
	type PolicyOutcome,
} from "./orchestration-policy.ts";

export const REGISTRY_ENTRY = "mypi-worker-registry";
export const AUTHORITY_ENTRY = "mypi-orchestration-authority";

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
	/**
	 * Who produces the work being judged: `coordinator` when the Coordinator
	 * implements it itself, otherwise the Worker's name. Independence is measured
	 * against this, not against the size of the team.
	 */
	producedBy: string;
	/** Workers whose collected evidence passed, in order. */
	verifiedBy: string[];
};

export const COORDINATOR_PRODUCER = "coordinator";

export const DEFAULT_ASSURANCE: AssuranceState = {
	level: "coordinator",
	reason: "ค่าเริ่มต้น: Coordinator ตรวจหลักฐานเองเพียงพอ",
	producedBy: COORDINATOR_PRODUCER,
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
	| { action: "assurance"; level: AssuranceLevel; reason: string; producedBy?: string }
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
			state = {
				level: data.level,
				reason: data.reason,
				producedBy: data.producedBy ?? COORDINATOR_PRODUCER,
				verifiedBy: state.verifiedBy,
			};
		} else if (data?.action === "verified" && !state.verifiedBy.includes(data.name)) {
			state = { ...state, verifiedBy: [...state.verifiedBy, data.name] };
		}
	}
	return state;
}

/**
 * Whether the agreed assurance level has been met. `human-approval` never
 * settles on its own: only the user can close it.
 *
 * Independence is "someone other than the producer verified it". Counting two
 * verifiers instead would be unsatisfiable in the most common shape, where the
 * Coordinator does the work itself and one Worker reviews it.
 */
export function assuranceMet(state: AssuranceState): boolean {
	if (state.level === "human-approval") return false;
	if (state.level === "independent-review") {
		return state.verifiedBy.some((name) => name !== state.producedBy);
	}
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
	setAssurance(level: AssuranceLevel, reason: string, producedBy?: string): AssuranceState;
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

		setAssurance(level, reason, producedBy) {
			const producer = producedBy?.trim() || COORDINATOR_PRODUCER;
			assurance = { level, reason, producedBy: producer, verifiedBy: assurance.verifiedBy };
			record({ action: "assurance", level, reason, producedBy: producer });
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


export type AuthorityAuditType =
	| "mandate-activated"
	| "mandate-replaced"
	| "mandate-finished"
	| "spawn-proposed"
	| "spawn-allowed"
	| "spawn-denied"
	| "spawn-escalated"
	| "worker-ready"
	| "worker-blocked"
	| "handoff"
	| "correction"
	| "worker-stopped"
	| "artifact-collected"
	| "verification"
	| "profile-defect";

export type AuthorityAuditEvent = {
	id: string;
	mandateId: string;
	type: AuthorityAuditType;
	at: string;
	actor: "coordinator" | "worker" | "system";
	workerId?: string;
	outcome?: PolicyOutcome;
	actionDigest?: string;
	details?: unknown;
};

export type AuthorityProfileRef = {
	mandateId: string;
	profileId: string;
	profileVersion: string;
	backend: "herdr" | "pi-agent-teams" | "piewf";
	digest: string;
	verified: boolean;
	observedAt: string;
};

type AuthorityEvent =
	| { schemaVersion: 1; action: "activate"; at: string; mandate: DelegationMandate; digest: string }
	| { schemaVersion: 1; action: "replace"; at: string; previousMandateId: string; mandate: DelegationMandate; digest: string }
	| { schemaVersion: 1; action: "finish"; at: string; mandateId: string; outcome: "complete" | "cancelled" }
	| { schemaVersion: 1; action: "audit"; event: AuthorityAuditEvent }
	| { schemaVersion: 1; action: "profile"; profile: AuthorityProfileRef };

export type OrchestrationAuthorityState = {
	activeMandate?: DelegationMandate;
	activeMandateDigest?: string;
	audit: AuthorityAuditEvent[];
	profiles: AuthorityProfileRef[];
	failClosedReason?: string;
};

function cloneMandate(mandate: DelegationMandate): DelegationMandate {
	return {
		...mandate,
		definitionOfDone: [...mandate.definitionOfDone],
		allowedHarnesses: [...mandate.allowedHarnesses],
		shellNetwork: mandate.shellNetwork === "deny" ? "deny" : { allowDomains: [...mandate.shellNetwork.allowDomains] },
		humanOnly: [...mandate.humanOnly],
	};
}

function cloneAuditEvent(event: AuthorityAuditEvent): AuthorityAuditEvent {
	return { ...event, details: redactForAudit(event.details) };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIso(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validHash(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validAuditType(value: unknown): value is AuthorityAuditType {
	return typeof value === "string" && [
		"mandate-activated", "mandate-replaced", "mandate-finished", "spawn-proposed", "spawn-allowed",
		"spawn-denied", "spawn-escalated", "worker-ready", "worker-blocked", "handoff", "correction",
		"worker-stopped", "artifact-collected", "verification", "profile-defect",
	].includes(value);
}

function validateAuditEvent(value: unknown): value is AuthorityAuditEvent {
	if (!isObject(value)) return false;
	if (typeof value.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(value.id)) return false;
	if (typeof value.mandateId !== "string" || !value.mandateId) return false;
	if (!validAuditType(value.type) || !validIso(value.at)) return false;
	if (value.actor !== "coordinator" && value.actor !== "worker" && value.actor !== "system") return false;
	if (value.workerId !== undefined && typeof value.workerId !== "string") return false;
	if (value.outcome !== undefined && !["ALLOW", "REVIEW", "HUMAN", "DENY"].includes(String(value.outcome))) return false;
	if (value.actionDigest !== undefined && !validHash(value.actionDigest)) return false;
	return true;
}

function validateProfileRef(value: unknown): value is AuthorityProfileRef {
	if (!isObject(value)) return false;
	return typeof value.mandateId === "string" && value.mandateId.length > 0 &&
		typeof value.profileId === "string" && /^[a-z][a-z0-9._-]{0,127}$/.test(value.profileId) &&
		typeof value.profileVersion === "string" && value.profileVersion.length > 0 && value.profileVersion.length <= 128 &&
		(value.backend === "herdr" || value.backend === "pi-agent-teams" || value.backend === "piewf") &&
		validHash(value.digest) && typeof value.verified === "boolean" && validIso(value.observedAt);
}

export function restoreAuthorityRegistry(
	entries: readonly unknown[],
	options: { now?: string } = {},
): OrchestrationAuthorityState {
	let activeMandate: DelegationMandate | undefined;
	let activeMandateDigest: string | undefined;
	const audit: AuthorityAuditEvent[] = [];
	const profiles: AuthorityProfileRef[] = [];
	const errors: string[] = [];

	for (const rawEntry of entries) {
		const entry = rawEntry as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== AUTHORITY_ENTRY) continue;
		if (!isObject(entry.data) || entry.data.schemaVersion !== 1 || typeof entry.data.action !== "string") {
			errors.push("malformed authority entry");
			continue;
		}
		const data = entry.data as unknown as AuthorityEvent;
		if (data.action === "activate" || data.action === "replace") {
			if (!validIso(data.at) || !validHash(data.digest)) {
				errors.push(`${data.action} entry metadata is invalid`);
				continue;
			}
			const validated = validateMandate(data.mandate, { now: data.at });
			if (!validated.ok || mandateDigest(validated.ok ? validated.value : data.mandate) !== data.digest) {
				errors.push(`${data.action} mandate is invalid or its digest does not match`);
				continue;
			}
			if (data.action === "activate") {
				if (activeMandate) {
					errors.push("activate entry overlaps an active mandate");
					continue;
				}
			} else {
				if (!activeMandate || data.previousMandateId !== activeMandate.id) {
					errors.push("replace entry does not match the active mandate");
					continue;
				}
				const narrowing = mandateNarrows(activeMandate, validated.value);
				if (!narrowing.narrows) {
					errors.push(`replace entry expands authority: ${narrowing.expansions.join(",")}`);
					continue;
				}
			}
			activeMandate = validated.value;
			activeMandateDigest = data.digest;
		} else if (data.action === "finish") {
			if (!validIso(data.at) || (data.outcome !== "complete" && data.outcome !== "cancelled") || !activeMandate || data.mandateId !== activeMandate.id) {
				errors.push("finish entry does not match the active mandate");
				continue;
			}
			activeMandate = undefined;
			activeMandateDigest = undefined;
		} else if (data.action === "audit") {
			if (!validateAuditEvent(data.event)) {
				errors.push("audit entry is invalid");
				continue;
			}
			audit.push({ ...data.event, details: redactForAudit(data.event.details) });
		} else if (data.action === "profile") {
			if (!validateProfileRef(data.profile)) {
				errors.push("profile entry is invalid");
				continue;
			}
			profiles.push({ ...data.profile });
		} else {
			errors.push("authority entry action is unknown");
		}
	}

	if (activeMandate) {
		const current = validateMandate(activeMandate, { now: options.now });
		if (!current.ok) errors.push(`active mandate is invalid or stale: ${current.errors.join(";")}`);
	}
	if (errors.length > 0) {
		return { audit, profiles, failClosedReason: errors.join(" | ") };
	}
	return { activeMandate, activeMandateDigest, audit, profiles };
}

export type AuthorityRegistry = {
	state(): OrchestrationAuthorityState;
	activateMandate(input: unknown, now?: string): DelegationMandate;
	replaceMandate(input: unknown, now?: string): DelegationMandate;
	finishMandate(outcome: "complete" | "cancelled", now?: string): void;
	recordAudit(input: Omit<AuthorityAuditEvent, "id" | "mandateId" | "at" | "details"> & { details?: unknown }, now?: string): AuthorityAuditEvent;
	recordProfile(input: Omit<AuthorityProfileRef, "mandateId" | "observedAt">, now?: string): AuthorityProfileRef;
	restore(entries: readonly unknown[], now?: string): OrchestrationAuthorityState;
};

export function createAuthorityRegistry(pi: Pick<ExtensionAPI, "appendEntry">): AuthorityRegistry {
	let state: OrchestrationAuthorityState = { audit: [], profiles: [] };
	const append = (data: AuthorityEvent) => pi.appendEntry(AUTHORITY_ENTRY, data);
	const timestamp = (value?: string): string => {
		const at = value ?? nowIso();
		if (!validIso(at)) throw new Error("authority timestamp must be ISO");
		return new Date(at).toISOString();
	};
	const requireActive = (): DelegationMandate => {
		if (state.failClosedReason) throw new Error(`authority registry is fail closed: ${state.failClosedReason}`);
		if (!state.activeMandate) throw new Error("no active mandate");
		return state.activeMandate;
	};

	return {
		state: () => ({
			...state,
			activeMandate: state.activeMandate ? cloneMandate(state.activeMandate) : undefined,
			audit: state.audit.map(cloneAuditEvent),
			profiles: state.profiles.map((profile) => ({ ...profile })),
		}),

		activateMandate(input, now) {
			if (state.failClosedReason) throw new Error(`authority registry is fail closed: ${state.failClosedReason}`);
			if (state.activeMandate) throw new Error("a mandate is already active; replace it explicitly");
			const at = timestamp(now);
			const validated = validateMandate(input, { now: at });
			if (!validated.ok) throw new Error(`invalid mandate: ${validated.errors.join("; ")}`);
			const digest = mandateDigest(validated.value);
			append({ schemaVersion: 1, action: "activate", at, mandate: cloneMandate(validated.value), digest });
			state = { ...state, activeMandate: cloneMandate(validated.value), activeMandateDigest: digest };
			return cloneMandate(validated.value);
		},

		replaceMandate(input, now) {
			const previous = requireActive();
			const at = timestamp(now);
			const validated = validateMandate(input, { now: at });
			if (!validated.ok) throw new Error(`invalid replacement mandate: ${validated.errors.join("; ")}`);
			const narrowing = mandateNarrows(previous, validated.value);
			if (!narrowing.narrows) throw new Error(`replacement expands authority: ${narrowing.expansions.join(",")}`);
			const digest = mandateDigest(validated.value);
			append({ schemaVersion: 1, action: "replace", at, previousMandateId: previous.id, mandate: cloneMandate(validated.value), digest });
			state = { ...state, activeMandate: cloneMandate(validated.value), activeMandateDigest: digest };
			return cloneMandate(validated.value);
		},

		finishMandate(outcome, now) {
			const active = requireActive();
			const at = timestamp(now);
			append({ schemaVersion: 1, action: "finish", at, mandateId: active.id, outcome });
			state = { ...state, activeMandate: undefined, activeMandateDigest: undefined };
		},

		recordAudit(input, now) {
			const active = requireActive();
			const event: AuthorityAuditEvent = {
				id: `evt-${randomUUID()}`,
				mandateId: active.id,
				type: input.type,
				at: timestamp(now),
				actor: input.actor,
				...(input.workerId ? { workerId: input.workerId } : {}),
				...(input.outcome ? { outcome: input.outcome } : {}),
				...(input.actionDigest ? { actionDigest: input.actionDigest } : {}),
				...(input.details === undefined ? {} : { details: redactForAudit(input.details) }),
			};
			if (!validateAuditEvent(event)) throw new Error("audit event is invalid");
			append({ schemaVersion: 1, action: "audit", event });
			state = { ...state, audit: [...state.audit, event] };
			return event;
		},

		recordProfile(input, now) {
			const active = requireActive();
			const profile: AuthorityProfileRef = { ...input, mandateId: active.id, observedAt: timestamp(now) };
			if (!validateProfileRef(profile)) throw new Error("profile reference is invalid");
			append({ schemaVersion: 1, action: "profile", profile });
			state = { ...state, profiles: [...state.profiles, profile] };
			return profile;
		},

		restore(entries, now) {
			state = restoreAuthorityRegistry(entries, { now });
			return this.state();
		},
	};
}
