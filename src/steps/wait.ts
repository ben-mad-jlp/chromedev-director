/**
 * Wait step handler for chromedev-director
 * Delays execution for a specified duration
 */

import { CDPClient, StepDef } from "../types";

/**
 * Executes a wait step by delaying for the specified duration
 *
 * @param client - The CDP client (unused for wait operations)
 * @param step - The step definition containing the wait duration in milliseconds
 * @param vars - Variables object (unused for wait operations)
 * @returns Promise resolving to success status
 *
 * @example
 * // Wait for 1 second
 * await waitStep(client, { wait: 1000 }, {})
 * // Returns: { success: true }
 *
 * @example
 * // Invalid duration (not a number)
 * await waitStep(client, { wait: "invalid" }, {})
 * // Returns: { success: false, error: "wait duration must be a number" }
 */
export async function waitStep(
  client: CDPClient,
  step: any,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const duration = step.wait;

    // Validate that duration is a number
    if (typeof duration !== "number") {
      return {
        success: false,
        error: "wait duration must be a number",
      };
    }

    // Wait for the specified duration
    await new Promise((resolve) => setTimeout(resolve, duration));

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
