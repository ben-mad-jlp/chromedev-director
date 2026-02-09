# Blueprint: Item 4 - MCP Tools

## 1. Structure Summary

### Files

- `src/server.ts` — Add 6 new tools and extend `run_test` with `testId` parameter

### Type Definitions

No new types needed — uses `SavedTest`, `TestRun`, `TestResult` from Item 1 (storage types).

### Component Interactions

- All new tools call `storage.*` functions from Item 1
- `run_test` extended: optional `testId` triggers load-from-storage + result persistence
- Existing ad-hoc `run_test` (no `testId`) unchanged

---

## 2. Function Blueprints

### New Tool: `save_test`

**Input:** `{ name: string, test: TestDef }`
**Output:** `{ id: string, name: string }`

**Pseudocode:**
1. Validate `name` is non-empty string
2. Validate `test` against TestDefSchema
3. Call `storage.saveTest(projectRoot, name, testDef)`
4. Return `{ id, name }` as JSON text

**Error Handling:**
- Slug collision: return error "Test with this name already exists"
- Invalid input: return Zod validation error

---

### New Tool: `list_tests`

**Input:** `{}` (no args)
**Output:** `{ tests: Array<{ id, name, stepCount, lastRun? }> }`

**Pseudocode:**
1. Call `storage.listTests(projectRoot)`
2. Map to summary format: id, name, step count, latest result status
3. Return as JSON text

---

### New Tool: `get_test`

**Input:** `{ id: string }`
**Output:** `{ id, name, test: TestDef }`

**Pseudocode:**
1. Validate `id` is non-empty
2. Call `storage.getTest(projectRoot, id)`
3. Return full saved test as JSON text

**Error Handling:**
- Not found: return error "Test not found: {id}"

---

### New Tool: `delete_test`

**Input:** `{ id: string }`
**Output:** `{ ok: true }`

**Pseudocode:**
1. Validate `id` is non-empty
2. Call `storage.deleteTest(projectRoot, id)`
3. Return `{ ok: true }` as JSON text

**Error Handling:**
- Not found: return error "Test not found: {id}"

---

### New Tool: `list_results`

**Input:** `{ testId: string, limit?: number }`
**Output:** `{ results: Array<{ runId, timestamp, status, duration_ms }> }`

**Pseudocode:**
1. Call `storage.listResults(projectRoot, testId)`
2. Optionally slice to `limit`
3. Map to summary: runId, timestamp, status, duration
4. Return as JSON text

---

### New Tool: `get_result`

**Input:** `{ testId: string, runId: string }`
**Output:** Full `TestRun` object

**Pseudocode:**
1. Call `storage.getResult(projectRoot, testId, runId)`
2. Return as JSON text

**Error Handling:**
- Not found: return error "Result not found"

---

### Update: `run_test` — optional `testId` parameter

**Current input:** `{ test: TestDef, port?: number }`
**New input:** `{ test?: TestDef, testId?: string, port?: number }`

**Pseudocode:**
1. If `testId` provided:
   a. Load saved test via `storage.getTest(projectRoot, testId)`
   b. Use loaded test definition
   c. Run test via `runTest()`
   d. Save result via `storage.saveResult(projectRoot, testId, result, nestedVersions)`
   e. Return result + runId
2. If `test` provided (ad-hoc):
   a. Run as before (no persistence)
   b. Return result only
3. If neither: return error

**Error Handling:**
- testId not found: return error
- Both testId and test provided: testId takes precedence

---

### Helper: `projectRoot` resolution

All tools need a `projectRoot`. Options:
- Use `process.cwd()` as default
- Accept optional `projectRoot` parameter on MCP server creation
- Use environment variable `DIRECTOR_PROJECT_ROOT`

**Decision:** Use `process.cwd()` with optional env var override.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: mcp-crud-tools
    files: [src/server.ts]
    tests: [src/server.test.ts]
    description: Add save_test, list_tests, get_test, delete_test tools to MCP server, register in tools/list handler
    parallel: true
    depends-on: []

  - id: mcp-result-tools
    files: [src/server.ts]
    tests: [src/server.test.ts]
    description: Add list_results, get_result tools to MCP server
    parallel: true
    depends-on: []

  - id: mcp-run-test-extend
    files: [src/server.ts]
    tests: [src/server.test.ts]
    description: Extend run_test with optional testId for saved test execution and result persistence
    parallel: false
    depends-on: [mcp-crud-tools]

  - id: mcp-tests
    files: [src/server.test.ts]
    tests: [src/server.test.ts]
    description: Unit tests for all MCP tools including CRUD, result queries, and testId-based runs
    parallel: false
    depends-on: [mcp-crud-tools, mcp-result-tools, mcp-run-test-extend]
```

### Execution Waves

**Wave 1 (no dependencies):**
- mcp-crud-tools
- mcp-result-tools

**Wave 2 (depends on Wave 1):**
- mcp-run-test-extend

**Wave 3 (depends on Wave 2):**
- mcp-tests

### Summary
- **Total tasks:** 4
- **Total waves:** 3
- **Max parallelism:** 2 (Wave 1)
- **Cross-item dependency:** Requires Item 1 (storage functions) and Item 2 (run_test StepDef for nested execution)