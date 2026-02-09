# Blueprint: Item 2 - run_test StepDef Variant

## 1. Structure Summary

### Files

- `src/types.ts` — Add `run_test` variant to `StepDef` union
- `src/step-runner.ts` — Add `run_test` handler in `executeStep()`, cycle detection in runner

### Type Definitions

```typescript
// New StepDef variant (added to existing union)
| { label?: string; run_test: string }

// Cycle detection context (internal to runner)
type RunContext = {
  visitedTests: Set<string>;  // test IDs already in the call stack
};
```

### Component Interactions

- `step-runner.ts` calls `storage.getTest()` to resolve nested test by ID
- `executeStep()` dispatches to new `runTestStep()` handler
- `runTestStep()` executes nested test's `steps` array inline (ignores url/before/after/env)
- `$vars` map is shared across nested boundaries (passed by reference)
- Cycle detection uses a `visitedTests` Set passed through the call chain

---

## 2. Function Blueprints

### Update: `StepDef` type union (types.ts)

Add one new variant to the union:
```typescript
| { label?: string; run_test: string }
```

No other type changes needed. The `run_test` field is the test ID (slug) referencing a saved test.

---

### Update: `executeStep()` — add run_test dispatch (step-runner.ts)

**Current:** `executeStep()` handles eval, fill, click, assert, wait, wait_for, console_check, network_check, mock_network. Falls through to "Unknown step type" error.

**Change:** Add `run_test` check before the fallthrough:

```typescript
if ("run_test" in step) {
  return await runTestStep(step, client, vars, projectRoot, context);
}
```

**Note:** `executeStep()` needs two new parameters: `projectRoot` (to load saved tests) and `context` (for cycle detection). These propagate from `runTest()` / `runSteps()` down through the step loop.

---

### New: `async function runTestStep(step, client, vars, projectRoot, context): Promise<StepResult>`

**Signature:**
```typescript
async function runTestStep(
  step: { label?: string; run_test: string },
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  projectRoot: string,
  context: RunContext
): Promise<{ success: boolean; error?: string; value?: unknown }>
```

**Pseudocode:**
1. Extract `testId` from `step.run_test`
2. Check `context.visitedTests` for `testId` — if present, throw cycle error
3. Add `testId` to `context.visitedTests`
4. Load saved test via `storage.getTest(projectRoot, testId)`
5. Extract only `steps` from the loaded test (ignore url, before, after, env)
6. For each step in the nested test's steps:
   a. Interpolate step with parent's env and shared vars
   b. Call `executeStep()` recursively (passing same vars, projectRoot, context)
   c. Handle `as` variable storage from eval steps
   d. If step fails, return failure with nested context in error message
7. Remove `testId` from `context.visitedTests` (allow same test in sibling branches)
8. Return success

**Error Handling:**
- `NOT_FOUND`: Nested test ID doesn't exist — return failure with clear error
- `CYCLE_DETECTED`: Test references itself (directly or indirectly) — return failure
- Step failures within nested test: include nested test name + step index in error

**Edge Cases:**
- Nested test has zero steps (success, nothing to do)
- Nested test itself contains `run_test` steps (recursive — handled by cycle detection)
- Deeply nested tests (A → B → C → D) — no depth limit, cycle detection prevents infinite recursion
- `$vars` set by nested steps are visible to subsequent parent steps (shared reference)
- Nested test not found (deleted after parent was saved)

**Test Strategy:**
- Test simple nesting (A calls B, B has 3 steps)
- Test vars flowing through nested boundary
- Test circular reference detection (A → B → A)
- Test nested test not found
- Test nested test with zero steps
- Test multi-level nesting (A → B → C)
- Test same test nested in two sibling branches (not a cycle)

**Stub:**
```typescript
async function runTestStep(
  step: { label?: string; run_test: string },
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  projectRoot: string,
  context: RunContext
): Promise<{ success: boolean; error?: string; value?: unknown }> {
  // TODO: Step 1 - Extract testId
  // TODO: Step 2 - Check for cycle
  // TODO: Step 3 - Add to visited set
  // TODO: Step 4 - Load saved test from storage
  // TODO: Step 5 - Execute nested steps inline
  // TODO: Step 6 - Remove from visited set
  // TODO: Step 7 - Return result
  throw new Error('Not implemented');
}
```

---

### Update: `runTest()` and `runSteps()` — threading context

Both `runTest()` and `runSteps()` need to:
1. Accept an optional `projectRoot` parameter (needed for `storage.getTest()`)
2. Create a `RunContext` with empty `visitedTests` set
3. Pass `projectRoot` and `context` through to `executeStep()`

**Backward compatibility:** `projectRoot` defaults to `process.cwd()`. Existing callers are unaffected.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: run-test-type
    files: [src/types.ts]
    tests: []
    description: Add { run_test: string } variant to StepDef union type
    parallel: true
    depends-on: []

  - id: run-test-handler
    files: [src/step-runner.ts]
    tests: [src/step-runner.test.ts]
    description: Implement runTestStep() handler with cycle detection, update executeStep() dispatch, thread projectRoot and RunContext through runner functions
    parallel: false
    depends-on: [run-test-type]

  - id: run-test-tests
    files: [src/step-runner.test.ts]
    tests: [src/step-runner.test.ts]
    description: Unit tests for run_test nesting, cycle detection, vars flow, error handling
    parallel: false
    depends-on: [run-test-handler]
```

### Execution Waves

**Wave 1 (no dependencies):**
- run-test-type

**Wave 2 (depends on Wave 1):**
- run-test-handler

**Wave 3 (depends on Wave 2):**
- run-test-tests

### Summary
- **Total tasks:** 3
- **Total waves:** 3
- **Cross-item dependency:** Requires Item 1 (storage layer) for `storage.getTest()`