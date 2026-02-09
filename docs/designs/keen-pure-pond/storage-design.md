# Storage Design

## Directory: `.director/`

Standard location in any project that uses chromedev-director.

```
my-project/
  .director/
    tests/
      login-flow.json
      packaging-station.json
      full-e2e-suite.json
    results/
      login-flow/
        2024-01-15T10-30-00Z.json
        2024-01-16T09-00-00Z.json
      packaging-station/
        2024-01-15T11-00-00Z.json
    config.json
```

### Why this structure
- **All JSON** — no binary deps, human-readable, git-friendly
- **Tests are files** — easy to inspect, diff, share, version-control
- **Results grouped by test** — simple to list history for a given test
- **Timestamp filenames** — natural sort order, no collisions

### .gitignore consideration
```gitignore
# .director/.gitignore
results/
```

---

## Data Shapes

### SavedTest (`tests/<slug>.json`)
```ts
interface SavedTest {
  id: string;              // slug, matches filename ("login-flow")
  name: string;            // display name ("Login Flow")
  testDef: TestDef;        // the full test definition
  nested?: string[];       // IDs of nested tests (always uses latest version)
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp — KEY for staleness detection
  tags?: string[];         // optional grouping
}
```

### TestRun (`results/<test-id>/<timestamp>.json`)
```ts
interface TestRun {
  id: string;              // "<test-id>-<timestamp>"
  testId: string;          // which saved test
  result: TestResult;      // existing pass/fail type
  startedAt: string;
  completedAt: string;
  trigger: "gui" | "mcp";
  // Snapshot of nested test versions at run time — for staleness detection
  nestedVersions?: Record<string, string>;  // { "login-flow": "2024-01-14T..." }
  // Always captured (small, text-based)
  consoleLog: string[];           // full console output
  networkLog: NetworkResponse[];  // all network activity
  // Only on failure (can be large)
  domSnapshot?: string;           // HTML snapshot at failure point
  screenshot?: string;            // base64 PNG at failure point (future)
}
```

### Config (`.director/config.json`)
```ts
interface DirectorConfig {
  chromePort?: number;     // default 9222
  baseUrl?: string;        // e.g. "http://localhost:8081"
  resultRetention?: number; // max results per test (default: 50)
}
```

---

## Data Capture Policy

**Always capture** (small, text-based):
- Full console log (all levels, not just errors)
- Full network log (all requests/responses with status codes)
- Step-by-step timing

**Only on failure** (can be large):
- DOM snapshot at failure point
- Screenshot at failure point (future)

**Retention**: 50 results per test by default, configurable. Delete oldest when over limit.

---

## Dynamic Nesting + Staleness Detection

### Decision: Always use latest (dynamic)
When `packaging-station` nests `login-flow`, it always resolves to the current `login-flow.json` at run time. No copying, no drift.

### Staleness tracking
Each TestRun records `nestedVersions` — a snapshot of the `updatedAt` timestamps for every nested test at the time of the run.

```json
{
  "testId": "packaging-station",
  "result": { "status": "passed" },
  "nestedVersions": {
    "login-flow": "2024-01-14T09:00:00Z"
  }
}
```

### How staleness shows in the GUI

**Steps tab** — nested test block:
- Badge: "Updated since last run" if nested test changed

**History tab** — each historical run:
- Warning icon: "Login Flow was updated after this run"

**Sidebar** — test list:
- Small indicator if any nested dep is newer than the last run

---

## MCP Tools for Storage

| Tool | Description |
|------|-------------|
| `save_test` | Save a TestDef to `.director/tests/` |
| `list_tests` | List all saved tests (names, IDs, last result) |
| `get_test` | Get a saved test by ID |
| `delete_test` | Remove a saved test |
| `run_test` | (existing) Run a test — now also saves results to `.director/results/` |
| `list_results` | Get run history for a test |
| `get_result` | Get a specific run result |

---

## Decisions Made
- [x] `.director/` folder in project root
- [x] All JSON storage (no SQLite)
- [x] Dynamic nesting (always latest)
- [x] Staleness tracking via `nestedVersions` snapshot per run
- [x] Capture everything small; heavy data only on failure
- [x] 50 result retention default, configurable
