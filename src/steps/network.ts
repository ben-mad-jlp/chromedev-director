/**
 * Network step handlers: network_check, console_check, mock_network, http_request
 */

import { CDPClient as CDPClientInterface, StepDef } from "../types.js";

/**
 * Execute a network_check step
 * Validates that no network responses have 4xx/5xx status codes
 */
export async function networkCheckStep(
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
 * Execute a console_check step
 * Checks collected console messages for specified log levels
 */
export async function consoleCheckStep(
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
 * Execute a mock_network step
 */
export async function mockNetworkStep(
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
 * Execute an http_request step
 * Makes a server-side HTTP request using Node's fetch API
 */
export async function httpRequestStep(
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
