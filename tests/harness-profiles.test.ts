import assert from "node:assert/strict";
import test from "node:test";
import {
	assertSafeHarnessArgs,
	buildClaudeDelegatedProfile,
	buildCodexDelegatedProfile,
	missingRequiredHelpFlags,
	verifyClaudeProfile,
	verifyCodexProfile,
	type BoundaryEvidence,
} from "../extensions/harness-profiles.ts";

const ENV = {
	HOME: "/Users/probe",
	PATH: "/toolchain/bin:/usr/bin:/bin",
	USER: "probe",
	LOGNAME: "probe",
	SHELL: "/bin/zsh",
	TERM: "xterm-256color",
	LANG: "en_US.UTF-8",
	LC_ALL: "en_US.UTF-8",
	TMPDIR: "/private/var/tmp/probe/",
	HERDR_ENV: "1",
	HERDR_SOCKET_PATH: "/Users/probe/.config/herdr/herdr.sock",
	HERDR_PANE_ID: "w7:pB",
	MYPI_PHASE0_PARENT_MARKER: "must-not-leak",
	ANTHROPIC_API_KEY: "must-not-leak",
	AWS_SECRET_ACCESS_KEY: "must-not-leak",
};

const BOUNDARY_PASS: BoundaryEvidence = {
	routine: true,
	tests: true,
	environmentIsolated: true,
	secretDenied: true,
	hostCredentialsDenied: true,
	worktreeReadIsolation: true,
	externalWriteDenied: true,
	networkDenied: true,
	noRoutinePrompt: true,
};

test("builds an isolated Codex profile without ambient secrets or bypass flags", () => {
	const profile = buildCodexDelegatedProfile({
		cliVersion: "0.150.1",
		model: "gpt-5.6-luna",
		effort: "medium",
		cwd: "/Users/probe/worktree",
		codexHome: "/Users/probe/runtime/codex",
		shellHome: "/Users/probe/runtime/shell-home",
		tempDir: "/Users/probe/runtime/tmp",
		credentialFilePaths: ["/Users/probe/fixture-credential.txt"],
		environment: ENV,
	});

	assert.equal(profile.environment.CODEX_HOME, "/Users/probe/runtime/codex");
	assert.equal(profile.environment.HERDR_PANE_ID, "w7:pB");
	assert.equal(profile.environment.MYPI_PHASE0_PARENT_MARKER, undefined);
	assert.equal(profile.environment.ANTHROPIC_API_KEY, undefined);
	assert.equal(profile.environment.AWS_SECRET_ACCESS_KEY, undefined);
	assert.match(profile.configToml, /inherit = "none"/);
	assert.match(profile.configToml, /approvals_reviewer = "auto_review"/);
	assert.match(profile.configToml, /":slash_tmp" = "deny"/);
	assert.match(profile.configToml, /"\*\*\/\.env" = "deny"/);
	assert.match(profile.configToml, /\/Users\/probe\/\.ssh/);
	assert.match(profile.configToml, /fixture-credential\.txt/);
	assert.match(profile.configToml, /enabled = false/);
	assert.equal(profile.configSha256.length, 64);
	assert.ok(!profile.args.some((arg) => arg.includes("dangerously")));
	assert.deepEqual(missingRequiredHelpFlags("--strict-config --model --no-alt-screen", profile.requiredHelpFlags), []);
});

test("Codex verification fails closed on drift, readiness, digest, or boundary evidence", () => {
	const requested = buildCodexDelegatedProfile({
		cliVersion: "0.150.1",
		model: "gpt-5.6-luna",
		effort: "medium",
		cwd: "/Users/probe/worktree",
		codexHome: "/Users/probe/runtime/codex",
		shellHome: "/Users/probe/runtime/shell-home",
		tempDir: "/Users/probe/runtime/tmp",
		environment: ENV,
	});
	const observed = {
		cliVersion: "0.150.1",
		model: "gpt-5.6-luna",
		effort: "medium",
		cwd: "/Users/probe/worktree",
		approvalPolicy: "on-request",
		sandboxPolicy: { type: "workspace-write", networkAccess: false, excludeSlashTmp: true },
		interactiveReady: true,
		lifecycleSessionId: "01a-session",
		configSha256: requested.configSha256,
	};
	assert.deepEqual(verifyCodexProfile({ requested, observed, boundary: BOUNDARY_PASS }), {
		verified: true,
		mismatches: [],
	});

	const failed = verifyCodexProfile({
		requested,
		observed: {
			...observed,
			model: "gpt-5.4-mini",
			effort: "low",
			interactiveReady: false,
			lifecycleSessionId: undefined,
			configSha256: "0".repeat(64),
		},
		boundary: { ...BOUNDARY_PASS, environmentIsolated: false },
	});
	assert.equal(failed.verified, false);
	assert.deepEqual(failed.mismatches, [
		"model",
		"effort",
		"interactive-readiness",
		"lifecycle-session",
		"config-digest",
		"boundary:environmentIsolated",
	]);
});

test("builds Claude dontAsk profile with only explicit settings, tools, hook, and environment", () => {
	const profile = buildClaudeDelegatedProfile({
		cliVersion: "2.1.251",
		model: "claude-sonnet-5",
		effort: "medium",
		cwd: "/Users/probe/worktree",
		settingsPath: "/Users/probe/runtime/claude-settings.json",
		herdrHookPath: "/Users/probe/.claude/hooks/herdr-agent-state.sh",
		credentialFilePaths: ["/Users/probe/fixture-credential.txt"],
		environment: ENV,
	});

	assert.equal(profile.environment.MYPI_PHASE0_PARENT_MARKER, undefined);
	assert.equal(profile.environment.ANTHROPIC_API_KEY, undefined);
	assert.equal(profile.environment.HERDR_SOCKET_PATH, ENV.HERDR_SOCKET_PATH);
	assert.ok(profile.args.includes("dontAsk"));
	assert.ok(profile.args.includes("--restricted"));
	assert.ok(!profile.args.includes("--safe-mode"), "safe mode would disable the explicit Herdr hook");
	assert.ok(!profile.args.some((arg) => arg.includes("bypass")));
	assert.match(profile.settingsJson, /"allowUnsandboxedCommands": false/);
	assert.match(profile.settingsJson, /"failIfUnavailable": true/);
	assert.match(profile.settingsJson, /"denyRead": \[/);
	assert.match(profile.settingsJson, /"credentials": \{/);
	assert.match(profile.settingsJson, /"~\/\.ssh"/);
	assert.match(profile.settingsJson, /fixture-credential\.txt/);
	assert.match(profile.settingsJson, /"ANTHROPIC_API_KEY"/);
	assert.match(profile.settingsJson, /"deniedDomains": \[/);
	assert.match(profile.settingsJson, /herdr-agent-state\.sh' session/);
	assert.equal(profile.settingsSha256.length, 64);
	assert.deepEqual(
		missingRequiredHelpFlags(profile.requiredHelpFlags.join(" "), profile.requiredHelpFlags),
		[],
	);
});

test("Claude verification requires exact observed mode, tools, lifecycle identity, and evidence", () => {
	const requested = buildClaudeDelegatedProfile({
		cliVersion: "2.1.251",
		model: "claude-sonnet-5",
		effort: "medium",
		cwd: "/Users/probe/worktree",
		settingsPath: "/Users/probe/runtime/claude-settings.json",
		herdrHookPath: "/Users/probe/.claude/hooks/herdr-agent-state.sh",
		environment: ENV,
	});
	const observed = {
		cliVersion: "2.1.251",
		model: "claude-sonnet-5",
		permissionMode: "dontAsk",
		cwd: "/Users/probe/worktree",
		tools: ["Bash", "Edit", "Read", "Write"],
		interactiveReady: true,
		lifecycleSessionId: "claude-session",
		settingsSha256: requested.settingsSha256,
	};
	assert.equal(verifyClaudeProfile({ requested, observed, boundary: BOUNDARY_PASS }).verified, true);

	const failed = verifyClaudeProfile({
		requested,
		observed: {
			...observed,
			permissionMode: "auto",
			tools: [...observed.tools, "WebFetch"],
			lifecycleSessionId: undefined,
		},
		boundary: { ...BOUNDARY_PASS, noRoutinePrompt: false },
	});
	assert.deepEqual(failed, {
		verified: false,
		mismatches: ["permission-mode", "tools", "lifecycle-session", "boundary:noRoutinePrompt"],
	});
});

test("rejects unsupported versions, non-identifiers, non-absolute paths, and bypass flags", () => {
	assert.throws(() => buildCodexDelegatedProfile({
		cliVersion: "0.151.0",
		model: "gpt-5.6-luna",
		effort: "medium",
		cwd: "/worktree",
		codexHome: "/runtime/codex",
		shellHome: "/runtime/home",
		tempDir: "/runtime/tmp",
		environment: ENV,
	}), /unsupported codex version/);
	assert.throws(() => buildClaudeDelegatedProfile({
		cliVersion: "2.1.251",
		model: "inherit default",
		effort: "medium",
		cwd: "/worktree",
		settingsPath: "/runtime/settings.json",
		herdrHookPath: "/runtime/hook.sh",
		environment: ENV,
	}), /model must be a non-empty identifier/);
	assert.throws(() => buildClaudeDelegatedProfile({
		cliVersion: "2.1.251",
		model: "claude-sonnet-5",
		effort: "medium",
		cwd: "relative/worktree",
		settingsPath: "/runtime/settings.json",
		herdrHookPath: "/runtime/hook.sh",
		environment: ENV,
	}), /cwd must be an absolute path/);
	assert.throws(() => assertSafeHarnessArgs(["--permission-mode", "bypassPermissions"]), /forbidden/);
	assert.throws(() => assertSafeHarnessArgs(["--dangerously-bypass-approvals-and-sandbox=true"]), /forbidden/);
	assert.deepEqual(missingRequiredHelpFlags("--model", ["--model", "--strict-config"]), ["--strict-config"]);
});
