import { glob } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const patterns = ["tests/**/*.test.ts", "capabilities/**/*.test.ts"];
const files = [];
for (const pattern of patterns) {
	for await (const file of glob(pattern)) files.push(file);
}
files.sort();
if (files.length === 0) throw new Error("No test files found");

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...files], {
	stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
