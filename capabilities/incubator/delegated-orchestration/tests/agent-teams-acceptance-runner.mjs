import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const upstreamCommit = "2c1776d2a68104aaadc1c622d8a704684c7c35d6";
const root = mkdtempSync(join(tmpdir(), "mypi-agent-teams-acceptance-source-"));
chmodSync(root, 0o700);
const checkout = join(root, "source");
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const overlay = join(packageRoot, "profiles", "pi-agent-teams", "node-worker-v1", "agent-teams-overlay.patch");
const probe = join(dirname(fileURLToPath(import.meta.url)), "agent-teams-acceptance-probe.mjs");

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000, ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed: ${(result.stderr || result.stdout).trim()}`);
	return result;
}

try {
	run("git", ["clone", "--quiet", "--no-checkout", "https://github.com/tmustier/pi-agent-teams.git", checkout]);
	run("git", ["-C", checkout, "checkout", "--quiet", "--detach", upstreamCommit]);
	run("git", ["-C", checkout, "apply", "--check", "--unidiff-zero", overlay]);
	run("git", ["-C", checkout, "apply", "--unidiff-zero", overlay]);
	run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: checkout, timeout: 300_000 });
	const child = spawnSync(process.execPath, [probe, checkout], { stdio: "inherit", env: process.env, timeout: 600_000 });
	if (child.error) throw child.error;
	process.exitCode = child.status ?? 1;
} finally {
	rmSync(root, { recursive: true, force: true });
}
