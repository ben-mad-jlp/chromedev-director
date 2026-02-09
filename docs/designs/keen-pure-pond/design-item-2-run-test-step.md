# run_test StepDef Variant — Design Doc

## Problem/Goal
Tests cannot compose — there's no way for one test to invoke another as a step. A "checkout" test can't reuse a "login" sub-test. This leads to duplication and fragile long tests.

## Decisions
- **Reference mode**: Both by saved ID and inline TestDef
- **Variable passing**: Inherit parent vars + merge sub-test vars back into parent
- **Failure propagation**: Parent fails immediately on sub-test failure (error includes sub-test details)
- **CDP connection**: Shared — sub-test reuses parent's CDP client
- **Navigation**: Always navigate to sub-test's URL
- **Nesting depth**: Limited to 3 levels

## Approach

**Architecture**: Reuse `runSteps()` internally. The `run_test` step handler resolves the TestDef, then delegates to the existing step execution engine with the parent's CDP client and vars.

### Section 1: StepDef Type Addition

New variant added to the `StepDef` union in `types.ts`:

```ts
/** Run a saved or inline test as a sub-test. Shares CDP connection and vars with parent. */
| {
    label?: string;
    run_test: {
      id?: string;      // Saved test slug (looked up via Storage)
      def?: TestDef;     // Inline test definition
    };
  }
```

Validation rules:
- Exactly one of `id` or `def` must be provided (not both, not neither)
- If `id` is provided, requires a `Storage` instance to resolve it
- If `def` is provided, it must be a valid `TestDef` (has `url` and `steps`)

The `interpolateStep` function in `env.ts` gains a new case:
```ts
if ("run_test" in step) {
  return {
    ...(interpolatedLabel && { label: interpolatedLabel }),
    run_test: {
      ...(step.run_test.id && { id: interpolate(step.run_test.id, env, vars) }),
      ...(step.run_test.def && { def: step.run_test.def }), // def is not string-interpolated
    },
  };
}
```

Only the `id` field is interpolated (supports `$vars.testName`). The inline `def` is passed through as-is — its individual steps get interpolated when they execute.

### Section 2: Step Handler & Execution Flow

New `runTestStep()` function in `step-runner.ts`:

```ts
async function runTestStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  depth: number,
  storage?: Storage
): Promise<{ success: boolean; error?: string }>
```

**Execution flow:**
1. **Validate**: Exactly one of `id` or `def` must be set
2. **Resolve TestDef**: If `id`, call `storage.getTest(id)` to get the saved TestDef. If `def`, use it directly
3. **Check depth**: If `depth >= 3`, return `{ success: false, error: "Max nesting depth (3) exceeded" }`
4. **Navigate**: Call `client.navigate(resolvedDef.url)` to go to the sub-test's URL
5. **Run before hooks**: Execute `before` steps with the shared vars
6. **Run steps**: Call a new internal `executeSteps()` that accepts a `depth` parameter and passes it through to any nested `run_test` steps as `depth + 1`
7. **Run after hooks**: Execute `after` steps (always, even on failure)
8. **Merge vars**: Any new keys added to `vars` by the sub-test are already visible to the parent (since it's the same object reference)
9. **Return result**: Map the sub-test's `TestResult` to `{ success, error }`

**Changes to `executeStep()`:**
- Gains `depth` and `storage` parameters (default `depth=0`, `storage=undefined`)
- When dispatching to `runTestStep`, passes `depth` and `storage` through
- All other step handlers are unchanged (they ignore the extra params)

**Variable sharing works naturally** because `vars` is passed by reference. The sub-test's steps modify the same object, so new vars are visible to the parent after the sub-test completes.

### Section 3: Error Reporting & Success Criteria

**Error messages include sub-test context:**

When a sub-test fails, the parent's error message nests the details:
```
Sub-test "login-flow" failed at step 2 (Click login button): Element not found: button[type='submit']
```

Format: `Sub-test "{id or 'inline'}" failed at step {N} ({label}): {original error}`

This gives the caller enough context to debug without re-running.

**Edge cases:**
- `run_test` with `id` but no `Storage` instance: return `{ success: false, error: "Storage required to resolve test ID 'login-flow'" }`
- `run_test` with `id` that doesn't exist: return `{ success: false, error: "Test not found: 'login-flow'" }`
- `run_test` with both `id` and `def`: return `{ success: false, error: "Provide either 'id' or 'def', not both" }`
- `run_test` with neither: return `{ success: false, error: "run_test requires 'id' or 'def'" }`

## Success Criteria
- New `run_test` StepDef variant added to the union type
- Sub-tests can be referenced by saved ID or inline TestDef
- Sub-test shares parent's CDP connection and vars (pass by reference)
- Sub-test always navigates to its own URL
- Parent fails immediately when sub-test fails, with nested error details
- Nesting depth limited to 3 levels with clear error on exceeded
- `interpolateStep` handles the new variant (interpolates `id` only)
- Existing 106 unit tests continue to pass
- New tests cover: by-id resolution, inline def, var inheritance, var merge-back, depth limit, error cases
