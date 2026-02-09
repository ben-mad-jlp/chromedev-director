# Runner Event Emitter — Design Doc

## Problem/Goal
The runner is a black box — callers get a final TestResult but have no visibility during execution. This blocks real-time progress for the GUI (Item 6), HTTP API streaming (Item 5), and MCP progress (Item 4).

## Decisions
- **Event types**: Full observability — test lifecycle, step lifecycle, before/after hooks, sub-test events, console messages, network responses
- **Pattern**: Node EventEmitter (built-in, zero deps, typed)
- **Emission point**: step-runner.ts only — single source of truth. CDP client forwards console/network to runner which re-emits.
- **Integration**: Optional `emitter` in options param — `runTest(testDef, port, { emitter? })`. No emitter = events silently dropped. Zero breaking changes.
- **Sub-test events**: Prefixed with context — events include `parentTestId` / `depth` field so consumers can distinguish nesting levels

## Approach

**Architecture**: Emit helper function. A no-op-safe `emit(emitter, event, data)` helper called at each lifecycle point in step-runner.ts.

### Section 1: Event Type Definitions

New types in `src/types.ts`:

```ts
import { EventEmitter } from "events";

/** All event names the runner can emit */
type RunnerEventMap = {
  "test:start":   { testId?: string; url: string; stepCount: number; depth: number };
  "test:end":     { testId?: string; status: "passed" | "failed"; duration_ms: number; depth: number };
  "step:start":   { index: number; label?: string; type: string; depth: number };
  "step:end":     { index: number; label?: string; success: boolean; duration_ms: number; error?: string; depth: number };
  "before:start": { index: number; depth: number };
  "before:end":   { index: number; success: boolean; depth: number };
  "after:start":  { index: number; depth: number };
  "after:end":    { index: number; success: boolean; depth: number };
  "console":      { type: string; text: string; depth: number };
  "network":      { url: string; status: number; depth: number };
};

type RunnerEventName = keyof RunnerEventMap;

/** Typed emitter interface */
interface RunnerEmitter extends EventEmitter {
  emit<K extends RunnerEventName>(event: K, data: RunnerEventMap[K]): boolean;
  on<K extends RunnerEventName>(event: K, listener: (data: RunnerEventMap[K]) => void): this;
}
```

Every event includes `depth: number` (0 = top-level, 1+ = sub-test). This is how consumers distinguish parent vs nested test events.

The `type` field in `step:start` is the step kind string: `"eval"`, `"fill"`, `"click"`, `"assert"`, `"wait"`, `"wait_for"`, `"console_check"`, `"network_check"`, `"mock_network"`, `"run_test"`.

### Section 2: Emit Helper & Runner Wiring

**Emit helper** in `step-runner.ts`:

```ts
function emit<K extends RunnerEventName>(
  emitter: RunnerEmitter | undefined,
  event: K,
  data: RunnerEventMap[K]
): void {
  if (emitter) emitter.emit(event, data);
}
```

No-ops when emitter is undefined. One-line call sites throughout the runner.

**Options param expansion:**

```ts
interface RunTestOptions {
  testId?: string;
  storage?: Storage;
  emitter?: RunnerEmitter;
  depth?: number;  // internal, not for external callers
}
```

`depth` defaults to 0. Only `runTestStep()` (Item 2) passes `depth + 1` when calling nested tests.

**Wiring points in step-runner.ts:**

| Location | Event |
|----------|-------|
| `runTestInner()` start | `test:start` |
| `runTestInner()` end (success or failure) | `test:end` |
| Before hook loop, before each hook | `before:start` |
| Before hook loop, after each hook | `before:end` |
| Main step loop, before `executeStep()` | `step:start` |
| Main step loop, after `executeStep()` | `step:end` |
| After hook loop, before each hook | `after:start` |
| After hook loop, after each hook | `after:end` |

**Console/network forwarding from CDP client:**
- `cdp-client.ts` already collects console messages and network responses via listeners
- Add an optional `onConsole` and `onNetwork` callback to `CDPClient` constructor (or a setter method)
- `runTestInner()` sets these callbacks to re-emit as `console` and `network` events via the emitter
- Callbacks are cleaned up in the `finally` block (same pattern as the timeout cleanup)

**Step type detection:**
A helper `getStepType(step: StepDef): string` returns the first matching key (`"eval"`, `"fill"`, etc.) for use in `step:start` events.

### Section 3: Success Criteria

## Success Criteria
- `RunnerEventMap` and `RunnerEmitter` types exported from `types.ts`
- `emit()` helper no-ops when emitter is undefined (zero overhead when not used)
- All 10 event types emitted at correct lifecycle points
- Every event includes `depth` field (0 for top-level, incremented for sub-tests)
- `step:start` includes step type and label; `step:end` includes success, duration, and error
- Console and network events forwarded from CDP client via callbacks
- Existing 106 unit tests pass with no emitter (backward-compatible)
- New tests verify: event sequence for a passing test, event sequence for a failing test, depth field in sub-test events, no events when emitter is omitted
- Events are fire-and-forget — listener errors do not affect test execution (emitter errors caught silently)
