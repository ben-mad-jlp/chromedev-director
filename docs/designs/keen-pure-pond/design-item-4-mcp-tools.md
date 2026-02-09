# MCP Tools — Design Doc

## Problem/Goal
The MCP server only exposes `run_test`. Claude has no way to save tests for reuse, view run history, or manage suites. We need MCP tools that expose the storage layer (Item 1) and enhanced runner capabilities (Items 2-3).

## Decisions
- **Granularity**: One tool per operation — clear, discoverable, simple schemas
- **run_test**: Enhanced with optional `test_id` param to run saved tests by ID (no separate tool)
- **Code organization**: Tool registry pattern — array of tool definitions with name/description/schema/handler
- **Descriptions**: Rich — include usage examples, parameter details, tips

## Approach

**Architecture**: Tool registry pattern. Array of `ToolDef` objects with name, description, inputSchema, and handler. Generic dispatcher in `server.ts`.

### Section 1: Tool Registry & Inventory

**Registry type** in `server.ts`:

```ts
interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: Record<string, any>, ctx: { storage: Storage; port: number }) => Promise<any>;
}
```

**Full tool inventory (10 tools):**

| Tool | Params | Returns |
|------|--------|---------|
| `run_test` | `test` (TestDef) OR `test_id` (string), `port?` | TestResult |
| `save_test` | `id`, `name`, `def` (TestDef), `description?`, `tags?` | StoredTest |
| `get_test` | `id` | StoredTest or error |
| `list_tests` | `tag?` | StoredTest[] |
| `delete_test` | `id` | success message |
| `list_runs` | `test_id`, `status?`, `limit?` | StoredRun[] |
| `get_latest_run` | `test_id` | StoredRun or null |
| `save_suite` | `id`, `name`, `test_ids` | StoredSuite |
| `list_suites` | (none) | StoredSuite[] |
| `delete_suite` | `id` | success message |

**`run_test` enhanced behavior:**
- If `test_id` provided (no `test`): load saved TestDef from storage and run it
- If `test` provided (no `test_id`): run inline TestDef as today
- If both: error
- If `test_id` provided: auto-save result via storage

**Dispatcher** replaces the current `if (name !== "run_test")` pattern:
```ts
const tool = tools.find(t => t.name === name);
if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
const result = await tool.handler(args, { storage, port });
return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
```

### Section 2: Error Handling & Success Criteria

**Error handling pattern** — consistent across all tools:
- Handler throws → dispatcher catches and returns `{ isError: true, content: [{ type: "text", text: "Error: {message}" }] }`
- Not-found cases (get_test, get_latest_run) → return `null` in content, not an error
- Validation errors (missing required params) → return `isError: true` with specific message
- Storage I/O errors → propagate as error responses

**Tool descriptions** follow the `run_test` style:
- First paragraph: one-line summary
- Followed by parameter descriptions with types
- Followed by example usage
- Followed by tips/notes

**`tools/list` handler** returns all tools from the registry:
```ts
() => ({ tools: registry.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
```

## Success Criteria
- 10 MCP tools registered and callable
- `run_test` works both with inline `test` and saved `test_id`
- All storage CRUD operations accessible via MCP tools
- Each tool has rich description with examples
- Generic dispatcher handles routing and error wrapping
- Tool registry is a single array — adding a new tool = adding one object
- Existing `run_test` behavior unchanged when called without `test_id`
- All tools return JSON in `content[0].text`
- New tests verify: each tool's happy path, error responses, run_test with test_id
