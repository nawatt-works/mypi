---
name: mcp-scripting
description: Write mcpScript JavaScript for discovering, inspecting, and calling MCP tools.
---

# MCP scripting

Use `mcp` for one status, search, describe, authentication, or tool call. Use `mcpScript` when several MCP calls need JavaScript control flow such as loops, filtering, chaining, or fan-out.

## Workflow

1. Discover candidates with `await tools.search({ query, server?, limit?, offset? })`.
2. Inspect the exact returned path with `await tools.describe({ path })`.
3. Call it with `await tools.call(path, args)`.
4. Handle both `{ ok: true, data }` and `{ ok: false, error }` results.
5. Use `emit(value)` only for output that should be visible to the user.

```js
const { items } = await tools.search({ query: "search issues", server: "github" });
const candidate = items[0];
if (!candidate) return { error: "No matching tool" };

const details = await tools.describe({ path: candidate.path });
if (details.error) return details;

const result = await tools.call(details.path, { query: "is:open label:bug" });
if (!result.ok) return result;
emit({ tool: details.path, completed: true });
return result.data;
```

Do not enumerate the `tools` proxy. Use `tools.search` for discovery. Known identifier-safe flat paths may be called directly; use `tools.call()` for hyphenated or reserved names. Always await `search` and `describe`, and keep work within the script timeout.

This My Pi guidance tracks the API of the pinned `pi-mcp-adapter` dependency; upstream owns the runtime implementation.
