import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const CAPABILITIES = join(ROOT, "capabilities");
const LANES = ["global", "project-opt-in", "incubator"] as const;
const RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

type PackageManifest = {
	name: string;
	private?: boolean;
	workspaces?: string[];
	dependencies?: Record<string, string>;
	pi?: Partial<Record<(typeof RESOURCE_KEYS)[number], string[]>>;
};

function manifest(path: string): PackageManifest {
	return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function packageDirectories(lane: (typeof LANES)[number]): string[] {
	const root = join(CAPABILITIES, lane);
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(root, entry.name))
		.sort();
}

function walk(root: string): string[] {
	const output: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new Error(`symlink is not allowed in capability source: ${path}`);
		if (entry.isDirectory()) output.push(...walk(path));
		else output.push(path);
	}
	return output;
}

function normalized(path: string): string {
	return path.split(sep).join("/");
}

test("every capability is a self-described package in an explicit lane", () => {
	const names = new Set<string>();
	for (const lane of LANES) {
		for (const directory of packageDirectories(lane)) {
			const packagePath = join(directory, "package.json");
			assert.ok(existsSync(packagePath), `missing package.json: ${normalized(relative(ROOT, directory))}`);
			assert.ok(existsSync(join(directory, "README.md")), `missing README.md: ${normalized(relative(ROOT, directory))}`);
			const value = manifest(packagePath);
			assert.match(value.name, /^@nawatt-works\/mypi-[a-z0-9-]+$/);
			assert.equal(value.private, true);
			assert.ok(!names.has(value.name), `duplicate capability package name: ${value.name}`);
			names.add(value.name);
			for (const key of RESOURCE_KEYS) {
				for (const resource of value.pi?.[key] ?? []) {
					assert.ok(!resource.split(/[\\/]/).includes(".."), `${value.name} ${key} escapes its package: ${resource}`);
					assert.ok(existsSync(resolve(directory, resource)), `${value.name} ${key} resource is missing: ${resource}`);
				}
			}
		}
	}
});

test("root aggregate loads every and only stable global capability resource", () => {
	const root = manifest(join(ROOT, "package.json"));
	assert.deepEqual(root.workspaces, [
		"capabilities/global/*",
		"capabilities/project-opt-in/*",
		"capabilities/incubator/*",
	]);
	const rootResources = RESOURCE_KEYS.flatMap((key) => (root.pi?.[key] ?? []).map((path) => `${key}:${path.replace(/^\.\//, "")}`)).sort();
	for (const item of rootResources) {
		assert.match(item, /:capabilities\/global\//, `root aggregate crossed a capability lane: ${item}`);
		assert.ok(existsSync(join(ROOT, item.slice(item.indexOf(":") + 1))), `root resource is missing: ${item}`);
	}
	const expected = packageDirectories("global").flatMap((directory) => {
		const value = manifest(join(directory, "package.json"));
		return RESOURCE_KEYS.flatMap((key) => (value.pi?.[key] ?? []).map((path) => {
			const target = normalized(relative(ROOT, resolve(directory, path)));
			return `${key}:${target}`;
		}));
	}).sort();
	assert.deepEqual(rootResources, expected);
	assert.deepEqual(root.pi?.skills, [
		"./capabilities/global/mcp-adapter/skills/mcp-scripting/SKILL.md",
		"./capabilities/global/dependency-updates/skills/dependency-update-assessment/SKILL.md",
	]);
});

test("managed third-party global adapters use exact dependency pins", () => {
	const expected = new Map([
		["@nawatt-works/mypi-mcp-adapter", ["pi-mcp-adapter", "2.31.0"]],
		["@nawatt-works/mypi-web-access", ["pi-web-access", "0.27.0"]],
		["@nawatt-works/mypi-chrome-devtools", ["@narumitw/pi-chrome-devtools", "0.53.1"]],
	]);
	let matched = 0;
	for (const directory of packageDirectories("global")) {
		const value = manifest(join(directory, "package.json"));
		const pin = expected.get(value.name);
		if (!pin) continue;
		matched++;
		assert.deepEqual(Object.entries(value.dependencies ?? {}), [pin]);
		assert.match(pin[1], /^\d+\.\d+\.\d+$/);
	}
	assert.equal(matched, expected.size);
});

test("stable global packages cannot depend on or import from another lane", () => {
	const globalPackages = new Map(packageDirectories("global").map((directory) => {
		const value = manifest(join(directory, "package.json"));
		return [value.name, directory] as const;
	}));
	for (const directory of packageDirectories("global")) {
		const value = manifest(join(directory, "package.json"));
		for (const dependency of Object.keys(value.dependencies ?? {}).filter((name) => name.startsWith("@nawatt-works/mypi-"))) {
			assert.ok(globalPackages.has(dependency), `${value.name} depends on non-global capability ${dependency}`);
		}
		for (const file of walk(directory).filter((path) => /\.(?:ts|mts|mjs|js)$/.test(path))) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
				const specifier = match[1];
				if (specifier.startsWith(".")) {
					const target = resolve(dirname(file), specifier);
					const escaped = relative(join(CAPABILITIES, "global"), target);
					assert.ok(escaped && escaped !== ".." && !escaped.startsWith(`..${sep}`), `global relative import escaped lane: ${normalized(relative(ROOT, file))} -> ${specifier}`);
				} else if (specifier.startsWith("@nawatt-works/mypi-")) {
					const packageName = specifier.split("/").slice(0, 2).join("/");
					assert.ok(globalPackages.has(packageName), `global import targets non-global capability: ${specifier}`);
				}
			}
		}
	}
});

test("stable extension commands keep the mypi prefix and legacy roots are gone", () => {
	for (const directory of packageDirectories("global")) {
		for (const file of walk(directory).filter((path) => path.endsWith(".ts"))) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/registerCommand\(\s*["']([^"']+)/g)) {
				assert.match(match[1], /^mypi-/, `${normalized(relative(ROOT, file))} registers an unprefixed command`);
			}
		}
	}
	for (const legacy of ["extensions", "skills", "themes", "local", "profiles"]) {
		assert.equal(existsSync(join(ROOT, legacy)), false, `legacy resource root still exists: ${legacy}`);
	}
});
