/**
 * Mock network step handler for chromedev-director
 * Registers mock rules for intercepting and mocking network requests
 */

import { CDPClient, StepDef } from "../types";

/**
 * Executes a mock_network step by registering a mock rule for network request interception
 *
 * @param client - The CDP client instance
 * @param step - The step definition containing mock_network configuration
 * @param vars - Variables object (unused for mock_network operations)
 * @returns Promise resolving to success status or error details
 *
 * @example
 * // Mock a specific endpoint with a status code
 * await mockNetworkStep(client, { mock_network: { match: "/api/users", status: 200, body: { id: 1, name: "John" } } }, {})
 * // Returns: { success: true }
 *
 * @example
 * // Mock an endpoint with delay
 * await mockNetworkStep(client, { mock_network: { match: "/api/data", status: 200, body: {}, delay: 1000 } }, {})
 * // Returns: { success: true }
 *
 * @example
 * // Invalid match (not a string)
 * await mockNetworkStep(client, { mock_network: { match: 123, status: 200 } }, {})
 * // Returns: { success: false, error: "match and status are required" }
 *
 * @example
 * // Invalid status (not a number)
 * await mockNetworkStep(client, { mock_network: { match: "/api/test", status: "200" } }, {})
 * // Returns: { success: false, error: "match and status are required" }
 */
export async function mockNetworkStep(
  client: CDPClient,
  step: any,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { match, status, body, delay } = step.mock_network;

    // Validate that match is a string and status is a number
    if (typeof match !== "string" || typeof status !== "number") {
      return {
        success: false,
        error: "match and status are required",
      };
    }

    // Register the mock rule with the CDP client
    client.addMockRule(match, status, body, delay);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
