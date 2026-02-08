/**
 * Assert step handler for chromedev-director
 * Evaluates an assertion expression with retry logic
 */

import { CDPClient, StepDef } from "../types";

/**
 * Executes an assert step by evaluating an assertion expression with retries
 *
 * @param client - The CDP client used to evaluate expressions
 * @param step - The step definition containing the assertion expression and retry config
 * @param vars - Variables object (unused for assertion operations)
 * @returns Promise resolving to success status
 *
 * @example
 * // Simple assertion that passes
 * await assertStep(client, { assert: "document.title !== ''" }, {})
 * // Returns: { success: true }
 *
 * @example
 * // Assertion with custom retry settings
 * await assertStep(client, {
 *   assert: "document.body.textContent.includes('Loaded')",
 *   retry: { interval: 200, timeout: 3000 }
 * }, {})
 * // Returns: { success: true } or { success: false, error: "Assertion failed after retries" }
 *
 * @example
 * // Invalid assertion (not a string)
 * await assertStep(client, { assert: 123 }, {})
 * // Returns: { success: false, error: "assert expression must be a string" }
 *
 * @example
 * // Assertion that fails after timeout
 * await assertStep(client, {
 *   assert: "document.getElementById('nonexistent')",
 *   retry: { interval: 100, timeout: 500 }
 * }, {})
 * // Returns: { success: false, error: "Assertion failed after retries" }
 */
export async function assertStep(
  client: CDPClient,
  step: any,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const expression = step.assert;
    const retry = step.retry || { interval: 100, timeout: 5000 };

    // Validate that expression is a string
    if (typeof expression !== "string") {
      return { success: false, error: "assert expression must be a string" };
    }

    // Validate retry configuration
    if (
      typeof retry.interval !== "number" ||
      typeof retry.timeout !== "number"
    ) {
      return {
        success: false,
        error: "retry.interval and retry.timeout must be numbers",
      };
    }

    // Retry loop with timeout
    const startTime = Date.now();
    while (Date.now() - startTime < retry.timeout) {
      try {
        const result = await client.evaluate(expression);
        // Check if the result is truthy
        if (result) {
          return { success: true };
        }
      } catch (evalError) {
        // Continue retrying on evaluation errors
        // (e.g., element not yet available)
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, retry.interval));
    }

    return { success: false, error: "Assertion failed after retries" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
