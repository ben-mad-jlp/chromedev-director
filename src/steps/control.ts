/**
 * Control flow step handlers: loop, run_test
 * These handlers receive executeStep as a callback to avoid circular imports.
 */

import { CDPClient as CDPClientInterface, OnEvent } from "../types.js";
import { interpolate, interpolateStep, markVarSynced, unmarkVarSynced } from "../env.js";
import { getTest } from "../storage.js";
import { emit, RunContext, ExecuteStepFn, StepResult } from "./_utils.js";

/**
 * Execute a loop step
 * Supports two modes: `over` (iterate array) and `while` (repeat while truthy)
 */
export async function loopStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  onEvent: OnEvent | undefined,
  projectRoot: string,
  context: RunContext,
  executeStepFn: ExecuteStepFn
): Promise<StepResult> {
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

            const result = await executeStepFn(interpolatedStep, client, vars, onEvent, projectRoot, context);

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

            const result = await executeStepFn(interpolatedStep, client, vars, onEvent, projectRoot, context);

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
 * Execute a run_test step
 * Resolves a test by ID from storage and executes its steps inline
 * Supports nested test execution with cycle detection
 */
export async function runTestStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  onEvent: OnEvent | undefined,
  projectRoot: string,
  context: RunContext,
  executeStepFn: ExecuteStepFn
): Promise<StepResult> {
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
        const result = await executeStepFn(
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
