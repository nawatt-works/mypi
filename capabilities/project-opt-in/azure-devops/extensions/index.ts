import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2_000;
import {
	AzureDevOpsClient,
	CONFIG_RELATIVE_PATH,
	WORK_ITEM_INPUT_TO_FIELD,
	assertWriteConfiguration,
	loadConfigIfPresent,
	validateWorkItemFields,
	type AzureDevOpsConfig,
	type WorkItem,
	type WorkItemFieldUpdates,
} from "./client.ts";
import {
	AZURE_TOOL_NAMES,
	TOOL_POLICY,
	allowedToolNames,
	assertToolPermission,
	isAzureToolName,
	isKnownAzureTool,
	type AzureToolName,
} from "./policy.ts";
import { previewCommand, sensitiveShellReason } from "./security.ts";

export { AZURE_TOOL_NAMES, allowedToolNames } from "./policy.ts";

export function setAzureToolsActive(pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">, names: readonly string[]): void {
	const owned = new Set<string>(AZURE_TOOL_NAMES);
	const activeWithoutAzure = pi.getActiveTools().filter((name) => !owned.has(name));
	pi.setActiveTools([...new Set([...activeWithoutAzure, ...names])]);
}

export default function azureDevOpsExtension(pi: ExtensionAPI) {
	let config: AzureDevOpsConfig | undefined;
	let configError: string | undefined;

	pi.on("session_start", async (_event, ctx) => {
		config = undefined;
		configError = undefined;
		if (!ctx.isProjectTrusted()) {
			setAzureToolsActive(pi, []);
			ctx.ui.setStatus("azure-devops", undefined);
			return;
		}
		try {
			config = await loadConfigIfPresent(ctx.cwd);
			if (!config) {
				setAzureToolsActive(pi, []);
				ctx.ui.setStatus("azure-devops", undefined);
				return;
			}
			setAzureToolsActive(pi, allowedToolNames(config.permissions));
			ctx.ui.setStatus("azure-devops", `ADO: ${config.organization}/${config.project}`);
		} catch (error) {
			configError = errorMessage(error);
			setAzureToolsActive(pi, []);
			ctx.ui.setStatus("azure-devops", "ADO: config error");
			ctx.ui.notify(`Azure DevOps extension: ${configError}`, "warning");
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("azure-devops", undefined);
	});

	function currentConfig(toolName: AzureToolName): AzureDevOpsConfig {
		if (!config) throw new Error(configError ?? `Azure DevOps is inactive; add ${CONFIG_RELATIVE_PATH} to a trusted project`);
		assertToolPermission(toolName, config.permissions);
		return config;
	}

	function client(toolName: AzureToolName): AzureDevOpsClient {
		return new AzureDevOpsClient(
			currentConfig(toolName),
			(command, args, options) => pi.exec(command, args, options),
		);
	}

	pi.registerTool({
		name: "azure_boards_doctor",
		label: "Azure DevOps Doctor",
		description: "Validate project-local Azure DevOps configuration, authentication, and project access. Read-only.",
		promptSnippet: "Check Azure DevOps configuration and connectivity",
		promptGuidelines: ["Use azure_boards_doctor when Azure DevOps authentication or configuration might be invalid."],
		parameters: Type.Object({}),
		async execute(_id, _params, signal) {
			const devops = client("azure_boards_doctor");
			const project = await devops.doctor(signal);
			return output({
				ok: true,
				organization: devops.config.organization,
				project: devops.config.project,
				defaultTeam: devops.config.defaultTeam,
				authMethod: devops.config.auth.method,
				configPath: CONFIG_RELATIVE_PATH,
				effectivePermissions: devops.config.permissions,
				projectDetails: project,
			});
		},
	});

	pi.registerTool({
		name: "azure_boards_query_work_items",
		label: "Query Azure Work Items",
		description: `Run a read-only WIQL SELECT query and return detailed work items. Results are capped by maxQueryResults in ${CONFIG_RELATIVE_PATH}.`,
		promptSnippet: "Query Azure Boards work items with read-only WIQL",
		promptGuidelines: ["Use azure_boards_query_work_items for fresh Azure Boards backlog, bug, task, assignee, state, area, and iteration data."],
		parameters: Type.Object({
			wiql: Type.String({ description: "A WIQL SELECT statement" }),
			fields: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
			maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		}),
		async execute(_id, params, signal) {
			return output(await client("azure_boards_query_work_items").queryWorkItems(params.wiql, {
				fields: params.fields,
				maxResults: params.maxResults,
			}, signal));
		},
	});

	pi.registerTool({
		name: "azure_boards_get_work_item",
		label: "Get Azure Work Item",
		description: "Get one Azure DevOps work item by numeric ID, including fields and relations. Read-only.",
		parameters: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
		async execute(_id, params, signal) {
			return output(await client("azure_boards_get_work_item").getWorkItem(params.id, signal));
		},
	});

	pi.registerTool({
		name: "azure_boards_create_work_item",
		label: "Create Azure Work Item",
		description: "Create one Azure Boards work item. Requires workItems.create, PAT authentication, interactive UI, and confirmation every time.",
		parameters: Type.Object({
			type: Type.String({ minLength: 1, description: "Work item type, for example Task, Bug, or User Story" }),
			title: Type.String({ minLength: 1 }),
			description: Type.Optional(Type.String()),
			assignedTo: Type.Optional(Type.String()),
			areaPath: Type.Optional(Type.String()),
			iterationPath: Type.Optional(Type.String()),
			tags: Type.Optional(Type.String()),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const activeConfig = requireWriteExecution(currentConfig("azure_boards_create_work_item"), "create", ctx);
			const fields = workItemFields(params);
			validateWorkItemFields(fields);
			const approved = await ctx.ui.confirm(
				"Create Azure work item?",
				formatCreatePreview(activeConfig, params.type, fields),
			);
			if (!approved) throw new Error("User declined Azure work item creation; no request was sent");
			const devops = new AzureDevOpsClient(activeConfig, (command, args, options) => pi.exec(command, args, options));
			return output(await devops.createWorkItem(params.type.trim(), fields, signal));
		},
	});

	pi.registerTool({
		name: "azure_boards_update_work_item",
		label: "Update Azure Work Item",
		description: "Update allowed fields on one Azure Boards work item with revision protection. Requires workItems.update, PAT authentication, interactive UI, and confirmation every time.",
		parameters: Type.Object({
			id: Type.Integer({ minimum: 1 }),
			title: Type.Optional(Type.String({ minLength: 1 })),
			description: Type.Optional(Type.String()),
			state: Type.Optional(Type.String({ minLength: 1 })),
			assignedTo: Type.Optional(Type.String()),
			areaPath: Type.Optional(Type.String()),
			iterationPath: Type.Optional(Type.String()),
			tags: Type.Optional(Type.String()),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const activeConfig = requireWriteExecution(currentConfig("azure_boards_update_work_item"), "update", ctx);
			const fields = workItemFields(params);
			validateWorkItemFields(fields);
			const devops = new AzureDevOpsClient(activeConfig, (command, args, options) => pi.exec(command, args, options));
			const current = await devops.getWorkItem(params.id, signal);
			if (!Number.isInteger(current.rev)) throw new Error(`Work item ${params.id} did not include a revision`);
			const approved = await ctx.ui.confirm(
				`Update Azure work item #${params.id}?`,
				formatUpdatePreview(activeConfig, current, fields),
			);
			if (!approved) throw new Error("User declined Azure work item update; no write request was sent");
			return output(await devops.updateWorkItem(params.id, current.rev!, fields, signal));
		},
	});

	pi.registerTool({
		name: "azure_boards_delete_work_item",
		label: "Delete Azure Work Item",
		description: "Soft-delete one Azure Boards work item to the recycle bin. Permanent destroy is not supported. Requires workItems.delete, PAT authentication, interactive UI, and confirmation every time.",
		parameters: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const activeConfig = requireWriteExecution(currentConfig("azure_boards_delete_work_item"), "delete", ctx);
			const devops = new AzureDevOpsClient(activeConfig, (command, args, options) => pi.exec(command, args, options));
			const current = await devops.getWorkItem(params.id, signal);
			const approved = await ctx.ui.confirm(
				`Soft-delete Azure work item #${params.id}?`,
				formatDeletePreview(activeConfig, current),
			);
			if (!approved) throw new Error("User declined Azure work item deletion; no delete request was sent");
			return output({ softDeleted: true, result: await devops.deleteWorkItem(params.id, signal) });
		},
	});

	registerRepoTools(pi, client);
	registerBoardReadTools(pi, client);

	pi.registerCommand("mypi-azure-devops-config", {
		description: "Show the effective project-local Azure DevOps configuration without credentials",
		handler: async (_args, ctx) => {
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify("Azure DevOps is inactive because this project is not trusted.", "warning");
				return;
			}
			try {
				const current = config ?? await loadConfigIfPresent(ctx.cwd);
				if (!current) {
					ctx.ui.notify(`Azure DevOps is inactive; ${CONFIG_RELATIVE_PATH} was not found.`, "info");
					return;
				}
				ctx.ui.notify([
					`Organization: ${current.organization}`,
					`Project: ${current.project}`,
					`Default team: ${current.defaultTeam ?? "(not set)"}`,
					`Authentication: ${current.auth.method}`,
					`Effective permissions: ${JSON.stringify(current.permissions)}`,
					`Config: ${CONFIG_RELATIVE_PATH}`,
				].join("\n"), "info");
			} catch (error) {
				ctx.ui.notify(errorMessage(error), "error");
			}
		},
	});

	// Direct Azure CLI access and broad environment disclosure require separate user approval.
	// Internal read authentication may still call pi.exec("az", ...); it never traverses the bash tool.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const input = event.input as { command?: unknown };
		if (typeof input.command !== "string") return;
		const reason = sensitiveShellReason(input.command);
		if (!reason) return;
		if (!ctx.hasUI) return { block: true, reason: `${reason} Blocked because interactive confirmation is unavailable.` };
		const approved = await ctx.ui.confirm(
			"Azure credential guard",
			`${reason}\n\nAllow this shell command?\n\n${previewCommand(input.command)}`,
		);
		if (!approved) return { block: true, reason: `User declined sensitive shell command: ${reason}` };
	});

	pi.on("user_bash", async (event, ctx) => {
		const reason = sensitiveShellReason(event.command);
		if (!reason) return;
		if (ctx.hasUI) {
			const approved = await ctx.ui.confirm(
				"Azure credential guard",
				`${reason}\n\nAllow this shell command?\n\n${previewCommand(event.command)}`,
			);
			if (approved) return;
		}
		return { result: { output: `Blocked by Azure credential guard: ${reason}`, exitCode: 126, cancelled: true, truncated: false } };
	});

	pi.on("tool_call", (event) => {
		if (!isAzureToolName(event.toolName)) return;
		if (!isKnownAzureTool(event.toolName)) {
			return { block: true, reason: `Unknown Azure DevOps tool blocked: ${event.toolName}` };
		}
		if (!config) return { block: true, reason: configError ?? "Azure DevOps is inactive for this project" };
		try {
			assertToolPermission(event.toolName, config.permissions);
		} catch (error) {
			return { block: true, reason: errorMessage(error) };
		}
	});
}

function registerRepoTools(
	pi: ExtensionAPI,
	client: (toolName: AzureToolName) => AzureDevOpsClient,
): void {
	pi.registerTool({
		name: "azure_repos_list_repositories",
		label: "List Azure Repositories",
		description: "List Git repositories in the configured Azure DevOps project. Read-only.",
		parameters: Type.Object({}),
		async execute(_id, _params, signal) { return output(await client("azure_repos_list_repositories").listRepositories(signal)); },
	});
	pi.registerTool({
		name: "azure_repos_list_pull_requests",
		label: "List Azure Pull Requests",
		description: "List pull requests, optionally filtered by repository, status, or branch. Read-only.",
		parameters: Type.Object({
			repository: Type.Optional(Type.String()),
			status: Type.Optional(Type.Unsafe<"active" | "abandoned" | "completed" | "all">({
				type: "string",
				enum: ["active", "abandoned", "completed", "all"],
			})),
			sourceBranch: Type.Optional(Type.String()),
			targetBranch: Type.Optional(Type.String()),
			maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		}),
		async execute(_id, params, signal) {
			return output(await client("azure_repos_list_pull_requests").listPullRequests({
				repository: params.repository,
				status: params.status,
				sourceRefName: params.sourceBranch,
				targetRefName: params.targetBranch,
				maxResults: params.maxResults,
			}, signal));
		},
	});
	for (const definition of [
		["azure_repos_get_pull_request", "Get Azure Pull Request", "Get pull request metadata and status. Read-only.", "getPullRequest"],
		["azure_repos_get_pull_request_threads", "Get Pull Request Threads", "Get pull request review threads. Read-only.", "getPullRequestThreads"],
		["azure_repos_get_pull_request_commits", "Get Pull Request Commits", "Get commits included in a pull request. Read-only.", "getPullRequestCommits"],
		["azure_repos_get_pull_request_work_items", "Get Pull Request Work Items", "Get work items linked to a pull request. Read-only.", "getPullRequestWorkItems"],
	] as const) {
		const [name, label, description, method] = definition;
		pi.registerTool({
			name,
			label,
			description,
			parameters: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
			async execute(_id, params, signal) {
				return output(await client(name)[method](params.id, signal));
			},
		});
	}
}

function registerBoardReadTools(
	pi: ExtensionAPI,
	client: (toolName: AzureToolName) => AzureDevOpsClient,
): void {
	pi.registerTool({
		name: "azure_boards_list_teams",
		label: "List Azure Teams",
		description: "List teams in the configured Azure DevOps project. Read-only.",
		parameters: Type.Object({}),
		async execute(_id, _params, signal) { return output(await client("azure_boards_list_teams").listTeams(signal)); },
	});
	pi.registerTool({
		name: "azure_boards_list_boards",
		label: "List Azure Boards",
		description: "List Boards for an Azure DevOps team. Read-only.",
		parameters: Type.Object({ team: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const devops = client("azure_boards_list_boards");
			return output(await devops.listBoards(devops.resolveTeam(params.team), signal));
		},
	});
	pi.registerTool({
		name: "azure_boards_get_board",
		label: "Get Azure Board",
		description: "Get a Board and its columns for an Azure DevOps team. Read-only.",
		parameters: Type.Object({ board: Type.String(), team: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const devops = client("azure_boards_get_board");
			return output(await devops.getBoard(devops.resolveTeam(params.team), params.board, signal));
		},
	});
	pi.registerTool({
		name: "azure_boards_list_iterations",
		label: "List Azure Iterations",
		description: "List iterations/sprints for an Azure DevOps team. Read-only.",
		parameters: Type.Object({ team: Type.Optional(Type.String()), currentOnly: Type.Optional(Type.Boolean()) }),
		async execute(_id, params, signal) {
			const devops = client("azure_boards_list_iterations");
			return output(await devops.listIterations(devops.resolveTeam(params.team), params.currentOnly ? "current" : undefined, signal));
		},
	});
	pi.registerTool({
		name: "azure_boards_get_iteration_work_items",
		label: "Get Iteration Work Items",
		description: "Get work items assigned to an Azure DevOps team iteration. Read-only.",
		parameters: Type.Object({ iterationId: Type.String(), team: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const devops = client("azure_boards_get_iteration_work_items");
			return output(await devops.getIterationWorkItems(devops.resolveTeam(params.team), params.iterationId, signal));
		},
	});
}

function requireWriteExecution(
	config: AzureDevOpsConfig,
	operation: "create" | "update" | "delete",
	ctx: ExtensionContext,
): AzureDevOpsConfig {
	assertWriteConfiguration(config, operation);
	if (!process.env[config.auth.patEnv]) throw new Error(`Environment variable ${config.auth.patEnv} is not set`);
	if (!ctx.hasUI) throw new Error(`Azure DevOps ${operation} is blocked because interactive confirmation is unavailable`);
	return config;
}

function workItemFields(params: Record<string, unknown>): WorkItemFieldUpdates {
	const fields: Record<string, unknown> = {};
	for (const [input, field] of Object.entries(WORK_ITEM_INPUT_TO_FIELD)) {
		if (params[input] !== undefined) fields[field] = params[input];
	}
	return fields as WorkItemFieldUpdates;
}

function formatCreatePreview(config: AzureDevOpsConfig, type: string, fields: WorkItemFieldUpdates): string {
	return [
		`Project: ${config.organization}/${config.project}`,
		`Type: ${type.trim()}`,
		...formatFieldLines(fields),
		"",
		"This write requires confirmation every time.",
	].join("\n");
}

function formatUpdatePreview(config: AzureDevOpsConfig, current: WorkItem, fields: WorkItemFieldUpdates): string {
	const lines = Object.entries(fields).map(([field, next]) => {
		const before = current.fields?.[field];
		return `${field}: ${displayValue(before)} → ${displayValue(next)}`;
	});
	return [
		`Project: ${config.organization}/${config.project}`,
		`Revision: ${current.rev}`,
		...lines,
		"",
		"The update will fail if the revision changes before execution.",
	].join("\n");
}

function formatDeletePreview(config: AzureDevOpsConfig, current: WorkItem): string {
	return [
		`Project: ${config.organization}/${config.project}`,
		`ID: ${current.id ?? "(unknown)"}`,
		`Type: ${displayValue(current.fields?.["System.WorkItemType"])}`,
		`Title: ${displayValue(current.fields?.["System.Title"])}`,
		"",
		"This moves the work item to the recycle bin. Permanent destroy is not supported.",
	].join("\n");
}

function formatFieldLines(fields: WorkItemFieldUpdates): string[] {
	return Object.entries(fields).map(([field, value]) => `${field}: ${displayValue(value)}`);
}

function displayValue(value: unknown): string {
	if (value === undefined || value === null || value === "") return "(empty)";
	if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
	return JSON.stringify(value);
}

function output(data: unknown) {
	const raw = JSON.stringify(data, null, 2);
	const truncated = truncateOutput(raw);
	const suffix = truncated.truncated
		? `\n\n[Output truncated: ${truncated.outputBytes} of ${truncated.totalBytes} bytes]`
		: "";
	return {
		content: [{ type: "text" as const, text: truncated.content + suffix }],
		details: { truncated: truncated.truncated },
	};
}

function truncateOutput(value: string): {
	content: string;
	truncated: boolean;
	outputBytes: number;
	totalBytes: number;
} {
	const totalBytes = Buffer.byteLength(value);
	const lineLimited = value.split("\n").slice(0, DEFAULT_MAX_LINES).join("\n");
	let content = lineLimited;
	while (Buffer.byteLength(content) > DEFAULT_MAX_BYTES) content = content.slice(0, -1);
	return {
		content,
		truncated: content !== value,
		outputBytes: Buffer.byteLength(content),
		totalBytes,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
