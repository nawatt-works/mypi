import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	defaultPermissions,
	hasWritePermission,
	type AzureDevOpsPermissions,
	type CrudOperation,
} from "./policy.ts";

export const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const CONFIG_RELATIVE_PATH = join(".pi", "azure-devops.json");

export type AzureDevOpsConfig = {
	organization: string;
	project: string;
	defaultTeam?: string;
	auth: {
		method: "auto" | "azure-cli" | "pat";
		patEnv: string;
	};
	permissions: AzureDevOpsPermissions;
	maxQueryResults: number;
};

export type WorkItem = {
	id?: number;
	rev?: number;
	url?: string;
	fields?: Record<string, unknown>;
};

export type WorkItemFieldUpdates = Partial<Record<WorkItemFieldName, unknown>>;
export type WorkItemFieldName = typeof WORK_ITEM_FIELD_NAMES[number];

const WORK_ITEM_FIELD_NAMES = [
	"System.Title",
	"System.Description",
	"System.State",
	"System.AssignedTo",
	"System.AreaPath",
	"System.IterationPath",
	"System.Tags",
] as const;

const WORK_ITEM_FIELD_SET = new Set<string>(WORK_ITEM_FIELD_NAMES);

export const WORK_ITEM_INPUT_TO_FIELD = {
	title: "System.Title",
	description: "System.Description",
	state: "System.State",
	assignedTo: "System.AssignedTo",
	areaPath: "System.AreaPath",
	iterationPath: "System.IterationPath",
	tags: "System.Tags",
} as const satisfies Record<string, WorkItemFieldName>;

const ROOT_CONFIG_KEYS = new Set([
	"organization",
	"project",
	"defaultTeam",
	"auth",
	"permissions",
	"maxQueryResults",
]);
const AUTH_KEYS = new Set(["method", "patEnv"]);
const PERMISSION_RESOURCES = new Set(["workItems", "repos"]);
const WORK_ITEM_PERMISSION_KEYS = new Set(["read", "create", "update", "delete"]);
const REPO_PERMISSION_KEYS = new Set(["read"]);

type ExecResult = { stdout: string; stderr: string; code: number };
export type ExecCommand = (
	command: string,
	args: string[],
	options: { signal?: AbortSignal; timeout?: number },
) => Promise<ExecResult>;
export type FetchCommand = typeof fetch;
export type PullRequestStatus = "active" | "abandoned" | "completed" | "all";

type PullRequestReference = {
	pullRequestId?: number;
	repository?: { id?: string; name?: string };
};

export async function loadConfig(cwd: string): Promise<AzureDevOpsConfig> {
	const config = await loadConfigIfPresent(cwd);
	if (!config) throw new Error(`Cannot read ${CONFIG_RELATIVE_PATH}: file does not exist`);
	return config;
}

export async function loadConfigIfPresent(cwd: string): Promise<AzureDevOpsConfig | undefined> {
	const configPath = join(cwd, CONFIG_RELATIVE_PATH);
	let rawText: string;
	try {
		rawText = await readFile(configPath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw new Error(`Cannot read ${CONFIG_RELATIVE_PATH}: ${errorMessage(error)}`);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(rawText);
	} catch (error) {
		throw new Error(`Invalid JSON in ${CONFIG_RELATIVE_PATH}: ${errorMessage(error)}`);
	}
	return normalizeConfig(raw);
}

export function normalizeConfig(value: unknown): AzureDevOpsConfig {
	const raw = requiredObject(value, CONFIG_RELATIVE_PATH);
	assertKnownKeys(raw, ROOT_CONFIG_KEYS, CONFIG_RELATIVE_PATH);
	const organization = requiredString(raw.organization, "organization");
	const project = requiredString(raw.project, "project");
	const defaultTeam = optionalString(raw.defaultTeam, "defaultTeam");

	const auth = raw.auth === undefined ? {} : requiredObject(raw.auth, "auth");
	assertKnownKeys(auth, AUTH_KEYS, `${CONFIG_RELATIVE_PATH}: auth`);
	const method = auth.method ?? "auto";
	if (method !== "auto" && method !== "azure-cli" && method !== "pat") {
		throw new Error(`${CONFIG_RELATIVE_PATH}: auth.method must be "auto", "azure-cli", or "pat"`);
	}
	const patEnv = optionalString(auth.patEnv, "auth.patEnv") ?? "AZURE_DEVOPS_PAT";

	const permissions = normalizePermissions(raw.permissions);
	if (hasWritePermission(permissions) && method !== "pat") {
		throw new Error(
			`${CONFIG_RELATIVE_PATH}: create, update, and delete permissions require auth.method "pat"`,
		);
	}

	const requestedLimit = raw.maxQueryResults ?? 100;
	if (!Number.isInteger(requestedLimit) || (requestedLimit as number) < 1 || (requestedLimit as number) > 200) {
		throw new Error(`${CONFIG_RELATIVE_PATH}: maxQueryResults must be an integer from 1 to 200`);
	}

	return {
		organization,
		project,
		defaultTeam,
		auth: { method, patEnv },
		permissions,
		maxQueryResults: requestedLimit as number,
	};
}

export function normalizePermissions(value: unknown): AzureDevOpsPermissions {
	const defaults = defaultPermissions();
	if (value === undefined) return defaults;
	const raw = requiredObject(value, "permissions");
	assertKnownKeys(raw, PERMISSION_RESOURCES, `${CONFIG_RELATIVE_PATH}: permissions`);

	const workItems = raw.workItems === undefined
		? {}
		: requiredObject(raw.workItems, "permissions.workItems");
	assertKnownKeys(workItems, WORK_ITEM_PERMISSION_KEYS, `${CONFIG_RELATIVE_PATH}: permissions.workItems`);
	const repos = raw.repos === undefined
		? {}
		: requiredObject(raw.repos, "permissions.repos");
	assertKnownKeys(repos, REPO_PERMISSION_KEYS, `${CONFIG_RELATIVE_PATH}: permissions.repos`);

	return {
		workItems: {
			read: optionalBoolean(workItems.read, "permissions.workItems.read") ?? defaults.workItems.read,
			create: optionalBoolean(workItems.create, "permissions.workItems.create") ?? false,
			update: optionalBoolean(workItems.update, "permissions.workItems.update") ?? false,
			delete: optionalBoolean(workItems.delete, "permissions.workItems.delete") ?? false,
		},
		repos: {
			read: optionalBoolean(repos.read, "permissions.repos.read") ?? defaults.repos.read,
		},
	};
}

export function assertWriteConfiguration(config: AzureDevOpsConfig, operation: Exclude<CrudOperation, "read">): void {
	if (!config.permissions.workItems[operation]) {
		throw new Error(`Azure DevOps permission denied: workItems.${operation} is disabled`);
	}
	if (config.auth.method !== "pat") {
		throw new Error(`Azure DevOps ${operation} requires auth.method "pat"`);
	}
}

export function validateWorkItemFields(fields: Record<string, unknown>): WorkItemFieldUpdates {
	const entries = Object.entries(fields);
	if (entries.length === 0) throw new Error("At least one work item field is required");
	for (const [field, fieldValue] of entries) {
		if (!WORK_ITEM_FIELD_SET.has(field)) throw new Error(`Work item field is not allowed: ${field}`);
		if (fieldValue === undefined) throw new Error(`Work item field cannot be undefined: ${field}`);
	}
	return fields as WorkItemFieldUpdates;
}

function requiredObject(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${CONFIG_RELATIVE_PATH}: ${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, known: Set<string>, field: string): void {
	const unknown = Object.keys(value).find((key) => !known.has(key));
	if (unknown) throw new Error(`${field} contains unknown property "${unknown}"`);
}

function requiredString(value: unknown, field: string): string {
	const parsed = optionalString(value, field);
	if (!parsed) throw new Error(`${CONFIG_RELATIVE_PATH}: ${field} is required`);
	return parsed;
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new Error(`${CONFIG_RELATIVE_PATH}: ${field} must be a string`);
	const parsed = value.trim();
	return parsed || undefined;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${CONFIG_RELATIVE_PATH}: ${field} must be a boolean`);
	return value;
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class AzureDevOpsClient {
	readonly config: AzureDevOpsConfig;
	private readonly exec: ExecCommand;
	private readonly fetcher: FetchCommand;

	constructor(config: AzureDevOpsConfig, exec: ExecCommand, fetcher: FetchCommand = fetch) {
		this.config = config;
		this.exec = exec;
		this.fetcher = fetcher;
	}

	async doctor(signal?: AbortSignal): Promise<unknown> {
		return this.request(`/_apis/projects/${encodeURIComponent(this.config.project)}?api-version=7.1`, { signal });
	}

	async queryWorkItems(
		wiql: string,
		options: { fields?: string[]; maxResults?: number },
		signal?: AbortSignal,
	): Promise<{ queryType?: string; count: number; workItems: unknown[] }> {
		if (!/^\s*select\b/i.test(wiql)) {
			throw new Error("WIQL must start with SELECT; this extension only permits read queries");
		}
		const requestedLimit = options.maxResults ?? this.config.maxQueryResults;
		const limit = Math.min(requestedLimit, this.config.maxQueryResults);
		const query = await this.request<{
			queryType?: string;
			workItems?: Array<{ id: number }>;
			workItemRelations?: Array<{ source?: { id: number }; target?: { id: number } }>;
		}>(this.projectApi("wit/wiql?api-version=7.1"), {
			method: "POST",
			signal,
			body: JSON.stringify({ query: wiql }),
		});
		const ids = collectWorkItemIds(query).slice(0, limit);
		const workItems = ids.length > 0 ? await this.getWorkItemsBatch(ids, options.fields, signal) : [];
		return { queryType: query.queryType, count: workItems.length, workItems };
	}

	async getWorkItem(id: number, signal?: AbortSignal): Promise<WorkItem> {
		return this.request(this.projectApi(`wit/workitems/${id}?$expand=relations&api-version=7.1`), { signal });
	}

	async createWorkItem(
		type: string,
		fields: WorkItemFieldUpdates,
		signal?: AbortSignal,
	): Promise<WorkItem> {
		assertWriteConfiguration(this.config, "create");
		const validFields = validateWorkItemFields(fields);
		if (typeof validFields["System.Title"] !== "string" || !validFields["System.Title"]?.trim()) {
			throw new Error("System.Title is required to create a work item");
		}
		const created = await this.request<WorkItem>(
			this.projectApi(`wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`),
			{
				method: "POST",
				signal,
				headers: { "Content-Type": "application/json-patch+json" },
				body: JSON.stringify(Object.entries(validFields).map(([field, value]) => ({
					op: "add",
					path: `/fields/${field}`,
					value,
				}))),
			},
			"create",
		);
		if (!created.id) throw new Error("Azure DevOps create response did not include a work item ID");
		return this.getWorkItem(created.id, signal);
	}

	async updateWorkItem(
		id: number,
		revision: number,
		fields: WorkItemFieldUpdates,
		signal?: AbortSignal,
	): Promise<WorkItem> {
		assertWriteConfiguration(this.config, "update");
		const validFields = validateWorkItemFields(fields);
		await this.request<WorkItem>(
			this.projectApi(`wit/workitems/${id}?api-version=7.1`),
			{
				method: "PATCH",
				signal,
				headers: { "Content-Type": "application/json-patch+json" },
				body: JSON.stringify([
					{ op: "test", path: "/rev", value: revision },
					...Object.entries(validFields).map(([field, value]) => ({
						op: "add",
						path: `/fields/${field}`,
						value,
					})),
				]),
			},
			"update",
		);
		return this.getWorkItem(id, signal);
	}

	async deleteWorkItem(id: number, signal?: AbortSignal): Promise<unknown> {
		assertWriteConfiguration(this.config, "delete");
		return this.request(
			this.projectApi(`wit/workitems/${id}?destroy=false&api-version=7.1`),
			{ method: "DELETE", signal },
			"delete",
		);
	}

	async listRepositories(signal?: AbortSignal): Promise<unknown> {
		return this.request(this.projectApi("git/repositories?api-version=7.1"), { signal });
	}

	async listPullRequests(
		options: {
			repository?: string;
			status?: PullRequestStatus;
			sourceRefName?: string;
			targetRefName?: string;
			maxResults?: number;
		},
		signal?: AbortSignal,
	): Promise<unknown> {
		const limit = Math.min(options.maxResults ?? 50, this.config.maxQueryResults);
		const query = new URLSearchParams({
			"searchCriteria.status": options.status ?? "active",
			"$top": String(limit),
			"api-version": "7.1",
		});
		if (options.sourceRefName) query.set("searchCriteria.sourceRefName", normalizeGitRef(options.sourceRefName));
		if (options.targetRefName) query.set("searchCriteria.targetRefName", normalizeGitRef(options.targetRefName));
		const apiPath = options.repository
			? `git/repositories/${encodeURIComponent(options.repository)}/pullrequests`
			: "git/pullrequests";
		return this.request(this.projectApi(`${apiPath}?${query.toString()}`), { signal });
	}

	async getPullRequest(id: number, signal?: AbortSignal): Promise<unknown> {
		return this.request(this.projectApi(`git/pullrequests/${id}?api-version=7.1`), { signal });
	}

	async getPullRequestThreads(id: number, signal?: AbortSignal): Promise<unknown> {
		const pullRequest = await this.getPullRequestReference(id, signal);
		return this.request(this.pullRequestApi(pullRequest, id, "threads?api-version=7.1"), { signal });
	}

	async getPullRequestCommits(id: number, signal?: AbortSignal): Promise<unknown> {
		const pullRequest = await this.getPullRequestReference(id, signal);
		return this.request(this.pullRequestApi(pullRequest, id, "commits?api-version=7.1"), { signal });
	}

	async getPullRequestWorkItems(id: number, signal?: AbortSignal): Promise<unknown> {
		const pullRequest = await this.getPullRequestReference(id, signal);
		const references = await this.request<{ value?: Array<{ id?: string }> }>(
			this.pullRequestApi(pullRequest, id, "workitems?api-version=7.1"),
			{ signal },
		);
		const ids = (references.value ?? [])
			.map((item) => Number(item.id))
			.filter((itemId) => Number.isInteger(itemId) && itemId > 0)
			.slice(0, this.config.maxQueryResults);
		const workItems = ids.length > 0 ? await this.getWorkItemsBatch(ids, undefined, signal) : [];
		return { count: workItems.length, workItems };
	}

	async listTeams(signal?: AbortSignal): Promise<unknown> {
		return this.request(`/_apis/projects/${encodeURIComponent(this.config.project)}/teams?$top=200&api-version=7.1`, { signal });
	}

	async listBoards(team: string, signal?: AbortSignal): Promise<unknown> {
		return this.request(this.teamApi(team, "work/boards?api-version=7.1"), { signal });
	}

	async getBoard(team: string, board: string, signal?: AbortSignal): Promise<unknown> {
		return this.request(this.teamApi(team, `work/boards/${encodeURIComponent(board)}?api-version=7.1`), { signal });
	}

	async listIterations(team: string, timeframe?: "current", signal?: AbortSignal): Promise<unknown> {
		const query = timeframe ? `?$timeframe=${timeframe}&api-version=7.1` : "?api-version=7.1";
		return this.request(this.teamApi(team, `work/teamsettings/iterations${query}`), { signal });
	}

	async getIterationWorkItems(team: string, iterationId: string, signal?: AbortSignal): Promise<unknown> {
		const result = await this.request<{
			workItemRelations?: Array<{ source?: { id: number }; target?: { id: number } }>;
		}>(this.teamApi(team, `work/teamsettings/iterations/${encodeURIComponent(iterationId)}/workitems?api-version=7.1`), { signal });
		const ids = collectWorkItemIds(result).slice(0, this.config.maxQueryResults);
		const workItems = ids.length > 0 ? await this.getWorkItemsBatch(ids, undefined, signal) : [];
		return { count: workItems.length, workItems };
	}

	resolveTeam(team?: string): string {
		const resolved = team?.trim() || this.config.defaultTeam;
		if (!resolved) throw new Error(`A team is required. Pass team or set defaultTeam in ${CONFIG_RELATIVE_PATH}`);
		return resolved;
	}

	private async getWorkItemsBatch(ids: number[], fields?: string[], signal?: AbortSignal): Promise<unknown[]> {
		const selectedFields = fields?.length ? fields : DEFAULT_WORK_ITEM_FIELDS;
		const results: unknown[] = [];
		for (let offset = 0; offset < ids.length; offset += 200) {
			const response = await this.request<{ value?: unknown[] }>(
				this.projectApi("wit/workitemsbatch?api-version=7.1"),
				{
					method: "POST",
					signal,
					body: JSON.stringify({ ids: ids.slice(offset, offset + 200), fields: selectedFields, errorPolicy: "Omit" }),
				},
			);
			results.push(...(response.value ?? []));
		}
		return results;
	}

	private async getPullRequestReference(id: number, signal?: AbortSignal): Promise<PullRequestReference> {
		const pullRequest = await this.request<PullRequestReference>(
			this.projectApi(`git/pullrequests/${id}?api-version=7.1`),
			{ signal },
		);
		if (!pullRequest.repository?.id) throw new Error(`Pull request ${id} did not include a repository ID`);
		return pullRequest;
	}

	private pullRequestApi(pullRequest: PullRequestReference, id: number, suffix: string): string {
		return this.projectApi(`git/repositories/${encodeURIComponent(pullRequest.repository!.id!)}/pullRequests/${id}/${suffix}`);
	}

	private projectApi(path: string): string {
		return `/${encodeURIComponent(this.config.project)}/_apis/${path}`;
	}

	private teamApi(team: string, path: string): string {
		return `/${encodeURIComponent(this.config.project)}/${encodeURIComponent(team)}/_apis/${path}`;
	}

	private async request<T = unknown>(
		path: string,
		init: RequestInit,
		operation: CrudOperation = "read",
	): Promise<T> {
		const authorization = await this.getAuthorization(operation, init.signal ?? undefined);
		const url = `https://dev.azure.com/${encodeURIComponent(this.config.organization)}${path}`;
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		headers.set("Authorization", authorization);
		if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
		const response = await this.fetcher(url, { ...init, headers });
		const text = await response.text();
		if (!response.ok) {
			const body = redactSecrets(text.slice(0, 2_000), [authorization, process.env[this.config.auth.patEnv]])
				.replace(/\s+/g, " ")
				.trim();
			throw new Error(`Azure DevOps API ${response.status} ${response.statusText}: ${body || "empty response"}`);
		}
		if (!text) return undefined as T;
		try {
			const sanitized = redactSecrets(text, [authorization, process.env[this.config.auth.patEnv]]);
			return JSON.parse(sanitized) as T;
		} catch {
			throw new Error(`Azure DevOps returned non-JSON content from ${path}`);
		}
	}

	private async getAuthorization(operation: CrudOperation, signal?: AbortSignal): Promise<string> {
		const envName = this.config.auth.patEnv;
		const pat = process.env[envName];
		if (operation !== "read") {
			if (this.config.auth.method !== "pat") throw new Error(`Azure DevOps ${operation} requires PAT authentication`);
			if (!pat) throw new Error(`Environment variable ${envName} is not set`);
			return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
		}
		if ((this.config.auth.method === "pat" || this.config.auth.method === "auto") && pat) {
			return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
		}
		if (this.config.auth.method === "pat") throw new Error(`Environment variable ${envName} is not set`);

		const result = await this.exec("az", [
			"account",
			"get-access-token",
			"--resource",
			AZURE_DEVOPS_RESOURCE,
			"--query",
			"accessToken",
			"--output",
			"tsv",
		], { signal, timeout: 20_000 });
		const token = result.stdout.trim();
		if (result.code !== 0 || !token) {
			const reason = result.stderr.trim() || "Azure CLI returned no access token";
			const fallback = this.config.auth.method === "auto"
				? ` Set ${envName} to a read-only PAT, or authenticate Azure CLI.`
				: " Authenticate Azure CLI before using read tools.";
			throw new Error(`Azure CLI authentication failed: ${reason}.${fallback}`);
		}
		return `Bearer ${token}`;
	}
}

export const DEFAULT_WORK_ITEM_FIELDS = [
	"System.Id",
	"System.WorkItemType",
	"System.Title",
	"System.State",
	"System.AssignedTo",
	"System.AreaPath",
	"System.IterationPath",
	"System.Tags",
	"System.Parent",
	"System.CreatedDate",
	"System.ChangedDate",
];

function normalizeGitRef(value: string): string {
	const ref = value.trim();
	return ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
}

function collectWorkItemIds(value: {
	workItems?: Array<{ id: number }>;
	workItemRelations?: Array<{ source?: { id: number }; target?: { id: number } }>;
}): number[] {
	const ids = new Set<number>();
	for (const item of value.workItems ?? []) ids.add(item.id);
	for (const relation of value.workItemRelations ?? []) {
		if (relation.source?.id) ids.add(relation.source.id);
		if (relation.target?.id) ids.add(relation.target.id);
	}
	return [...ids];
}

function redactSecrets(value: string, secrets: Array<string | undefined>): string {
	let redacted = value.replace(/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_AUTHORIZATION]");
	for (const secret of secrets) {
		if (secret) redacted = redacted.split(secret).join("[REDACTED_SECRET]");
	}
	return redacted;
}
