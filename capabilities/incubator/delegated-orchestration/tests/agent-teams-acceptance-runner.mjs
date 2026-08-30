import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const upstreamCommit = "2c1776d2a68104aaadc1c622d8a704684c7c35d6";
const root = mkdtempSync(join(tmpdir(), "mypi-agent-teams-acceptance-source-"));
chmodSync(root, 0o700);
const checkout = join(root, "source");
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const profileRoot = join(packageRoot, "profiles", "pi-agent-teams", "node-worker-v1");
const overlay = join(profileRoot, "agent-teams-overlay.patch");
const dependencySource = join(profileRoot, "acceptance-dependencies");
const dependencyPins = {
	"package.json": "d24acfc7ac60a925ef03ce38dc37b789e06563936b24b4e146fcada1adff75b6",
	"package-lock.json": "2a52e2d4ab52088f8dd6eed2fb80a9ea360913deb51af3d384b3cb8f137e229f",
};
const probe = join(dirname(fileURLToPath(import.meta.url)), "agent-teams-acceptance-probe.mjs");
let stage = "clone";
let emitted = false;

function digest(error) {
	return createHash("sha256").update(error instanceof Error ? `${error.name}:${error.message}` : String(error)).digest("hex");
}

function emit(value) {
	if (emitted) return;
	emitted = true;
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000, ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command}:${args[0] ?? "command"}:exit-${result.status ?? "unknown"}`);
	return result;
}

try {
	run("git", ["clone", "--quiet", "--no-checkout", "https://github.com/tmustier/pi-agent-teams.git", checkout]);
	stage = "checkout";
	run("git", ["-C", checkout, "checkout", "--quiet", "--detach", upstreamCommit]);
	stage = "overlay";
	run("git", ["-C", checkout, "apply", "--check", "--unidiff-zero", overlay]);
	run("git", ["-C", checkout, "apply", "--unidiff-zero", overlay]);
	stage = "dependencies";
	const dependencies = join(root, "dependencies");
	mkdirSync(dependencies, { mode: 0o700 });
	for (const [name, expectedDigest] of Object.entries(dependencyPins)) {
		const source = join(dependencySource, name);
		if (createHash("sha256").update(readFileSync(source)).digest("hex") !== expectedDigest) throw new Error(`acceptance dependency lock drift:${name}`);
		copyFileSync(source, join(dependencies, name));
	}
	run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", "--progress=false"], { cwd: dependencies, timeout: 300_000 });
	symlinkSync(join(dependencies, "node_modules"), join(checkout, "node_modules"), "dir");
	stage = "probe";
	const child = spawnSync(process.execPath, [probe, checkout], { encoding: "utf8", env: process.env, timeout: 600_000 });
	if (child.error) throw child.error;
	let evidence;
	try { evidence = JSON.parse(child.stdout); } catch { evidence = undefined; }
	if (evidence && (evidence.status === "PASS" || evidence.status === "FAIL" || evidence.status === "BLOCKED")) {
		emit(evidence.status === "PASS" ? evidence : {
			...evidence,
			stage: typeof evidence.stage === "string" ? evidence.stage : stage,
			exitCode: Number.isSafeInteger(evidence.exitCode) ? evidence.exitCode : child.status,
			errorDigest: typeof evidence.errorDigest === "string" && /^[a-f0-9]{64}$/.test(evidence.errorDigest)
				? evidence.errorDigest
				: digest(typeof evidence.reason === "string" ? evidence.reason : `${evidence.status}:${stage}`),
		});
		process.exitCode = child.status ?? 1;
	} else {
		emit({
			schemaVersion: 1,
			kind: "mypi-agent-teams-generated-profile-acceptance",
			status: child.status === 78 ? "BLOCKED" : "FAIL",
			stage,
			exitCode: child.status,
			errorDigest: digest(child.stderr || `probe-exit-${child.status ?? "unknown"}`),
			productionActivated: false,
		});
		process.exitCode = child.status ?? 1;
	}
} catch (error) {
	emit({
		schemaVersion: 1,
		kind: "mypi-agent-teams-generated-profile-acceptance",
		status: "BLOCKED",
		stage,
		exitCode: 78,
		errorDigest: digest(error),
		productionActivated: false,
	});
	process.exitCode = 78;
} finally {
	rmSync(root, { recursive: true, force: true });
}
