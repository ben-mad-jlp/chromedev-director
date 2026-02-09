# Blueprint: Item 9 (6c) - Run Execution & Live Progress

## 1. Structure Summary

### Files

- `gui/src/features/runs/RunButton.tsx` — Run button with 4 states (idle, running, busy, chrome-offline)
- `gui/src/features/runs/LogPanel.tsx` — Collapsible console/network log panel
- `gui/src/features/runs/LogEntry.tsx` — Individual log entry display component

### Component Interactions

- `RunButton` reads from `useRunStore` (activeRun) and `useUIStore` (chromeConnected)
- `RunButton.onClick` calls `runStore.startRun(testId)`
- `StepCard` (from Item 8) receives `status` prop from `runStore.stepStatuses`
- `LogPanel` reads from `runStore.logs` array
- WebSocket messages flow: ws.ts → runStore.handleWsMessage → stepStatuses + logs update → components re-render
- `TestDetail` (from Item 8) wires RunButton into header and LogPanel below tabs

---

## 2. Function Blueprints

### `RunButton.tsx`

**Props:** `{ testId: string }`

**Pseudocode:**
1. Get `activeRun` from `useRunStore`, `chromeConnected` from `useUIStore`
2. Determine button state:
   - If `!chromeConnected`: disabled, "Chrome Disconnected" (gray), tooltip
   - If `activeRun && activeRun.testId === testId`: disabled, "Running..." + spinner
   - If `activeRun && activeRun.testId !== testId`: disabled, "Test Running" (muted)
   - Otherwise: enabled, "Run Test" (primary)
3. onClick: call `useRunStore.getState().startRun(testId)`

**Stub:**
```typescript
export function RunButton({ testId }: { testId: string }) {
  // TODO: Read stores
  // TODO: Determine state
  // TODO: Render button with appropriate label/style/disabled
}
```

---

### `LogPanel.tsx`

**Props:** `{ testId: string }`

**Pseudocode:**
1. Get `logs`, `activeRun` from `useRunStore`
2. Render shadcn `Collapsible`:
   - Trigger: "Console & Network ({logs.length} entries)"
   - Auto-expand when `activeRun` becomes non-null
3. Content: `ScrollArea` with mapped `LogEntry` components
4. Auto-scroll to bottom on new entries (unless user scrolled up)
5. Implement scroll detection:
   - Track `isAtBottom` via scroll event listener
   - On new logs: if `isAtBottom`, scrollTo bottom
   - If user scrolls up, pause auto-scroll

**Auto-scroll implementation:**
```typescript
const scrollRef = useRef<HTMLDivElement>(null);
const isAtBottom = useRef(true);

useEffect(() => {
  if (isAtBottom.current && scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [logs.length]);

function handleScroll(e: React.UIEvent) {
  const el = e.currentTarget;
  isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
}
```

---

### `LogEntry.tsx`

**Props:** `{ entry: LogEntry }`

**Pseudocode:**
1. Switch on `entry.type`:
   - `'console'`: colored by level (default, yellow for warning, red for error). Monospace.
   - `'network'`: "GET /api/tests 200 142ms" format. Green 2xx, yellow 3xx, red 4xx/5xx.
   - `'step'`: "Step 3: Fill #division — passed (142ms)" as divider with muted bg.

---

### Updates to `run-store.ts` (from Item 7)

The `handleWsMessage` function needs detailed implementation:

```typescript
handleWsMessage: (msg: WsMessage) => {
  const state = get();
  switch (msg.type) {
    case 'run:start':
      set({
        activeRun: { testId: msg.testId, runId: msg.runId },
        stepStatuses: new Map(),
        logs: [],
      });
      break;
    case 'run:step':
      const newStatuses = new Map(state.stepStatuses);
      newStatuses.set(msg.stepIndex, msg.status);
      const newLogs = [...state.logs, {
        type: 'step' as const,
        stepIndex: msg.stepIndex,
        label: msg.stepLabel,
        status: msg.status,
        timestamp: Date.now(),
      }];
      set({ stepStatuses: newStatuses, logs: newLogs });
      break;
    case 'run:complete':
      set({ activeRun: null });
      useTestStore.getState().fetchTests(); // refresh pass/fail icons
      break;
  }
},
```

---

### Updates to `TestDetail.tsx` (from Item 8)

Wire in RunButton and LogPanel:
- Add `<RunButton testId={id} />` in header area
- Add `<LogPanel testId={id} />` below the tabs content
- Pass `runStore.stepStatuses` to StepsTab → StepCard as status prop

---

### Chrome Status in `AppBar.tsx` (from Item 7)

Already designed in Item 7. The AppBar reads `uiStore.chromeConnected` and shows a green/red dot.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: gui-run-button
    files: [gui/src/features/runs/RunButton.tsx]
    tests: []
    description: Create RunButton component with 4 states (idle, running, busy, chrome-offline)
    parallel: true
    depends-on: []

  - id: gui-log-entry
    files: [gui/src/features/runs/LogEntry.tsx]
    tests: []
    description: Create LogEntry component with console/network/step display formatting
    parallel: true
    depends-on: []

  - id: gui-log-panel
    files: [gui/src/features/runs/LogPanel.tsx]
    tests: []
    description: Create LogPanel with collapsible layout, auto-scroll, auto-expand on run start
    parallel: false
    depends-on: [gui-log-entry]

  - id: gui-run-store-impl
    files: [gui/src/stores/run-store.ts]
    tests: []
    description: Implement handleWsMessage with step status tracking and log accumulation
    parallel: true
    depends-on: []

  - id: gui-wire-run-ui
    files: [gui/src/features/tests/TestDetail.tsx, gui/src/features/tests/StepsTab.tsx]
    tests: []
    description: Wire RunButton into TestDetail header, LogPanel below tabs, pass stepStatuses to StepCard
    parallel: false
    depends-on: [gui-run-button, gui-log-panel, gui-run-store-impl]
```

### Execution Waves

**Wave 1 (no dependencies):**
- gui-run-button
- gui-log-entry
- gui-run-store-impl

**Wave 2 (depends on Wave 1):**
- gui-log-panel

**Wave 3 (depends on Wave 2):**
- gui-wire-run-ui

### Summary
- **Total tasks:** 5
- **Total waves:** 3
- **Max parallelism:** 3 (Wave 1)
- **Cross-item dependency:** Requires Item 7 (stores, ws client), Item 8 (TestDetail, StepCard)