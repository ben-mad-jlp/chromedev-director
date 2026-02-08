/**
 * Type definitions for chromedev-director MCP
 * Defines the core types for test definitions, step definitions, and results
 */

/**
 * Runtime test input definition — declares a parameter that the user provides before running.
 * Values are seeded as `$vars.name` so they're available from step 1.
 */
export interface InputDef {
  /** Variable name — becomes `$vars.name` */
  name: string;
  /** Display label shown in the form */
  label: string;
  /** Form control type */
  type: 'text' | 'number' | 'boolean';
  /** Pre-filled default value */
  default?: string | number | boolean;
  /** Whether the field must be filled in (default true) */
  required?: boolean;
}

/**
 * Main test definition — describes a complete test scenario to execute against Chrome.
 */
export interface TestDef {
  /** Page URL to navigate to after `before` hooks run. */
  url: string;
  /** Key-value pairs for `$env.KEY` interpolation in step strings. */
  env?: Record<string, unknown>;
  /** Runtime inputs — prompts user for values before run, seeded as `$vars.name`. */
  inputs?: InputDef[];
  /** Steps that run BEFORE navigation — use for `mock_network` setup so mocks are active on first page load. */
  before?: StepDef[];
  /** Cleanup steps — ALWAYS run even if main steps fail. */
  after?: StepDef[];
  /** Main test steps, executed sequentially after page load. */
  steps: StepDef[];
  /** Test-level timeout in ms (default 30000). Covers the entire test including before/after. */
  timeout?: number;
  /** Skip to step N. Checks that any `$vars` dependencies for skipped steps are satisfiable. */
  resume_from?: number;
}

/**
 * Individual step definition — a single action or assertion in a test.
 *
 * Every variant supports an optional `label` for clear error messages on failure.
 */
export type StepDef =
  /** Execute JS in the page. `as` stores the result in `$vars.NAME`. Returns objects auto-serialized. */
  | { label?: string; eval: string; as?: string }
  /** Fill an input field. Dispatches input+change events so React controlled components update. */
  | { label?: string; fill: { selector: string; value: string } }
  /** Click an element by CSS selector. */
  | { label?: string; click: { selector: string } }
  /** Assert a JS expression is truthy. `retry` enables polling at interval until timeout. */
  | {
      label?: string;
      assert: string;
      retry?: { interval: number; timeout: number };
    }
  /** Sleep for N milliseconds. Use after actions that trigger async renders (500-2000ms). */
  | { label?: string; wait: number }
  /** Poll for element existence by CSS selector. */
  | { label?: string; wait_for: { selector: string; timeout?: number } }
  /** Fail if console messages exist at given levels. Use `"warning"` not `"warn"` — CDP uses `"warning"`. */
  | { label?: string; console_check: ("error" | "warn" | "warning" | "info" | "log" | "debug")[] }
  /** Fail if any 4xx/5xx network responses were captured. */
  | { label?: string; network_check: boolean }
  /**
   * Intercept requests matching a glob pattern and return a mock response.
   * `match` uses glob: `*api/users*`. First matching rule wins — register specific patterns first.
   * `body` is auto-JSON-stringified — pass objects, not strings. CORS preflight handled automatically.
   * Register in `before` steps so mocks are active before page navigation.
   */
  | {
      label?: string;
      mock_network: {
        match: string;
        status: number;
        body?: unknown;
        delay?: number;
      };
    }
  /** Execute another test by ID. Nested test's steps run inline; url/before/after/env are ignored. */
  | { label?: string; run_test: string };

/**
 * Test execution result
 * Represents the outcome of a test run
 */
export type TestResult =
  | {
      status: "passed";
      steps_completed: number;
      duration_ms: number;
    }
  | {
      status: "failed";
      failed_step: number;
      failed_label?: string;
      step_definition: StepDef;
      error: string;
      console_errors: string[];
      dom_snapshot?: string;
      duration_ms: number;
    };

/**
 * Step handler signature
 * Represents the function signature that all step handlers must implement
 */
export type StepHandler = (
  cdpClient: CDPClient,
  step: StepDef,
  vars: Record<string, unknown>
) => Promise<{ success: boolean; error?: string; value?: unknown }>;

/**
 * Console message for tracking
 * Represents a single console message captured during test execution
 */
export interface ConsoleMessage {
  type: "log" | "debug" | "info" | "warn" | "error";
  text: string;
  timestamp: number;
}

/**
 * Network response for tracking
 * Represents a network response captured during test execution
 */
export interface NetworkResponse {
  url: string;
  status: number;
  timestamp: number;
}

/**
 * CDP Client interface (placeholder for actual implementation)
 * This is used in the StepHandler type definition
 */
export interface CDPClient {
  connect(url: string): Promise<void>;
  navigate(url: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  getConsoleMessages(): Promise<Array<{ type: string; text: string }>>;
  getNetworkResponses(): Promise<NetworkResponse[]>;
  getDomSnapshot(): Promise<string>;
  close(): Promise<void>;
  addMockRule(
    pattern: string,
    status: number,
    body?: unknown,
    delay?: number
  ): void;
}

/**
 * Event types emitted during test execution
 * Provides real-time visibility into test progress for logging, streaming, and UI updates
 */
export type RunEvent =
  | {
      type: "step:start";
      stepIndex: number;
      label: string;
      nested: string | null;
    }
  | {
      type: "step:pass";
      stepIndex: number;
      label: string;
      nested: string | null;
      duration_ms: number;
    }
  | {
      type: "step:fail";
      stepIndex: number;
      label: string;
      nested: string | null;
      duration_ms: number;
      error: string;
    }
  | { type: "console"; level: string; text: string }
  | {
      type: "network";
      method: string;
      url: string;
      status: number;
      duration_ms: number;
    };

/**
 * Callback signature for test execution events
 * Called whenever a test event is emitted (step start/pass/fail, console, network)
 */
export type OnEvent = (event: RunEvent) => void;

/**
 * Saved test with metadata
 * Wraps a TestDef with ID, name, timestamps, and optional tags for filtering
 */
export interface SavedTest {
  id: string;              // User-provided slug (folder name, unique identifier)
  name: string;            // Human-readable display name
  description?: string;    // Optional description of the test
  tags?: string[];         // Optional tags for filtering (e.g., ["smoke", "auth"])
  definition: TestDef;     // The actual test definition
  createdAt: string;       // ISO 8601 timestamp when test was created
  updatedAt: string;       // ISO 8601 timestamp when test was last modified
}

/**
 * Test run result with metadata
 * Records the outcome of a single test execution with full result details
 */
export interface TestRun {
  id: string;              // Unique run identifier (timestamp-based or UUID)
  testId: string;          // References SavedTest.id
  status: "passed" | "failed" | "running"; // Run status
  result: TestResult;      // Full test result (includes errors, console logs, DOM snapshot on failure)
  startedAt: string;       // ISO 8601 timestamp when run started
  completedAt?: string;    // ISO 8601 timestamp when run completed (undefined if still running)
  duration_ms?: number;    // Execution duration in milliseconds
}

/**
 * Director configuration
 * Global configuration for the storage and retention policies
 */
export interface DirectorConfig {
  storageDir: string;         // Root directory for storing tests and results
  resultRetentionDays: number; // How many days to keep test results (default: 30)
  port: number;               // Port for the API server (default: 3000)
}
