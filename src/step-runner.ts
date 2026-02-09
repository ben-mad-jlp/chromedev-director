/**
 * Step runner for executing test steps with variable chaining support
 * Handles step execution, variable storage, and resume functionality
 */

import { TestDef, StepDef, TestResult, CDPClient as CDPClientInterface, OnEvent, RunEvent } from "./types.js";
import { interpolate, interpolateStep } from "./env.js";
import { CDPClient } from "./cdp-client.js";
import { getTest } from "./storage.js";

/**
 * Context for tracking nested test execution (cycle detection)
 */
interface RunContext {
  visitedTests: Set<string>;
}

/**
 * Safely emit an event if an onEvent callback is provided
 * No-ops when onEvent is undefined
 */
function emit(onEvent: OnEvent | undefined, event: RunEvent): void {
  if (onEvent) {
    try {
      onEvent(event);
    } catch {
      // Ignore listener errors so they don't affect test execution
    }
  }
}

/**
 * Helper to get the step type name from a step definition
 * Returns the first matching key that identifies the step type
 */
function getStepType(step: StepDef): string {
  if ("eval" in step) return "eval";
  if ("fill" in step) return "fill";
  if ("click" in step) return "click";
  if ("assert" in step) return "assert";
  if ("wait" in step) return "wait";
  if ("wait_for" in step) return "wait_for";
  if ("console_check" in step) return "console_check";
  if ("network_check" in step) return "network_check";
  if ("mock_network" in step) return "mock_network";
  if ("run_test" in step) return "run_test";
  if ("screenshot" in step) return "screenshot";
  if ("select" in step) return "select";
  if ("press_key" in step) return "press_key";
  if ("hover" in step) return "hover";
  if ("switch_frame" in step) return "switch_frame";
  if ("handle_dialog" in step) return "handle_dialog";
  if ("http_request" in step) return "http_request";
  return "unknown";
}

/**
 * Main test execution function with full lifecycle management
 * Orchestrates connection, before hooks, main steps, after hooks, and cleanup
 *
 * @param testDef - The test definition containing steps and configuration
 * @param port - The CDP port (default 9222)
 * @param onEvent - Optional callback for emitting events during test execution
 * @param projectRoot - Project root for resolving nested test IDs (default: process.cwd())
 * @returns The test result with execution status, errors, and diagnostics
 */
export async function runTest(testDef: TestDef, port: number = 9222, onEvent?: OnEvent, projectRoot: string = process.cwd(), initialVars?: Record<string, unknown>): Promise<TestResult> {
  const client = new CDPClient(port);
  const vars: Record<string, unknown> = { ...initialVars };
  const startTime = Date.now();
  const testTimeout = testDef.timeout ?? 30000;
  const context: RunContext = { visitedTests: new Set() };

  // Create a timeout promise that rejects after the configured timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Test timed out after ${testTimeout}ms`));
    }, testTimeout);
  });

  // Track the inner promise so we can catch its rejection if timeout wins
  const innerPromise = runTestInner(testDef, client, vars, startTime, onEvent, projectRoot, context);

  try {
    const result = await Promise.race([
      innerPromise,
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    // If timeout won the race, innerPromise may reject later when close() disrupts
    // pending CDP operations. Swallow that rejection to prevent crashing Node.
    innerPromise.catch(() => {});
    // Run after hooks even on unexpected errors
    await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
    return {
      status: "failed",
      failed_step: -1,
      step_definition: testDef.steps[0] || { eval: "" },
      error: error instanceof Error ? error.message : String(error),
      console_errors: [],
      duration_ms: Date.now() - startTime,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    try {
      await client.close();
    } catch {
      // Ignore close errors to avoid replacing the test result
    }
  }
}

/**
 * Inner test execution logic, separated to support timeout wrapping
 */
async function runTestInner(
  testDef: TestDef,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  startTime: number,
  onEvent: OnEvent | undefined,
  projectRoot: string,
  context: RunContext
): Promise<TestResult> {
  // Connect to Chrome
  await client.connect(testDef.url);

  const beforeHooks = testDef.before || [];

  // Phase 0: Run http_request before hooks BEFORE CDP connect (server-side, no CDP needed)
  for (let i = 0; i < beforeHooks.length; i++) {
    const hook = beforeHooks[i];
    if (!("http_request" in hook)) continue;

    const label = hook.label || `Before hook ${i + 1}`;
    const hookStartTime = Date.now();

    emit(onEvent, { type: "step:start", stepIndex: -(i + 1), label, nested: null });

    const interpolatedHook = interpolateStep(hook, testDef.env || {}, vars);
    const result = await executeStep(interpolatedHook, client, vars, onEvent, projectRoot, context, true);
    const duration = Date.now() - hookStartTime;

    // Store response in vars if 'as' field is present
    if ("http_request" in interpolatedHook && interpolatedHook.http_request.as && result.success && "value" in result) {
      vars[interpolatedHook.http_request.as] = result.value;
    }

    if (!result.success) {
      emit(onEvent, { type: "step:fail", stepIndex: -(i + 1), label, nested: null, duration_ms: duration, error: result.error || "Unknown error" });
      await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
      return {
        status: "failed",
        failed_step: -(i + 1),
        step_definition: hook,
        error: `Before hook ${i} failed: ${result.error}`,
        console_errors: [],
        duration_ms: Date.now() - startTime,
      };
    }

    emit(onEvent, { type: "step:pass", stepIndex: -(i + 1), label, nested: null, duration_ms: duration });
  }

  // Phase 1: Run mock_network before hooks BEFORE navigation so rules are registered in time
  for (let i = 0; i < beforeHooks.length; i++) {
    const hook = beforeHooks[i];
    if (!("mock_network" in hook)) continue;

    const label = hook.label || `Before hook ${i + 1}`;
    const hookStartTime = Date.now();

    emit(onEvent, { type: "step:start", stepIndex: -(i + 1), label, nested: null });

    const interpolatedHook = interpolateStep(hook, testDef.env || {}, vars);
    const result = await executeStep(interpolatedHook, client, vars, onEvent, projectRoot, context, true);
    const duration = Date.now() - hookStartTime;

    if (!result.success) {
      emit(onEvent, { type: "step:fail", stepIndex: -(i + 1), label, nested: null, duration_ms: duration, error: result.error || "Unknown error" });
      await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
      return {
        status: "failed",
        failed_step: -(i + 1),
        step_definition: hook,
        error: `Before hook ${i} failed: ${result.error}`,
        console_errors: (await client.getConsoleMessages()).map(m => m.text),
        dom_snapshot: await client.getDomSnapshot(),
        duration_ms: Date.now() - startTime,
      };
    }

    emit(onEvent, { type: "step:pass", stepIndex: -(i + 1), label, nested: null, duration_ms: duration });
  }

  // Navigate to the test URL (after mock rules are set up)
  await client.navigate(testDef.url);

  // Phase 2: Run remaining before hooks AFTER navigation so page JS context is available
  for (let i = 0; i < beforeHooks.length; i++) {
    const hook = beforeHooks[i];
    if ("mock_network" in hook || "http_request" in hook) continue;

    const label = hook.label || `Before hook ${i + 1}`;
    const hookStartTime = Date.now();

    emit(onEvent, { type: "step:start", stepIndex: -(i + 1), label, nested: null });

    const interpolatedHook = interpolateStep(hook, testDef.env || {}, vars);
    const result = await executeStep(interpolatedHook, client, vars, onEvent, projectRoot, context, true);
    const duration = Date.now() - hookStartTime;

    if (!result.success) {
      emit(onEvent, { type: "step:fail", stepIndex: -(i + 1), label, nested: null, duration_ms: duration, error: result.error || "Unknown error" });
      await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
      return {
        status: "failed",
        failed_step: -(i + 1),
        step_definition: hook,
        error: `Before hook ${i} failed: ${result.error}`,
        console_errors: (await client.getConsoleMessages()).map(m => m.text),
        dom_snapshot: await client.getDomSnapshot(),
        duration_ms: Date.now() - startTime,
      };
    }

    emit(onEvent, { type: "step:pass", stepIndex: -(i + 1), label, nested: null, duration_ms: duration });
  }

  // Determine starting index for resume_from
  let startIndex = 0;
  if (testDef.resume_from !== undefined) {
    // Validate resume_from bounds
    if (testDef.resume_from < 0 || testDef.resume_from > testDef.steps.length) {
      return {
        status: "failed",
        failed_step: -1,
        step_definition: testDef.steps[0] || { eval: "" },
        error: `Invalid resume_from index: ${testDef.resume_from} (steps length: ${testDef.steps.length})`,
        console_errors: [],
        duration_ms: Date.now() - startTime,
      };
    }

    const skippedSteps = testDef.steps.slice(0, testDef.resume_from);
    const hasVarStorage = skippedSteps.some((s: any) => s.as || s.http_request?.as);
    if (hasVarStorage) {
      console.warn("Skipped steps contain variable storage; re-running from start");
    } else {
      startIndex = testDef.resume_from;
    }
  }

  // Run main steps with lazy interpolation (one at a time, so $vars are up-to-date)
  for (let i = startIndex; i < testDef.steps.length; i++) {
    const rawStep = testDef.steps[i];
    const label = rawStep.label || `Step ${i + 1}`;
    const stepStartTime = Date.now();

    // Emit step:start event
    emit(onEvent, {
      type: "step:start",
      stepIndex: i,
      label,
      nested: null,
    });

    // Interpolate lazily so that $vars set by previous steps are available
    const step = interpolateStep(rawStep, testDef.env || {}, vars);
    const result = await executeStep(step, client, vars, onEvent, projectRoot, context);

    // Store variable if step has 'as' field (not skipped)
    if ("as" in step && step.as && "value" in result && result.success && !result.skipped) {
      vars[step.as] = result.value;
    }
    // http_request stores 'as' inside http_request object
    if ("http_request" in step && step.http_request.as && "value" in result && result.success && !result.skipped) {
      vars[step.http_request.as] = result.value;
    }

    if (!result.success) {
      const duration = Date.now() - stepStartTime;

      // Emit step:fail event
      emit(onEvent, {
        type: "step:fail",
        stepIndex: i,
        label,
        nested: null,
        duration_ms: duration,
        error: result.error || "Unknown error",
      });

      await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
      return {
        status: "failed",
        failed_step: i,
        failed_label: step.label,
        step_definition: step,
        error: result.error || "Unknown error",
        console_errors: (await client.getConsoleMessages()).map(m => m.text),
        dom_snapshot: await client.getDomSnapshot(),
        duration_ms: Date.now() - startTime,
      };
    }

    // Emit step:pass event
    const duration = Date.now() - stepStartTime;
    emit(onEvent, {
      type: "step:pass",
      stepIndex: i,
      label,
      nested: null,
      duration_ms: duration,
      ...(result.skipped ? { skipped: true } : {}),
    });
  }

  // Run after hooks (always)
  await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);

  return {
    status: "passed",
    steps_completed: testDef.steps.length - startIndex,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Executes all steps in a test definition with support for:
 * - Variable storage via `as` field in eval steps
 * - Variable interpolation in subsequent steps
 * - Resume from functionality with smart handling of variable dependencies
 *
 * @param client - The CDP client for executing browser operations
 * @param testDef - The test definition containing steps to execute
 * @param projectRoot - Project root for resolving nested test IDs (default: process.cwd())
 * @returns The test result with execution status
 */
export async function runSteps(
  client: CDPClientInterface,
  testDef: TestDef,
  onEvent?: OnEvent,
  projectRoot: string = process.cwd()
): Promise<TestResult> {
  const startTime = Date.now();
  const context: RunContext = { visitedTests: new Set() };

  // Initialize variables map for storing eval step results
  const vars: Record<string, unknown> = {};

  // Run before hooks (mock_network setup, etc.) with failure checking
  if (testDef.before) {
    for (let i = 0; i < testDef.before.length; i++) {
      const hook = testDef.before[i];
      const label = hook.label || `Before hook ${i + 1}`;
      const hookStartTime = Date.now();

      // Emit step:start event
      emit(onEvent, {
        type: "step:start",
        stepIndex: -(i + 1),
        label,
        nested: null,
      });

      const interpolatedHook = interpolateStep(hook, testDef.env || {}, vars);
      const result = await executeStep(interpolatedHook, client, vars, onEvent, projectRoot, context, true);
      const duration = Date.now() - hookStartTime;

      if (!result.success) {
        // Emit step:fail event
        emit(onEvent, {
          type: "step:fail",
          stepIndex: -(i + 1),
          label,
          nested: null,
          duration_ms: duration,
          error: result.error || "Unknown error",
        });

        return {
          status: "failed",
          failed_step: -(i + 1),
          step_definition: hook,
          error: `Before hook ${i} failed: ${result.error}`,
          console_errors: [],
          duration_ms: Date.now() - startTime,
        };
      }

      // Emit step:pass event
      emit(onEvent, {
        type: "step:pass",
        stepIndex: -(i + 1),
        label,
        nested: null,
        duration_ms: duration,
      });
    }
  }

  // Determine starting index, handling resume_from with variable dependency checks
  let startIndex = 0;
  if (testDef.resume_from !== undefined) {
    // Validate resume_from bounds
    if (testDef.resume_from < 0 || testDef.resume_from > testDef.steps.length) {
      return {
        status: "failed",
        failed_step: -1,
        step_definition: testDef.steps[0] || { eval: "" },
        error: `Invalid resume_from index: ${testDef.resume_from} (steps length: ${testDef.steps.length})`,
        console_errors: [],
        duration_ms: Date.now() - startTime,
      };
    }

    // Check if any skipped steps have 'as' field (variable storage)
    const skippedSteps = testDef.steps.slice(0, testDef.resume_from);
    const hasVarStorage = skippedSteps.some((s: any) => s.as || s.http_request?.as);

    if (hasVarStorage) {
      // Skipped steps contain variable storage; re-run from start
      console.warn(
        "Skipped steps contain variable storage; re-running from start"
      );
      startIndex = 0;
    } else {
      // Safe to skip - no variable dependencies
      startIndex = testDef.resume_from;
    }
  }

  // Execute steps with lazy interpolation
  for (let i = startIndex; i < testDef.steps.length; i++) {
    const step = testDef.steps[i];
    const label = step.label || `Step ${i + 1}`;
    const stepStartTime = Date.now();

    // Emit step:start event
    emit(onEvent, {
      type: "step:start",
      stepIndex: i,
      label,
      nested: null,
    });

    try {
      // Interpolate the step lazily to replace $env and $vars patterns
      const interpolatedStep = interpolateStep(
        step,
        testDef.env || {},
        vars
      );

      const result = await executeStep(
        interpolatedStep,
        client,
        vars,
        onEvent,
        projectRoot,
        context
      );

      // Store result in vars if step has `as` field (not skipped, not failed)
      if ("as" in step && step.as && result.success && !result.skipped) {
        vars[step.as] = result.value;
      }
      // http_request stores 'as' inside http_request object
      if ("http_request" in step && step.http_request.as && result.success && !result.skipped && "value" in result) {
        vars[step.http_request.as] = result.value;
      }

      if (!result.success) {
        const duration = Date.now() - stepStartTime;

        // Emit step:fail event
        emit(onEvent, {
          type: "step:fail",
          stepIndex: i,
          label,
          nested: null,
          duration_ms: duration,
          error: result.error || "Unknown error",
        });

        await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
        const duration2 = Date.now() - startTime;
        const diagnostics = await collectDiagnostics(client);
        return {
          status: "failed",
          failed_step: i,
          failed_label: label,
          step_definition: step,
          error: result.error || "Unknown error",
          ...diagnostics,
          duration_ms: duration2,
        };
      }

      // Emit step:pass event
      const duration = Date.now() - stepStartTime;
      emit(onEvent, {
        type: "step:pass",
        stepIndex: i,
        label,
        nested: null,
        duration_ms: duration,
        ...(result.skipped ? { skipped: true } : {}),
      });
    } catch (error) {
      const duration = Date.now() - stepStartTime;

      // Emit step:fail event
      emit(onEvent, {
        type: "step:fail",
        stepIndex: i,
        label,
        nested: null,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      });

      await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
      const totalDuration = Date.now() - startTime;
      const diagnostics = await collectDiagnostics(client);
      return {
        status: "failed",
        failed_step: i,
        failed_label: label,
        step_definition: step,
        error: error instanceof Error ? error.message : String(error),
        ...diagnostics,
        duration_ms: totalDuration,
      };
    }
  }

  // Run after hooks on success
  await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);

  const duration = Date.now() - startTime;
  return {
    status: "passed",
    steps_completed: testDef.steps.length - startIndex,
    duration_ms: duration,
  };
}

/**
 * Safely collects diagnostic information (console messages and DOM snapshot)
 * Returns empty defaults if the client methods fail or return undefined
 */
async function collectDiagnostics(
  client: CDPClientInterface
): Promise<{ console_errors: string[]; dom_snapshot?: string; screenshot?: string }> {
  let console_errors: string[] = [];
  let dom_snapshot: string | undefined;
  let screenshot: string | undefined;
  try {
    const messages = await client.getConsoleMessages();
    if (messages) {
      console_errors = messages.map((m) => m.text);
    }
  } catch {
    // Client may not be connected
  }
  try {
    dom_snapshot = await client.getDomSnapshot();
  } catch {
    // Client may not be connected
  }
  try {
    screenshot = await client.captureScreenshot();
  } catch {
    // Client may not be connected
  }
  return {
    console_errors,
    ...(dom_snapshot ? { dom_snapshot } : {}),
    ...(screenshot ? { screenshot } : {}),
  };
}

/**
 * Run after hooks, ignoring any errors (cleanup phase)
 * After hooks always run even if main steps fail
 * Interpolates each hook lazily before execution
 *
 * @param hooks - The raw after hook step definitions
 * @param env - Environment variables for interpolation
 * @param client - The CDP client
 * @param vars - Current variables map
 */
async function runAfterHooks(
  hooks: StepDef[],
  env: Record<string, unknown>,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  onEvent?: OnEvent | undefined,
  projectRoot?: string,
  context?: RunContext
): Promise<void> {
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    const label = hook.label || `After hook ${i + 1}`;
    const hookStartTime = Date.now();

    // Emit step:start event
    emit(onEvent, {
      type: "step:start",
      stepIndex: -(100 + i), // After hooks use negative indices starting at -100 to avoid collision with before hooks
      label,
      nested: null,
    });

    try {
      const interpolatedHook = interpolateStep(hook, env, vars);
      await executeStep(interpolatedHook, client, vars, onEvent, projectRoot, context, true);

      // Emit step:pass event
      const duration = Date.now() - hookStartTime;
      emit(onEvent, {
        type: "step:pass",
        stepIndex: -(100 + i),
        label,
        nested: null,
        duration_ms: duration,
      });
    } catch (error) {
      // Emit step:fail event
      const duration = Date.now() - hookStartTime;
      emit(onEvent, {
        type: "step:fail",
        stepIndex: -(100 + i),
        label,
        nested: null,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      });
      // Ignore errors in after hooks (cleanup phase)
    }
  }
}

/**
 * Execute a single step
 * Dispatches to the appropriate step handler based on step type
 *
 * @param step - The step definition to execute
 * @param client - The CDP client
 * @param vars - Current variables map
 * @param onEvent - Optional callback for emitting events
 * @param projectRoot - Project root for resolving nested test IDs
 * @param context - Run context for cycle detection
 * @returns Success status and optional value (for eval steps)
 */
async function executeStep(
  step: StepDef,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  onEvent?: OnEvent,
  projectRoot: string = process.cwd(),
  context: RunContext = { visitedTests: new Set() },
  isHook: boolean = false
): Promise<{ success: boolean; error?: string; value?: unknown; skipped?: boolean }> {
  try {
    // Check conditional — if the `if` field is present, evaluate it first
    // http_request steps don't use CDP, so their `if` is evaluated as a simple JS expression
    if ("if" in step && step.if != null) {
      if ("http_request" in step) {
        // For http_request, evaluate the condition without CDP (simple truthy check)
        // eslint-disable-next-line no-eval
        const conditionResult = (() => { try { return !!eval(step.if); } catch { return false; } })();
        if (!conditionResult) {
          return { success: true, skipped: true };
        }
      } else {
        const conditionResult = await client.evaluate(step.if);
        if (!conditionResult) {
          return { success: true, skipped: true };
        }
      }
    }

    // Dispatch to appropriate handler based on step type
    if ("http_request" in step) {
      return await httpRequestStep(step as any, vars);
    }

    if ("eval" in step) {
      return await evalStep(step, client, vars, isHook);
    }

    if ("fill" in step) {
      return await fillStep(step, client, vars);
    }

    if ("click" in step) {
      return await clickStep(step, client, vars);
    }

    if ("assert" in step) {
      return await assertStep(step, client, vars);
    }

    if ("wait" in step) {
      return await waitStep(step, client, vars);
    }

    if ("wait_for" in step) {
      return await waitForStep(step, client, vars);
    }

    if ("console_check" in step) {
      return await consoleCheckStep(step, client, vars);
    }

    if ("network_check" in step) {
      return await networkCheckStep(step, client, vars);
    }

    if ("mock_network" in step) {
      return await mockNetworkStep(step, client, vars);
    }

    if ("run_test" in step) {
      return await runTestStep(step, client, vars, onEvent, projectRoot, context);
    }

    if ("screenshot" in step) {
      return await screenshotStep(step, client, vars);
    }

    if ("select" in step) {
      return await selectStep(step, client, vars);
    }

    if ("press_key" in step) {
      return await pressKeyStep(step, client, vars);
    }

    if ("hover" in step) {
      return await hoverStep(step, client, vars);
    }

    if ("switch_frame" in step) {
      return await switchFrameStep(step, client, vars);
    }

    if ("handle_dialog" in step) {
      return await handleDialogStep(step, client, vars);
    }

    return {
      success: false,
      error: "Unknown step type",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute an eval step
 * If the step has an 'as' field, stores the result for later use.
 * If the step has no 'as' field, treats falsy results as assertion failures.
 */
async function evalStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  isHook: boolean = false
): Promise<{ success: boolean; error?: string; value?: unknown }> {
  try {
    if (typeof step.eval !== "string") {
      return {
        success: false,
        error: "eval expression must be a string",
      };
    }

    const result = await client.evaluate(step.eval);

    // If the eval step has no 'as' field, treat it as an assertion:
    // only strict false indicates failure (use 'assert' step for truthy checking)
    // Skip assertion check in hooks — hooks are for setup/teardown, not assertions
    if (!isHook && !step.as && result === false) {
      return {
        success: false,
        error: `Eval assertion failed: ${step.eval}`,
      };
    }

    return { success: true, value: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a fill step
 */
async function fillStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.fill || typeof step.fill.selector !== "string" || typeof step.fill.value !== "string") {
      return {
        success: false,
        error: "fill step requires selector and value strings",
      };
    }

    await client.fill(step.fill.selector, step.fill.value);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a click step
 */
async function clickStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.click || typeof step.click.selector !== "string") {
      return {
        success: false,
        error: "click step requires selector string",
      };
    }

    await client.click(step.click.selector);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute an assert step with retry logic
 * Supports configurable retry interval and timeout
 */
async function assertStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof step.assert !== "string") {
      return {
        success: false,
        error: "assert expression must be a string",
      };
    }

    const retry = step.retry || { interval: 100, timeout: 5000 };

    // Retry loop with timeout — always evaluate at least once
    const startTime = Date.now();
    let lastError: string | undefined;
    let firstAttempt = true;

    while (firstAttempt || Date.now() - startTime < retry.timeout) {
      firstAttempt = false;

      try {
        const result = await client.evaluate(step.assert);
        if (result) {
          return { success: true };
        }
        lastError = `Assertion failed: ${step.assert}`;
      } catch (evalError) {
        lastError = evalError instanceof Error ? evalError.message : String(evalError);
      }

      // Don't sleep after the last attempt
      if (Date.now() - startTime < retry.timeout) {
        await new Promise((resolve) => setTimeout(resolve, retry.interval));
      }
    }

    return {
      success: false,
      error: lastError || `Assertion failed after retries: ${step.assert}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a wait step
 */
async function waitStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof step.wait !== "number") {
      return {
        success: false,
        error: "wait duration must be a number",
      };
    }

    await new Promise((resolve) => setTimeout(resolve, step.wait));
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a wait_for step
 * Polls for an element matching the selector until it appears or timeout
 */
async function waitForStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.wait_for || typeof step.wait_for.selector !== "string") {
      return {
        success: false,
        error: "wait_for step requires selector string",
      };
    }

    const timeout = step.wait_for.timeout ?? 5000;
    const interval = 100;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const found = await client.evaluate(
          `!!document.querySelector(${JSON.stringify(step.wait_for.selector)})`
        );
        if (found) {
          return { success: true };
        }
      } catch {
        // Element not found yet, continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return {
      success: false,
      error: `Timed out waiting for selector: ${step.wait_for.selector}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a console_check step
 * Checks collected console messages for specified log levels
 */
async function consoleCheckStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!Array.isArray(step.console_check)) {
      return {
        success: false,
        error: "console_check must be an array",
      };
    }

    const messages = await client.getConsoleMessages();
    const levelsToCheck: string[] = step.console_check;

    // Normalize levels: CDP uses "warning" but users may write "warn"
    const normalizedLevels = levelsToCheck.map((l) =>
      l === "warn" ? "warning" : l
    );

    // Find console messages matching any of the specified levels
    const matched = messages.filter((m) => normalizedLevels.includes(m.type));

    if (matched.length > 0) {
      const details = matched.map((m) => `[${m.type}] ${m.text}`).join("; ");
      return {
        success: false,
        error: `Console messages found: ${details}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a network_check step
 * Validates that no network responses have 4xx/5xx status codes
 */
async function networkCheckStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof step.network_check !== "boolean") {
      return {
        success: false,
        error: "network_check must be a boolean",
      };
    }

    if (!step.network_check) {
      return { success: true };
    }

    const responses = await client.getNetworkResponses();
    const errors = responses.filter((resp) => resp.status >= 400);

    if (errors.length > 0) {
      const errorText = errors.map((e) => `${e.status} ${e.url}`).join("; ");
      return {
        success: false,
        error: `Network errors: ${errorText}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a run_test step
 * Resolves a test by ID from storage and executes its steps inline
 * Supports nested test execution with cycle detection
 */
async function runTestStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  onEvent: OnEvent | undefined,
  projectRoot: string,
  context: RunContext
): Promise<{ success: boolean; error?: string; value?: unknown }> {
  try {
    // Validate run_test step format
    if (typeof step.run_test !== "string") {
      return {
        success: false,
        error: "run_test must be a string (test ID)",
      };
    }

    const testId = step.run_test;

    // Check for cycles: if this test ID is already being visited, reject
    if (context.visitedTests.has(testId)) {
      return {
        success: false,
        error: `Cycle detected: test "${testId}" is already in the call stack`,
      };
    }

    // Mark this test as being visited
    context.visitedTests.add(testId);

    try {
      // Load the test from storage
      const savedTest = await getTest(projectRoot, testId);
      if (!savedTest) {
        return {
          success: false,
          error: `Test not found: "${testId}"`,
        };
      }

      // Navigate to the sub-test's URL
      await client.navigate(savedTest.definition.url);

      // Execute the sub-test's steps (without before/after hooks, only main steps)
      const subTestDef = savedTest.definition;
      for (let i = 0; i < subTestDef.steps.length; i++) {
        const rawStep = subTestDef.steps[i];
        // Interpolate with parent's env and shared vars
        const interpolatedStep = interpolateStep(
          rawStep,
          subTestDef.env || {},
          vars
        );

        // Execute the step with the same context
        const result = await executeStep(
          interpolatedStep,
          client,
          vars,
          onEvent,
          projectRoot,
          context
        );

        // Store variable if eval step has 'as' field
        if (
          "as" in interpolatedStep &&
          interpolatedStep.as &&
          "value" in result &&
          result.success
        ) {
          vars[interpolatedStep.as] = result.value;
        }

        // If step fails, return with nested error context
        if (!result.success) {
          return {
            success: false,
            error: `Sub-test "${testId}" failed at step ${i} (${interpolatedStep.label || "unnamed"}): ${result.error}`,
          };
        }
      }

      // All steps passed
      return { success: true };
    } finally {
      // Remove from visited set to allow same test in sibling branches
      context.visitedTests.delete(testId);
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a mock_network step
 */
async function mockNetworkStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (
      !step.mock_network ||
      typeof step.mock_network.match !== "string" ||
      typeof step.mock_network.status !== "number"
    ) {
      return {
        success: false,
        error: "mock_network step requires match pattern and status code",
      };
    }

    client.addMockRule(
      step.mock_network.match,
      step.mock_network.status,
      step.mock_network.body,
      step.mock_network.delay
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a screenshot step
 */
async function screenshotStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string; value?: unknown }> {
  try {
    const data = await client.captureScreenshot();
    if (step.screenshot?.as) {
      vars[step.screenshot.as] = data;
    }
    return { success: true, value: data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a select step
 */
async function selectStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.select || typeof step.select.selector !== "string" || typeof step.select.value !== "string") {
      return {
        success: false,
        error: "select step requires selector and value strings",
      };
    }

    await client.select(step.select.selector, step.select.value);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a press_key step
 */
async function pressKeyStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.press_key || typeof step.press_key.key !== "string") {
      return {
        success: false,
        error: "press_key step requires key string",
      };
    }

    await client.pressKey(step.press_key.key, step.press_key.modifiers);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a hover step
 */
async function hoverStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.hover || typeof step.hover.selector !== "string") {
      return {
        success: false,
        error: "hover step requires selector string",
      };
    }

    await client.hover(step.hover.selector);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a switch_frame step
 */
async function switchFrameStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.switchFrame(step.switch_frame?.selector);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute an http_request step
 * Makes a server-side HTTP request using Node's fetch API
 */
async function httpRequestStep(
  step: StepDef & { http_request: { url: string; method?: string; body?: unknown; headers?: Record<string, string>; as?: string } },
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string; value?: unknown }> {
  try {
    const { url, method = "GET", body, headers, as: varName } = step.http_request;

    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };

    if (body != null && method !== "GET") {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    // Parse response — try JSON first, fall back to text
    let responseBody: unknown;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    if (varName) {
      return { success: true, value: responseBody };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a handle_dialog step
 */
async function handleDialogStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.handle_dialog || !["accept", "dismiss"].includes(step.handle_dialog.action)) {
      return {
        success: false,
        error: 'handle_dialog step requires action ("accept" or "dismiss")',
      };
    }

    await client.handleDialog(step.handle_dialog.action, step.handle_dialog.text);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
