/**
 * Step runner for executing test steps with variable chaining support
 * Handles step execution, variable storage, and resume functionality
 */

import { TestDef, StepDef, TestResult, CDPClient as CDPClientInterface, OnEvent, RunEvent, VerifyPageDef } from "./types.js";
import { interpolate, interpolateStep, markVarSynced, unmarkVarSynced } from "./env.js";
import { CDPClient } from "./cdp-client.js";
import { getTest } from "./storage.js";
import { SessionManager } from "./session-manager.js";

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
 * Verify the page loaded correctly after navigation.
 * Polls with 200ms interval until all conditions pass or timeout.
 */
async function verifyPage(
  client: CDPClientInterface,
  verify: VerifyPageDef,
  env: Record<string, unknown>,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const timeout = verify.timeout ?? 10000;
  const interval = 200;
  const deadline = Date.now() + timeout;

  // Interpolate string fields for $env/$vars support
  const selector = verify.selector ? interpolate(verify.selector, env, vars) : undefined;
  const title = verify.title ? interpolate(verify.title, env, vars) : undefined;
  const urlContains = verify.url_contains ? interpolate(verify.url_contains, env, vars) : undefined;

  while (Date.now() < deadline) {
    const errors: string[] = [];

    if (selector) {
      const found = await client.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (!found) errors.push(`Selector "${selector}" not found`);
    }

    if (title) {
      const pageTitle = await client.evaluate("document.title") as string;
      if (!pageTitle || !pageTitle.includes(title)) {
        errors.push(`Title "${pageTitle}" does not contain "${title}"`);
      }
    }

    if (urlContains) {
      const pageUrl = await client.evaluate("window.location.href") as string;
      if (!pageUrl || !pageUrl.includes(urlContains)) {
        errors.push(`URL "${pageUrl}" does not contain "${urlContains}"`);
      }
    }

    if (errors.length === 0) return { success: true };

    // If past deadline after this check, fail
    if (Date.now() + interval > deadline) {
      return { success: false, error: `verify_page failed after ${timeout}ms: ${errors.join("; ")}` };
    }

    await new Promise(r => setTimeout(r, interval));
  }

  return { success: false, error: `verify_page timed out after ${timeout}ms` };
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
  if ("loop" in step) return "loop";
  if ("scan_input" in step) return "scan_input";
  if ("fill_form" in step) return "fill_form";
  if ("scroll_to" in step) return "scroll_to";
  if ("clear_input" in step) return "clear_input";
  if ("wait_for_text" in step) return "wait_for_text";
  if ("wait_for_text_gone" in step) return "wait_for_text_gone";
  if ("assert_text" in step) return "assert_text";
  if ("click_text" in step) return "click_text";
  if ("click_nth" in step) return "click_nth";
  if ("type" in step) return "type";
  if ("choose_dropdown" in step) return "choose_dropdown";
  if ("expand_menu" in step) return "expand_menu";
  if ("toggle" in step) return "toggle";
  if ("close_modal" in step) return "close_modal";
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
export async function runTest(testDef: TestDef, port: number = 9222, onEvent?: OnEvent, projectRoot: string = process.cwd(), initialVars?: Record<string, unknown>, createTab?: boolean, sessionId?: string, sessionManager?: SessionManager): Promise<TestResult> {
  const client = new CDPClient(port, undefined, {
    createTab: createTab ?? false,
    sessionId,
    sessionManager
  });
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
      console_log: [],
      network_log: [],
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
        console_log: [],
        network_log: [],
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
      const consoleMessages = await client.getConsoleMessages();
      const networkResponses = await client.getNetworkResponses();
      return {
        status: "failed",
        failed_step: -(i + 1),
        step_definition: hook,
        error: `Before hook ${i} failed: ${result.error}`,
        console_errors: consoleMessages.map(m => m.text),
        dom_snapshot: await client.getDomSnapshot(),
        duration_ms: Date.now() - startTime,
        console_log: consoleMessages,
        network_log: networkResponses,
      };
    }

    emit(onEvent, { type: "step:pass", stepIndex: -(i + 1), label, nested: null, duration_ms: duration });
  }

  // Navigate to the test URL (after mock rules are set up)
  await client.navigate(testDef.url);

  // Verify page loaded correctly (if verify_page is configured)
  if (testDef.verify_page) {
    const verifyResult = await verifyPage(client, testDef.verify_page, testDef.env || {}, vars);
    if (!verifyResult.success) {
      await runAfterHooks(testDef.after || [], testDef.env || {}, client, vars, onEvent, projectRoot, context);
      const consoleMessages = await safeGetConsoleMessages(client);
      const networkResponses = await safeGetNetworkResponses(client);
      return {
        status: "failed",
        failed_step: -1,
        step_definition: testDef.steps[0] || { eval: "" },
        error: verifyResult.error || "Page verification failed",
        console_errors: consoleMessages.map(m => m.text),
        dom_snapshot: await client.getDomSnapshot().catch(() => undefined),
        screenshot: await client.captureScreenshot().catch(() => undefined),
        duration_ms: Date.now() - startTime,
        console_log: consoleMessages,
        network_log: networkResponses,
      };
    }
  }

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
      const consoleMessages = await client.getConsoleMessages();
      const networkResponses = await client.getNetworkResponses();
      return {
        status: "failed",
        failed_step: -(i + 1),
        step_definition: hook,
        error: `Before hook ${i} failed: ${result.error}`,
        console_errors: consoleMessages.map(m => m.text),
        dom_snapshot: await client.getDomSnapshot(),
        duration_ms: Date.now() - startTime,
        console_log: consoleMessages,
        network_log: networkResponses,
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
        console_log: [],
        network_log: [],
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

  // Track per-step DOM snapshots for steps with capture_dom: true
  const domSnapshots: Record<number, string> = {};

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
      const consoleMessages = await client.getConsoleMessages();
      const networkResponses = await client.getNetworkResponses();
      return {
        status: "failed",
        failed_step: i,
        failed_label: step.label,
        step_definition: step,
        error: result.error || "Unknown error",
        ...(result.loop_context ? { loop_context: result.loop_context } : {}),
        console_errors: consoleMessages.map(m => m.text),
        dom_snapshot: await client.getDomSnapshot(),
        duration_ms: Date.now() - startTime,
        console_log: consoleMessages,
        network_log: networkResponses,
        ...(Object.keys(domSnapshots).length > 0 ? { dom_snapshots: domSnapshots } : {}),
      };
    }

    // Capture DOM snapshot if step has capture_dom: true
    if ("capture_dom" in rawStep && rawStep.capture_dom) {
      try {
        domSnapshots[i] = await client.getDomSnapshot();
      } catch {
        // Ignore capture errors — non-critical
      }
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

  const consoleMessages = await client.getConsoleMessages();
  const networkResponses = await client.getNetworkResponses();
  return {
    status: "passed",
    steps_completed: testDef.steps.length - startIndex,
    duration_ms: Date.now() - startTime,
    console_log: consoleMessages,
    network_log: networkResponses,
    ...(Object.keys(domSnapshots).length > 0 ? { dom_snapshots: domSnapshots } : {}),
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
          console_log: [],
          network_log: [],
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
        console_log: [],
        network_log: [],
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

  // Track per-step DOM snapshots for steps with capture_dom: true
  const domSnapshots: Record<number, string> = {};

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
      if ("as" in step && step.as && "value" in result && result.success && !result.skipped) {
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
        const diagnostics = await collectDiagnostics(client, domSnapshots);
        return {
          status: "failed",
          failed_step: i,
          failed_label: label,
          step_definition: step,
          error: result.error || "Unknown error",
          ...(result.loop_context ? { loop_context: result.loop_context } : {}),
          ...diagnostics,
          duration_ms: duration2,
        };
      }

      // Capture DOM snapshot if step has capture_dom: true
      if ("capture_dom" in step && step.capture_dom) {
        try {
          domSnapshots[i] = await client.getDomSnapshot();
        } catch {
          // Ignore capture errors — non-critical
        }
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
      const diagnostics = await collectDiagnostics(client, domSnapshots);
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
  const consoleMessages = await safeGetConsoleMessages(client);
  const networkResponses = await safeGetNetworkResponses(client);
  return {
    status: "passed",
    steps_completed: testDef.steps.length - startIndex,
    duration_ms: duration,
    console_log: consoleMessages,
    network_log: networkResponses,
    ...(Object.keys(domSnapshots).length > 0 ? { dom_snapshots: domSnapshots } : {}),
  };
}

/**
 * Safely get console messages from client, returning empty array on error
 */
async function safeGetConsoleMessages(
  client: CDPClientInterface
): Promise<Array<{ type: string; text: string; timestamp: number }>> {
  try {
    const msgs = (await client.getConsoleMessages()) || [];
    return msgs.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/**
 * Safely get network responses from client, returning empty array on error
 */
async function safeGetNetworkResponses(
  client: CDPClientInterface
): Promise<Array<{ url: string; method: string; status: number; timestamp: number }>> {
  try {
    const responses = (await client.getNetworkResponses()) || [];
    return responses.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/**
 * Safely collects diagnostic information (console messages, network log, DOM snapshot)
 * Returns empty defaults if the client methods fail or return undefined
 */
async function collectDiagnostics(
  client: CDPClientInterface,
  domSnapshots?: Record<number, string>
): Promise<{
  console_errors: string[];
  dom_snapshot?: string;
  screenshot?: string;
  console_log: Array<{ type: string; text: string; timestamp: number }>;
  network_log: Array<{ url: string; method: string; status: number; timestamp: number }>;
  dom_snapshots?: Record<number, string>;
}> {
  const console_log = await safeGetConsoleMessages(client);
  const network_log = await safeGetNetworkResponses(client);
  const console_errors = console_log.map((m) => m.text);

  let dom_snapshot: string | undefined;
  let screenshot: string | undefined;
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
    console_log,
    network_log,
    ...(domSnapshots && Object.keys(domSnapshots).length > 0 ? { dom_snapshots: domSnapshots } : {}),
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
): Promise<{ success: boolean; error?: string; value?: unknown; skipped?: boolean; loop_context?: Array<{ iteration: number; step: number; label: string }> }> {
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
        const conditionResult = await client.evaluate(`!!(${step.if})`);
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

    if ("loop" in step) {
      return await loopStep(step, client, vars, onEvent, projectRoot, context);
    }

    if ("scan_input" in step) {
      return await scanInputStep(step, client);
    }

    if ("fill_form" in step) {
      return await fillFormStep(step, client);
    }

    if ("scroll_to" in step) {
      return await scrollToStep(step, client);
    }

    if ("clear_input" in step) {
      return await clearInputStep(step, client);
    }

    if ("wait_for_text" in step) {
      return await waitForTextStep(step, client);
    }

    if ("wait_for_text_gone" in step) {
      return await waitForTextGoneStep(step, client);
    }

    if ("assert_text" in step) {
      return await assertTextStep(step, client);
    }

    if ("click_text" in step) {
      return await clickTextStep(step, client);
    }

    if ("click_nth" in step) {
      return await clickNthStep(step, client);
    }

    if ("type" in step) {
      return await typeStep(step, client);
    }

    if ("choose_dropdown" in step) {
      return await chooseDropdownStep(step, client);
    }

    if ("expand_menu" in step) {
      return await expandMenuStep(step, client);
    }

    if ("toggle" in step) {
      return await toggleStep(step, client);
    }

    if ("close_modal" in step) {
      return await closeModalStep(step, client);
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
 * Execute a loop step
 * Supports two modes: `over` (iterate array) and `while` (repeat while truthy)
 */
async function loopStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  onEvent: OnEvent | undefined,
  projectRoot: string,
  context: RunContext
): Promise<{ success: boolean; error?: string; value?: unknown; loop_context?: Array<{ iteration: number; step: number; label: string }> }> {
  try {
    const loop = step.loop;
    if (!loop || !Array.isArray(loop.steps)) {
      return { success: false, error: "loop step requires a steps array" };
    }

    const asName = loop.as ?? "item";
    const indexAs = loop.index_as ?? "index";

    // Helper: sync a loop variable to both vars and browser's window.__cdp_vars
    const syncLoopVar = async (key: string, value: unknown) => {
      vars[key] = value;
      await client.evaluate(`(function() {
        window.__cdp_vars = window.__cdp_vars || {};
        window.__cdp_vars[${JSON.stringify(key)}] = ${JSON.stringify(value)};
      })()`);
      markVarSynced(key);
    };

    if (loop.over != null) {
      // --- over mode: iterate over an array ---
      const items = await client.evaluate(loop.over);
      if (!Array.isArray(items)) {
        return { success: false, error: `loop.over expression must return an array, got ${typeof items}` };
      }

      // Inject full array into browser once so inner `loop.over` expressions can reference it
      await client.evaluate(`(function() {
        window.__cdp_vars = window.__cdp_vars || {};
        window.__cdp_vars[${JSON.stringify(asName + "__array")}] = ${JSON.stringify(items)};
      })()`);

      const maxIterations = loop.max != null ? Math.min(loop.max, items.length) : items.length;

      try {
        for (let i = 0; i < maxIterations; i++) {
          await syncLoopVar(asName, items[i]);
          await syncLoopVar(indexAs, i);

          for (let s = 0; s < loop.steps.length; s++) {
            const nestedStep = loop.steps[s];
            const interpolatedStep = interpolateStep(nestedStep, {}, vars);
            const label = interpolatedStep.label || `Step ${s + 1}`;

            emit(onEvent, { type: "step:start", stepIndex: s, label: `Loop iteration ${i}, ${label}`, nested: null });
            const stepStart = Date.now();

            const result = await executeStep(interpolatedStep, client, vars, onEvent, projectRoot, context);

            // Store variable if step has 'as' field
            if ("as" in interpolatedStep && interpolatedStep.as && "value" in result && result.success && !result.skipped) {
              vars[interpolatedStep.as] = result.value;
            }
            if ("http_request" in interpolatedStep && interpolatedStep.http_request.as && "value" in result && result.success && !result.skipped) {
              vars[interpolatedStep.http_request.as] = result.value;
            }

            const duration = Date.now() - stepStart;

            if (!result.success) {
              emit(onEvent, { type: "step:fail", stepIndex: s, label: `Loop iteration ${i}, ${label}`, nested: null, duration_ms: duration, error: result.error || "Unknown error" });
              // Build loop_context breadcrumb: prepend this level, carry inner context from nested loops
              const thisLevel = { iteration: i, step: s, label };
              const innerContext = result.loop_context || [];
              return {
                success: false,
                error: `Loop iteration ${i}, step ${s} (${label}): ${result.error}`,
                loop_context: [thisLevel, ...innerContext],
              };
            }

            emit(onEvent, { type: "step:pass", stepIndex: s, label: `Loop iteration ${i}, ${label}`, nested: null, duration_ms: duration, ...(result.skipped ? { skipped: true } : {}) });
          }
        }

        return { success: true };
      } finally {
        unmarkVarSynced(asName);
        unmarkVarSynced(indexAs);
      }
    } else if (loop.while != null) {
      // --- while mode: repeat while condition is truthy ---
      if (loop.max == null) {
        return { success: false, error: "loop.while requires max to prevent infinite loops" };
      }

      try {
        let iteration = 0;
        while (iteration < loop.max) {
          // Sync iteration index to browser
          await syncLoopVar(indexAs, iteration);

          // Evaluate condition with current vars
          const conditionExpr = interpolate(loop.while, {}, vars);
          const condition = await client.evaluate(`!!(${conditionExpr})`);
          if (!condition) break;

          for (let s = 0; s < loop.steps.length; s++) {
            const nestedStep = loop.steps[s];
            const interpolatedStep = interpolateStep(nestedStep, {}, vars);
            const label = interpolatedStep.label || `Step ${s + 1}`;

            emit(onEvent, { type: "step:start", stepIndex: s, label: `Loop iteration ${iteration}, ${label}`, nested: null });
            const stepStart = Date.now();

            const result = await executeStep(interpolatedStep, client, vars, onEvent, projectRoot, context);

            // Store variable if step has 'as' field
            if ("as" in interpolatedStep && interpolatedStep.as && "value" in result && result.success && !result.skipped) {
              vars[interpolatedStep.as] = result.value;
            }
            if ("http_request" in interpolatedStep && interpolatedStep.http_request.as && "value" in result && result.success && !result.skipped) {
              vars[interpolatedStep.http_request.as] = result.value;
            }

            const duration = Date.now() - stepStart;

            if (!result.success) {
              emit(onEvent, { type: "step:fail", stepIndex: s, label: `Loop iteration ${iteration}, ${label}`, nested: null, duration_ms: duration, error: result.error || "Unknown error" });
              const thisLevel = { iteration, step: s, label };
              const innerContext = result.loop_context || [];
              return {
                success: false,
                error: `Loop iteration ${iteration}, step ${s} (${label}): ${result.error}`,
                loop_context: [thisLevel, ...innerContext],
              };
            }

            emit(onEvent, { type: "step:pass", stepIndex: s, label: `Loop iteration ${iteration}, ${label}`, nested: null, duration_ms: duration, ...(result.skipped ? { skipped: true } : {}) });
          }

          iteration++;
        }

        return { success: true };
      } finally {
        unmarkVarSynced(indexAs);
      }
    } else {
      return { success: false, error: "loop step requires either 'over' or 'while'" };
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

// ─── High-level step handlers ───────────────────────────────────────

/**
 * Execute a scan_input step
 * Fills an input and presses Enter (barcode scanner pattern)
 */
async function scanInputStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.scan_input || typeof step.scan_input.selector !== "string" || typeof step.scan_input.value !== "string") {
      return { success: false, error: "scan_input step requires selector and value strings" };
    }
    await client.fill(step.scan_input.selector, step.scan_input.value);
    await client.pressKey("Enter");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a fill_form step
 * Fills multiple form fields sequentially
 */
async function fillFormStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.fill_form || !Array.isArray(step.fill_form.fields)) {
      return { success: false, error: "fill_form step requires a fields array" };
    }
    for (let i = 0; i < step.fill_form.fields.length; i++) {
      const field = step.fill_form.fields[i];
      if (typeof field.selector !== "string" || typeof field.value !== "string") {
        return { success: false, error: `fill_form field ${i} requires selector and value strings` };
      }
      try {
        await client.fill(field.selector, field.value);
      } catch (err) {
        return { success: false, error: `fill_form field ${i} (${field.selector}): ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a scroll_to step
 * Scrolls an element into view
 */
async function scrollToStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.scroll_to || typeof step.scroll_to.selector !== "string") {
      return { success: false, error: "scroll_to step requires selector string" };
    }
    const selector = step.scroll_to.selector;
    const result = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return 'ok';
    })()`);
    if (result === "not_found") {
      return { success: false, error: `scroll_to: element not found: ${selector}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a clear_input step
 * Clears an input with proper React event dispatching
 */
async function clearInputStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.clear_input || typeof step.clear_input.selector !== "string") {
      return { success: false, error: "clear_input step requires selector string" };
    }
    const selector = step.clear_input.selector;
    const result = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, '');
      } else {
        el.value = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    if (result === "not_found") {
      return { success: false, error: `clear_input: element not found: ${selector}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Build a JS expression that tests `innerText` against `text` using the given match mode.
 * The returned expression assumes `innerText` and `text` variables are in scope in the browser.
 * For regex mode, `text` is the pattern string passed to `new RegExp()`.
 */
function buildTextMatchExpr(text: string, matchMode: string): string {
  if (matchMode === "regex") {
    return `new RegExp(${JSON.stringify(text)}).test(innerText)`;
  }
  if (matchMode === "exact") {
    return `innerText.trim() === ${JSON.stringify(text)}`;
  }
  // "contains" (default)
  return `innerText.includes(${JSON.stringify(text)})`;
}

/**
 * Execute a wait_for_text step
 * Polls until text appears on page
 */
async function waitForTextStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.wait_for_text || typeof step.wait_for_text.text !== "string") {
      return { success: false, error: "wait_for_text step requires text string" };
    }
    const { text, match: matchMode, selector, timeout: timeoutMs } = step.wait_for_text;
    const timeout = timeoutMs ?? 5000;
    const interval = 200;
    const deadline = Date.now() + timeout;
    const scope = selector ? JSON.stringify(selector) : "null";
    const matchExpr = buildTextMatchExpr(text, matchMode ?? "contains");

    while (Date.now() < deadline) {
      const found = await client.evaluate(`(() => {
        const scope = ${scope} ? document.querySelector(${scope}) : document.body;
        if (!scope) return false;
        const innerText = scope.innerText;
        return ${matchExpr};
      })()`);
      if (found) return { success: true };
      if (Date.now() + interval > deadline) break;
      await new Promise(r => setTimeout(r, interval));
    }
    return { success: false, error: `wait_for_text: "${text}" not found after ${timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a wait_for_text_gone step
 * Polls until text disappears from page
 */
async function waitForTextGoneStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.wait_for_text_gone || typeof step.wait_for_text_gone.text !== "string") {
      return { success: false, error: "wait_for_text_gone step requires text string" };
    }
    const { text, match: matchMode, selector, timeout: timeoutMs } = step.wait_for_text_gone;
    const timeout = timeoutMs ?? 5000;
    const interval = 200;
    const deadline = Date.now() + timeout;
    const scope = selector ? JSON.stringify(selector) : "null";
    const matchExpr = buildTextMatchExpr(text, matchMode ?? "contains");

    while (Date.now() < deadline) {
      const found = await client.evaluate(`(() => {
        const scope = ${scope} ? document.querySelector(${scope}) : document.body;
        if (!scope) return false;
        const innerText = scope.innerText;
        return ${matchExpr};
      })()`);
      if (!found) return { success: true };
      if (Date.now() + interval > deadline) break;
      await new Promise(r => setTimeout(r, interval));
    }
    return { success: false, error: `wait_for_text_gone: "${text}" still present after ${timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute an assert_text step
 * Asserts page contains (or doesn't contain) specific text
 */
async function assertTextStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.assert_text || typeof step.assert_text.text !== "string") {
      return { success: false, error: "assert_text step requires text string" };
    }
    const { text, absent, match: matchMode, selector, retry } = step.assert_text;
    const scope = selector ? JSON.stringify(selector) : "null";
    const matchExpr = buildTextMatchExpr(text, matchMode ?? "contains");

    const checkOnce = async (): Promise<boolean> => {
      const found = await client.evaluate(`(() => {
        const scope = ${scope} ? document.querySelector(${scope}) : document.body;
        if (!scope) return false;
        const innerText = scope.innerText;
        return ${matchExpr};
      })()`);
      return absent ? !found : !!found;
    };

    if (!retry) {
      const pass = await checkOnce();
      if (pass) return { success: true };
      return { success: false, error: absent ? `assert_text: "${text}" is present (expected absent)` : `assert_text: "${text}" not found` };
    }

    // Retry loop
    const deadline = Date.now() + retry.timeout;
    while (Date.now() < deadline) {
      const pass = await checkOnce();
      if (pass) return { success: true };
      if (Date.now() + retry.interval > deadline) break;
      await new Promise(r => setTimeout(r, retry.interval));
    }
    return { success: false, error: absent ? `assert_text: "${text}" still present after ${retry.timeout}ms` : `assert_text: "${text}" not found after ${retry.timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a click_text step
 * Clicks an element by visible text content
 */
async function clickTextStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.click_text || typeof step.click_text.text !== "string") {
      return { success: false, error: "click_text step requires text string" };
    }
    const { text, match, selector } = step.click_text;
    const matchMode = match ?? "contains";
    const scope = selector ? JSON.stringify(selector) : "null";

    // Build per-element match expression (uses `elText` variable)
    let elMatchExpr: string;
    if (matchMode === "regex") {
      elMatchExpr = `new RegExp(${JSON.stringify(text)}).test(elText)`;
    } else if (matchMode === "exact") {
      elMatchExpr = `elText.trim() === ${JSON.stringify(text)}`;
    } else {
      elMatchExpr = `elText.includes(${JSON.stringify(text)})`;
    }

    const result = await client.evaluate(`(() => {
      const scopeEl = ${scope} ? document.querySelector(${scope}) : document.body;
      if (!scopeEl) return 'scope_not_found';
      const candidates = scopeEl.querySelectorAll('[role="button"], [tabindex="0"], button, a, [dir="auto"]');
      for (const el of candidates) {
        const elText = el.textContent || '';
        if (${elMatchExpr}) {
          const clickable = el.closest('[tabindex="0"], [role="button"], button, a') || el;
          clickable.click();
          return 'ok';
        }
      }
      return 'not_found';
    })()`);

    if (result === "scope_not_found") {
      return { success: false, error: `click_text: scope selector not found: ${selector}` };
    }
    if (result === "not_found") {
      return { success: false, error: `click_text: no element with text "${text}" found` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a click_nth step
 * Clicks the Nth element matching selector or text pattern
 */
async function clickNthStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.click_nth || typeof step.click_nth.index !== "number") {
      return { success: false, error: "click_nth step requires index number" };
    }
    const { index, text, selector, match } = step.click_nth;
    const cssSelector = selector ?? '[role="button"], [tabindex="0"]';
    const matchMode = match ?? "contains";

    // Build per-element filter expression (uses `elText` variable)
    let filterExpr: string;
    if (matchMode === "regex") {
      filterExpr = `new RegExp(${JSON.stringify(text ?? "")}).test(elText)`;
    } else if (matchMode === "exact") {
      filterExpr = `elText.trim() === ${JSON.stringify(text ?? "")}`;
    } else {
      filterExpr = `elText.includes(${JSON.stringify(text ?? "")})`;
    }

    const result = await client.evaluate(`(() => {
      const all = Array.from(document.querySelectorAll(${JSON.stringify(cssSelector)}));
      const hasText = ${text != null};
      let filtered = all;
      if (hasText) {
        filtered = all.filter(el => {
          const elText = el.textContent || '';
          return ${filterExpr};
        });
      }
      const idx = ${index};
      if (idx < 0 || idx >= filtered.length) return 'out_of_bounds:' + filtered.length;
      filtered[idx].click();
      return 'ok';
    })()`);

    if (typeof result === "string" && result.startsWith("out_of_bounds:")) {
      const count = result.split(":")[1];
      return { success: false, error: `click_nth: index ${index} out of bounds (${count} elements found)` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a type step
 * Types text character by character with delays
 */
async function typeStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.type || typeof step.type.selector !== "string" || typeof step.type.text !== "string") {
      return { success: false, error: "type step requires selector and text strings" };
    }
    const { selector, text, delay: delayMs, clear: shouldClear } = step.type;
    const delay = delayMs ?? 50;

    // Focus the element (and optionally clear)
    const focusResult = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      el.focus();
      ${shouldClear ? `
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) { nativeSetter.call(el, ''); } else { el.value = ''; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      ` : ""}
      return 'ok';
    })()`);

    if (focusResult === "not_found") {
      return { success: false, error: `type: element not found: ${selector}` };
    }

    // Type each character with a delay
    for (const char of text) {
      await client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(char)}, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ${JSON.stringify(char)}, bubbles: true }));
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) { nativeSetter.call(el, el.value + ${JSON.stringify(char)}); } else { el.value += ${JSON.stringify(char)}; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(char)}, bubbles: true }));
      })()`);
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a choose_dropdown step
 * Opens dropdown and selects an option by text
 */
async function chooseDropdownStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.choose_dropdown || typeof step.choose_dropdown.selector !== "string" || typeof step.choose_dropdown.text !== "string") {
      return { success: false, error: "choose_dropdown step requires selector and text strings" };
    }
    const { selector, text, match: matchMode, timeout: timeoutMs } = step.choose_dropdown;
    const timeout = timeoutMs ?? 3000;

    // Build the matching logic based on match mode
    let matchExpr: string;
    if (matchMode === "regex") {
      matchExpr = `new RegExp(${JSON.stringify(text)}).test(opt.textContent)`;
    } else if (matchMode === "exact") {
      matchExpr = `opt.textContent && opt.textContent.trim() === ${JSON.stringify(text)}`;
    } else {
      // "contains" (default)
      matchExpr = `opt.textContent && opt.textContent.includes(${JSON.stringify(text)})`;
    }

    // Phase 1: Click to open
    await client.click(selector);

    // Phase 2: Poll for options to appear
    const interval = 200;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await client.evaluate(`(() => {
        const options = document.querySelectorAll('[role="menuitem"], [role="option"]');
        if (options.length === 0) return 'no_options';
        for (const opt of options) {
          if (${matchExpr}) {
            opt.click();
            return 'ok';
          }
        }
        return 'not_matched';
      })()`);
      if (result === "ok") return { success: true };
      if (result === "not_matched") {
        return { success: false, error: `choose_dropdown: option "${text}" not found in dropdown (match: ${matchMode || "contains"})` };
      }
      // no_options — keep polling
      if (Date.now() + interval > deadline) break;
      await new Promise(r => setTimeout(r, interval));
    }
    return { success: false, error: `choose_dropdown: no options appeared after ${timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute an expand_menu step
 * Expands a collapsed navigation group by name
 */
async function expandMenuStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.expand_menu || typeof step.expand_menu.group !== "string") {
      return { success: false, error: "expand_menu step requires group string" };
    }
    const group = step.expand_menu.group;

    const result = await client.evaluate(`(() => {
      const group = ${JSON.stringify(group)};
      const collapsed = group + ', collapsed';
      const expanded = group + ', expanded';
      const all = document.querySelectorAll('[aria-label]');
      for (const el of all) {
        const label = el.getAttribute('aria-label');
        if (label === expanded) return 'already_expanded';
        if (label === collapsed) {
          el.click();
          return 'ok';
        }
      }
      return 'not_found';
    })()`);

    if (result === "not_found") {
      return { success: false, error: `expand_menu: group "${group}" not found` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a toggle step
 * Toggles a checkbox or switch by its label text
 */
async function toggleStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.toggle || typeof step.toggle.label !== "string") {
      return { success: false, error: "toggle step requires label string" };
    }
    const { label: labelText, state } = step.toggle;

    const result = await client.evaluate(`(() => {
      const labelText = ${JSON.stringify(labelText)};
      const desiredState = ${state != null ? JSON.stringify(state) : "null"};
      const labels = document.querySelectorAll('label');
      for (const lbl of labels) {
        if (!lbl.textContent || !lbl.textContent.includes(labelText)) continue;
        // Find associated input
        let input = lbl.htmlFor ? document.getElementById(lbl.htmlFor) : null;
        if (!input) input = lbl.querySelector('input[type="checkbox"], input[type="radio"]');
        if (!input) input = lbl.closest('[role="switch"], [role="checkbox"]') || lbl.querySelector('[role="switch"], [role="checkbox"]');
        if (!input) continue;
        // Check current state
        const currentState = input.checked ?? (input.getAttribute('aria-checked') === 'true');
        if (desiredState !== null && currentState === desiredState) return 'already_correct';
        input.click();
        return 'ok';
      }
      return 'not_found';
    })()`);

    if (result === "not_found") {
      return { success: false, error: `toggle: label "${labelText}" not found` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a close_modal step
 * Closes current modal/overlay using multiple strategies
 */
async function closeModalStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    const strategy = step.close_modal?.strategy;

    const tryButton = async (): Promise<boolean> => {
      const result = await client.evaluate(`(() => {
        const selectors = [
          '[aria-label="Close modal"]',
          '[aria-label="Close"]',
          '.close-button',
          'button.close',
          '[data-dismiss="modal"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { el.click(); return true; }
        }
        return false;
      })()`);
      return !!result;
    };

    const tryEscape = async (): Promise<boolean> => {
      await client.pressKey("Escape");
      return true;
    };

    const tryBackdrop = async (): Promise<boolean> => {
      const result = await client.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog && dialog.parentElement) {
          dialog.parentElement.click();
          return true;
        }
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
          backdrop.click();
          return true;
        }
        return false;
      })()`);
      return !!result;
    };

    if (strategy === "button") {
      const ok = await tryButton();
      return ok ? { success: true } : { success: false, error: "close_modal: no close button found" };
    }
    if (strategy === "escape") {
      await tryEscape();
      return { success: true };
    }
    if (strategy === "backdrop") {
      const ok = await tryBackdrop();
      return ok ? { success: true } : { success: false, error: "close_modal: no modal backdrop found" };
    }

    // Default: try all strategies in order
    if (await tryButton()) return { success: true };
    await tryEscape();
    // Escape always "succeeds" — we can't verify the modal closed without DOM checks
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
