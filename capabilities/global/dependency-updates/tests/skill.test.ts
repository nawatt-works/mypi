import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { formatUpdateNotification } from "../extensions/index.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SKILL = resolve(ROOT, "skills", "dependency-update-assessment", "SKILL.md");
const CHECKLIST = resolve(ROOT, "skills", "dependency-update-assessment", "references", "assessment-checklist.md");
const TEMPLATE = resolve(ROOT, "skills", "dependency-update-assessment", "references", "report-template.md");
const EVALS = resolve(ROOT, "skills", "dependency-update-assessment", "evals", "evals.json");

test("update notification remains detection-only and routes exact candidates to assessment", () => {
	const output = formatUpdateNotification([
		{ name: "example", current: "1.0.0", wanted: "1.0.0", latest: "2.0.0" },
	]);
	assert.match(output, /detection only/);
	assert.match(output, /\/skill:dependency-update-assessment/);
	assert.doesNotMatch(output, /Run npm update|npm update in my-pi/);
});

test("dependency assessment skill declares a valid trigger and progressive references", () => {
	const source = readFileSync(SKILL, "utf8");
	const frontmatter = source.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
	assert.match(frontmatter, /^name: dependency-update-assessment$/mu);
	const description = frontmatter.match(/^description: (.+)$/mu)?.[1] ?? "";
	assert.ok(description.length > 80 && description.length <= 1024);
	assert.match(description, /exact pins?/i);
	assert.match(description, /changelog|compatibility|security/i);
	assert.match(source, /references\/assessment-checklist\.md/);
	assert.match(source, /references\/report-template\.md/);
	const checklist = readFileSync(CHECKLIST, "utf8");
	for (const contract of [
		"`pi.extensions`, `pi.skills`, `pi.prompts`, and `pi.themes`",
		"Generated Workers retain `--no-extensions`, `--no-skills`",
		"Full tests pass",
		"Clean install and Pi RPC/resource discovery pass",
		"`npm audit --omit=dev`",
		"Release, tag, Default Pi, and settings rollback steps",
	]) assert.ok(checklist.includes(contract), `missing checklist contract: ${contract}`);
	const template = readFileSync(TEMPLATE, "utf8");
	for (const contract of [
		"Mutation status: none",
		"CURRENT/SAFE_TO_PROPOSE/HOLD/REJECT/HUMAN",
		"clean install/resource smoke",
		"authenticated/real-provider acceptance",
		"Proposed patch — not applied",
		"commit/tag/push/release/Default switch decision",
	]) assert.ok(template.includes(contract), `missing report contract: ${contract}`);
});

test("dependency assessment skill keeps analysis separate from mutation authority", () => {
	const source = readFileSync(SKILL, "utf8");
	for (const verdict of ["CURRENT", "SAFE_TO_PROPOSE", "HOLD", "REJECT", "HUMAN"]) assert.match(source, new RegExp(`\\b${verdict}\\b`));
	for (const boundary of [
		"Never edit the real manifest or lockfile",
		"never execute package code or lifecycle hooks",
		"run candidate lifecycle scripts",
		"Default Pi",
		"separate human decision",
	]) assert.ok(source.includes(boundary), `missing assessment boundary: ${boundary}`);
	assert.match(source, /Never say “safe to update”/);
	assert.match(source, /do not select an arbitrary dependency/);
	assert.match(source, /failed or hanging commands cannot prove/);
	assert.match(source, /an npm web page, search result, publisher profile, cached page, or release list is not sufficient/);
	assert.match(source, /hard prerequisites; if any required gate is unavailable or not run, return `HOLD`/);
});

test("dependency assessment evals cover safe proposal, deceptive patch, and human-only release", () => {
	const value = JSON.parse(readFileSync(EVALS, "utf8")) as {
		skill_name?: unknown;
		evals?: Array<{ id?: unknown; prompt?: unknown; expected_output?: unknown; assertions?: unknown[] }>;
	};
	assert.equal(value.skill_name, "dependency-update-assessment");
	assert.equal(value.evals?.length, 3);
	for (const entry of value.evals ?? []) {
		assert.equal(typeof entry.id, "number");
		assert.equal(typeof entry.prompt, "string");
		assert.equal(typeof entry.expected_output, "string");
		assert.equal(entry.assertions?.length, 3);
	}
	const scenarios = JSON.stringify(value.evals);
	assert.match(scenarios, /direct registry JSON/);
	assert.match(scenarios, /does not invent an arbitrary package scope/);
	assert.match(scenarios, /postinstall/);
	assert.match(scenarios, /push, release tag, and Default Pi switch/);
});
