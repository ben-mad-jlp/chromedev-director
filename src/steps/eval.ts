/**
 * Eval and screenshot step handlers
 */

import { CDPClient as CDPClientInterface } from "../types.js";

/**
 * Execute an eval step
 * If the step has an 'as' field, stores the result for later use.
 * If the step has no 'as' field, treats falsy results as assertion failures.
 */
export async function evalStep(
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
 * Execute a screenshot step
 */
export async function screenshotStep(
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
