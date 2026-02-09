# Storage Layer — Design Doc

## Problem/Goal
chromedev-director is fully stateless — test definitions, results, and run history are ephemeral. We need a storage layer to persist tests and results so they can be retrieved, replayed, and analyzed.

## Decisions
- **Backend**: JSON files on disk (zero new dependencies, human-readable)
- **Entities**: Test definitions, run results + history, test suites
- **File layout**: Nested by test
  ```
  .chromedev-director/
    tests/{slug}/def.json       # TestDef + metadata
    tests/{slug}/runs/*.json    # TestResult + run metadata
    suites/{slug}.json          # { name, testIds[] }
  ```
- **Storage root**: Project-local (`.chromedev-director/` in cwd)
- **Test identity**: User-provided slug (required, used as folder name, must be unique)
- **API surface**: Full CRUD + queries (save/get/list/delete tests, save/list runs, create/list/delete suites, filtering by tag/status/date)
- **Integration**: Auto-save on run — `runTest()` automatically persists result when a test ID is provided

## Approach

**Architecture**: Class-based Storage with lazy I/O (Approach A). Every call reads/writes disk directly — no in-memory cache, no sync issues.

### Section 1: Data Types

New types in `src/types.ts`:

```ts
/** Stored test definition with metadata */
interface StoredTest {
  id: string;              // User-provided slug (folder name)
  name: string;            // Human-readable display name
  description?: string;    // Optional description
  tags?: string[];         // For filtering (e.g., ["smoke", "auth"])
  def: TestDef;            // The actual test definition
  createdAt: string;       // ISO 8601 timestamp
  updatedAt: string;       // ISO 8601 timestamp
}

/** Stored run result with metadata */
interface StoredRun {
  testId: string;          // References StoredTest.id
  timestamp: string;       // ISO 8601 (also used as filename)
  status: "passed" | "failed";
  duration_ms: number;
  result: TestResult;      // Full TestResult payload
}

/** Test suite — a named group of tests */
interface StoredSuite {
  id: string;              // User-provided slug
  name: string;            // Display name
  testIds: string[];       // References to StoredTest.id
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}
```

Key decisions:
- `StoredRun` embeds the full `TestResult` (including `dom_snapshot`, `console_errors` on failure) — useful for debugging without re-running
- `StoredTest` wraps `TestDef` with metadata rather than extending it — keeps the runtime type clean
- Timestamps are ISO 8601 strings for JSON compatibility and human readability
- `tags` on tests enable filtering (list all "smoke" tests, all "auth" tests)

### Section 2: Storage Class API

New file `src/storage.ts` exports a `Storage` class:

```ts
class Storage {
  constructor(rootDir?: string)  // defaults to `${cwd}/.chromedev-director`

  // Test CRUD
  saveTest(id: string, name: string, def: TestDef, opts?: { description?: string; tags?: string[] }): Promise<StoredTest>
  getTest(id: string): Promise<StoredTest | null>
  listTests(filter?: { tag?: string }): Promise<StoredTest[]>
  updateTest(id: string, updates: Partial<Pick<StoredTest, 'name' | 'description' | 'tags' | 'def'>>): Promise<StoredTest>
  deleteTest(id: string): Promise<void>  // deletes folder + all runs

  // Run results
  saveRun(testId: string, result: TestResult): Promise<StoredRun>
  listRuns(testId: string, filter?: { status?: 'passed' | 'failed'; limit?: number }): Promise<StoredRun[]>
  getLatestRun(testId: string): Promise<StoredRun | null>

  // Suites
  saveSuite(id: string, name: string, testIds: string[]): Promise<StoredSuite>
  getSuite(id: string): Promise<StoredSuite | null>
  listSuites(): Promise<StoredSuite[]>
  updateSuite(id: string, updates: Partial<Pick<StoredSuite, 'name' | 'testIds'>>): Promise<StoredSuite>
  deleteSuite(id: string): Promise<void>
}
```

Key design points:
- Constructor creates the directory tree if it doesn't exist (`mkdir -p` equivalent)
- All methods are `async` since they do file I/O via `fs/promises`
- `listTests` scans `tests/*/def.json` — reads each file, applies optional tag filter
- `listRuns` reads `tests/{id}/runs/*.json`, sorts by timestamp descending, applies optional status filter and limit
- `deleteTest` removes the entire `tests/{id}/` directory (def + all runs)
- `saveRun` generates filename from timestamp: `2026-02-07T18-30-00-123.json` (colons replaced with dashes for filesystem safety)

### Section 3: Runner Integration

How `runTest()` auto-saves results:

```ts
// step-runner.ts — modified signature
export async function runTest(
  testDef: TestDef,
  port?: number,
  options?: { testId?: string; storage?: Storage }
): Promise<TestResult>
```

When `options.testId` is provided:
1. Runner executes the test as normal (no behavior change)
2. After getting the `TestResult`, calls `storage.saveRun(testId, result)`
3. Returns the `TestResult` unchanged

When `options.testId` is omitted:
- Behaves exactly as today — fire-and-forget, no persistence

**server.ts changes:**
- Create a singleton `Storage` instance at server startup
- The `run_test` MCP tool gains an optional `test_id` parameter
- If `test_id` is provided, pass it through to `runTest()` with the storage instance
- Storage creation is lazy — directories aren't created until first write

**runSteps() is NOT modified** — it remains the low-level function for unit tests with no storage awareness.

This approach is **backward-compatible**: existing callers that don't pass `testId` see zero behavior change. The storage integration is purely additive.

### Section 4: Error Handling & Edge Cases

**Slug validation:**
- Slugs must match `/^[a-z0-9][a-z0-9-]*$/` (lowercase alphanumeric + hyphens, no leading hyphen)
- `saveTest()` throws if slug is invalid or already exists (use `updateTest()` for updates)
- Maximum slug length: 100 characters

**File I/O errors:**
- `getTest()` / `getSuite()` return `null` if not found (not throw)
- `deleteTest()` / `deleteSuite()` are idempotent — no error if already deleted
- `saveRun()` throws if test doesn't exist (must `saveTest()` first)
- All write operations use `writeFile` with atomic semantics: write to `.tmp` file, then `rename()` to avoid partial writes

**Concurrent access:**
- Single-process safety via atomic file writes (write-then-rename)
- No file locking — acceptable for a dev tool where concurrent writes to the same test are unlikely
- `listTests()` / `listRuns()` tolerate partially written files by catching JSON parse errors and skipping corrupt entries

**Storage save failures don't break tests:**
- If `saveRun()` fails in `runTest()`, log a warning but still return the `TestResult`
- Storage is best-effort — test execution is always the priority

## Success Criteria
- Tests can be saved, retrieved, listed, and deleted by slug
- Run results are automatically persisted with timestamps
- Run history can be queried per test (all runs, recent failures, etc.)
- Suites can group tests and be executed as a batch
- Existing unit tests continue to pass (storage is additive, not breaking)
- Zero new npm dependencies
