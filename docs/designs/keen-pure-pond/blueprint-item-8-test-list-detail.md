# Blueprint: Item 8 (6b) - Test List & Detail View

## 1. Structure Summary

### Files

- `gui/src/features/tests/TestList.tsx` — Sidebar test list with search filtering
- `gui/src/features/tests/TestListItem.tsx` — Individual test item in sidebar
- `gui/src/features/tests/TestDetail.tsx` — Main content area for selected test
- `gui/src/features/tests/StepsTab.tsx` — Steps tab content
- `gui/src/features/tests/StepCard.tsx` — Individual step card with type badge
- `gui/src/features/tests/NestedTestBlock.tsx` — Collapsible nested test display
- `gui/src/features/tests/HomePage.tsx` — Home page (empty state or redirect)

### Component Interactions

- `TestList` reads from `useTestStore` (tests, searchQuery filter)
- `TestListItem` shows test name, pass/fail icon, step count; navigates on click
- `TestDetail` fetches individual test via `api.getTest(id)`, renders tabs
- `StepsTab` maps test steps to `StepCard` components
- `StepCard` handles all step types with colored badges
- `NestedTestBlock` recursively fetches and renders nested test steps
- `Sidebar.tsx` (from Item 7) renders `<TestList />` as child

---

## 2. Function Blueprints

### `TestList.tsx`

**Props:** None (reads from stores)

**Pseudocode:**
1. Get `tests` from `useTestStore`, `searchQuery` from `useUIStore`
2. Filter tests by name containing searchQuery (case-insensitive)
3. Render shadcn `ScrollArea` with filtered list of `TestListItem`
4. If no tests: show "No tests saved yet" message
5. If no search results: show "No tests match" message

---

### `TestListItem.tsx`

**Props:** `{ test: SavedTest; isSelected: boolean }`

**Pseudocode:**
1. Determine status icon: ✓ (green) / ✗ (red) / — (gray) from latest result
2. Render: name (truncated), status icon, step count Badge
3. onClick: `navigate(`/tests/${test.id}`)`
4. Highlight if isSelected (bg-accent)

---

### `TestDetail.tsx`

**Props:** None (reads id from `useParams()`)

**Pseudocode:**
1. Get `id` from route params
2. Fetch test via `api.getTest(id)` on mount / id change
3. Store in local state (loading, error, test)
4. Render header: test name (h1), URL (muted), Run button placeholder
5. Render shadcn `Tabs`: Steps | Results | History
6. Pass test to `StepsTab`

---

### `StepsTab.tsx`

**Props:** `{ test: TestDef; testId: string }`

**Pseudocode:**
1. Map `test.steps` to `StepCard` components with index
2. For `run_test` steps: render `NestedTestBlock` instead
3. Show "before" hooks section if present (collapsible, muted)

---

### `StepCard.tsx`

**Props:** `{ step: StepDef; index: number; status?: 'pending' | 'running' | 'passed' | 'failed' }`

**Pseudocode:**
1. Determine step type from discriminated union keys
2. Render type badge (colored by type):
   - `fill` → blue, `click` → green, `assert` → purple
   - `evaluate` → orange, `wait_for` → yellow, `navigate` → gray
   - `wait` → gray, `console_check` → teal, `network_check` → teal
   - `mock_network` → indigo, `run_test` → amber
3. Render label (explicit or auto-generated):
   - `fill` → "Fill {selector}", `click` → "Click {selector}"
   - `assert` → "Assert {expression...}", etc.
4. Show key details inline (selector, value — truncated)
5. Step index number on left
6. Status overlay if provided (colored left border + icon)

**Auto-label helper:**
```typescript
function getStepLabel(step: StepDef): string {
  if (step.label) return step.label;
  if ('fill' in step) return `Fill ${step.fill.selector}`;
  if ('click' in step) return `Click ${step.click.selector}`;
  if ('assert' in step) return `Assert ${step.assert.slice(0, 40)}...`;
  if ('eval' in step) return step.as ? `Eval → $vars.${step.as}` : 'Evaluate';
  if ('wait' in step) return `Wait ${step.wait}ms`;
  if ('wait_for' in step) return `Wait for ${step.wait_for.selector}`;
  if ('run_test' in step) return `Run ${step.run_test}`;
  if ('console_check' in step) return `Console check`;
  if ('network_check' in step) return `Network check`;
  if ('mock_network' in step) return `Mock ${step.mock_network.match}`;
  return 'Unknown step';
}
```

---

### `NestedTestBlock.tsx`

**Props:** `{ testId: string; depth: number }`

**Pseudocode:**
1. If depth > 5, show "Max nesting depth reached" warning
2. Fetch nested test via `api.getTest(testId)` on mount
3. Render shadcn `Collapsible`:
   - Trigger: amber badge + nested test name + step count
   - Content: nested test's steps as `StepCard` list (indented with left border)
4. If nested test has its own `run_test` steps, render `NestedTestBlock` recursively (depth + 1)
5. Show staleness badge if applicable (compare timestamps)
6. Handle not-found: show "Test '{testId}' not found" error inline

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: gui-step-card
    files: [gui/src/features/tests/StepCard.tsx]
    tests: []
    description: Create StepCard component with type badges, auto-label generation, status overlay support
    parallel: true
    depends-on: []

  - id: gui-test-list
    files: [gui/src/features/tests/TestList.tsx, gui/src/features/tests/TestListItem.tsx]
    tests: []
    description: Create TestList with search filtering and TestListItem with pass/fail icons, wire into Sidebar
    parallel: true
    depends-on: []

  - id: gui-nested-block
    files: [gui/src/features/tests/NestedTestBlock.tsx]
    tests: []
    description: Create NestedTestBlock with recursive fetch, collapsible display, depth limit, staleness badge
    parallel: false
    depends-on: [gui-step-card]

  - id: gui-steps-tab
    files: [gui/src/features/tests/StepsTab.tsx]
    tests: []
    description: Create StepsTab mapping test steps to StepCard/NestedTestBlock components
    parallel: false
    depends-on: [gui-step-card, gui-nested-block]

  - id: gui-test-detail
    files: [gui/src/features/tests/TestDetail.tsx, gui/src/features/tests/HomePage.tsx]
    tests: []
    description: Create TestDetail page with header, tabs shell, and HomePage with empty state
    parallel: false
    depends-on: [gui-steps-tab, gui-test-list]
```

### Execution Waves

**Wave 1 (no dependencies):**
- gui-step-card
- gui-test-list

**Wave 2 (depends on Wave 1):**
- gui-nested-block

**Wave 3 (depends on Wave 2):**
- gui-steps-tab

**Wave 4 (depends on Wave 3):**
- gui-test-detail

### Summary
- **Total tasks:** 5
- **Total waves:** 4
- **Max parallelism:** 2 (Wave 1)
- **Cross-item dependency:** Requires Item 7 (gui scaffolding — Layout, Sidebar, stores, api client)