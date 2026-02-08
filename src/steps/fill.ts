/**
 * Fill step handler for chromedev-director
 * Fills form fields (text, checkbox, radio, select inputs) with specified values
 */

import { CDPClient, StepDef } from "../types";

/**
 * Executes a fill step by populating a form field with a value
 *
 * @param client - The CDP client instance
 * @param step - The step definition containing selector and value for the fill operation
 * @param vars - Variables object (unused for fill operations)
 * @returns Promise resolving to success status or error details
 *
 * @example
 * // Fill a text input
 * await fillStep(client, { fill: { selector: "input[name='email']", value: "test@example.com" } }, {})
 * // Returns: { success: true }
 *
 * @example
 * // Invalid selector (not a string)
 * await fillStep(client, { fill: { selector: 123, value: "test" } }, {})
 * // Returns: { success: false, error: "selector and value must be strings" }
 *
 * @example
 * // Invalid value (not a string)
 * await fillStep(client, { fill: { selector: "input", value: null } }, {})
 * // Returns: { success: false, error: "selector and value must be strings" }
 */
export async function fillStep(
  client: CDPClient,
  step: any,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { selector, value } = step.fill;

    // Validate that selector and value are strings
    if (typeof selector !== "string" || typeof value !== "string") {
      return {
        success: false,
        error: "selector and value must be strings",
      };
    }

    // Fill the form field using the CDP client
    await client.fill(selector, value);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
