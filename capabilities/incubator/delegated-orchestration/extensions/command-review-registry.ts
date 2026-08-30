import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createCommandReviewGrant,
	resolveCommandPolicy,
	verifyCommandReviewGrant,
	type CommandAnalysis,
	type CommandPolicyDecision,
	type CommandPolicyRequest,
	type CommandReviewGrant,
} from "./command-policy.ts";
import type { AuthorityRegistry, OrchestrationAuthorityState } from "./orchestration-registry.ts";

export const COMMAND_REVIEW_ENTRY = "mypi-command-review-grant";
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 15 * 60_000;
const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type ReviewGrantStatus = "active" | "consumed" | "revoked" | "expired";
export type CommandReviewRecord = {
	grant: CommandReviewGrant;
	status: ReviewGrantStatus;
	snapshotDigest: string;
	consumedAt?: string;
	revokedAt?: string;
};

export type CommandReviewRegistryState = {
	records: CommandReviewRecord[];
	failClosedReason?: string;
};

type ReviewRegistryEvent =
	| { schemaVersion: 1; action: "issue"; at: string; grant: CommandReviewGrant; snapshotDigest: string }
	| { schemaVersion: 1; action: "consume"; at: string; grantId: string }
	| { schemaVersion: 1; action: "revoke"; at: string; grantId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function cloneGrant(grant: CommandReviewGrant): CommandReviewGrant {
	return { ...grant, findingCodes: [...grant.findingCodes], resources: [...grant.resources] };
}

function cloneRecord(record: CommandReviewRecord): CommandReviewRecord {
	return { ...record, grant: cloneGrant(record.grant) };
}

function validIso(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function grantSnapshotErrors(grant: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(grant)) return ["grant must be an object"];
	if (grant.version !== 1) errors.push("unsupported grant version");
	for (const key of ["grantId", "workerId", "sessionId", "mandateId", "profileId"] as const) {
		if (typeof grant[key] !== "string" || !IDENTIFIER.test(grant[key])) errors.push(`invalid ${key}`);
	}
	for (const key of ["bindingDigest", "commandDigest", "generationDigest"] as const) {
		if (typeof grant[key] !== "string" || !HASH.test(grant[key])) errors.push(`invalid ${key}`);
	}
	if (typeof grant.policyVersion !== "string" || !HASH.test(grant.policyVersion)) errors.push("policyVersion must be an exact policy digest");
	for (const key of ["workspaceRoot", "cwd"] as const) {
		if (typeof grant[key] !== "string" || !isAbsolute(grant[key])) errors.push(`${key} must be absolute`);
	}
	if (typeof grant.workspaceRoot === "string" && typeof grant.cwd === "string" &&
		(resolve(grant.cwd) !== resolve(grant.workspaceRoot) && !resolve(grant.cwd).startsWith(`${resolve(grant.workspaceRoot)}/`))) {
		errors.push("grant cwd is outside workspaceRoot");
	}
	if (!Array.isArray(grant.findingCodes) || !grant.findingCodes.every((item) => typeof item === "string") ||
		JSON.stringify(grant.findingCodes) !== JSON.stringify([...new Set(grant.findingCodes)].sort())) errors.push("findingCodes must be sorted unique strings");
	if (!Array.isArray(grant.resources) || !grant.resources.every((item) => typeof item === "string") ||
		JSON.stringify(grant.resources) !== JSON.stringify([...new Set(grant.resources)].sort())) errors.push("resources must be sorted unique strings");
	if (!validIso(grant.issuedAt) || !validIso(grant.expiresAt)) errors.push("grant timestamps are invalid");
	if (validIso(grant.issuedAt) && validIso(grant.expiresAt)) {
		const ttl = Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt);
		if (ttl <= 0 || ttl > MAX_TTL_MS) errors.push("grant TTL is invalid");
	}
	return errors;
}

function contextKey(grant: CommandReviewGrant): string {
	return sha256({
		commandDigest: grant.commandDigest,
		workerId: grant.workerId,
		sessionId: grant.sessionId,
		mandateId: grant.mandateId,
		profileId: grant.profileId,
		policyVersion: grant.policyVersion,
		generationDigest: grant.generationDigest,
		workspaceRoot: grant.workspaceRoot,
		cwd: grant.cwd,
		findingCodes: grant.findingCodes,
		resources: grant.resources,
	});
}

function effectiveStatus(record: CommandReviewRecord, now: string): ReviewGrantStatus {
	if (record.status !== "active") return record.status;
	return Date.parse(now) >= Date.parse(record.grant.expiresAt) ? "expired" : "active";
}

export function restoreCommandReviewRegistry(entries: readonly unknown[], now: string): CommandReviewRegistryState {
	if (!validIso(now)) return { records: [], failClosedReason: "restore time is invalid" };
	const records = new Map<string, CommandReviewRecord>();
	const activeContexts = new Map<string, string>();
	const errors: string[] = [];
	for (const raw of entries) {
		const entry = raw as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== COMMAND_REVIEW_ENTRY) continue;
		if (!isRecord(entry.data) || entry.data.schemaVersion !== 1 || !validIso(entry.data.at) || typeof entry.data.action !== "string") {
			errors.push("malformed command review entry");
			continue;
		}
		const event = entry.data as unknown as ReviewRegistryEvent;
		if (event.action === "issue") {
			for (const record of records.values()) {
				if (record.status === "active" && Date.parse(record.grant.expiresAt) <= Date.parse(event.at)) {
					activeContexts.delete(contextKey(record.grant));
				}
			}
			const grantErrors = grantSnapshotErrors(event.grant);
			if (grantErrors.length || !HASH.test(event.snapshotDigest) || sha256(event.grant) !== event.snapshotDigest) {
				errors.push(`invalid or tampered grant snapshot: ${grantErrors.join(",")}`);
				continue;
			}
			if (event.at !== event.grant.issuedAt) {
				errors.push("grant issue timestamp mismatch");
				continue;
			}
			if (records.has(event.grant.grantId)) {
				errors.push(`duplicate grant id: ${event.grant.grantId}`);
				continue;
			}
			const key = contextKey(event.grant);
			if (activeContexts.has(key)) {
				errors.push("duplicate active grant context");
				continue;
			}
			records.set(event.grant.grantId, {
				grant: cloneGrant(event.grant),
				status: "active",
				snapshotDigest: event.snapshotDigest,
			});
			activeContexts.set(key, event.grant.grantId);
		} else if (event.action === "consume" || event.action === "revoke") {
			if (typeof event.grantId !== "string" || !IDENTIFIER.test(event.grantId)) {
				errors.push(`${event.action} grant id is invalid`);
				continue;
			}
			const record = records.get(event.grantId);
			if (!record || record.status !== "active") {
				errors.push(`${event.action} references a missing or inactive grant`);
				continue;
			}
			const at = Date.parse(event.at);
			if (at < Date.parse(record.grant.issuedAt) || at >= Date.parse(record.grant.expiresAt)) {
				errors.push(`${event.action} timestamp is outside the grant lifetime`);
				continue;
			}
			activeContexts.delete(contextKey(record.grant));
			record.status = event.action === "consume" ? "consumed" : "revoked";
			if (event.action === "consume") record.consumedAt = new Date(at).toISOString();
			else record.revokedAt = new Date(at).toISOString();
		} else {
			errors.push("unknown command review action");
		}
	}
	if (errors.length) return { records: [], failClosedReason: errors.join(" | ") };
	return {
		records: [...records.values()].map((record) => ({ ...cloneRecord(record), status: effectiveStatus(record, now) })),
	};
}

export type CommandReviewRegistry = {
	state(now?: string): CommandReviewRegistryState;
	issue(request: CommandPolicyRequest, analysis: CommandAnalysis, options?: { now?: string; ttlMs?: number }): CommandReviewGrant;
	consume(request: CommandPolicyRequest, analysis: CommandAnalysis, now?: string): CommandPolicyDecision;
	revoke(grantId: string, now?: string): void;
	restore(entries: readonly unknown[], now?: string): CommandReviewRegistryState;
};

export function createCommandReviewRegistry(
	pi: Pick<ExtensionAPI, "appendEntry">,
	authority: Pick<AuthorityRegistry, "state">,
): CommandReviewRegistry {
	let records: CommandReviewRecord[] = [];
	let failure: string | undefined;
	const timestamp = (value?: string): string => {
		const at = value ?? new Date().toISOString();
		if (!validIso(at)) throw new Error("command review timestamp must be ISO");
		return new Date(at).toISOString();
	};
	const authorityState = (): OrchestrationAuthorityState => {
		const state = authority.state();
		if (state.failClosedReason) throw new Error(`authority registry is fail closed: ${state.failClosedReason}`);
		if (!state.activeMandate) throw new Error("no active mandate for command review");
		return state;
	};
	const requireHealthy = () => {
		if (failure) throw new Error(`command review registry is fail closed: ${failure}`);
	};
	const requireTrustedContext = (request: CommandPolicyRequest): OrchestrationAuthorityState => {
		requireHealthy();
		const state = authorityState();
		if (request.mandateId !== state.activeMandate?.id) throw new Error("command review mandate does not match active authority");
		if (!HASH.test(request.policyVersion)) throw new Error("command review policyVersion must be an exact policy digest");
		const profile = state.profiles.find((item) =>
			item.mandateId === request.mandateId && item.profileId === request.profileId && item.verified
		);
		if (!profile) throw new Error("command review profile is not a verified authority reference");
		if (profile.policyDigest !== request.policyVersion) throw new Error("command review policy digest is not the authoritative profile policy");
		return state;
	};
	const append = (event: ReviewRegistryEvent) => {
		const snapshot: ReviewRegistryEvent = event.action === "issue"
			? { ...event, grant: cloneGrant(event.grant) }
			: { ...event };
		pi.appendEntry(COMMAND_REVIEW_ENTRY, snapshot);
	};
	const listAt = (now: string) => records.map((record) => ({ ...cloneRecord(record), status: effectiveStatus(record, now) }));

	return {
		state(now) {
			const at = timestamp(now);
			return { records: failure ? [] : listAt(at), ...(failure ? { failClosedReason: failure } : {}) };
		},

		issue(request, analysis, options = {}) {
			requireTrustedContext(request);
			const now = timestamp(options.now);
			const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
			if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) throw new Error("command review TTL must be from 1ms to 15 minutes");
			if (analysis.recommendedOutcome !== "REVIEW") throw new Error(`cannot issue review grant for ${analysis.recommendedOutcome}`);
			const active = listAt(now).filter((record) => record.status === "active");
			const probe = createCommandReviewGrant(request, analysis, {
				grantId: `review-${randomUUID()}`,
				issuedAt: now,
				expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
			});
			if (active.some((record) => contextKey(record.grant) === contextKey(probe))) throw new Error("an active exact-context review grant already exists");
			const record: CommandReviewRecord = {
				grant: cloneGrant(probe),
				status: "active",
				snapshotDigest: sha256(probe),
			};
			try {
				// This single append is both the trusted grant transition and its audit event.
				// No second store write may fail after it and leave memory behind history.
				append({ schemaVersion: 1, action: "issue", at: now, grant: probe, snapshotDigest: record.snapshotDigest });
				records = [...records, record];
				return cloneGrant(probe);
			} catch (error) {
				failure = `grant issue append failed: ${String(error)}`;
				throw new Error(failure, { cause: error });
			}
		},

		consume(request, analysis, nowValue) {
			requireTrustedContext(request);
			const now = timestamp(nowValue);
			const matches = records.filter((record) =>
				effectiveStatus(record, now) === "active" && verifyCommandReviewGrant(request, analysis, record.grant, now).valid
			);
			if (matches.length === 0) return resolveCommandPolicy(request, analysis, { now });
			if (matches.length > 1) {
				failure = "multiple active grants match the same command context";
				return { outcome: "DENY", executionAllowed: false, reviewed: false, reasons: [failure] };
			}
			const record = matches[0]!;
			const decision = resolveCommandPolicy(request, analysis, { grant: record.grant, now });
			if (!decision.executionAllowed || !decision.reviewed) return decision;
			try {
				append({ schemaVersion: 1, action: "consume", at: now, grantId: record.grant.grantId });
				records = records.map((item) => item.grant.grantId === record.grant.grantId
					? { ...item, status: "consumed", consumedAt: now }
					: item);
				return decision;
			} catch (error) {
				failure = `grant consume append failed: ${String(error)}`;
				throw new Error(failure, { cause: error });
			}
		},

		revoke(grantId, nowValue) {
			requireHealthy();
			const state = authorityState();
			const now = timestamp(nowValue);
			const record = records.find((item) => item.grant.grantId === grantId);
			if (!record || effectiveStatus(record, now) !== "active") throw new Error("review grant is missing or inactive");
			if (record.grant.mandateId !== state.activeMandate?.id) throw new Error("review grant mandate does not match active authority");
			try {
				append({ schemaVersion: 1, action: "revoke", at: now, grantId });
				records = records.map((item) => item.grant.grantId === grantId ? { ...item, status: "revoked", revokedAt: now } : item);
			} catch (error) {
				failure = `grant revoke append failed: ${String(error)}`;
				throw new Error(failure, { cause: error });
			}
		},

		restore(entries, nowValue) {
			const now = timestamp(nowValue);
			const restored = restoreCommandReviewRegistry(entries, now);
			records = restored.records.map(cloneRecord);
			failure = restored.failClosedReason;
			return this.state(now);
		},
	};
}
