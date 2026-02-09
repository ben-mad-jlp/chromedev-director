# Blueprint: Item 10 (6d) - Results & History

## 1. Structure Summary

### Files

- `gui/src/features/history/ResultsTab.tsx` — Latest run result display (reusable for specific runId)
- `gui/src/features/history/HistoryTab.tsx` — Chronological list of past runs
- `gui/src/features/history/HistoryItem.tsx` — Individual history row with summary
- `gui/src/features/history/ResultStepCard.tsx` — Step card with result overlay (pass/fail + duration)
- `gui/src/lib/utils.ts` — Shared utilities (relative time formatting)

### Component Interactions

- `ResultsTab` fetches latest result or specific runId result via API
- `HistoryTab` fetches all results for a test, renders as list of `HistoryItem`
- `HistoryItem` shows status, timestamp, duration, step summary bar
- Clicking a `HistoryItem` navigates to `/tests/:id/history/:runId`
- `ResultsTab` reuses `StepCard` from Item 8 with result overlay data
- Both tabs refresh after `run:complete` WebSocket event
- `TestDetail` (from Item 8) renders these as tab content

---

## 2. Function Blueprints

### `ResultsTab.tsx`

**Props:** `{ testId: string; runId?: string }`

**Pseudocode:**
1. If `runId` provided: fetch via `api.getResult(runId)`
2. If no `runId`: fetch via `api.listResults(testId)`, take first (most recent)
3. If no results: show "No runs yet. Click Run to execute this test."
4. Render summary bar:
   - Pass/fail Badge (green/red)
   - Total duration (e.g., "2.4s")
   - Timestamp (relative: "2 minutes ago")
5. Render step results list:
   - Map `result.steps` to `ResultStepCard` with pass/fail + duration
   - Failed steps: expanded error message below in red-tinted Card
6. Staleness warning banner:
   - If `result.nestedVersions` exists, check each nested test's current `updatedAt`
   - If mismatch: amber banner "Nested test '{name}' modified since this run"
7. Collapsed console/network summary section from result data

**Auto-refresh:** Subscribe to `run:complete` WebSocket event. If `msg.testId === testId`, refetch.

---

### `HistoryTab.tsx`

**Props:** `{ testId: string }`

**Pseudocode:**
1. Fetch via `api.listResults(testId)` on mount
2. If empty: show "No run history yet."
3. Render list of `HistoryItem` components (newest first)
4. Auto-refresh on `run:complete` WebSocket event

---

### `HistoryItem.tsx`

**Props:** `{ run: TestRun; testId: string }`

**Pseudocode:**
1. Render row with:
   - Status icon: ✓ (green) or ✗ (red)
   - Timestamp: relative ("3 hours ago") with full date tooltip
   - Duration: "2.4s"
   - Step summary: "5/5 passed" or "3/5 passed"
   - Mini progress bar: green/red segments proportional to pass/fail count
   - Staleness icon: ⚠ if nestedVersions mismatch
2. onClick: `navigate(`/tests/${testId}/history/${run.runId}`)`

**Step count extraction:**
```typescript
function getStepSummary(result: TestResult): { passed: number; total: number } {
  if (result.status === 'passed') {
    return { passed: result.steps_completed, total: result.steps_completed };
  }
  return { passed: result.failed_step, total: result.failed_step + 1 };
}
```

---

### `ResultStepCard.tsx`

**Props:** `{ step: StepDef; index: number; result: StepResult }`

Reuses `StepCard` from Item 8 but adds result overlay:
- Passed: green left border + ✓ + duration on right
- Failed: red left border + ✗ + expanded error card below
- This is essentially `StepCard` with a `status` and `duration` prop — may just extend `StepCard` props rather than creating a separate component

---

### `gui/src/lib/utils.ts` — Relative Time

```typescript
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fullTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
```

---

### Wiring into TestDetail tabs

`TestDetail.tsx` (Item 8) renders tabs. Results and History tabs:
```tsx
<Tabs defaultValue="steps">
  <TabsList>
    <TabsTrigger value="steps">Steps</TabsTrigger>
    <TabsTrigger value="results">Results</TabsTrigger>
    <TabsTrigger value="history">History</TabsTrigger>
  </TabsList>
  <TabsContent value="steps"><StepsTab ... /></TabsContent>
  <TabsContent value="results"><ResultsTab testId={id} /></TabsContent>
  <TabsContent value="history"><HistoryTab testId={id} /></TabsContent>
</Tabs>
```

When URL has `/tests/:id/history/:runId`, auto-select Results tab with specific runId.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: gui-utils
    files: [gui/src/lib/utils.ts]
    tests: []
    description: Create utility functions for relative time, duration formatting, full timestamp
    parallel: true
    depends-on: []

  - id: gui-result-step-card
    files: [gui/src/features/history/ResultStepCard.tsx]
    tests: []
    description: Create or extend StepCard with result overlay (pass/fail status, duration, error expansion)
    parallel: true
    depends-on: []

  - id: gui-results-tab
    files: [gui/src/features/history/ResultsTab.tsx]
    tests: []
    description: Create ResultsTab with summary bar, step results list, staleness warning, auto-refresh
    parallel: false
    depends-on: [gui-utils, gui-result-step-card]

  - id: gui-history-item
    files: [gui/src/features/history/HistoryItem.tsx]
    tests: []
    description: Create HistoryItem row with status icon, relative timestamp, duration, step summary bar, staleness indicator
    parallel: false
    depends-on: [gui-utils]

  - id: gui-history-tab
    files: [gui/src/features/history/HistoryTab.tsx]
    tests: []
    description: Create HistoryTab with result list, auto-refresh on run:complete
    parallel: false
    depends-on: [gui-history-item]

  - id: gui-wire-tabs
    files: [gui/src/features/tests/TestDetail.tsx]
    tests: []
    description: Wire ResultsTab and HistoryTab into TestDetail tabs, handle /history/:runId route
    parallel: false
    depends-on: [gui-results-tab, gui-history-tab]
```

### Execution Waves

**Wave 1 (no dependencies):**
- gui-utils
- gui-result-step-card

**Wave 2 (depends on Wave 1):**
- gui-results-tab
- gui-history-item

**Wave 3 (depends on Wave 2):**
- gui-history-tab

**Wave 4 (depends on Wave 3):**
- gui-wire-tabs

### Summary
- **Total tasks:** 6
- **Total waves:** 4
- **Max parallelism:** 2 (Waves 1, 2)
- **Cross-item dependency:** Requires Item 7 (stores, api), Item 8 (TestDetail, StepCard)