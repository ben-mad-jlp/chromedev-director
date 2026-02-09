/**
 * Type definitions for chromedev-director GUI
 * Mirrored types from server for type-safe API interactions
 * These types match src/types.ts exactly
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
  | { label?: string; if?: string; eval: string; as?: string }
  /** Fill an input field. Dispatches input+change events so React controlled components update. */
  | { label?: string; if?: string; fill: { selector: string; value: string } }
  /** Click an element by CSS selector. */
  | { label?: string; if?: string; click: { selector: string } }
  /** Assert a JS expression is truthy. `retry` enables polling at interval until timeout. */
  | {
      label?: string;
      if?: string;
      assert: string;
      retry?: { interval: number; timeout: number };
    }
  /** Sleep for N milliseconds. Use after actions that trigger async renders (500-2000ms). */
  | { label?: string; if?: string; wait: number }
  /** Poll for element existence by CSS selector. */
  | { label?: string; if?: string; wait_for: { selector: string; timeout?: number } }
  /** Fail if console messages exist at given levels. Use `"warning"` not `"warn"` — CDP uses `"warning"`. */
  | { label?: string; if?: string; console_check: ("error" | "warn" | "warning" | "info" | "log" | "debug")[] }
  /** Fail if any 4xx/5xx network responses were captured. */
  | { label?: string; if?: string; network_check: boolean }
  /**
   * Intercept requests matching a glob pattern and return a mock response.
   * `match` uses glob: `*api/users*`. First matching rule wins — register specific patterns first.
   * `body` is auto-JSON-stringified — pass objects, not strings. CORS preflight handled automatically.
   * Register in `before` steps so mocks are active before page navigation.
   */
  | {
      label?: string;
      if?: string;
      mock_network: {
        match: string;
        status: number;
        body?: unknown;
        delay?: number;
      };
    }
  /** Execute another test by ID. Nested test's steps run inline; url/before/after/env are ignored. */
  | { label?: string; if?: string; run_test: string }
  /** Capture a PNG screenshot. Optionally store base64 in `$vars.NAME` via `as`. */
  | { label?: string; if?: string; screenshot: { as?: string } }
  /** Select an option in a native `<select>` dropdown. */
  | { label?: string; if?: string; select: { selector: string; value: string } }
  /** Dispatch a keyboard event. `key` uses DOM key names (Enter, Tab, Escape, ArrowDown, etc.). */
  | { label?: string; if?: string; press_key: { key: string; modifiers?: ("ctrl" | "shift" | "alt" | "meta")[] } }
  /** Hover over an element by CSS selector (dispatches mouseMoved). */
  | { label?: string; if?: string; hover: { selector: string } }
  /** Switch execution context to an iframe (by selector) or back to main frame (omit selector). */
  | { label?: string; if?: string; switch_frame: { selector?: string } }
  /** Configure auto-handling for future JS dialogs (alert/confirm/prompt). */
  | { label?: string; if?: string; handle_dialog: { action: "accept" | "dismiss"; text?: string } }
  /** Make a server-side HTTP request (Node fetch). Useful for API setup/teardown in before hooks. */
  | {
      label?: string;
      if?: string;
      http_request: {
        url: string;
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
        as?: string;
      };
    };

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
      screenshot?: string;
      duration_ms: number;
    };

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
 * WebSocket message format
 * Generic message wrapper for real-time communication
 */
export interface WsMessage {
  type: string;            // Message type identifier
  data: any;               // Message payload
}
