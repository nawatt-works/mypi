# Project-local Azure DevOps extension

Project-configured Azure DevOps Boards and Repos tools for Pi. Source is maintained centrally at `local/extensions/azure-devops/` แต่ extension ไม่ได้โหลดจาก global `my-pi` package แต่ละ project ต้องอ้าง path นี้ใน `.pi/settings.json` และต้องผ่าน project trust ก่อน Pi จึงจะ execute extension

## Installation and activation

เพิ่ม path ใน `.pi/settings.json` ของ project ที่ต้องใช้:

```json
{
  "extensions": [
    "/Users/developer/my-project/my-pi/local/extensions/azure-devops"
  ]
}
```

- Untrusted project: Pi does not load project settings or execute this extension.
- Trusted project without the extension path: Azure DevOps tools are not registered.
- Trusted project with the extension path but without `.pi/azure-devops.json`: extension stays inactive without warnings.
- Invalid config: Azure DevOps tools are disabled and Pi shows a warning.
- Valid config: only tools permitted by the effective project permissions are active.

Absolute paths tie project settings to the current machine. If this repository moves, update every project that references it.

Use this command to inspect non-secret effective configuration:

```text
/mypi-azure-devops-config
```

## Default read-only configuration

Existing configurations without `permissions` remain compatible and normalize to read-only:

```json
{
  "organization": "example-org",
  "project": "example-project",
  "defaultTeam": "optional-team",
  "auth": {
    "method": "azure-cli"
  },
  "maxQueryResults": 100
}
```

Read operations support `auto`, `azure-cli`, and `pat` authentication. `auto` uses the configured PAT environment variable when present, then falls back to Azure CLI authentication.

No authentication command runs merely because the extension loads. Authentication is requested only when an active Azure tool executes.

## Enabling Work Item writes

Create, update, and delete are opt-in per project and require `auth.method: "pat"`:

```json
{
  "organization": "example-org",
  "project": "example-project",
  "auth": {
    "method": "pat",
    "patEnv": "AZURE_DEVOPS_PAT"
  },
  "permissions": {
    "workItems": {
      "read": true,
      "create": true,
      "update": true,
      "delete": false
    },
    "repos": {
      "read": true
    }
  },
  "maxQueryResults": 100
}
```

This extension intentionally does not define where or how the PAT is stored. It only requires the named environment variable to be available at execution time.

Rules:

- Omitting `permissions` defaults Work Items and Repos to read-only.
- `workItems.create`, `workItems.update`, or `workItems.delete` rejects `auto` and `azure-cli` config.
- Write authentication never falls back to Azure CLI.
- Every write requires a fresh interactive confirmation; there is no session-level approval.
- Print/JSON modes and any context without confirmation UI block writes.
- Field updates use a fixed standard-field allowlist.
- Writes are not retried automatically.
- Update includes a `/rev` test to reject stale concurrent changes.
- Delete calls only `destroy=false`, moving the item to the Azure DevOps recycle bin. Permanent destroy is not implemented.

Azure DevOps still enforces the PAT scopes and identity/project ACL. Use the least privileges required for each project.

The write contracts follow Azure DevOps REST API 7.1:

- [Work Items - Create](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/create?view=azure-devops-rest-7.1)
- [Work Items - Update](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1)
- [Work Items - Delete](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/delete?view=azure-devops-rest-7.1)

## Tools

### Project and Work Item reads

- `azure_boards_doctor`
- `azure_boards_query_work_items`
- `azure_boards_get_work_item`
- `azure_boards_list_teams`
- `azure_boards_list_boards`
- `azure_boards_get_board`
- `azure_boards_list_iterations`
- `azure_boards_get_iteration_work_items`

### Work Item writes

- `azure_boards_create_work_item`
- `azure_boards_update_work_item`
- `azure_boards_delete_work_item` — soft delete only

The standard write-field allowlist is:

- `System.Title`
- `System.Description`
- `System.State`
- `System.AssignedTo`
- `System.AreaPath`
- `System.IterationPath`
- `System.Tags`

### Repos reads

- `azure_repos_list_repositories`
- `azure_repos_list_pull_requests`
- `azure_repos_get_pull_request`
- `azure_repos_get_pull_request_threads`
- `azure_repos_get_pull_request_commits`
- `azure_repos_get_pull_request_work_items`

Azure Repos remains read-only in this version.

## Credential and shell guard

The extension asks for separate user confirmation when the model or user attempts direct `az`, `env`, or `printenv` commands through Pi's shell interfaces. Internal Azure CLI authentication for read tools uses `pi.exec()` and does not expose its token to the model.

This is a best-effort guard, not an OS sandbox. Pi extensions and unrestricted shell processes retain the OS user's permissions.

## Project setup checklist

1. Add the maintained extension path to the project's `.pi/settings.json`.
2. Keep the project's `.pi/azure-devops.json` in place.
3. Trust the project and restart Pi or use `/reload`.
4. Run `/mypi-azure-devops-config` and verify organization, project, auth method, and effective permissions.
5. Verify `azure_boards_doctor`.
6. Read one known Work Item.
7. Read one known Pull Request.
8. Confirm a legacy config without `permissions` exposes no write tools.
9. Check that no copied `.pi/extensions/azure-boards` or `.pi/extensions/azure-devops` remains, to avoid duplicate tools.
10. When this repository moves, update the absolute extension path and repeat the checks.

Do not put PATs, access tokens, or Authorization headers in project configuration or test reports.
