/**
 * Typed fetch wrapper for chromedev-director API
 * Handles JSON serialization/deserialization, error handling, and type safety
 */

import type { SavedTest, TestRun } from "./types.js";

/**
 * API error class
 * Extends Error with HTTP status and response data for detailed error handling
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
    message?: string
  ) {
    super(message ?? `API error: ${status}`);
    this.name = "ApiError";
  }
}

/**
 * Typed fetch wrapper
 * Handles JSON serialization/deserialization and error responses
 *
 * @param path - URL path (e.g., "/tests")
 * @param options - Fetch options (method, headers, body will be auto-serialized)
 * @param baseUrl - Base URL for API requests (defaults to "/api")
 * @returns Promise resolving to parsed JSON response
 * @throws ApiError on non-2xx status codes
 */
async function apiFetch<T>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {},
  baseUrl: string = "/api"
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers = new Headers(options.headers);

  // Set Content-Type for JSON if body is present
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Serialize body if it's an object
  const body =
    options.body !== undefined
      ? typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body)
      : undefined;

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  } as RequestInit);

  // Parse response body
  let responseData: unknown = null;
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    responseData = await response.json();
  } else if (response.ok) {
    responseData = await response.text();
  }

  // Throw on error status
  if (!response.ok) {
    throw new ApiError(
      response.status,
      responseData,
      `${response.status} ${response.statusText}`
    );
  }

  return responseData as T;
}

/**
 * List all saved tests
 * @returns Array of SavedTest objects
 */
export async function listTests(): Promise<SavedTest[]> {
  const data = await apiFetch<{ tests: SavedTest[] }>("/tests", { method: "GET" });
  return data.tests;
}

/**
 * Get a specific test by ID
 * @param id - Test ID
 * @returns SavedTest object
 */
export async function getTest(id: string): Promise<SavedTest> {
  const data = await apiFetch<{ test: SavedTest }>(`/tests/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  return data.test;
}

/**
 * Save or update a test
 * @param test - SavedTest object to save
 */
export async function saveTest(test: SavedTest): Promise<void> {
  await apiFetch<{ test: SavedTest }>(`/tests/${encodeURIComponent(test.id)}`, {
    method: "PUT",
    body: test,
  });
}

/**
 * Delete a test by ID
 * @param id - Test ID
 */
export async function deleteTest(id: string): Promise<void> {
  return apiFetch<void>(`/tests/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * List all test runs for a specific test
 * @param testId - Test ID
 * @returns Array of TestRun objects
 */
export async function listResults(testId: string): Promise<TestRun[]> {
  const data = await apiFetch<{ runs: TestRun[] }>(
    `/tests/${encodeURIComponent(testId)}/results`,
    {
      method: "GET",
    }
  );
  return data.runs;
}

/**
 * Get a specific test run
 * @param testId - Test ID
 * @param runId - Run ID
 * @returns TestRun object
 */
export async function getResult(
  testId: string,
  runId: string
): Promise<TestRun> {
  const data = await apiFetch<{ run: TestRun }>(
    `/tests/${encodeURIComponent(testId)}/results/${encodeURIComponent(runId)}`,
    {
      method: "GET",
    }
  );
  return data.run;
}

/**
 * Run a test by ID (triggers async execution on the server)
 * @param testId - Test ID to run
 * @param inputs - Optional runtime input values to seed as $vars
 * @returns Object with runId for tracking the test execution
 */
export async function runTest(testId: string, inputs?: Record<string, unknown>): Promise<{ runId: string }> {
  return apiFetch<{ runId: string; result: TestRun }>(
    `/tests/${encodeURIComponent(testId)}/run`,
    {
      method: "POST",
      body: inputs ? { inputs } : {},
    }
  );
}

/**
 * Get Chrome connection status
 * @returns Object with connection status and optional version info
 */
export async function getChromeStatus(): Promise<{
  connected: boolean;
  version?: string;
}> {
  return apiFetch<{ connected: boolean; version?: string }>(
    "/chrome/status",
    {
      method: "GET",
    }
  );
}

/**
 * Get server health and project info
 */
export async function getHealth(): Promise<{
  status: string;
  projectRoot: string;
}> {
  return apiFetch<{ status: string; projectRoot: string }>("/health", {
    method: "GET",
  });
}

/**
 * Switch to a different project root
 * @param projectRoot - Absolute path to the new project root directory
 * @returns Object with the new projectRoot
 */
export async function switchProject(projectRoot: string): Promise<{ projectRoot: string }> {
  return apiFetch<{ projectRoot: string }>("/project", {
    method: "PUT",
    body: { projectRoot },
  });
}
