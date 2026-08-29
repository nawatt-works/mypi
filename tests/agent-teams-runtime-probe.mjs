import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildAgentTeamsProfile } from "../extensions/agent-teams-profile.ts";

const checkout = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node --experimental-strip-types tests/agent-teams-runtime-probe.mjs <patched-agent-teams-checkout>");
const repositoryRoot = resolve(import.meta.dirname, "..");
const entryPath = join(checkout, "extensions", "teams", "index.ts");
const teammateRpcPath = join(checkout, "extensions", "teams", "teammate-rpc.ts");
const overlayPath = join(repositoryRoot, "profiles", "pi-agent-teams", "node-worker-v1", "agent-teams-overlay.patch");
const temporaryRoot = mkdtempSync(join(tmpdir(), "mypi-agent-teams-runtime-probe-"));
const cleanWorktree = join(temporaryRoot, "clean-upstream");
const result = { applyCheck: false, profileBuild: false, cases: [] };

function run(command, args, options = {}) {
	return spawnSync(command, args, { encoding: "utf8", timeout: 30_000, ...options });
}

function record(name, blocked, detail) {
	result.cases.push({ name, blocked, detail });
	if (!blocked) throw new Error(`${name} did not fail closed: ${detail}`);
}

try {
	const head = run("git", ["-C", checkout, "rev-parse", "HEAD"]);
	if (head.status !== 0 || head.stdout.trim() !== "2c1776d2a68104aaadc1c622d8a704684c7c35d6") throw new Error("unexpected upstream checkout");
	const add = run("git", ["-C", checkout, "worktree", "add", "--detach", cleanWorktree, head.stdout.trim()]);
	if (add.status !== 0) throw new Error(add.stderr || "unable to create clean upstream worktree");
	const apply = run("git", ["-C", cleanWorktree, "apply", "--check", "--unidiff-zero", overlayPath]);
	if (apply.status !== 0) throw new Error(apply.stderr || "overlay apply-check failed");
	result.applyCheck = true;

	const profile = buildAgentTeamsProfile({
		upstreamCommit: head.stdout.trim(),
		patchedTeamsEntryPath: entryPath,
		teamsRootDir: join(temporaryRoot, "teams"),
		maxWorkers: 2,
		environment: process.env,
	});
	result.profileBuild = true;
	const baseLeaderArgs = ["--mode", "rpc", "--no-extensions", "-e", entryPath];
	const leaderCases = [
		{
			name: "missing-managed-environment",
			mutate(environment) { delete environment.PI_TEAMS_CHILD_EXTENSIONS; },
			expect: /boundary extension is missing or invalid/,
		},
		{
			name: "valid-wrong-contract-digest",
			mutate(environment) { environment.PI_TEAMS_MANAGED_PROFILE_DIGEST = "b".repeat(64); },
			expect: /does not match the derived boundary contract/,
		},
	];
	const forgedBoundary = join(temporaryRoot, "forged-boundary.ts");
	writeFileSync(forgedBoundary, "export default function forged() {}\n");
	leaderCases.push({
		name: "replaced-boundary-extension",
		mutate(environment) { environment.PI_TEAMS_CHILD_EXTENSIONS = forgedBoundary; },
		expect: /boundary extension digest mismatch/,
	});
	for (const probe of leaderCases) {
		const environment = { ...profile.leaderEnvironment };
		probe.mutate(environment);
		const child = run("pi", baseLeaderArgs, {
			env: environment,
			input: '{"id":"probe","type":"get_state"}\n',
			timeout: 15_000,
		});
		record(probe.name, child.status !== 0 && probe.expect.test(child.stderr), child.stderr.trim().split("\n")[0] ?? "");
	}

	const { TeammateRpc } = await import(pathToFileURL(teammateRpcPath).href);
	const fixture = join(temporaryRoot, "fixture");
	mkdirSync(fixture, { recursive: true });
	const digest = (character) => character.repeat(64);
	const expectedReadiness = {
		contractDigest: digest("c"),
		nonceDigest: digest("b"),
		teamId: "probe-team",
		workerName: "probe-worker",
		boundaryPath: join(temporaryRoot, "readiness-extension.ts"),
		boundarySha256: digest("d"),
		entryPath: join(temporaryRoot, "entry.ts"),
		entrySha256: digest("e"),
		sourceSha256: digest("f"),
		tools: ["read"],
		workspaceMode: "worktree",
		maxWorkers: 2,
	};
	const commonStart = {
		cwd: fixture,
		env: { PI_TEAMS_TEAM_ID: expectedReadiness.teamId, PI_TEAMS_AGENT_NAME: expectedReadiness.workerName },
	};

	const forgedExtension = expectedReadiness.boundaryPath;
	writeFileSync(forgedExtension, `export default function forged(pi) { pi.on("session_start", () => process.stderr.write("MYPI_WORKER_BOUNDARY_READY " + JSON.stringify({contractDigest:"${expectedReadiness.contractDigest}",nonceDigest:"${digest("a")}",teamId:process.env.PI_TEAMS_TEAM_ID??"",workerName:process.env.PI_TEAMS_AGENT_NAME??"",boundaryPath:${JSON.stringify(forgedExtension)},boundarySha256:"${expectedReadiness.boundarySha256}",entryPath:${JSON.stringify(expectedReadiness.entryPath)},entrySha256:"${expectedReadiness.entrySha256}",sourceSha256:"${expectedReadiness.sourceSha256}",tools:["read"],environmentKeys:Object.keys(process.env).sort(),workspaceMode:"worktree",maxWorkers:2}) + "\\n")); }\n`);
	const forged = new TeammateRpc("forged-marker");
	let forgedError = "";
	try {
		await forged.start({ ...commonStart, args: ["--no-extensions", "--tools", "read", "-e", forgedExtension], expectedReadiness });
	} catch (error) {
		forgedError = String(error);
	} finally {
		await forged.stop().catch(() => undefined);
	}
	record("forged-or-replayed-marker", /structured readiness does not match/.test(forgedError), forgedError);

	const missing = new TeammateRpc("missing-marker");
	let missingError = "";
	try {
		await missing.start({ ...commonStart, args: ["--no-extensions", "--tools", "read"], expectedReadiness });
	} catch (error) {
		missingError = String(error);
	} finally {
		await missing.stop().catch(() => undefined);
	}
	record("missing-marker", /Timed out waiting for Worker boundary readiness marker/.test(missingError), missingError);

	const raceExtension = join(temporaryRoot, "readiness-race.ts");
	const raceExpected = { ...expectedReadiness, boundaryPath: raceExtension, nonceDigest: digest("9") };
	writeFileSync(raceExtension, `export default function race(pi) { pi.on("session_start", () => { process.stderr.write("MYPI_WORKER_BOUNDARY_READY " + JSON.stringify({contractDigest:"${raceExpected.contractDigest}",nonceDigest:"${raceExpected.nonceDigest}",teamId:process.env.PI_TEAMS_TEAM_ID??"",workerName:process.env.PI_TEAMS_AGENT_NAME??"",boundaryPath:${JSON.stringify(raceExtension)},boundarySha256:"${raceExpected.boundarySha256}",entryPath:${JSON.stringify(raceExpected.entryPath)},entrySha256:"${raceExpected.entrySha256}",sourceSha256:"${raceExpected.sourceSha256}",tools:["read"],environmentKeys:Object.keys(process.env).sort(),workspaceMode:"worktree",maxWorkers:2}) + "\\n"); setTimeout(() => process.exit(78), 500); }); }\n`);
	const race = new TeammateRpc("startup-race");
	let raceError = "";
	try {
		await race.start({ ...commonStart, args: ["--no-extensions", "--tools", "read", "-e", raceExtension], expectedReadiness: raceExpected });
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
		await race.setSessionName("must-fail-after-exit");
	} catch (error) {
		raceError = String(error);
	} finally {
		await race.stop().catch(() => undefined);
	}
	record("post-marker-startup-race", /not running|Process exited|Teammate/.test(raceError), raceError);

	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	run("git", ["-C", checkout, "worktree", "remove", "--force", cleanWorktree]);
	rmSync(temporaryRoot, { recursive: true, force: true });
}
