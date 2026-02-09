# Design Decisions

## 1. Test Nesting — New StepDef Variant

**Decision:** Add `{ run_test: string }` as a new `StepDef` variant.

```ts
| { label?: string; run_test: string }  // run a saved test by ID
```

The runner resolves `run_test: "login-flow"` by:
1. Loading `.director/tests/login-flow.json`
2. Checking for circular references (see #5)
3. Executing only the nested test's `steps` inline
4. Reporting step progress as "Login Flow > step 1", "Login Flow > step 2", etc.
5. If a nested step fails, the error includes which nested test it was in

**Why not pre-flatten:** The runner needs to know about nesting boundaries for:
- Progress reporting ("Login Flow > fill Division")
- Error context ("Failed in nested test Login Flow, step 3")
- Staleness tracking (recording which version of each nested test was used)

---

## 2. Nested Tests Only Contribute `steps`

**Decision:** When a nested test runs, only its `steps` array is executed. `url`, `before`, and `after` are ignored.

| Field | When run standalone | When nested |
|-------|-------------------|-------------|
| `url` | Navigates to this URL | **Ignored** — parent controls navigation |
| `before` | Runs before navigation | **Ignored** — parent sets up mocks |
| `steps` | Runs after navigation | **Executed inline** |
| `after` | Runs after steps (always) | **Ignored** — parent handles cleanup |
| `env` | Applied to step interpolation | **Ignored** — parent's env used |

**Rationale:** The parent test owns the full lifecycle. Nested tests are reusable step sequences, not independent test runs. If Login Flow needs mocks when nested, the parent should set them up in its own `before`.

The nested test's `env` is ignored because the parent might have different env values (different base URL, different credentials). Parent env applies to all steps including nested ones.

**`$vars` flow naturally.** Since nested steps are executed inline in the same runner context, any `$vars` set by the parent are visible to nested steps, and vice versa. This is intentional — it enables patterns like:

```json
// Parent sets up credentials
{ "eval": "'admin'", "as": "username" },
// Nested login flow uses $vars.username
{ "run_test": "login-flow" }
// Parent can use $vars set by login flow (e.g., $vars.userId)
{ "assert": "$vars.userId != null" }
```

---

## 3. HTTP API Server (Separate from MCP)

**Decision:** New `src/api-server.ts` — an HTTP server that runs alongside (not replacing) the MCP server.

```
# Two entry points, shared engine
chromedev-director
  ├── src/server.ts          # MCP server (stdio) — for Claude
  ├── src/api-server.ts      # HTTP server — for GUI
  ├── src/step-runner.ts     # shared test engine
  └── src/storage.ts         # shared .director/ file operations
```

### API endpoints
```
GET    /api/tests              # list saved tests
GET    /api/tests/:id          # get a saved test
POST   /api/tests              # save a new test
PUT    /api/tests/:id          # update a test
DELETE /api/tests/:id          # delete a test

POST   /api/tests/:id/run      # run a saved test
GET    /api/tests/:id/results   # list run history
GET    /api/results/:runId      # get a specific run result

GET    /api/config              # get project config
PUT    /api/config              # update project config

GET    /api/chrome/status       # check Chrome connection
```

### WebSocket
```
WS /ws
  → { type: "run:start", testId, runId }
  → { type: "run:step", testId, runId, stepIndex, stepLabel, nested?, status }
  → { type: "run:complete", testId, runId, result }
```

### Static files
Serves the React GUI from `dist/` or `public/`.

### How to run
```bash
# Option A: single command starts both
npx chromedev-director --gui --port 3838

# Option B: separate commands
npx chromedev-director          # MCP server (stdio)
npx chromedev-director gui      # HTTP server + GUI
```

---

## 4. Live Progress — Runner Event Emitter

**Decision:** Refactor `runTest()` to accept an optional event callback.

```ts
type RunEvent =
  | { type: "step:start"; index: number; step: StepDef; nested?: string }
  | { type: "step:pass"; index: number; duration_ms: number; nested?: string }
  | { type: "step:fail"; index: number; error: string; nested?: string }
  | { type: "console"; message: ConsoleMessage }
  | { type: "network"; response: NetworkResponse };

async function runTest(
  testDef: TestDef,
  port: number,
  onEvent?: (event: RunEvent) => void
): Promise<TestResult>
```

- **MCP server:** Calls `runTest()` without `onEvent` — same as today, just returns final result.
- **API server:** Calls `runTest()` with `onEvent` that forwards events over WebSocket.
- **No breaking change** to existing callers — the callback is optional.

The `nested` field on events indicates which nested test the step belongs to (e.g., `"Login Flow"`), or undefined for top-level steps.

---

## 5. Circular Nesting — Cycle Detection

**Decision:** Detect cycles at resolution time, before execution.

```ts
function resolveNestedTests(testId: string, visited: Set<string> = new Set()): StepDef[] {
  if (visited.has(testId)) {
    throw new Error(`Circular test reference detected: ${[...visited, testId].join(" → ")}`);
  }
  visited.add(testId);
  // ... load test, resolve any run_test steps recursively
}
```

Error message example:
```
Circular test reference detected: packaging-station → login-flow → packaging-station
```

Detection happens when:
- A test is saved with `run_test` steps (validate on save)
- A test is about to run (validate before execution)

---

## 6. Ad-hoc vs Saved Test Runs

**Decision:** Only saved tests get results persisted to `.director/results/`.

- MCP `run_test` with an inline `TestDef` (not a saved test) → returns result but does NOT save it. Same as today.
- MCP `run_test` with a saved test ID → runs and saves result.
- GUI always runs saved tests → always saves result.

**Rationale:** Ad-hoc runs are throwaway experiments. The user can always save the test first if they want history.

We add an optional `testId` parameter to the MCP `run_test` tool:
```ts
// Run ad-hoc (no persistence)
{ test: { url: "...", steps: [...] } }

// Run saved test (persists result)
{ testId: "login-flow" }
```

---

## 7. Slug Generation

**Decision:** Generate slugs from test name with collision handling.

```ts
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
```

- "Login Flow" → `login-flow`
- "Full E2E Suite" → `full-e2e-suite`
- On collision: error. User must pick a different name.
- Renaming: not supported initially. Delete and recreate.

---

## 8. Chrome Health Check

**Decision:** API server has a `/api/chrome/status` endpoint.

```ts
// Lightweight probe — try to connect, immediately close
async function checkChromeStatus(port: number): Promise<{ connected: boolean; version?: string }> {
  try {
    const info = await fetch(`http://localhost:${port}/json/version`);
    const data = await info.json();
    return { connected: true, version: data["Browser"] };
  } catch {
    return { connected: false };
  }
}
```

Uses Chrome's built-in `/json/version` endpoint — no CDP connection needed. Fast and non-disruptive.

---

## 9. Concurrent Run Protection

**Decision:** One test run at a time. Queue or reject concurrent requests.

- API server tracks if a run is in progress.
- If a second run is requested while one is active: return `409 Conflict` with a message.
- The GUI disables the Run button while a test is executing.
- MCP `run_test` also checks — returns error if a run is in progress.

**Rationale:** A single Chrome instance can't reliably handle concurrent test sessions. Page navigation in one test would break another.

---

## Summary of Decisions

| # | Issue | Decision |
|---|-------|----------|
| 1 | Nesting at runtime | New `{ run_test: string }` StepDef variant |
| 2 | What nested tests contribute | Only `steps`. `url`, `before`, `after`, `env` ignored. |
| 3 | GUI server | Separate HTTP server (`api-server.ts`) alongside MCP |
| 4 | Live progress | Optional `onEvent` callback on `runTest()` |
| 5 | Circular nesting | Cycle detection with visited set, error on cycle |
| 6 | Ad-hoc runs | Not persisted. Only saved tests get history. |
| 7 | Slugs | Slugify name, error on collision, no rename |
| 8 | Chrome health | `/json/version` probe, no CDP needed |
| 9 | Concurrent runs | One at a time, 409 on conflict |
