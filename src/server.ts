/**
 * MCP server for chromedev-director
 * Provides run_test tool for executing autonomous tests against Chrome instances
 * Implements stdio transport for Claude integration
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runTest } from "./step-runner.js";
import { runSuite } from "./suite-runner.js";
import { TestDef, TestResult, SavedTest, SuiteResult } from "./types.js";
import * as storageModule from "./storage.js";

/**
 * Storage interface for CRUD operations
 * Uses functions from storage module to persist tests and results
 */
interface Storage {
  storageDir: string;
  saveTest(
    id: string,
    name: string,
    test: TestDef,
    opts?: { description?: string; tags?: string[] }
  ): Promise<SavedTest>;
  getTest(id: string): Promise<SavedTest | null>;
  listTests(filter?: { tag?: string }): Promise<SavedTest[]>;
  deleteTest(id: string): Promise<void>;
  updateTest(
    id: string,
    updates: Partial<Pick<SavedTest, 'name' | 'description' | 'tags' | 'definition'>>
  ): Promise<SavedTest>;
  saveRun(testId: string, result: TestResult): Promise<any>;
}

/**
 * Tool definition interface for tool registry pattern
 */
interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  handler: (
    args: Record<string, any>,
    ctx: { storage: Storage }
  ) => Promise<any>;
}

/**
 * Zod schema for TestDef validation
 * Ensures all incoming test definitions match the expected structure
 */
const TestDefSchema = z.object({
  url: z.string(),
  env: z.record(z.unknown()).optional(),
  inputs: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(['text', 'number', 'boolean']),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    required: z.boolean().optional(),
  })).optional(),
  before: z.array(z.unknown()).optional(),
  after: z.array(z.unknown()).optional(),
  steps: z.array(z.unknown()),
  timeout: z.number().optional(),
  resume_from: z.number().optional(),
});

/**
 * Zod schema for save_test tool input
 * Validates request to save a test definition
 */
const SaveTestInputSchema = z.object({
  name: z.string().min(1, "name is required"),
  test: TestDefSchema,
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Zod schema for list_tests tool input (no parameters)
 */
const ListTestsInputSchema = z.object({});

/**
 * Zod schema for get_test tool input
 */
const GetTestInputSchema = z.object({
  id: z.string().min(1, "id is required"),
});

/**
 * Zod schema for delete_test tool input
 */
const DeleteTestInputSchema = z.object({
  id: z.string().min(1, "id is required"),
});

/**
 * Zod schema for update_test tool input
 */
const UpdateTestInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  test: TestDefSchema.optional(),
});

/**
 * Zod schema for step-level tool inputs
 */
const SectionSchema = z.enum(["steps", "before", "after"]).default("steps");

const AddStepInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  step: z.record(z.unknown()),
  index: z.number().int().min(0).optional(),
  section: SectionSchema,
});

const RemoveStepInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  index: z.number().int().min(0),
  section: SectionSchema,
});

const UpdateStepInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  index: z.number().int().min(0),
  step: z.record(z.unknown()),
  section: SectionSchema,
});

const MoveStepInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  section: SectionSchema,
});

/**
 * Zod schema for list_results tool input
 * Validates request to list test run results
 */
const ListResultsInputSchema = z.object({
  testId: z.string(),
  limit: z.number().optional(),
});

/**
 * Zod schema for get_result tool input
 * Validates request to get a specific test run result
 */
const GetResultInputSchema = z.object({
  testId: z.string(),
  runId: z.string(),
});

/**
 * Create and configure the MCP server
 * Sets up tools, capabilities, and request handlers
 *
 * @returns Configured Server instance
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "chromedev-director",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Initialize storage instance using the storage module
  const storageDir = process.env.DIRECTOR_STORAGE_DIR || process.cwd() + "/.chromedev-director";
  const storage: Storage = {
    storageDir,
    async saveTest(
      id: string,
      name: string,
      test: TestDef,
      opts?: { description?: string; tags?: string[] }
    ): Promise<SavedTest> {
      return storageModule.saveTest(storageDir, id, name, test, opts);
    },
    async getTest(id: string): Promise<SavedTest | null> {
      return storageModule.getTest(storageDir, id);
    },
    async listTests(filter?: { tag?: string }): Promise<SavedTest[]> {
      return storageModule.listTests(storageDir, filter);
    },
    async deleteTest(id: string): Promise<void> {
      return storageModule.deleteTest(storageDir, id);
    },
    async updateTest(
      id: string,
      updates: Partial<Pick<SavedTest, 'name' | 'description' | 'tags' | 'definition'>>
    ): Promise<SavedTest> {
      return storageModule.updateTest(storageDir, id, updates);
    },
    async saveRun(testId: string, result: TestResult): Promise<any> {
      return storageModule.saveRun(storageDir, testId, result);
    },
  };

  /**
   * Tool: save_test
   * Saves a test definition with a name for later retrieval and execution
   */
  const saveTestTool: ToolDef = {
    name: "save_test",
    description: `Save a test definition for later retrieval and execution.

## Input Parameters

- \`name\` (string, required) — Human-readable name for the test
- \`test\` (TestDef, required) — Test definition with url, steps, etc.
- \`description\` (string, optional) — Longer description of what the test does
- \`tags\` (array of strings, optional) — Tags for organization (e.g., ["smoke", "auth"])

## Output

\`\`\`json
{
  "id": "my-test-slug",
  "name": "My Test Name"
}
\`\`\`

## Example

\`\`\`json
{
  "name": "Login Flow",
  "test": {
    "url": "https://example.com",
    "steps": [
      { "fill": { "selector": "[aria-label='Email']", "value": "user@test.com" } },
      { "click": { "selector": "button[type='submit']" } },
      { "wait": 1000 },
      { "assert": "document.querySelector('.dashboard')" }
    ]
  },
  "description": "Tests the basic login flow with valid credentials",
  "tags": ["auth", "smoke"]
}
\`\`\`

## Notes

- Test ID is derived from the name (e.g., "My Test" → "my-test")
- ID must be globally unique — attempting to save with a duplicate name will fail
- Use the returned \`id\` to run saved tests with \`run_test\` tool (via testId parameter)`,
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Human-readable name for the test",
        },
        test: {
          type: "object",
          description: "Test definition (TestDef)",
        },
        description: {
          type: "string",
          description: "Optional longer description",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for organization",
        },
      },
      required: ["name", "test"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = SaveTestInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { name, test, description, tags } = parseResult.data;
      const id = storageModule.slugify(name);
      const saved = await ctx.storage.saveTest(id, name, test as TestDef, { description, tags });
      return { id: saved.id, name: saved.name };
    },
  };

  /**
   * Tool: list_tests
   * Lists all saved tests with basic metadata
   */
  const listTestsTool: ToolDef = {
    name: "list_tests",
    description: `List all saved tests with basic metadata.

## Input Parameters

None.

## Output

\`\`\`json
{
  "tests": [
    {
      "id": "login-flow",
      "name": "Login Flow",
      "description": "Tests the basic login flow",
      "tags": ["auth", "smoke"],
      "createdAt": "2026-02-07T18:30:00Z"
    },
    {
      "id": "checkout-flow",
      "name": "Checkout Flow",
      "description": "Tests the e-commerce checkout",
      "tags": ["e2e"],
      "createdAt": "2026-02-07T17:45:00Z"
    }
  ]
}
\`\`\`

## Example

\`\`\`json
{}
\`\`\`

## Notes

- Results are sorted by creation time (newest first)
- Use \`get_test\` to retrieve the full test definition for execution`,
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const tests = await ctx.storage.listTests();
      return {
        tests: tests.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          tags: t.tags,
          createdAt: t.createdAt,
        })),
      };
    },
  };

  /**
   * Tool: get_test
   * Retrieves a saved test definition by ID for inspection or execution
   */
  const getTestTool: ToolDef = {
    name: "get_test",
    description: `Retrieve a saved test definition by ID.

## Input Parameters

- \`id\` (string, required) — The test ID (from \`save_test\` or \`list_tests\`)

## Output

\`\`\`json
{
  "id": "login-flow",
  "name": "Login Flow",
  "description": "Tests the basic login flow",
  "tags": ["auth", "smoke"],
  "test": {
    "url": "https://example.com",
    "steps": [
      { "fill": { "selector": "[aria-label='Email']", "value": "user@test.com" } },
      { "click": { "selector": "button[type='submit']" } }
    ]
  },
  "createdAt": "2026-02-07T18:30:00Z",
  "updatedAt": "2026-02-07T18:30:00Z"
}
\`\`\`

## Example

\`\`\`json
{ "id": "login-flow" }
\`\`\`

## Notes

- Returns null if the test is not found
- Use the full test definition with \`run_test\` tool to execute it`,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The test ID",
        },
      },
      required: ["id"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = GetTestInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { id } = parseResult.data;
      const test = await ctx.storage.getTest(id);
      if (!test) {
        throw new Error(`Test not found: ${id}`);
      }
      return test;
    },
  };

  /**
   * Tool: delete_test
   * Deletes a saved test and all its associated run history
   */
  const deleteTestTool: ToolDef = {
    name: "delete_test",
    description: `Delete a saved test and all its associated run history.

## Input Parameters

- \`id\` (string, required) — The test ID to delete

## Output

\`\`\`json
{
  "ok": true
}
\`\`\`

## Example

\`\`\`json
{ "id": "login-flow" }
\`\`\`

## Notes

- This operation is permanent — the test and all its run results will be deleted
- Returns an error if the test is not found`,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The test ID to delete",
        },
      },
      required: ["id"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = DeleteTestInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { id } = parseResult.data;
      await ctx.storage.deleteTest(id);
      return { ok: true };
    },
  };

  /**
   * Tool: list_results
   * Lists test run results for a specific test
   */
  const listResultsTool: ToolDef = {
    name: "list_results",
    description: `List test run results for a specific test ID.

Returns an array of result summaries ordered by timestamp (newest first).

## Input Parameters

- \`testId\` (string) — The ID of the test to fetch results for
- \`limit\` (number, optional) — Maximum number of results to return (default: all)

## Output

\`\`\`json
{
  "results": [
    { "runId": "uuid", "timestamp": 1704067200000, "status": "passed", "duration_ms": 2345 },
    { "runId": "uuid", "timestamp": 1704067100000, "status": "failed", "duration_ms": 5678 }
  ]
}
\`\`\`

## Example

\`\`\`json
{ "testId": "login-flow", "limit": 10 }
\`\`\`

## Notes

- Timestamp is Unix milliseconds
- Results are sorted newest first
- Status is either "passed" or "failed"
- Use \`get_result\` to fetch the full result details including error messages`,
    inputSchema: {
      type: "object" as const,
      properties: {
        testId: {
          type: "string",
          description: "The test ID to fetch results for",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (optional)",
        },
      },
      required: ["testId"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = ListResultsInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { testId, limit } = parseResult.data;
      const runs = await storageModule.listRuns(ctx.storage.storageDir, testId, { limit });
      return {
        results: runs.map(r => ({
          runId: r.id,
          timestamp: new Date(r.startedAt).getTime(),
          status: r.status,
          duration_ms: r.duration_ms,
        })),
      };
    },
  };

  /**
   * Tool: get_result
   * Retrieves the full result of a specific test run
   */
  const getResultTool: ToolDef = {
    name: "get_result",
    description: `Get the full result of a specific test run.

Retrieves complete details of a test run including all step information and error messages.

## Input Parameters

- \`testId\` (string) — The test ID
- \`runId\` (string) — The run ID to fetch

## Output

\`\`\`json
{
  "runId": "uuid",
  "testId": "login-flow",
  "timestamp": 1704067200000,
  "status": "passed",
  "duration_ms": 2345,
  "result": {
    "status": "passed",
    "steps_completed": 8,
    "duration_ms": 2345
  }
}
\`\`\`

or on failure:

\`\`\`json
{
  "runId": "uuid",
  "testId": "login-flow",
  "timestamp": 1704067200000,
  "status": "failed",
  "duration_ms": 5678,
  "result": {
    "status": "failed",
    "failed_step": 3,
    "failed_label": "Click Login Button",
    "step_definition": { "click": { "selector": "button[type='submit']" } },
    "error": "Element not found",
    "console_errors": ["TypeError: window.login is not a function"],
    "dom_snapshot": "<html>..."
  }
}
\`\`\`

## Example

\`\`\`json
{ "testId": "login-flow", "runId": "abc-123-def" }
\`\`\`

## Notes

- Returns null if the result is not found
- For failed results, includes console_errors and dom_snapshot for debugging
- Use \`list_results\` first to get available run IDs`,
    inputSchema: {
      type: "object" as const,
      properties: {
        testId: {
          type: "string",
          description: "The test ID",
        },
        runId: {
          type: "string",
          description: "The run ID to fetch",
        },
      },
      required: ["testId", "runId"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = GetResultInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { testId, runId } = parseResult.data;
      const run = await storageModule.getRun(ctx.storage.storageDir, testId, runId);
      if (!run) {
        throw new Error(`Result not found: ${runId}`);
      }
      return {
        runId: run.id,
        testId: run.testId,
        timestamp: new Date(run.startedAt).getTime(),
        status: run.status,
        duration_ms: run.duration_ms,
        result: run.result,
      };
    },
  };

  /**
   * Define run_test tool schema
   */
  const runTestTool = {
    name: "run_test",
    description: `Run an autonomous test against a Chrome instance via Chrome DevTools Protocol.

## Two Modes

### Mode 1: Saved Test by ID (with result persistence)
Pass \`testId\` to run a previously saved test and automatically save the result:
\`\`\`json
{ "testId": "login-flow" }
\`\`\`

### Mode 2: Inline Test Definition (ad-hoc, no persistence)
Pass \`test\` to run a test immediately without saving:
\`\`\`json
{ "test": { "url": "...", "steps": [...] } }
\`\`\`

## TestDef structure

\`\`\`ts
{
  url: string,          // Page to navigate to after \`before\` hooks run
  inputs?: InputDef[],  // Runtime inputs — user provides values before run, seeded as $vars.name
  before?: StepDef[],   // Steps that run BEFORE navigation — use for mock_network setup
  steps: StepDef[],     // Main test steps, run sequentially after page load
  after?: StepDef[],    // Cleanup steps, ALWAYS run even if steps fail
  env?: Record<string, unknown>,  // $env.KEY interpolation in step strings
  timeout?: number,     // Test-level timeout in ms (default 30000)
  resume_from?: number  // Skip to step N (checks variable dependencies)
}
\`\`\`

## Runtime inputs

Declare \`inputs\` on a TestDef to parameterize tests. Values are seeded as \`$vars.name\` before step 1.

\`\`\`ts
InputDef = { name: string, label: string, type: 'text' | 'number' | 'boolean', default?: value, required?: boolean }
\`\`\`

- In the GUI, clicking Run opens a form pre-filled with defaults; the user fills in values and submits.
- Via MCP, pass \`inputs\` (a \`Record<string, unknown>\`) alongside \`testId\` or \`test\` to provide values directly.
- Required inputs without defaults that are missing will cause a validation error.
- Example: \`{ "testId": "login-flow", "inputs": { "username": "admin", "password": "1234" } }\`

## Step types

- **eval** — Execute JS in the page. Use \`as\` to store the result in \`$vars.NAME\`.
  \`{ eval: "document.title", as: "title" }\`
  Returns objects automatically (auto-serialized). Use an IIFE for complex DOM traversal.

- **fill** — Fill an input field. Dispatches input/change events so React controlled components update.
  \`{ fill: { selector: "[aria-label='Email']", value: "user@test.com" } }\`

- **click** — Click an element by CSS selector.
  \`{ click: { selector: "button[type='submit']" } }\`

- **assert** — Assert a JS expression is truthy. Use \`retry\` for polling.
  \`{ assert: "document.querySelector('.success')", retry: { interval: 500, timeout: 5000 } }\`

- **wait** — Sleep for N milliseconds. Use after actions that trigger async renders (500-2000ms).
  \`{ wait: 1000 }\`

- **wait_for** — Poll for element existence by CSS selector.
  \`{ wait_for: { selector: ".loaded", timeout: 10000 } }\`

- **console_check** — Fail if console messages exist at given levels. Use \`"warning"\` not \`"warn"\` (CDP uses \`"warning"\`).
  \`{ console_check: ["error", "warning"] }\`

- **network_check** — Fail if any 4xx/5xx responses were captured.
  \`{ network_check: true }\`

- **mock_network** — Intercept requests matching a glob pattern and return a mock response.
  \`{ mock_network: { match: "*api/users*", status: 200, body: [{ id: 1, name: "Test" }] } }\`

- **screenshot** — Capture a PNG screenshot. Use \`as\` to store base64 data in \`$vars\`.
  \`{ screenshot: { as: "loginScreen" } }\`

- **select** — Select an option in a native \`<select>\` dropdown.
  \`{ select: { selector: "select#country", value: "US" } }\`

- **press_key** — Dispatch a keyboard event. Supports modifier keys.
  \`{ press_key: { key: "Enter" } }\`
  \`{ press_key: { key: "a", modifiers: ["ctrl"] } }\`

- **hover** — Hover over an element (dispatches mouseMoved to center of element).
  \`{ hover: { selector: ".dropdown-trigger" } }\`

- **switch_frame** — Switch execution context to an iframe, or back to main frame.
  \`{ switch_frame: { selector: "iframe#content" } }\` — switch to iframe
  \`{ switch_frame: {} }\` — return to main frame

- **handle_dialog** — Configure auto-handling for JS dialogs (alert/confirm/prompt).
  \`{ handle_dialog: { action: "accept" } }\`
  \`{ handle_dialog: { action: "accept", text: "yes" } }\`

- **http_request** — Make a server-side HTTP request (Node fetch, not browser). Useful for API setup/teardown.
  In before hooks, runs BEFORE navigation (seeds external services before app loads).
  Response body stored in \`$vars\` via \`as\` field.
  \`{ http_request: { url: "$env.API/seed/reset", method: "POST" } }\`
  \`{ http_request: { url: "$env.API/data", as: "response" } }\`

## Conditional steps

Any step can have an \`if\` field with a JS expression. If the expression evaluates to falsy, the step is silently skipped.
\`{ click: { selector: ".optional-btn" }, if: "document.querySelector('.optional-btn')" }\`
If the \`if\` expression throws, the step fails. If an eval step with \`as\` is skipped, the variable is NOT set.

## mock_network details

- \`match\` uses glob patterns: \`*api/users*\` matches any URL containing \`api/users\`
- First matching rule wins — register most specific patterns first
- \`body\` is auto-JSON-stringified — pass objects, not pre-serialized strings
- Body must match the exact DTO shape the app expects
- CORS preflight (OPTIONS) is handled automatically — responds with 204 + CORS headers
- Register mocks in \`before\` steps so they're active before page navigation

## Tips

- Always add \`wait\` steps (500-2000ms) after actions that trigger async renders
- Use \`label\` on every step for clear error messages on failure
- For complex DOM interaction, use \`eval\` with an IIFE that traverses the DOM
- The test result includes \`console_errors\` and \`dom_snapshot\` on failure for diagnostics
- \`$vars.KEY\` interpolation is raw text replacement — string values need quoting in eval expressions`,
    inputSchema: {
      type: "object" as const,
      properties: {
        test: {
          type: "object",
          description: "Test definition (TestDef) for inline execution — see tool description for full schema. Mutually exclusive with testId.",
        },
        testId: {
          type: "string",
          description: "ID of a saved test to execute. Result will be persisted. Mutually exclusive with test.",
        },
        inputs: {
          type: "object",
          description: "Runtime input values to seed as $vars before step execution. Keys are input names, values are the provided values. Used with tests that declare an `inputs` array in their definition.",
        },
        port: {
          type: "number",
          description: "Chrome DevTools Protocol port (default: 9222)",
        },
      },
      required: [],
    },
  };

  /**
   * Tool: run_suite
   * Run a suite of tests sequentially with aggregate results
   */
  const runSuiteTool: ToolDef = {
    name: "run_suite",
    description: `Run a suite of saved tests sequentially and return aggregate results.

## Input Parameters

- \`tag\` (string, optional) — Run all tests matching this tag. Mutually exclusive with \`testIds\`.
- \`testIds\` (array of strings, optional) — Run these specific tests by ID. Mutually exclusive with \`tag\`.
- \`port\` (number, optional) — Chrome DevTools Protocol port (default: 9222)
- \`stopOnFailure\` (boolean, optional) — Stop after first test failure (default: false)

Must provide either \`tag\` or \`testIds\`.

## Output

\`\`\`json
{
  "status": "passed",
  "total": 5,
  "passed": 4,
  "failed": 1,
  "skipped": 0,
  "duration_ms": 12345,
  "results": [
    { "testId": "login-flow", "testName": "Login Flow", "status": "passed", "duration_ms": 2000, "runId": "..." },
    { "testId": "checkout", "testName": "Checkout", "status": "failed", "duration_ms": 3000, "error": "...", "runId": "..." }
  ]
}
\`\`\`

## Example

\`\`\`json
{ "tag": "smoke" }
\`\`\`

\`\`\`json
{ "testIds": ["login-flow", "checkout-flow"], "stopOnFailure": true }
\`\`\``,
    inputSchema: {
      type: "object" as const,
      properties: {
        tag: {
          type: "string",
          description: "Run all tests matching this tag",
        },
        testIds: {
          type: "array",
          items: { type: "string" },
          description: "Run these specific tests by ID",
        },
        port: {
          type: "number",
          description: "Chrome DevTools Protocol port (default: 9222)",
        },
        stopOnFailure: {
          type: "boolean",
          description: "Stop after first test failure (default: false)",
        },
      },
      required: [],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const { tag, testIds, port, stopOnFailure } = args;

      if (!tag && (!testIds || testIds.length === 0)) {
        throw new Error("Either 'tag' or 'testIds' must be provided");
      }

      const result = await runSuite({
        tag,
        testIds,
        port: port ?? 9222,
        stopOnFailure: stopOnFailure ?? false,
        storageDir: ctx.storage.storageDir,
      });

      return result;
    },
  };

  /**
   * Tool: update_test
   * Update test metadata and/or definition
   */
  const updateTestTool: ToolDef = {
    name: "update_test",
    description: `Update a saved test's metadata and/or definition.

## Input Parameters

- \`id\` (string, required) — The test ID to update
- \`name\` (string, optional) — New display name
- \`description\` (string, optional) — New description
- \`tags\` (string[], optional) — New tags (replaces existing tags, does not merge)
- \`test\` (TestDef, optional) — New full test definition (replaces entire definition)

## Output

\`\`\`json
{ "id": "login-flow", "name": "Login Flow", "updatedAt": "2026-02-09T..." }
\`\`\`

## Example

\`\`\`json
{ "id": "login-flow", "name": "Login Flow v2", "tags": ["auth", "regression"] }
\`\`\`

## Notes

- Only provided fields are updated; omitted fields are left unchanged
- Tags are replaced entirely (not merged) — pass the full desired tag list
- Returns an error if the test is not found`,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The test ID to update" },
        name: { type: "string", description: "New display name" },
        description: { type: "string", description: "New description" },
        tags: { type: "array", items: { type: "string" }, description: "New tags (replaces existing)" },
        test: { type: "object", description: "New full test definition (TestDef)" },
      },
      required: ["id"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = UpdateTestInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { id, name, description, tags, test } = parseResult.data;
      const updates: Partial<Pick<SavedTest, 'name' | 'description' | 'tags' | 'definition'>> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (tags !== undefined) updates.tags = tags;
      if (test !== undefined) updates.definition = test as TestDef;
      const updated = await ctx.storage.updateTest(id, updates);
      return { id: updated.id, name: updated.name, updatedAt: updated.updatedAt };
    },
  };

  /**
   * Helper: get the steps array for a section, initializing if needed
   */
  function getSection(definition: TestDef, section: "steps" | "before" | "after"): any[] {
    if (section === "steps") return definition.steps;
    if (!definition[section]) definition[section] = [];
    return definition[section]!;
  }

  /**
   * Tool: add_step
   * Insert a step into a saved test
   */
  const addStepTool: ToolDef = {
    name: "add_step",
    description: `Insert a step into a saved test at a specific position.

## Input Parameters

- \`id\` (string, required) — The test ID
- \`step\` (StepDef, required) — The step to insert
- \`index\` (number, optional) — Position to insert at (default: end of section)
- \`section\` ("steps" | "before" | "after", optional) — Which section to modify (default: "steps")

## Output

\`\`\`json
{ "id": "login-flow", "section": "steps", "index": 2, "total_steps": 5 }
\`\`\`

## Example

\`\`\`json
{ "id": "login-flow", "step": { "wait": 1000, "label": "Wait for render" }, "index": 3 }
\`\`\``,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The test ID" },
        step: { type: "object", description: "The step definition to insert" },
        index: { type: "number", description: "Position to insert at (default: end)" },
        section: { type: "string", enum: ["steps", "before", "after"], description: "Section to modify (default: steps)" },
      },
      required: ["id", "step"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = AddStepInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { id, step, index, section } = parseResult.data;
      const test = await ctx.storage.getTest(id);
      if (!test) throw new Error(`Test not found: ${id}`);

      const definition = { ...test.definition };
      if (section !== "steps") {
        definition[section] = definition[section] ? [...definition[section]!] : [];
      } else {
        definition.steps = [...definition.steps];
      }
      const arr = getSection(definition, section);
      const insertAt = index ?? arr.length;
      if (insertAt < 0 || insertAt > arr.length) {
        throw new Error(`Index ${insertAt} out of bounds (0..${arr.length})`);
      }
      arr.splice(insertAt, 0, step);
      await ctx.storage.updateTest(id, { definition });
      return { id, section, index: insertAt, total_steps: arr.length };
    },
  };

  /**
   * Tool: remove_step
   * Remove a step by index from a saved test
   */
  const removeStepTool: ToolDef = {
    name: "remove_step",
    description: `Remove a step by index from a saved test.

## Input Parameters

- \`id\` (string, required) — The test ID
- \`index\` (number, required) — Step index to remove
- \`section\` ("steps" | "before" | "after", optional) — Which section to modify (default: "steps")

## Output

\`\`\`json
{ "id": "login-flow", "section": "steps", "removed_step": { "wait": 1000 }, "total_steps": 4 }
\`\`\`

## Example

\`\`\`json
{ "id": "login-flow", "index": 2 }
\`\`\``,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The test ID" },
        index: { type: "number", description: "Step index to remove" },
        section: { type: "string", enum: ["steps", "before", "after"], description: "Section to modify (default: steps)" },
      },
      required: ["id", "index"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = RemoveStepInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { id, index, section } = parseResult.data;
      const test = await ctx.storage.getTest(id);
      if (!test) throw new Error(`Test not found: ${id}`);

      const definition = { ...test.definition };
      if (section !== "steps") {
        definition[section] = definition[section] ? [...definition[section]!] : [];
      } else {
        definition.steps = [...definition.steps];
      }
      const arr = getSection(definition, section);
      if (index < 0 || index >= arr.length) {
        throw new Error(`Index ${index} out of bounds (0..${arr.length - 1})`);
      }
      const [removed] = arr.splice(index, 1);
      await ctx.storage.updateTest(id, { definition });
      return { id, section, removed_step: removed, total_steps: arr.length };
    },
  };

  /**
   * Tool: update_step
   * Replace a step at an index in a saved test
   */
  const updateStepTool: ToolDef = {
    name: "update_step",
    description: `Replace a step at a specific index in a saved test.

## Input Parameters

- \`id\` (string, required) — The test ID
- \`index\` (number, required) — Step index to replace
- \`step\` (StepDef, required) — New step definition
- \`section\` ("steps" | "before" | "after", optional) — Which section to modify (default: "steps")

## Output

\`\`\`json
{ "id": "login-flow", "section": "steps", "index": 2, "total_steps": 5 }
\`\`\`

## Example

\`\`\`json
{ "id": "login-flow", "index": 1, "step": { "click": { "selector": "#new-btn" }, "label": "Click new button" } }
\`\`\``,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The test ID" },
        index: { type: "number", description: "Step index to replace" },
        step: { type: "object", description: "New step definition" },
        section: { type: "string", enum: ["steps", "before", "after"], description: "Section to modify (default: steps)" },
      },
      required: ["id", "index", "step"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = UpdateStepInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { id, index, step, section } = parseResult.data;
      const test = await ctx.storage.getTest(id);
      if (!test) throw new Error(`Test not found: ${id}`);

      const definition = { ...test.definition };
      if (section !== "steps") {
        definition[section] = definition[section] ? [...definition[section]!] : [];
      } else {
        definition.steps = [...definition.steps];
      }
      const arr = getSection(definition, section);
      if (index < 0 || index >= arr.length) {
        throw new Error(`Index ${index} out of bounds (0..${arr.length - 1})`);
      }
      arr[index] = step;
      await ctx.storage.updateTest(id, { definition });
      return { id, section, index, total_steps: arr.length };
    },
  };

  /**
   * Tool: move_step
   * Reorder a step within a section of a saved test
   */
  const moveStepTool: ToolDef = {
    name: "move_step",
    description: `Reorder a step within a section of a saved test.

## Input Parameters

- \`id\` (string, required) — The test ID
- \`from\` (number, required) — Current step index
- \`to\` (number, required) — Target step index
- \`section\` ("steps" | "before" | "after", optional) — Which section to modify (default: "steps")

## Output

\`\`\`json
{ "id": "login-flow", "section": "steps", "from": 0, "to": 3, "total_steps": 5 }
\`\`\`

## Example

\`\`\`json
{ "id": "login-flow", "from": 0, "to": 2 }
\`\`\``,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The test ID" },
        from: { type: "number", description: "Current step index" },
        to: { type: "number", description: "Target step index" },
        section: { type: "string", enum: ["steps", "before", "after"], description: "Section to modify (default: steps)" },
      },
      required: ["id", "from", "to"],
    },
    handler: async (args: Record<string, any>, ctx: { storage: Storage }): Promise<any> => {
      const parseResult = MoveStepInputSchema.safeParse(args);
      if (!parseResult.success) {
        throw new Error(`Validation error: ${parseResult.error.message}`);
      }
      const { id, from, to, section } = parseResult.data;
      const test = await ctx.storage.getTest(id);
      if (!test) throw new Error(`Test not found: ${id}`);

      const definition = { ...test.definition };
      if (section !== "steps") {
        definition[section] = definition[section] ? [...definition[section]!] : [];
      } else {
        definition.steps = [...definition.steps];
      }
      const arr = getSection(definition, section);
      if (from < 0 || from >= arr.length) {
        throw new Error(`'from' index ${from} out of bounds (0..${arr.length - 1})`);
      }
      if (to < 0 || to >= arr.length) {
        throw new Error(`'to' index ${to} out of bounds (0..${arr.length - 1})`);
      }
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      await ctx.storage.updateTest(id, { definition });
      return { id, section, from, to, total_steps: arr.length };
    },
  };

  /**
   * Tool registry — array of all available tools
   * New tools can be added by appending to this array
   */
  const tools: ToolDef[] = [
    saveTestTool,
    listTestsTool,
    getTestTool,
    deleteTestTool,
    updateTestTool,
    addStepTool,
    removeStepTool,
    updateStepTool,
    moveStepTool,
    listResultsTool,
    getResultTool,
    runSuiteTool,
  ];

  /**
   * Register tools/call handler
   * Handles incoming tool calls from Claude with generic dispatcher
   */
  (server as any).setRequestHandler(
    z.object({
      method: z.literal("tools/call"),
      params: z.object({
        name: z.string(),
        arguments: z.record(z.any()).optional(),
      }),
    }),
    async (request: any) => {
      const { name, arguments: args = {} } = request.params;

      // Special handling for run_test (supports two modes: testId or inline test)
      if (name === "run_test") {
        try {
          const { test, testId, port: portArg, inputs: inputValues } = args;
          const port = (portArg as number) ?? 9222;
          const initialVars = inputValues as Record<string, unknown> | undefined;

          // Determine which mode to use
          if (testId) {
            // Mode 1: Load and run saved test, persist result
            if (!testId || typeof testId !== "string") {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: testId must be a non-empty string`,
                  },
                ],
                isError: true,
              };
            }

            const savedTest = await storage.getTest(testId);
            if (!savedTest) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: Test not found: ${testId}`,
                  },
                ],
                isError: true,
              };
            }

            // Run the loaded test definition
            const testData = savedTest.definition;
            const result = await runTest(testData, port, undefined, undefined, initialVars);

            // Save the result
            const testRun = await storage.saveRun(testId, result);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      ...result,
                      runId: testRun.id,
                      testId: testId,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } else if (test) {
            // Mode 2: Run inline test definition (ad-hoc, no persistence)
            const parseResult = TestDefSchema.safeParse(test);
            if (!parseResult.success) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: invalid test definition: ${parseResult.error.message}`,
                  },
                ],
                isError: true,
              };
            }

            const testData = parseResult.data as TestDef;
            const result = await runTest(testData, port, undefined, undefined, initialVars);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } else {
            // Neither testId nor test provided
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Either 'test' (inline TestDef) or 'testId' (saved test ID) must be provided`,
                },
              ],
              isError: true,
            };
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }

      // Generic dispatcher for all other tools
      const tool = tools.find(t => t.name === name);
      if (!tool) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await tool.handler(args, { storage });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * Register tools/list handler
   * Returns available tools to Claude from the tool registry
   */
  (server as any).setRequestHandler(
    z.object({
      method: z.literal("tools/list"),
    }),
    async () => {
      return {
        tools: [
          runTestTool,
          ...tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        ],
      };
    }
  );

  return server;
}

/**
 * Start the MCP server with stdio transport
 * This is the main entry point that connects to Claude via stdin/stdout
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[chromedev-director] MCP server started");
}

/**
 * Main entry point
 * Starts the server and handles any startup errors
 */
if (process.argv[1]) {
  const scriptPath = process.argv[1].replace(/\\/g, "/");
  const moduleUrl = import.meta.url.replace(/^file:\/\//, "");
  if (moduleUrl === scriptPath || moduleUrl.endsWith("/" + scriptPath)) {
    startMcpServer().catch((error) => {
      console.error("Failed to start MCP server:", error);
      process.exit(1);
    });
  }
}
