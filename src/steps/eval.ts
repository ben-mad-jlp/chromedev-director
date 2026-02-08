/**
 * Eval step handler for chromedev-director
 * Evaluates JavaScript expressions and returns the result
 */

import { CDPClient, StepDef } from "../types";

/**
 * Executes an eval step by evaluating a JavaScript expression
 *
 * @param client - The CDP client used to evaluate expressions
 * @param step - The step definition containing the JavaScript expression to evaluate
 * @param vars - Variables object (unused for eval operations)
 * @returns Promise resolving to success status with the evaluated value
 *
 * @example
 * // Evaluate a simple expression
 * await evalStep(client, { eval: "1 + 1" }, {})
 * // Returns: { success: true, value: 2 }
 *
 * @example
 * // Evaluate DOM query
 * await evalStep(client, { eval: "document.title" }, {})
 * // Returns: { success: true, value: "Page Title" }
 *
 * @example
 * // Invalid expression (not a string)
 * await evalStep(client, { eval: 123 }, {})
 * // Returns: { success: false, error: "eval expression must be a string" }
 *
 * @example
 * // Expression evaluation error
 * await evalStep(client, { eval: "nonexistent.variable" }, {})
 * // Returns: { success: false, error: "ReferenceError: nonexistent is not defined" }
 */
export async function evalStep(
  client: CDPClient,
  step: any,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string; value?: unknown }> {
  try {
    const expression = step.eval;

    // Validate that expression is a string
    if (typeof expression !== "string") {
      return {
        success: false,
        error: "eval expression must be a string",
      };
    }

    // Evaluate the expression
    const result = await client.evaluate(expression);

    return { success: true, value: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
