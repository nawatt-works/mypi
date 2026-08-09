export type CrudOperation = "read" | "create" | "update" | "delete";
export type AzureResource = "project" | "workItems" | "repos";

export type ResourcePermissions = {
	read: boolean;
	create: boolean;
	update: boolean;
	delete: boolean;
};

export type AzureDevOpsPermissions = {
	workItems: ResourcePermissions;
	repos: Pick<ResourcePermissions, "read">;
};

export type ToolPolicy = {
	resource: AzureResource;
	operation: CrudOperation;
	requires?: readonly ToolPolicy[];
};

export const TOOL_POLICY = {
	azure_boards_doctor: { resource: "project", operation: "read" },
	azure_boards_query_work_items: { resource: "workItems", operation: "read" },
	azure_boards_get_work_item: { resource: "workItems", operation: "read" },
	azure_boards_create_work_item: { resource: "workItems", operation: "create" },
	azure_boards_update_work_item: { resource: "workItems", operation: "update" },
	azure_boards_delete_work_item: { resource: "workItems", operation: "delete" },
	azure_repos_list_repositories: { resource: "repos", operation: "read" },
	azure_repos_list_pull_requests: { resource: "repos", operation: "read" },
	azure_repos_get_pull_request: { resource: "repos", operation: "read" },
	azure_repos_get_pull_request_threads: { resource: "repos", operation: "read" },
	azure_repos_get_pull_request_commits: { resource: "repos", operation: "read" },
	azure_repos_get_pull_request_work_items: {
		resource: "repos",
		operation: "read",
		requires: [{ resource: "workItems", operation: "read" }],
	},
	azure_boards_list_teams: { resource: "workItems", operation: "read" },
	azure_boards_list_boards: { resource: "workItems", operation: "read" },
	azure_boards_get_board: { resource: "workItems", operation: "read" },
	azure_boards_list_iterations: { resource: "workItems", operation: "read" },
	azure_boards_get_iteration_work_items: { resource: "workItems", operation: "read" },
} as const satisfies Record<string, ToolPolicy>;

export type AzureToolName = keyof typeof TOOL_POLICY;
export const AZURE_TOOL_NAMES = Object.freeze(Object.keys(TOOL_POLICY) as AzureToolName[]);

export function defaultPermissions(): AzureDevOpsPermissions {
	return {
		workItems: { read: true, create: false, update: false, delete: false },
		repos: { read: true },
	};
}

export function isKnownAzureTool(toolName: string): toolName is AzureToolName {
	return Object.prototype.hasOwnProperty.call(TOOL_POLICY, toolName);
}

export function isAzureToolName(toolName: string): boolean {
	return toolName.startsWith("azure_boards_") || toolName.startsWith("azure_repos_");
}

export function hasPermission(
	permissions: AzureDevOpsPermissions,
	policy: ToolPolicy,
): boolean {
	const primary = policy.resource === "project"
		? policy.operation === "read"
		: policy.resource === "repos"
			? policy.operation === "read" && permissions.repos.read
			: permissions.workItems[policy.operation];
	return primary && (policy.requires ?? []).every((required) => hasPermission(permissions, required));
}

export function allowedToolNames(permissions: AzureDevOpsPermissions): AzureToolName[] {
	return AZURE_TOOL_NAMES.filter((name) => hasPermission(permissions, TOOL_POLICY[name]));
}

export function assertToolPermission(
	toolName: string,
	permissions: AzureDevOpsPermissions,
): ToolPolicy {
	if (!isKnownAzureTool(toolName)) {
		throw new Error(`Unknown Azure DevOps tool blocked: ${toolName}`);
	}
	const policy = TOOL_POLICY[toolName];
	if (!hasPermission(permissions, policy)) {
		const requirements = [policy, ...(policy.requires ?? [])]
			.map((required) => `${required.resource}.${required.operation}`)
			.join(" and ");
		throw new Error(`Azure DevOps permission denied: ${requirements} is disabled`);
	}
	return policy;
}

export function hasWritePermission(permissions: AzureDevOpsPermissions): boolean {
	return permissions.workItems.create || permissions.workItems.update || permissions.workItems.delete;
}
