import { isAbsolute, relative, resolve } from "node:path";
import type { CommandPolicyRequest } from "./command-policy.ts";
import type { OrchestrationAuthorityState } from "./orchestration-registry.ts";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DIGEST = /^[a-f0-9]{64}$/;

export type DelegatedWorkspaceRecord = Readonly<{
	mandateId: string;
	workerId: string;
	sessionId: string;
	profileId: string;
	policyDigest: string;
	authorityProfileDigest: string;
	generationDigest: string;
	workspaceRoot: string;
	cwd: string;
	workspaceMode: "read-only" | "worktree-write";
}>;

export type DelegatedWorkspaceAuthority = {
	registerVerified(record: DelegatedWorkspaceRecord): DelegatedWorkspaceRecord;
	authorize(request: CommandPolicyRequest, state: OrchestrationAuthorityState): { authorized: boolean; reason: string };
	release(input: Pick<DelegatedWorkspaceRecord, "workerId" | "sessionId" | "generationDigest">): void;
	list(): DelegatedWorkspaceRecord[];
};

function within(path: string, root: string): boolean {
	const offset = relative(root, path);
	return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function validateRecord(record: DelegatedWorkspaceRecord): DelegatedWorkspaceRecord {
	const expectedKeys = ["authorityProfileDigest", "cwd", "generationDigest", "mandateId", "policyDigest", "profileId", "sessionId", "workerId", "workspaceMode", "workspaceRoot"];
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) throw new Error("workspace authority record has an invalid shape");
	for (const [label, value] of Object.entries({
		mandateId: record.mandateId,
		workerId: record.workerId,
		sessionId: record.sessionId,
		profileId: record.profileId,
	})) if (!IDENTIFIER.test(value)) throw new Error(`${label} must be a bounded identifier`);
	for (const [label, value] of Object.entries({
		policyDigest: record.policyDigest,
		authorityProfileDigest: record.authorityProfileDigest,
		generationDigest: record.generationDigest,
	})) {
		if (!DIGEST.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
	}
	if (!isAbsolute(record.workspaceRoot) || !isAbsolute(record.cwd)) throw new Error("workspace authority paths must be absolute");
	const workspaceRoot = resolve(record.workspaceRoot);
	const cwd = resolve(record.cwd);
	if (!within(cwd, workspaceRoot)) throw new Error("workspace authority cwd is outside workspaceRoot");
	if (record.workspaceMode !== "read-only" && record.workspaceMode !== "worktree-write") throw new Error("workspace authority mode is invalid");
	return Object.freeze({ ...record, workspaceRoot, cwd });
}

function key(record: Pick<DelegatedWorkspaceRecord, "workerId" | "sessionId">): string {
	return `${record.sessionId}:${record.workerId}`;
}

export function createDelegatedWorkspaceAuthority(): DelegatedWorkspaceAuthority {
	const records = new Map<string, DelegatedWorkspaceRecord>();
	return Object.freeze({
		registerVerified(input) {
			const record = validateRecord(input);
			const identity = key(record);
			if (records.has(identity)) throw new Error("delegated workspace identity is already registered");
			records.set(identity, record);
			return { ...record };
		},
		authorize(request, state) {
			if (state.failClosedReason) return { authorized: false, reason: `authority registry is fail closed: ${state.failClosedReason}` };
			if (!state.activeMandate || request.mandateId !== state.activeMandate.id) return { authorized: false, reason: "request mandate is not active" };
			const record = records.get(key(request));
			if (!record) return { authorized: false, reason: "Worker workspace is not registered by the Coordinator" };
			const matches = record.mandateId === request.mandateId && record.profileId === request.profileId &&
				record.policyDigest === request.policyVersion && record.generationDigest === request.generationDigest &&
				record.workspaceRoot === resolve(request.workspaceRoot) && record.cwd === resolve(request.cwd);
			if (!matches) return { authorized: false, reason: "request does not match the exact registered Worker workspace generation" };
			const profile = state.profiles.find((item) => item.mandateId === record.mandateId && item.profileId === record.profileId &&
				item.policyDigest === record.policyDigest && item.digest === record.authorityProfileDigest && item.verified);
			return profile
				? { authorized: true, reason: "exact Worker workspace and verified profile generation match Coordinator authority" }
				: { authorized: false, reason: "registered workspace profile is not an active verified authority reference" };
		},
		release(input) {
			const identity = key(input);
			const record = records.get(identity);
			if (!record || record.generationDigest !== input.generationDigest) throw new Error("delegated workspace generation is missing or does not match");
			records.delete(identity);
		},
		list: () => [...records.values()].map((record) => ({ ...record })),
	});
}
