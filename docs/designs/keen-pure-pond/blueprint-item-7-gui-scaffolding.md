# Blueprint: Item 7 (6a) - GUI Scaffolding

## 1. Structure Summary

### Files

- `gui/package.json` — Dependencies and scripts
- `gui/vite.config.ts` — Vite config with proxy for API and WebSocket
- `gui/tsconfig.json` — TypeScript config for React
- `gui/index.html` — Vite entry HTML
- `gui/src/main.tsx` — React root mount + app initialization
- `gui/src/App.tsx` — Router + Layout wrapper
- `gui/src/index.css` — Tailwind directives
- `gui/src/components/Layout.tsx` — Flex container: AppBar + Sidebar + Main
- `gui/src/components/AppBar.tsx` — Top bar with title + Chrome status dot
- `gui/src/components/Sidebar.tsx` — Sidebar shell with search input placeholder
- `gui/src/components/ui/` — shadcn generated components
- `gui/src/stores/test-store.ts` — Zustand store for test data
- `gui/src/stores/run-store.ts` — Zustand store for active run state
- `gui/src/stores/ui-store.ts` — Zustand store for UI state + Chrome status
- `gui/src/lib/api.ts` — Typed fetch wrapper
- `gui/src/lib/ws.ts` — Singleton WebSocket client with auto-reconnect
- `gui/src/lib/types.ts` — Mirrored server types
- `gui/components.json` — shadcn/ui config

### Type Definitions

See design doc Section 2 (API Client & Types) for full type definitions:
- `SavedTest`, `TestDef`, `StepDef`, `TestResult`, `TestRun`
- `ApiError` class
- `WsMessage` union type
- Store interfaces: `TestStore`, `RunStore`, `UIStore`

---

## 2. Function Blueprints

### `gui/src/lib/api.ts` — API Client

```typescript
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // 1. Fetch with same-origin base
  // 2. If !res.ok, parse error body, throw ApiError
  // 3. Return res.json()
}

export const api = {
  listTests: () => request<{ tests: SavedTest[] }>('/api/tests'),
  getTest: (id: string) => request<...>(`/api/tests/${id}`),
  runTest: (id: string) => request<...>(`/api/tests/${id}/run`, { method: 'POST' }),
  listResults: (id: string) => request<...>(`/api/tests/${id}/results`),
  getResult: (runId: string) => request<...>(`/api/results/${runId}`),
  chromeStatus: () => request<{ connected: boolean; version?: string }>('/api/chrome/status'),
};
```

---

### `gui/src/lib/ws.ts` — WebSocket Client

```typescript
type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type Subscriber = (msg: WsMessage) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private subscribers = new Set<Subscriber>();
  private reconnectAttempts = 0;
  private maxAttempts = 5;
  private intentionallyClosed = false;
  status: WsStatus = 'disconnected';
  onStatusChange?: (status: WsStatus) => void;

  connect(url: string): void {
    // 1. Set status = 'connecting'
    // 2. Create WebSocket
    // 3. onopen: set status = 'connected', reset attempts
    // 4. onmessage: parse JSON, call all subscribers
    // 5. onclose: if !intentionallyClosed, schedule reconnect
    // 6. onerror: set status = 'error'
  }

  subscribe(fn: Subscriber): () => void {
    // Add to set, return unsubscribe function
  }

  close(): void {
    // Set intentionallyClosed = true, close ws
  }

  private reconnect(): void {
    // Exponential backoff: 1s * 2^attempt, max 5 attempts
  }
}

let instance: WsClient | null = null;
export function getWsClient(): WsClient {
  if (!instance) { instance = new WsClient(); instance.connect('/ws'); }
  return instance;
}
```

---

### `gui/src/stores/test-store.ts`

```typescript
export const useTestStore = create<TestStore>((set, get) => ({
  tests: [],
  selectedId: null,
  loading: false,
  error: null,
  fetchTests: async () => {
    // 1. set({ loading: true, error: null })
    // 2. try: api.listTests(), set({ tests, loading: false })
    // 3. catch: set({ error, loading: false })
  },
  selectTest: (id) => set({ selectedId: id }),
  getSelectedTest: () => get().tests.find(t => t.id === get().selectedId) ?? null,
}));
```

---

### `gui/src/stores/run-store.ts`

```typescript
export const useRunStore = create<RunStore>((set, get) => ({
  activeRun: null,
  stepStatuses: new Map(),
  logs: [],
  startRun: async (testId) => {
    // 1. set({ activeRun: { testId, runId: '' }, stepStatuses: new Map(), logs: [] })
    // 2. try: api.runTest(testId)
    // 3. set({ activeRun: null })  — HTTP response means run complete
    // 4. Refresh test list
  },
  handleWsMessage: (msg) => {
    // 1. If run:start: update activeRun with runId
    // 2. If run:step: update stepStatuses map, add to logs
    // 3. If run:complete: set activeRun = null
  },
  clearRun: () => set({ activeRun: null, stepStatuses: new Map(), logs: [] }),
}));
```

---

### `gui/src/stores/ui-store.ts`

```typescript
export const useUIStore = create<UIStore>((set) => ({
  chromeConnected: false,
  wsStatus: 'disconnected',
  searchQuery: '',
  checkChromeStatus: async () => {
    // try: api.chromeStatus(), set({ chromeConnected })
    // catch: set({ chromeConnected: false })
  },
  setWsStatus: (status) => set({ wsStatus: status }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
```

---

### `gui/src/App.tsx` — Router + Init

```typescript
function App() {
  useEffect(() => {
    // 1. Init WebSocket client
    // 2. Subscribe runStore.handleWsMessage
    // 3. Fetch tests, check chrome status
    // 4. Start 30s polling interval for chrome status
    // 5. Cleanup on unmount
  }, []);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tests/:id" element={<TestDetailPage />} />
          <Route path="/tests/:id/history/:runId" element={<TestDetailPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
```

---

### Layout Components

**`Layout.tsx`:** Flex container — AppBar on top, Sidebar (w-64) on left, main content (flex-1) on right.

**`AppBar.tsx`:** "Director" title, Chrome status dot (green if `uiStore.chromeConnected`, red otherwise). Uses `useUIStore`.

**`Sidebar.tsx`:** Search `<Input>` wired to `uiStore.setSearchQuery`. Renders children (TestList will be slotted in by Item 8).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: gui-scaffold
    files: [gui/package.json, gui/vite.config.ts, gui/tsconfig.json, gui/index.html, gui/src/index.css]
    tests: []
    description: Create Vite React TS project, install deps (react, zustand, react-router-dom, tailwindcss, shadcn), configure proxy
    parallel: true
    depends-on: []

  - id: gui-types
    files: [gui/src/lib/types.ts]
    tests: []
    description: Define mirrored server types (SavedTest, TestDef, StepDef, TestResult, TestRun, WsMessage)
    parallel: true
    depends-on: []

  - id: gui-api-client
    files: [gui/src/lib/api.ts]
    tests: []
    description: Implement typed fetch wrapper with ApiError class and all API methods
    parallel: false
    depends-on: [gui-types]

  - id: gui-ws-client
    files: [gui/src/lib/ws.ts]
    tests: []
    description: Implement singleton WebSocket client with auto-reconnect, subscribe/unsubscribe API
    parallel: false
    depends-on: [gui-types]

  - id: gui-stores
    files: [gui/src/stores/test-store.ts, gui/src/stores/run-store.ts, gui/src/stores/ui-store.ts]
    tests: []
    description: Create Zustand stores for test data, run state, and UI state
    parallel: false
    depends-on: [gui-api-client, gui-ws-client]

  - id: gui-layout
    files: [gui/src/components/Layout.tsx, gui/src/components/AppBar.tsx, gui/src/components/Sidebar.tsx]
    tests: []
    description: Create base layout shell with AppBar (Chrome status), Sidebar (search), main content area
    parallel: false
    depends-on: [gui-stores, gui-scaffold]

  - id: gui-app
    files: [gui/src/main.tsx, gui/src/App.tsx]
    tests: []
    description: Wire up App with BrowserRouter, routes, initialization (WS connect, fetch tests, chrome polling)
    parallel: false
    depends-on: [gui-layout]
```

### Execution Waves

**Wave 1 (no dependencies):**
- gui-scaffold
- gui-types

**Wave 2 (depends on Wave 1):**
- gui-api-client
- gui-ws-client

**Wave 3 (depends on Wave 2):**
- gui-stores

**Wave 4 (depends on Wave 3):**
- gui-layout

**Wave 5 (depends on Wave 4):**
- gui-app

### Summary
- **Total tasks:** 7
- **Total waves:** 5
- **Max parallelism:** 2 (Waves 1, 2)
- **Cross-item dependency:** Requires Item 5 (API server running) for dev proxy to work