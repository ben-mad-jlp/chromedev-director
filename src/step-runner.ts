/**
 * Step runner for executing test steps with variable chaining support
 * Handles step execution, variable storage, and resume functionality
 */

import { TestDef, StepDef, TestResult, CDPClient as CDPClientInterface, OnEvent, RunEvent, VerifyPageDef } from "./types.js";
import { interpolate, interpolateStep } from "./env.js";
import { CDPClient } from "./cdp-client.js";
import { SessionManager } from "./session-manager.js";
import { STEP_REGISTRY } from "./steps/registry.js";
import { emit, RunContext } from "./steps/_utils.js";

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

    // Dispatch to appropriate handler via registry
    const stepType = getStepType(step);
    const handler = STEP_REGISTRY[stepType];
    if (!handler) {
      return { success: false, error: `Unknown step type: ${stepType}` };
    }

    // Special args for specific handlers
    if (stepType === "loop" || stepType === "run_test") {
      return await handler(step, client, vars, onEvent, projectRoot, context, executeStep);
    } else if (stepType === "eval") {
      return await handler(step, client, vars, isHook);
    } else if (stepType === "http_request") {
      return await handler(step as any, vars);
    } else {
      return await handler(step, client, vars);
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
