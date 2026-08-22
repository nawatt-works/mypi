import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import azureDevOpsExtension, { setAzureToolsActive } from "../local/extensions/azure-devops/index.ts";
import {
	AzureDevOpsClient,
	normalizeConfig,
	validateWorkItemFields,
	type AzureDevOpsConfig,
} from "../local/extensions/azure-devops/client.ts";
import {
	AZURE_TOOL_NAMES,
	allowedToolNames,
	assertToolPermission,
	defaultPermissions,
} from "../local/extensions/azure-devops/policy.ts";

const temporaryTestRoot = mkdtempSync(join(tmpdir(), "my-pi-azure-devops-tests-"));
const PAT_ENV = "AZURE_DEVOPS_TEST_PAT";
const PAT = "test-pat-must-never-appear";

after(async () => {
	await rm(temporaryTestRoot, { recursive: true, force: true });
});

function readOnlyConfig(overrides: Record<string, unknown> = {}) {
	return normalizeConfig({
		organization: "example-org",
		project: "example-project",
		auth: { method: "pat", patEnv: PAT_ENV },
		...overrides,
	});
}

function writeConfig(permissions = { create: true, update: true, delete: true }): AzureDevOpsConfig {
	return normalizeConfig({
		organization: "example-org",
		project: "example-project",
		auth: { method: "pat", patEnv: PAT_ENV },
		permissions: { workItems: permissions, repos: { read: true } },
	});
}

function noExec(): never {
	throw new Error("Azure CLI must not be invoked by tests");
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

test("normalizes legacy config as read-only", () => {
	const config = normalizeConfig({
		organization: "AXONS-FIT-Business-and-CPTG",
		project: "AXONS EXIM",
		defaultTeam: "Slamdunk",
		auth: { method: "azure-cli" },
		maxQueryResults: 100,
	});
	assert.deepEqual(config.permissions, defaultPermissions());
	assert.equal(config.auth.method, "azure-cli");
});

test("normalizes partial permissions and rejects unknown permission keys", () => {
	const config = readOnlyConfig({ permissions: { workItems: { read: false }, repos: { read: false } } });
	assert.deepEqual(config.permissions.workItems, { read: false, create: false, update: false, delete: false });
	assert.equal(config.permissions.repos.read, false);
	assert.throws(
		() => readOnlyConfig({ permissions: { workItems: { merge: true } } }),
		/unknown property "merge"/,
	);
	assert.throws(
		() => readOnlyConfig({ permissions: { pipelines: { read: true } } }),
		/unknown property "pipelines"/,
	);
});

test("requires explicit PAT auth whenever write permission is enabled", () => {
	for (const method of ["auto", "azure-cli"]) {
		assert.throws(() => normalizeConfig({
			organization: "org",
			project: "project",
			auth: { method },
			permissions: { workItems: { create: true } },
		}), /require auth\.method "pat"/);
	}
	assert.equal(writeConfig().permissions.workItems.delete, true);
});

test("maps tools to resource CRUD permissions and blocks unknown tools", () => {
	const permissions = defaultPermissions();
	assert.doesNotThrow(() => assertToolPermission("azure_boards_get_work_item", permissions));
	assert.throws(() => assertToolPermission("azure_boards_create_work_item", permissions), /create is disabled/);
	assert.throws(() => assertToolPermission("azure_boards_permanent_destroy", permissions), /Unknown Azure DevOps tool/);
	assert.equal(allowedToolNames(permissions).includes("azure_repos_list_pull_requests"), true);
	assert.equal(allowedToolNames(permissions).includes("azure_boards_delete_work_item"), false);
	const reposOnly = { ...permissions, workItems: { ...permissions.workItems, read: false } };
	assert.throws(
		() => assertToolPermission("azure_repos_get_pull_request_work_items", reposOnly),
		/repos\.read and workItems\.read/,
	);
});

test("activation changes only tools owned by Azure DevOps extension", () => {
	let active = ["read", "other_extension_tool", ...AZURE_TOOL_NAMES];
	setAzureToolsActive({
		getActiveTools: () => active,
		setActiveTools: (names) => { active = names; },
	} as any, ["azure_boards_doctor"]);
	assert.deepEqual(active, ["read", "other_extension_tool", "azure_boards_doctor"]);
});

test("validates the work item field allowlist", () => {
	assert.deepEqual(validateWorkItemFields({ "System.Title": "Allowed" }), { "System.Title": "Allowed" });
	assert.throws(() => validateWorkItemFields({}), /At least one/);
	assert.throws(() => validateWorkItemFields({ "Custom.Secret": "blocked" }), /not allowed/);
});

test("client create uses JSON Patch POST and reads the created item back", async () => {
	process.env[PAT_ENV] = PAT;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		return calls.length === 1
			? jsonResponse({ id: 42, rev: 1 })
			: jsonResponse({ id: 42, rev: 1, fields: { "System.Title": "Created" } });
	};
	const client = new AzureDevOpsClient(writeConfig(), noExec as any, fetcher as typeof fetch);
	const result = await client.createWorkItem("Task", { "System.Title": "Created" });
	assert.equal(result.id, 42);
	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.init.method, "POST");
	assert.match(calls[0]?.url ?? "", /workitems\/\$Task\?api-version=7\.1$/);
	assert.equal(new Headers(calls[0]?.init.headers).get("Content-Type"), "application/json-patch+json");
	assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), [
		{ op: "add", path: "/fields/System.Title", value: "Created" },
	]);
	assert.equal(calls[1]?.init.method, undefined);
});

test("client update uses PATCH with revision test and reads back without retry", async () => {
	process.env[PAT_ENV] = PAT;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		return calls.length === 1
			? jsonResponse({ id: 7, rev: 4 })
			: jsonResponse({ id: 7, rev: 4, fields: { "System.State": "Done" } });
	};
	const client = new AzureDevOpsClient(writeConfig(), noExec as any, fetcher as typeof fetch);
	await client.updateWorkItem(7, 3, { "System.State": "Done" });
	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.init.method, "PATCH");
	assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), [
		{ op: "test", path: "/rev", value: 3 },
		{ op: "add", path: "/fields/System.State", value: "Done" },
	]);
	assert.equal(calls[1]?.init.method, undefined);
});

test("client delete uses only the soft-delete endpoint", async () => {
	process.env[PAT_ENV] = PAT;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		return jsonResponse({ id: 9, code: 200 });
	};
	const client = new AzureDevOpsClient(writeConfig(), noExec as any, fetcher as typeof fetch);
	await client.deleteWorkItem(9);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.init.method, "DELETE");
	assert.match(calls[0]?.url ?? "", /destroy=false/);
	assert.doesNotMatch(calls[0]?.url ?? "", /destroy=true/);
});

test("write client fails before HTTP when permission or PAT is unavailable", async () => {
	let fetchCalls = 0;
	const fetcher = async () => {
		fetchCalls += 1;
		return jsonResponse({});
	};
	process.env[PAT_ENV] = PAT;
	const readOnly = new AzureDevOpsClient(readOnlyConfig(), noExec as any, fetcher as typeof fetch);
	await assert.rejects(() => readOnly.createWorkItem("Task", { "System.Title": "No" }), /create is disabled/);
	delete process.env[PAT_ENV];
	const writable = new AzureDevOpsClient(writeConfig(), noExec as any, fetcher as typeof fetch);
	await assert.rejects(() => writable.createWorkItem("Task", { "System.Title": "No" }), /is not set/);
	assert.equal(fetchCalls, 0);
});

test("redacts PAT and Authorization values from successful API results", async () => {
	process.env[PAT_ENV] = PAT;
	const encoded = `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`;
	const fetcher = async () => jsonResponse({ echoedPat: PAT, authorization: encoded });
	const client = new AzureDevOpsClient(readOnlyConfig(), noExec as any, fetcher as typeof fetch);
	const result = await client.doctor() as { echoedPat: string; authorization: string };
	assert.equal(result.echoedPat, "[REDACTED_SECRET]");
	assert.equal(result.authorization, "[REDACTED_AUTHORIZATION]");
});

test("redacts PAT and Authorization values from API errors", async () => {
	process.env[PAT_ENV] = PAT;
	const encoded = `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`;
	const fetcher = async () => new Response(`failure ${PAT} ${encoded}`, { status: 403, statusText: "Forbidden" });
	const client = new AzureDevOpsClient(writeConfig(), noExec as any, fetcher as typeof fetch);
	await assert.rejects(
		() => client.createWorkItem("Task", { "System.Title": "No" }),
		(error: Error) => {
			assert.doesNotMatch(error.message, new RegExp(PAT));
			assert.doesNotMatch(error.message, new RegExp(encoded));
			assert.match(error.message, /REDACTED/);
			return true;
		},
	);
});

type Harness = ReturnType<typeof createHarness>;

function createHarness(activeTools: string[] = ["read", ...AZURE_TOOL_NAMES]) {
	const handlers = new Map<string, Array<(...args: any[]) => any>>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	let active = [...activeTools];
	const api = {
		on(name: string, handler: (...args: any[]) => any) {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
		},
		registerTool(definition: any) { tools.set(definition.name, definition); },
		registerCommand(name: string, definition: any) { commands.set(name, definition); },
		getActiveTools() { return [...active]; },
		setActiveTools(names: string[]) { active = [...names]; },
		exec: noExec,
	};
	azureDevOpsExtension(api as any);
	return { handlers, tools, commands, get active() { return active; } };
}

async function startHarness(harness: Harness, cwd: string, trusted = true): Promise<string[]> {
	const notifications: string[] = [];
	const ctx = {
		cwd,
		isProjectTrusted: () => trusted,
		hasUI: true,
		ui: {
			setStatus() {},
			notify(message: string) { notifications.push(message); },
		},
	};
	for (const handler of harness.handlers.get("session_start") ?? []) await handler({}, ctx);
	return notifications;
}

async function fixture(name: string, config?: unknown): Promise<string> {
	const cwd = join(temporaryTestRoot, name);
	await rm(cwd, { recursive: true, force: true });
	await mkdir(join(cwd, ".pi"), { recursive: true });
	if (config !== undefined) {
		await writeFile(join(cwd, ".pi", "azure-devops.json"), JSON.stringify(config), "utf8");
	}
	return cwd;
}

test("project-local lifecycle is silent without config and inactive for untrusted projects", async () => {
	const noConfig = createHarness(["read", "other_tool", ...AZURE_TOOL_NAMES]);
	const notifications = await startHarness(noConfig, await fixture("missing"));
	assert.deepEqual(notifications, []);
	assert.deepEqual(noConfig.active, ["read", "other_tool"]);

	const untrusted = createHarness(["read", ...AZURE_TOOL_NAMES]);
	await startHarness(untrusted, await fixture("untrusted", {
		organization: "org",
		project: "project",
	}), false);
	assert.deepEqual(untrusted.active, ["read"]);
});

test("project-local lifecycle warns and disables tools for invalid config", async () => {
	const harness = createHarness();
	const notifications = await startHarness(harness, await fixture("invalid", {
		organization: "org",
		project: "project",
		permissions: { workItems: { create: true } },
		auth: { method: "azure-cli" },
	}));
	assert.equal(notifications.length, 1);
	assert.match(notifications[0] ?? "", /require auth\.method "pat"/);
	assert.deepEqual(harness.active, ["read"]);
});

test("legacy project config activates only read tools", async () => {
	const harness = createHarness(["read", "other_tool", ...AZURE_TOOL_NAMES]);
	await startHarness(harness, await fixture("legacy", {
		organization: "AXONS-FIT-Business-and-CPTG",
		project: "AXONS EXIM",
		defaultTeam: "Slamdunk",
		auth: { method: "azure-cli" },
		maxQueryResults: 100,
	}));
	assert.equal(harness.active.includes("other_tool"), true);
	assert.equal(harness.active.includes("azure_boards_get_work_item"), true);
	assert.equal(harness.active.includes("azure_repos_get_pull_request"), true);
	assert.equal(harness.active.includes("azure_boards_create_work_item"), false);
});

test("config command reports effective permissions without credential material", async () => {
	process.env[PAT_ENV] = PAT;
	const harness = createHarness();
	const cwd = await fixture("config-command", {
		organization: "org",
		project: "project",
		auth: { method: "pat", patEnv: PAT_ENV },
		permissions: { workItems: { create: true } },
	});
	await startHarness(harness, cwd);
	let notification = "";
	await harness.commands.get("mypi-azure-devops-config").handler("", {
		cwd,
		isProjectTrusted: () => true,
		ui: { notify: (message: string) => { notification = message; } },
	});
	assert.match(notification, /Effective permissions/);
	assert.doesNotMatch(notification, new RegExp(PAT));
	assert.doesNotMatch(notification, new RegExp(PAT_ENV));
});

test("write tools fail closed without UI or confirmation", async () => {
	process.env[PAT_ENV] = PAT;
	const originalFetch = globalThis.fetch;
	const calls: RequestInit[] = [];
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		calls.push(init ?? {});
		return jsonResponse({ id: 1, rev: 1, fields: { "System.Title": "Current" } });
	}) as typeof fetch;
	try {
		const harness = createHarness();
		await startHarness(harness, await fixture("write-tools", {
			organization: "org",
			project: "project",
			auth: { method: "pat", patEnv: PAT_ENV },
			permissions: { workItems: { create: true, update: true, delete: true } },
		}));
		const create = harness.tools.get("azure_boards_create_work_item");
		await assert.rejects(
			() => create.execute("id", { type: "Task", title: "No UI" }, undefined, undefined, { hasUI: false, ui: {} }),
			/interactive confirmation is unavailable/,
		);
		await assert.rejects(
			() => create.execute("id", { type: "Task", title: "Denied" }, undefined, undefined, {
				hasUI: true,
				ui: { confirm: async () => false },
			}),
			/User declined/,
		);
		assert.equal(calls.length, 0);

		const remove = harness.tools.get("azure_boards_delete_work_item");
		await assert.rejects(
			() => remove.execute("id", { id: 1 }, undefined, undefined, { hasUI: false, ui: {} }),
			/interactive confirmation is unavailable/,
		);
		assert.equal(calls.length, 0);
		await assert.rejects(
			() => remove.execute("id", { id: 1 }, undefined, undefined, {
				hasUI: true,
				ui: { confirm: async () => false },
			}),
			/User declined/,
		);
		assert.equal(calls.length, 1);
		assert.equal(calls.some((init) => init.method === "DELETE"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("update preview denial sends no PATCH and approved update includes revision", { concurrency: false }, async () => {
	process.env[PAT_ENV] = PAT;
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		if (init?.method === "PATCH") return jsonResponse({ id: 5, rev: 4 });
		return jsonResponse({ id: 5, rev: init?.method === "PATCH" ? 4 : 3, fields: {
			"System.Title": "Before",
			"System.State": "Active",
		} });
	}) as typeof fetch;
	try {
		const harness = createHarness();
		await startHarness(harness, await fixture("update-tool", {
			organization: "org",
			project: "project",
			auth: { method: "pat", patEnv: PAT_ENV },
			permissions: { workItems: { update: true } },
		}));
		const update = harness.tools.get("azure_boards_update_work_item");
		let preview = "";
		await assert.rejects(
			() => update.execute("id", { id: 5, state: "Done" }, undefined, undefined, {
				hasUI: true,
				ui: { confirm: async (_title: string, message: string) => { preview = message; return false; } },
			}),
			/User declined/,
		);
		assert.match(preview, /Active → Done/);
		assert.equal(calls.some((call) => call.init.method === "PATCH"), false);

		await update.execute("id", { id: 5, state: "Done" }, undefined, undefined, {
			hasUI: true,
			ui: { confirm: async () => true },
		});
		const patch = calls.find((call) => call.init.method === "PATCH");
		assert.ok(patch);
		assert.equal(JSON.parse(String(patch.init.body))[0].path, "/rev");
		assert.equal(JSON.parse(String(patch.init.body))[0].value, 3);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("delete tool confirms current item and never requests permanent destroy", { concurrency: false }, async () => {
	process.env[PAT_ENV] = PAT;
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		return jsonResponse(init?.method === "DELETE"
			? { id: 8 }
			: { id: 8, rev: 2, fields: { "System.WorkItemType": "Bug", "System.Title": "Preview me" } });
	}) as typeof fetch;
	try {
		const harness = createHarness();
		await startHarness(harness, await fixture("delete-tool", {
			organization: "org",
			project: "project",
			auth: { method: "pat", patEnv: PAT_ENV },
			permissions: { workItems: { delete: true } },
		}));
		const remove = harness.tools.get("azure_boards_delete_work_item");
		let preview = "";
		await remove.execute("id", { id: 8 }, undefined, undefined, {
			hasUI: true,
			ui: { confirm: async (_title: string, message: string) => { preview = message; return true; } },
		});
		assert.match(preview, /Preview me/);
		const deleteCall = calls.find((call) => call.init.method === "DELETE");
		assert.ok(deleteCall);
		assert.match(deleteCall.url, /destroy=false/);
		assert.equal(calls.some((call) => call.url.includes("destroy=true")), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
