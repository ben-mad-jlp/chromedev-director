# Session: keen-pure-pond

## Session Context
**Converted from:** Vibe session
**Goal:** Build a GUI and supporting infrastructure for chromedev-director — run tests, view results, compose tests via nesting.
**Out of Scope:** AI-assist features (Ask AI to Create/Fix/Add), test recording mode
**Shared Decisions:** See design-gaps doc for all 9 architectural decisions

---

## Existing Artifacts

(Created during vibe phase — preserved for reference)

### Diagrams
- **architecture-overview** — system architecture: UI, API server, MCP, engine, storage
- **test-nesting-model** — how tests compose via nesting (Login → Packaging → E2E)
- **ai-assist-flow** — (out of scope for now) AI assist sequence diagram
- **nesting-staleness** — staleness detection for nested test changes

### Documents
- **storage-design** — `.director/` folder structure, data shapes, retention policy, nesting/staleness tracking
- **design-gaps** — 9 architectural decisions (nesting StepDef, nested contribution rules, HTTP server, event emitter, cycle detection, ad-hoc runs, slugs, Chrome health, concurrency)
- **ui-interaction-model** — role split: what users do vs what AI does
- **ai-assist-design** — (out of scope for now) AI assist API design

### Wireframes
- **revised-test-viewer** — main dashboard: sidebar, steps with nesting, run output, drop zone
- **main-ui-layout** — original v1 layout (superseded by revised-test-viewer)

---

## Work Items

### Item 1: Storage layer
**Type:** code
**Status:** pending

**Problem/Goal:**
No persistence exists. Need `.director/` folder with test definitions and run results stored as JSON files.

**Approach:**
- Create `src/storage.ts` with functions for reading/writing `.director/tests/` and `.director/results/`
- Define `SavedTest`, `TestRun`, `DirectorConfig` types
- Handle slug generation, result retention, directory creation
- Shared by both MCP server and API server

**Success Criteria:**
- Can save, load, list, delete test definitions
- Can save and query run results with history
- Result retention enforced (default 50 per test)
- Staleness detection via `nestedVersions` in run results

**Decisions:**
- All JSON, no SQLite
- Slugify names, error on collision
- `.director/` in project root

---

### Item 2: `run_test` StepDef variant
**Type:** code
**Status:** pending

**Problem/Goal:**
No way to nest tests at runtime. Need `{ run_test: string }` StepDef variant that resolves and executes a saved test's steps inline.

**Approach:**
- Add `{ label?: string; run_test: string }` to `StepDef` union in `types.ts`
- Runner resolves `run_test` by loading the saved test and executing only its `steps`
- Nested test's `url`, `before`, `after`, `env` are ignored
- `$vars` flow naturally across nested boundaries
- Cycle detection with visited set before execution

**Success Criteria:**
- Can reference saved tests by ID in step definitions
- Nested steps execute inline, vars flow through
- Circular references detected and error thrown
- Error messages include nested test context

**Decisions:**
- Only `steps` from nested test, not url/before/after/env
- Parent env applies to all steps including nested

---

### Item 3: Runner event emitter
**Type:** code
**Status:** pending

**Problem/Goal:**
`runTest()` only returns a final `TestResult`. GUI needs live step-by-step progress over WebSocket.

**Approach:**
- Add optional `onEvent` callback parameter to `runTest()`
- Define `RunEvent` type: step:start, step:pass, step:fail, console, network
- Events include `nested` field when step is inside a nested test
- MCP server calls without callback (unchanged behavior)
- API server forwards events over WebSocket

**Success Criteria:**
- Existing MCP callers unaffected (callback is optional)
- Events emitted for every step start/pass/fail
- Nested test context included in events
- Console and network events streamed in real time

**Decisions:**
- Optional callback, not EventEmitter class
- No breaking changes to existing API

---

### Item 4: MCP tools
**Type:** code
**Status:** documented

**Problem/Goal:**
Only `run_test` exists. Need CRUD tools for saved tests and result querying so Claude can manage tests.

**Approach:**
- Add to `server.ts`: `save_test`, `list_tests`, `get_test`, `delete_test`, `list_results`, `get_result`
- Extend `run_test` to accept optional `testId` for running saved tests (with result persistence)
- All tools use `storage.ts` functions

**Success Criteria:**
- Claude can save, list, get, delete tests via MCP
- Claude can run saved tests with result persistence
- Claude can query run history and specific results
- Ad-hoc `run_test` still works (no persistence)

**Decisions:**
- `testId` parameter on `run_test` triggers persistence
- Ad-hoc runs not persisted

---

### Item 5: HTTP API server
**Type:** code
**Status:** documented

**Problem/Goal:**
GUI needs HTTP endpoints, WebSocket, and static file serving. MCP server is stdio-only.

**Approach:**
- Create `src/api-server.ts` with REST endpoints mirroring MCP tools
- WebSocket for live run progress (forwards `onEvent` from runner)
- `/api/chrome/status` endpoint using `/json/version` probe
- Concurrent run protection (one at a time, 409 on conflict)
- Static file serving for React build
- CLI: `npx chromedev-director gui --port 3838`

**Success Criteria:**
- All CRUD endpoints working for tests and results
- WebSocket streams live step progress during runs
- Chrome health check works
- Concurrent runs rejected with 409
- Serves static React build

**Decisions:**
- Separate process from MCP server
- Shares engine and storage code
- One run at a time
- Hono framework (lightweight, TypeScript-first, built-in WebSocket support)
- Same-origin only (no CORS — GUI served from same server)
- Error format: `{ "error": "message" }` with HTTP status codes
- Node.js runtime with @hono/node-server and @hono/node-ws

**Detailed Design:**

**Server Structure & Endpoints**

`src/api-server.ts` exports a `createApiServer()` function returning a Hono app, plus a `startGui(options)` entry point for CLI use.

Dependencies: `hono`, `@hono/node-server`, `@hono/node-ws`.

Endpoints map 1:1 to storage functions:
- `GET /api/tests` → `storage.listTests()` — returns `{ tests: SavedTest[] }`
- `POST /api/tests` → `storage.saveTest(def)` — body: `{ name, test }`, returns `{ id, test }`
- `GET /api/tests/:id` → `storage.getTest(id)` — returns `{ id, test }` or 404
- `PUT /api/tests/:id` → `storage.updateTest(id, def)` — returns `{ id, test }` or 404
- `DELETE /api/tests/:id` → `storage.deleteTest(id)` — returns `{ ok: true }` or 404
- `POST /api/tests/:id/run` → loads test, calls `runTest()`, saves result — returns `{ runId, result }`
- `GET /api/tests/:id/results` → `storage.listResults(id)` — returns `{ results: TestRun[] }`
- `GET /api/results/:runId` → `storage.getResult(runId)` — returns `{ result }` or 404
- `GET /api/chrome/status` → probes `http://localhost:{cdpPort}/json/version` — returns `{ connected, version? }`

Static files served from `gui/dist/` with SPA fallback (all non-API routes → `index.html`).

See diagram: **api-server-flow**

**WebSocket & Live Progress**

WebSocket endpoint at `GET /ws` using `@hono/node-ws`. No auth — same-origin only.

**Connection model:** Clients connect and receive all run events broadcast-style. No subscription/channel needed since only one run executes at a time.

**Server maintains a `Set<WSContext>` of connected clients.** On connect, add to set. On close/error, remove. No heartbeat needed initially.

**Message protocol (server → client):**
```json
{ "type": "run:start", "testId": "login-flow", "runId": "abc123" }
{ "type": "run:step", "testId": "...", "runId": "...", "stepIndex": 0, "stepLabel": "Fill Division", "nested": null, "status": "running" }
{ "type": "run:step", "testId": "...", "runId": "...", "stepIndex": 0, "stepLabel": "Fill Division", "nested": null, "status": "passed", "duration_ms": 142 }
{ "type": "run:complete", "testId": "...", "runId": "...", "status": "passed" }
```

**Integration with runner:** The `POST /api/tests/:id/run` handler passes an `onEvent` callback to `runTest()`. The callback maps `RunEvent` types to WebSocket message types and broadcasts to all connected clients.

**Client → server messages:** Not needed initially. GUI only receives.

See diagram: **ws-progress-flow**

**Run Lock & Concurrency**

In-memory mutex — a single `activeRun` variable tracks the current run:

```ts
let activeRun: { testId: string; runId: string } | null = null;
```

**`POST /api/tests/:id/run` flow:**
1. Check `activeRun` — if not null, return `409 { "error": "Test already running", "activeRun": { testId, runId } }`
2. Set `activeRun = { testId, runId }`
3. Broadcast `run:start` over WebSocket
4. Call `runTest(def, port, onEvent)` with event forwarding
5. In `finally` block: set `activeRun = null`, broadcast `run:complete`
6. Save result via `storage.saveResult()`
7. Return `{ runId, result }`

**Why in-memory:** Single-process server, single Chrome instance. No need for Redis/file locks. If the server restarts, there's no orphaned run to worry about.

**Chrome health check** (`GET /api/chrome/status`): Probes `http://localhost:{cdpPort}/json/version` with a 2-second fetch timeout. Returns `{ connected: true, version: "Chrome/..." }` or `{ connected: false }`. Non-blocking — doesn't acquire the run lock.

**CLI entry point** (`src/cli.ts` or bottom of `api-server.ts`):
```
npx chromedev-director gui [--port 3838] [--cdp-port 9222]
```
Parses args, calls `startGui({ port, cdpPort })`, logs URL to stderr.

---

### Item 6: React GUI *(superseded — split into 6a–6d)*
**Type:** code
**Status:** superseded

**Shared Decisions (apply to all sub-items):**
- No test creation/editing in GUI (MCP only)
- Read-only steps display (no toggle on/off)
- No drag-to-nest or test composition in GUI (MCP only)
- GUI is view-and-run only: browse tests, trigger runs, view results/history
- UI library: shadcn/ui + Tailwind CSS
- State management: Zustand + native fetch + custom hooks (same pattern as mermaid-collab)
- Build tool: Vite
- Routing: react-router-dom
- WebSocket: auto-reconnect with exponential backoff (1s→2s→4s→8s→16s, max 5 attempts), singleton client, connection state in Zustand store

---

### Item 6a: GUI scaffolding
**Type:** code
**Status:** documented

**Problem/Goal:**
Set up the React app foundation — project structure, tooling, core infrastructure.

**Approach:**
- Separate `gui/` directory with its own `package.json` (not a monorepo workspace)
- Vite + React + TypeScript project
- Tailwind CSS + shadcn/ui setup
- Zustand stores (testStore, runStore, uiStore)
- API client module (`gui/src/api.ts`) wrapping native fetch
- WebSocket client (`gui/src/ws.ts`) with auto-reconnect, singleton pattern
- react-router-dom with routes: `/` (test list), `/tests/:id` (test detail)
- Base layout shell: app bar with Chrome status indicator, sidebar placeholder, main content area
- `gui/src/types.ts` — GUI-side type definitions mirroring server types (TestDef, StepDef, TestResult, etc.)

**Success Criteria:**
- `npm run dev` starts the GUI
- API client can fetch from the HTTP API server
- WebSocket connects and reconnects
- Base layout renders with routing

**Decisions:**
- Separate package.json, not monorepo workspace (simpler, can upgrade later)
- Types mirrored in gui/src/types.ts (API contract is the source of truth)
- Feature-based file structure (gui/src/features/)

**Detailed Design:**

**Section 1: Project Setup & Dependencies**

Scaffold with `npm create vite@latest gui -- --template react-ts`. Core dependencies:

- **Runtime:** `react`, `react-dom`, `react-router-dom`, `zustand`
- **UI:** `tailwindcss`, `@tailwindcss/vite`, `shadcn` (CLI init, then cherry-pick components: Button, Card, Badge, Tabs, Input, ScrollArea, Collapsible, Separator)
- **Dev:** `typescript`, `@types/react`, `@types/react-dom`, `vite`

No additional HTTP client (native `fetch`). No test framework in v1 (tests deferred).

**File structure:**
```
gui/
  package.json
  vite.config.ts
  tsconfig.json
  tailwind.config.ts          # ← NOTE: may not be needed with @tailwindcss/vite
  components.json             # shadcn config
  src/
    main.tsx                  # ReactDOM.createRoot
    App.tsx                   # BrowserRouter + Routes + Layout
    components/               # Shared: Layout, AppBar, Sidebar
      ui/                     # shadcn components (auto-generated)
    features/
      tests/                  # Test list, detail, step cards
      runs/                   # Run progress, log panel
      history/                # Results, history list
    stores/
      test-store.ts
      run-store.ts
      ui-store.ts
    lib/
      api.ts                  # Fetch wrapper
      ws.ts                   # WebSocket client
      types.ts                # Mirrored server types
    index.css                 # Tailwind directives
```

Vite dev server proxies `/api` and `/ws` to the API server (port 3838) during development.

**Section 2: API Client & Types**

`gui/src/lib/api.ts` — thin wrapper over `fetch` with typed methods:

```ts
const BASE = '';  // same-origin, proxied in dev

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json();
}

export const api = {
  listTests: () => request<{ tests: SavedTest[] }>('/api/tests'),
  getTest: (id: string) => request<{ id: string; test: TestDef }>(`/api/tests/${id}`),
  runTest: (id: string) => request<{ runId: string; result: TestResult }>(`/api/tests/${id}/run`, { method: 'POST' }),
  listResults: (id: string) => request<{ results: TestRun[] }>(`/api/tests/${id}/results`),
  getResult: (runId: string) => request<{ result: TestRun }>(`/api/results/${runId}`),
  chromeStatus: () => request<{ connected: boolean; version?: string }>('/api/chrome/status'),
};
```

`gui/src/lib/types.ts` — mirrored types from server. Key types:

- `SavedTest` — `{ id: string; name: string; test: TestDef }`
- `TestDef` — `{ url: string; steps: StepDef[]; env?: Record<string,string>; ... }`
- `StepDef` — union of step types (fill, click, assert, evaluate, run_test, etc.)
- `TestResult` — `{ status: 'passed'|'failed'; steps: StepResult[]; duration_ms: number; ... }`
- `TestRun` — `{ runId: string; testId: string; timestamp: string; result: TestResult; nestedVersions?: Record<string,string> }`

Custom `ApiError` class carries status code and message for error handling in stores.

**Section 3: WebSocket Client**

`gui/src/lib/ws.ts` — singleton WebSocket client with auto-reconnect.

```ts
type WsMessage =
  | { type: 'run:start'; testId: string; runId: string }
  | { type: 'run:step'; testId: string; runId: string; stepIndex: number; stepLabel: string; nested: string | null; status: 'running' | 'passed' | 'failed'; duration_ms?: number; error?: string }
  | { type: 'run:complete'; testId: string; runId: string; status: 'passed' | 'failed' };
```

**Singleton pattern:** `getWsClient()` returns or creates the single instance. Connects to `ws://localhost:{port}/ws` (same origin in production, proxied in dev).

**Auto-reconnect:** On close (non-intentional), retries with exponential backoff: 1s → 2s → 4s → 8s → 16s, max 5 attempts. Resets attempt counter on successful connect.

**Subscription API:**
```ts
const unsub = wsClient.subscribe((msg: WsMessage) => { ... });
// later: unsub();
```

Subscribers receive all messages. The `runStore` subscribes on app mount and updates step states. Cleanup on `wsClient.close()` (intentional disconnect).

**Connection state:** Exposes `status: 'connecting' | 'connected' | 'disconnected' | 'error'` as a reactive property. The `uiStore` reads this to show Chrome/server connection status in the AppBar.

**Vite proxy config** (`vite.config.ts`):
```ts
server: {
  proxy: {
    '/api': 'http://localhost:3838',
    '/ws': { target: 'ws://localhost:3838', ws: true }
  }
}
```

**Section 4: Zustand Stores**

Three stores, each handling a distinct concern:

**`testStore`** — test data and selection:
```ts
interface TestStore {
  tests: SavedTest[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  // Actions
  fetchTests: () => Promise<void>;
  selectTest: (id: string) => void;
  getSelectedTest: () => SavedTest | null;  // derived
}
```
`fetchTests()` calls `api.listTests()`, stores result. Called on mount and after a run completes (to refresh pass/fail status).

**`runStore`** — active run state and live events:
```ts
interface RunStore {
  activeRun: { testId: string; runId: string } | null;
  stepStatuses: Map<number, 'pending' | 'running' | 'passed' | 'failed'>;
  logs: LogEntry[];  // console + network events
  // Actions
  startRun: (testId: string) => Promise<void>;
  handleWsMessage: (msg: WsMessage) => void;
  clearRun: () => void;
}
```
`startRun()` calls `api.runTest(id)` and sets `activeRun`. WebSocket messages update `stepStatuses` and `logs` in real time. `clearRun()` resets after run completes.

**`uiStore`** — UI state and chrome status:
```ts
interface UIStore {
  chromeConnected: boolean;
  wsStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  searchQuery: string;
  // Actions
  checkChromeStatus: () => Promise<void>;
  setWsStatus: (status: string) => void;
  setSearchQuery: (q: string) => void;
}
```
`checkChromeStatus()` polls `api.chromeStatus()` on mount and every 30 seconds.

**Section 5: Base Layout & Routing**

`App.tsx` sets up routing and the layout shell. Two routes:

- `/` — redirects to first test or shows empty state
- `/tests/:id` — test detail view (steps, run, results, history)

**Layout structure** (matches `revised-test-viewer` wireframe):

```
┌──────────────────────────────────────────────┐
│  AppBar (title, Chrome status dot)           │
├──────────┬───────────────────────────────────┤
│ Sidebar  │  Main Content                     │
│          │  ┌─────────────────────────────┐  │
│ Search   │  │  Test Name + Run Button     │  │
│ ──────── │  │  ────────────────────────── │  │
│ Test 1 ✓ │  │  [Steps] [Results] [History]│  │
│ Test 2 ✗ │  │                             │  │
│ Test 3 ✓ │  │  (tab content)              │  │
│          │  │                             │  │
│          │  └─────────────────────────────┘  │
└──────────┴───────────────────────────────────┘
```

**Components for scaffolding (Item 6a):**
- `Layout.tsx` — flex container with sidebar + main area
- `AppBar.tsx` — top bar with "Director" title and Chrome status dot (green/red circle from `uiStore.chromeConnected`)
- `Sidebar.tsx` — placeholder with search input (wired to `uiStore.searchQuery`) and test list container (populated in Item 6b)

**App mount sequence** (`main.tsx` → `App.tsx`):
1. Initialize WebSocket client (`getWsClient()`)
2. Subscribe `runStore.handleWsMessage` to WebSocket
3. Call `testStore.fetchTests()` and `uiStore.checkChromeStatus()`
4. Start Chrome status polling interval (30s)
5. Render `<BrowserRouter>` with `<Layout>` wrapping route outlet

See diagram: **gui-scaffolding-architecture**

---

### Item 6b: Test list & detail view
**Type:** code
**Status:** documented
**Depends on:** 6a

**Problem/Goal:**
Browse and inspect saved tests — sidebar list, search, step display with nesting.

**Approach:**
- Sidebar: test list fetched from API, search/filter input, pass/fail icons per test (from latest result)
- Test detail view: test name, URL, step count
- Steps tab: step cards with type badges (fill, click, assert, etc.)
- Nested test blocks: collapsible sections showing `run_test` steps with their child steps
- Staleness indicators on nested tests

**Success Criteria:**
- Can browse all saved tests in sidebar
- Can search/filter tests by name
- Can view test details with all steps displayed
- Nested tests shown as collapsible blocks with staleness badges

**Detailed Design:**

**Section 1: Sidebar & Test List**

`features/tests/TestList.tsx` — renders inside `Sidebar.tsx` placeholder.

**Data flow:** On mount, `testStore.fetchTests()` loads all tests. The sidebar renders a filtered list based on `uiStore.searchQuery`.

**Each test list item shows:**
- Test name (truncated if long)
- Status icon: ✓ (green) if latest result passed, ✗ (red) if failed, — (gray) if never run
- Step count badge (e.g., "5 steps")

**Search:** `<Input>` at top of sidebar. Filters `testStore.tests` by name (case-insensitive substring match). Debounced to 200ms via `uiStore.setSearchQuery()`.

**Selection:** Clicking a test navigates to `/tests/:id` via `react-router-dom`'s `useNavigate()`. The selected test is highlighted in the sidebar. `testStore.selectedId` is derived from the URL param.

**Empty states:**
- No tests: "No tests saved yet. Use Claude to create tests via MCP."
- No search results: "No tests match your search."

**Component:** Uses shadcn `ScrollArea` for the list, `Input` for search, `Badge` for step count.

See diagram: **test-list-detail-flow**

**Section 2: Test Detail & Step Cards**

`features/tests/TestDetail.tsx` — main content area for `/tests/:id` route.

**Header area:**
- Test name (h1)
- URL displayed below name (muted text)
- Run button (top-right) — wired in Item 6c
- Tabs: Steps | Results | History (using shadcn `Tabs`)

**Steps tab** (`features/tests/StepsTab.tsx`):

Fetches test via `api.getTest(id)` and renders each step as a card.

**StepCard component** (`features/tests/StepCard.tsx`):
- Type badge (colored): `fill` (blue), `click` (green), `assert` (purple), `evaluate` (orange), `wait_for` (yellow), `navigate` (gray), `run_test` (amber), etc.
- Step label (or auto-generated from step type + selector/value)
- Key details shown inline: selector, value, expression (truncated, expandable)
- Step index number on the left

**Nested test display** — when step is `{ run_test: "test-id" }`:
- `StepCard` renders with amber `run_test` badge and nested test name
- Below it: shadcn `Collapsible` containing the nested test's steps (fetched via `api.getTest(nestedId)`)
- Indent nested steps visually (left border + padding)
- Staleness badge: ⚠ "Stale" if nested test was modified after the parent's last run (compare timestamps)
- Nested tests can themselves contain `run_test` steps (recursive rendering, max depth 5)

**Auto-label generation** for steps without explicit labels:
- `fill` → "Fill {selector}" 
- `click` → "Click {selector}"
- `assert` → "Assert {type}"
- `evaluate` → "Evaluate"
- `run_test` → "Run {testId}"

See diagram: **test-list-detail-flow**

---

### Item 6c: Run execution & live progress
**Type:** code
**Status:** documented
**Depends on:** 6a, 6b

**Problem/Goal:**
Trigger test runs and show live step-by-step progress via WebSocket.

**Approach:**
- Run button on test detail view (disabled when another test is running)
- Step cards update in-place: pending → spinner → checkmark/X
- Collapsible log panel below steps for console output and network activity
- Chrome connection status indicator in app bar (green/red dot)
- WebSocket receives `run:start`, `run:step`, `run:complete` events

**Success Criteria:**
- Can trigger a test run from the GUI
- Step cards show live progress as test executes
- Console/network log panel shows real-time output
- Chrome status indicator shows connected/disconnected
- Run button disabled while a test is running

**Detailed Design:**

**Section 1: Run Button & Step Progress**

`features/runs/RunButton.tsx` — placed in `TestDetail` header area.

**States:**
- **Idle:** "Run Test" (primary button). Enabled when `runStore.activeRun === null` and `uiStore.chromeConnected === true`.
- **Running:** "Running..." with spinner. Disabled. Shown when `runStore.activeRun.testId === currentTestId`.
- **Busy:** "Test Running" (muted). Disabled. Shown when `runStore.activeRun` is set but for a different test.
- **Chrome offline:** "Chrome Disconnected" (muted). Disabled. Tooltip explains Chrome isn't connected.

**Click handler:** Calls `runStore.startRun(testId)` which POSTs to `/api/tests/:id/run`. The HTTP response returns after the full run completes, but live progress arrives via WebSocket before that.

**Step progress overlay** — `StepCard` receives `status` from `runStore.stepStatuses`:
- `undefined` or `'pending'` → no overlay (default card)
- `'running'` → blue left border + spinner icon
- `'passed'` → green left border + ✓ icon
- `'failed'` → red left border + ✗ icon + error message below card

`stepStatuses` is a `Map<number, Status>` keyed by step index. Reset when a new run starts. Nested step events use the `nested` field to display progress within collapsible nested blocks.

See diagram: **run-progress-flow**

**Section 2: Log Panel**

`features/runs/LogPanel.tsx` — collapsible panel below the steps list, visible during and after a run.

**Layout:** shadcn `Collapsible` with a toggle header: "Console & Network (N entries)". Collapsed by default, auto-expands when a run starts. Contains a scrollable log area.

**Log entries** from `runStore.logs` array. Each entry is typed:

```ts
type LogEntry =
  | { type: 'console'; level: 'log' | 'warning' | 'error'; text: string; timestamp: number }
  | { type: 'network'; method: string; url: string; status: number; duration_ms: number; timestamp: number }
  | { type: 'step'; stepIndex: number; label: string; status: 'running' | 'passed' | 'failed'; timestamp: number };
```

**Display:**
- Console entries: colored by level (default, yellow for warning, red for error). Monospace text.
- Network entries: `GET /api/tests 200 142ms` format. Green for 2xx, yellow for 3xx, red for 4xx/5xx.
- Step entries: "Step 3: Fill #division — passed (142ms)" as dividers between step logs.

**Auto-scroll:** Panel scrolls to bottom as new entries arrive. Pauses auto-scroll if user scrolls up manually. Resumes if user scrolls back to bottom.

**Clear:** Logs cleared when a new run starts (`runStore.clearRun()`).

**WebSocket integration:** `runStore.handleWsMessage()` appends to `logs` array for console and network event types. Step events are also added as divider entries.

---

### Item 6d: Results & history
**Type:** code
**Status:** documented
**Depends on:** 6a, 6b

**Problem/Goal:**
View past run results and history for each test.

**Approach:**
- Results tab: latest run details — pass/fail per step, duration, error messages, console/network logs
- History tab: timestamped list of past runs, pass/fail summary
- Staleness warnings on results where nested test definitions have changed since the run
- Click a history entry to view its full result

**Success Criteria:**
- Can view the latest result for a test
- Can browse run history with timestamps
- Staleness warnings shown when nested tests changed
- Can drill into any historical run's full details

**Detailed Design:**

**Section 1: Results Tab**

`features/history/ResultsTab.tsx` — shows the latest run result for the selected test.

**Data flow:** Fetches via `api.listResults(testId)`, takes the first (most recent) entry. If no results exist, shows empty state: "No runs yet. Click Run to execute this test."

**Layout:**
- **Summary bar:** Pass/fail status badge, total duration, timestamp ("2 minutes ago" relative time)
- **Step results list:** Reuses `StepCard` component with result overlay:
  - Passed steps: green ✓ + duration
  - Failed steps: red ✗ + error message expanded below
  - Each step shows duration_ms on the right
- **Error details:** For failed steps, show the full error message in a red-tinted `Card` with monospace text. Include selector/expression that failed.
- **Console/Network summary:** Collapsed section showing captured console messages and network requests from the run (stored in result data).

**Staleness warning:** If `result.nestedVersions` exists and any nested test's current version differs from the recorded version, show an amber banner: "⚠ Nested test '{name}' has been modified since this run. Results may be outdated."

**Section 2: History Tab**

`features/history/HistoryTab.tsx` — chronological list of all past runs for the selected test.

**Data flow:** Fetches via `api.listResults(testId)`. Returns array sorted by timestamp descending (newest first).

**List layout:** Each history entry is a row showing:
- **Status icon:** ✓ (green) or ✗ (red)
- **Timestamp:** relative ("3 hours ago") with full date on hover tooltip
- **Duration:** total run time (e.g., "2.4s")
- **Step summary:** "5/5 passed" or "3/5 passed" with a mini progress bar (green/red segments)
- **Staleness indicator:** ⚠ amber icon if `nestedVersions` mismatch detected

**Drill-down:** Clicking a history entry navigates to a result detail view. This reuses `ResultsTab` component but loads the specific `runId` via `api.getResult(runId)` instead of showing the latest.

**URL:** `/tests/:id/history/:runId` — optional nested route. If no `runId`, shows the history list. If `runId` present, shows that specific result.

**Empty state:** "No run history yet."

**Pagination:** Not needed in v1. Storage layer defaults to 50 results per test (retention policy). If needed later, add "Load more" button.

**Auto-refresh:** After a run completes (`run:complete` WebSocket event), the history list refetches to include the new result.

---

## Diagrams
(auto-synced)
