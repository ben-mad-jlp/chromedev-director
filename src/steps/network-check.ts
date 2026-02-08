/**
 * Network response status checker step handler for chromedev-director
 * Validates that no network responses have failed (4xx/5xx) status codes
 */

import { CDPClient, StepDef } from "../types";

/**
 * Executes a network check step by validating network response statuses
 *
 * @param client - The CDP client used to retrieve network responses
 * @param step - The step definition containing the network_check flag
 * @param vars - Variables object (unused for network check operations)
 * @returns Promise resolving to success/failure with error details if applicable
 *
 * @example
 * // Check that all network responses are successful
 * await networkCheckStep(client, { network_check: true }, {})
 * // Returns: { success: true } if all responses have status < 400
 * // Returns: { success: false, error: "Network errors: 404 https://api.example.com/users; 500 https://api.example.com/data" }
 *
 * @example
 * // Skip network check
 * await networkCheckStep(client, { network_check: false }, {})
 * // Returns: { success: true }
 *
 * @example
 * // Invalid network_check value (not a boolean)
 * await networkCheckStep(client, { network_check: "true" }, {})
 * // Returns: { success: false, error: "network_check must be a boolean" }
 */
export async function networkCheckStep(
  client: CDPClient,
  step: any,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const shouldCheck = step.network_check;

    // Validate that network_check is a boolean
    if (typeof shouldCheck !== "boolean") {
      return {
        success: false,
        error: "network_check must be a boolean",
      };
    }

    // If network_check is false, skip the check
    if (!shouldCheck) {
      return { success: true };
    }

    // Get network responses from the CDP client
    const responses = await client.getNetworkResponses();

    // Filter for error responses (4xx and 5xx status codes)
    const errors = responses.filter((resp) => resp.status >= 400);

    // If there are errors, return them as a formatted list
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
