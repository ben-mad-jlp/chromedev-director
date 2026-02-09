# Blueprint: Item 3 - Runner Event Emitter

## 1. Structure Summary

### Files

- `src/types.ts` — Add `RunEvent` type and `OnEvent` callback type
- `src/step-runner.ts` — Add optional `onEvent` callback to `runTest()` and `runSteps()`, emit events during step execution

### Type Definitions

```typescript
// Event types emitted during test execution
type RunEvent =
  | { type: 'step:start'; stepIndex: number; label: string; nested: string | null }
  | { type: 'step:pass'; stepIndex: number; label: string; nested: string | null; duration_ms: number }
  | { type: 'step:fail'; stepIndex: number; label: string; nested: string | null; duration_ms: number; error: string }
  | { type: 'console'; level: string; text: string }
  | { type: 'network'; method: string; url: string; status: number; duration_ms: number };

// Callback signature
type OnEvent = (event: RunEvent) => void;
```

### Component Interactions

- `runTest()` accepts optional `onEvent` callback (3rd parameter after port)
- `runSteps()` accepts optional `onEvent` callback
- Step execution loop emits `step:start` before and `step:pass`/`step:fail` after each step
- Nested test steps emit events with `nested` field set to the nested test ID
- MCP server calls without callback (existing behavior unchanged)
- API server passes callback that forwards events over WebSocket

---

## 2. Function Blueprints

### Update: `runTest(testDef, port, onEvent?)` signature

**Current:** `runTest(testDef: TestDef, port: number = 9222): Promise<TestResult>`

**New:** `runTest(testDef: TestDef, port: number = 9222, onEvent?: OnEvent): Promise<TestResult>`

**Changes:**
1. Accept optional `onEvent` parameter
2. Pass `onEvent` to `runTestInner()`
3. No other changes — backward compatible

---

### Update: `runTestInner()` — emit events in step loop

**Current:** Loops through steps, calls `executeStep()`, returns result.

**Changes to step loop pseudocode:**
1. Before `executeStep()`: emit `{ type: 'step:start', stepIndex: i, label, nested: null }`
2. Record step start time
3. Call `executeStep()`
4. On success: emit `{ type: 'step:pass', stepIndex: i, label, nested: null, duration_ms }`
5. On failure: emit `{ type: 'step:fail', stepIndex: i, label, nested: null, duration_ms, error }`

**Same changes for before hooks** (with negative step indices).

**Guard:** Always check `if (onEvent)` before calling — callback is optional.

---

### Update: `runTestStep()` — emit nested events

When executing nested test steps (from Item 2), the `nested` field carries the nested test ID:

```typescript
// Inside runTestStep(), for each nested step:
onEvent?.({ type: 'step:start', stepIndex: nestedIdx, label, nested: testId });
// ... execute step ...
onEvent?.({ type: 'step:pass', stepIndex: nestedIdx, label, nested: testId, duration_ms });
```

**Threading:** `onEvent` is passed from `runTest()` → `runTestInner()` → step loop → `runTestStep()` → nested step loop.

---

### Update: `runSteps()` — same event emission pattern

Same changes as `runTestInner()` — emit events before/after each step. `runSteps()` accepts optional `onEvent` parameter.

---

### Console & Network events

**Console events:** The CDP client already captures console messages. To emit them in real-time, the CDP client's `Console.messageAdded` listener needs to call `onEvent`:

```typescript
// In cdp-client.ts or passed as callback from runner:
onEvent?.({ type: 'console', level: msg.level, text: msg.text });
```

**Network events:** Similarly, `Network.responseReceived` listener emits:
```typescript
onEvent?.({ type: 'network', method, url, status, duration_ms });
```

**Approach:** Pass `onEvent` to CDPClient (or wrap it). The CDP client calls back for each console/network event as they happen.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: event-types
    files: [src/types.ts]
    tests: []
    description: Define RunEvent union type and OnEvent callback type
    parallel: true
    depends-on: []

  - id: event-runner
    files: [src/step-runner.ts]
    tests: [src/step-runner.test.ts]
    description: Add onEvent parameter to runTest/runSteps, emit step:start/pass/fail events in step loops, thread through nested execution
    parallel: false
    depends-on: [event-types]

  - id: event-cdp
    files: [src/cdp-client.ts]
    tests: [src/cdp-client.test.ts]
    description: Add onEvent callback support to CDPClient for real-time console and network event forwarding
    parallel: false
    depends-on: [event-types]

  - id: event-tests
    files: [src/step-runner.test.ts]
    tests: [src/step-runner.test.ts]
    description: Unit tests verifying events are emitted for each step, nested events include test ID, console/network events forwarded
    parallel: false
    depends-on: [event-runner, event-cdp]
```

### Execution Waves

**Wave 1 (no dependencies):**
- event-types

**Wave 2 (depends on Wave 1):**
- event-runner
- event-cdp

**Wave 3 (depends on Wave 2):**
- event-tests

### Summary
- **Total tasks:** 4
- **Total waves:** 3
- **Max parallelism:** 2 (Wave 2)
- **Cross-item dependency:** Integrates with Item 2 (run_test handler emits nested events)