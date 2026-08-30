import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createCommandReviewRegistry } from "../extensions/command-review-registry.ts";
import { createAuthorityRegistry } from "../extensions/orchestration-registry.ts";
import { createDelegatedWorkspaceAuthority } from "../extensions/delegated-workspace-authority.ts";
import {
	DELEGATED_PRODUCTION_ENV,
	delegatedProductionRequested,
	registerDelegatedProductionCandidate,
} from "../extensions/production.ts";

const NOW = "2026-08-31T00:00:00.000Z";

function authorityFixture() {
	const entries: unknown[] = [];
	const pi = { appendEntry(customType: string, data: unknown) { entries.push({ customType, data }); } };
	const authority = createAuthorityRegistry(pi as any);
	authority.activateMandate({
		version: 1,
		id: "production-mandate",
		cwd: "/repo",
		goal: "verify disabled production seam",
		definitionOfDone: ["production acceptance passes"],
		allowedHarnesses: ["pi-agent-teams"],
		maxConcurrentWorkers: 1,
		maxAgentLaunches: 2,
		writePolicy: "worktree-only",
		shellNetwork: "deny",
		secrets: "deny",
		uploads: "deny",
		humanOnly: ["push-deploy-publish"],
		createdAt: "2026-08-30T23:59:00.000Z",
		expiresAt: "2026-08-31T01:00:00.000Z",
	}, NOW);
	authority.recordProfile({
		profileId: "pi-agent-teams-docker-strong-v1",
		profileVersion: "2",
		backend: "pi-agent-teams",
		digest: "a".repeat(64),
		policyDigest: "b".repeat(64),
		verified: true,
	}, "2026-08-31T00:00:01.000Z");
	return {
		authority,
		reviews: createCommandReviewRegistry(pi as any, authority),
		workspaces: createDelegatedWorkspaceAuthority(),
	};
}

test("production seam is absent from Pi resources and disabled without exact opt-in", () => {
	const packageRoot = resolve(import.meta.dirname, "..");
	const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
	assert.equal(manifest.exports["./production"], "./extensions/production.ts");
	assert.deepEqual(manifest.pi.extensions, ["./extensions/orchestration.ts"]);
	assert.equal(delegatedProductionRequested({}), false);
	assert.equal(delegatedProductionRequested({ [DELEGATED_PRODUCTION_ENV]: "0" }), false);
	assert.throws(() => delegatedProductionRequested({ [DELEGATED_PRODUCTION_ENV]: "yes" }), /absent, 0, or 1/);
});

test("disabled seam registers neither guardrails nor orchestration", () => {
	let registrations = 0;
	const result = registerDelegatedProductionCandidate({
		pi: { on() { registrations += 1; } } as any,
		authority: { state() { throw new Error("must not inspect disabled authority"); } } as any,
		reviews: {} as any,
		workspaces: {} as any,
		manualGuardrailsLoaded: false,
		environment: {},
		registerOrchestration() { registrations += 1; },
	});
	assert.deepEqual(result, { activated: false });
	assert.equal(registrations, 0);
});

test("exact opt-in requires trusted authority and composes one resolver path", () => {
	const fixture = authorityFixture();
	const handlers = new Map<string, unknown>();
	let orchestrationRegistrations = 0;
	const result = registerDelegatedProductionCandidate({
		pi: {
			on(name: string, handler: unknown) { handlers.set(name, handler); },
			events: { emit() {} },
		} as any,
		...fixture,
		manualGuardrailsLoaded: false,
		environment: { [DELEGATED_PRODUCTION_ENV]: "1" },
		now: () => "2026-08-31T00:00:02.000Z",
		registerOrchestration() { orchestrationRegistrations += 1; },
	});
	assert.equal(result.activated, true);
	assert.ok(result.resolver);
	assert.ok(handlers.has("tool_call"));
	assert.equal(orchestrationRegistrations, 1);
});

test("exact opt-in rejects a non-authoritative workspace contract", () => {
	const fixture = authorityFixture();
	assert.throws(() => registerDelegatedProductionCandidate({
		pi: {} as any,
		authority: fixture.authority,
		reviews: fixture.reviews,
		workspaces: {} as any,
		manualGuardrailsLoaded: false,
		environment: { [DELEGATED_PRODUCTION_ENV]: "1" },
	}), /workspace authority contract is invalid/);
});

test("exact opt-in fails closed without an active mandate", () => {
	const fixture = authorityFixture();
	fixture.authority.finishMandate("cancelled", "2026-08-31T00:00:02.000Z");
	assert.throws(() => registerDelegatedProductionCandidate({
		pi: {} as any,
		...fixture,
		manualGuardrailsLoaded: false,
		environment: { [DELEGATED_PRODUCTION_ENV]: "1" },
	}), /active trusted mandate/);
});
