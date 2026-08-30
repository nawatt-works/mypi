import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
	throw new Error("usage: npm run test:agent-teams-acceptance -- <patched-agent-teams-checkout> [output-root]");
}
const tsx = join(checkout, "node_modules", ".bin", "tsx");
if (!existsSync(tsx)) {
	throw new Error(`tsx is missing from the patched checkout; install its pinned package dependencies first: ${tsx}`);
}
const harness = join(dirname(fileURLToPath(import.meta.url)), "agent-teams-acceptance-probe.mts");
const args = [harness, checkout, ...(process.argv[3] ? [resolve(process.argv[3])] : [])];
const child = spawnSync(tsx, args, { stdio: "inherit", env: process.env });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
