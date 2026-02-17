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

/** Post-navigation verification — asserts the page loaded correctly before steps run. */
export interface VerifyPageDef {
  /** CSS selector that must exist on the page (polled until timeout). */
  selector?: string;
  /** Substring the document.title must contain. */
  title?: string;
  /** Substring the page URL must contain. */
  url_contains?: string;
  /** How long to poll before failing (default 10000ms). */
  timeout?: number;
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
  /** Post-navigation page verification. Runs after navigate, before main steps. */
  verify_page?: VerifyPageDef;
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
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; eval: string; as?: string }
  /** Fill an input field. Dispatches input+change events so React controlled components update. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; fill: { selector: string; value: string } }
  /** Click an element by CSS selector. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; click: { selector: string } }
  /** Assert a JS expression is truthy. `retry` enables polling at interval until timeout. */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      comment?: string;
      assert: string;
      retry?: { interval: number; timeout: number };
    }
  /** Sleep for N milliseconds. Use after actions that trigger async renders (500-2000ms). */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; wait: number }
  /** Poll for element existence by CSS selector. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; wait_for: { selector: string; timeout?: number } }
  /** Fail if console messages exist at given levels. Use `"warning"` not `"warn"` — CDP uses `"warning"`. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; console_check: ("error" | "warn" | "warning" | "info" | "log" | "debug")[] }
  /** Fail if any 4xx/5xx network responses were captured. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; network_check: boolean }
  /**
   * Intercept requests matching a glob pattern and return a mock response.
   * `match` uses glob: `*api/users*`. First matching rule wins — register specific patterns first.
   * `body` is auto-JSON-stringified — pass objects, not strings. CORS preflight handled automatically.
   * Register in `before` steps so mocks are active before page navigation.
   */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      mock_network: {
        match: string;
        status: number;
        body?: unknown;
        delay?: number;
      };
    }
  /** Execute another test by ID. Nested test's steps run inline; url/before/after/env are ignored. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; run_test: string }
  /** Capture a PNG screenshot. Optionally store base64 in `$vars.NAME` via `as`. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; screenshot: { as?: string } }
  /** Select an option in a native `<select>` dropdown. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; select: { selector: string; value: string } }
  /** Dispatch a keyboard event. `key` uses DOM key names (Enter, Tab, Escape, ArrowDown, etc.). */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; press_key: { key: string; modifiers?: ("ctrl" | "shift" | "alt" | "meta")[] } }
  /** Hover over an element by CSS selector (dispatches mouseMoved). */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; hover: { selector: string } }
  /** Switch execution context to an iframe (by selector) or back to main frame (omit selector). */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; switch_frame: { selector?: string } }
  /** Configure auto-handling for future JS dialogs (alert/confirm/prompt). */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; handle_dialog: { action: "accept" | "dismiss"; text?: string } }
  /** Make a server-side HTTP request (Node fetch). Useful for API setup/teardown in before hooks. */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      http_request: {
        url: string;
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
        as?: string;
      };
    }
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      loop: {
        over?: string;
        while?: string;
        as?: string;
        index_as?: string;
        max?: number;
        steps: StepDef[];
      };
    }
  /** Fill an input and press Enter (barcode scanner pattern). */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; scan_input: { selector: string; value: string } }
  /** Fill multiple form fields in one step. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; fill_form: { fields: Array<{ selector: string; value: string }> } }
  /** Scroll element into view. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; scroll_to: { selector: string } }
  /** Clear an input with proper React event dispatching. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; clear_input: { selector: string } }
  /** Wait until text appears on page (polls at 200ms). `match`: "contains" (default), "exact", or "regex". */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; wait_for_text: { text: string; match?: "exact" | "contains" | "regex"; selector?: string; timeout?: number } }
  /** Wait until text disappears from page (polls at 200ms). `match`: "contains" (default), "exact", or "regex". */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; wait_for_text_gone: { text: string; match?: "exact" | "contains" | "regex"; selector?: string; timeout?: number } }
  /** Assert page contains (or doesn't contain) specific text. `match`: "contains" (default), "exact", or "regex". */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      assert_text: {
        text: string;
        absent?: boolean;
        match?: "exact" | "contains" | "regex";
        selector?: string;
        retry?: { interval: number; timeout: number };
      };
    }
  /** Click element by visible text content. `match`: "contains" (default), "exact", or "regex". */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      click_text: {
        text: string;
        match?: "exact" | "contains" | "regex";
        selector?: string;
      };
    }
  /** Click Nth element matching selector or text pattern. `match`: "contains" (default), "exact", or "regex". */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      click_nth: {
        index: number;
        text?: string;
        selector?: string;
        match?: "exact" | "contains" | "regex";
      };
    }
  /** Type text character by character with delays (for autocomplete/debounced inputs). */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      type: {
        selector: string;
        text: string;
        delay?: number;
        clear?: boolean;
      };
    }
  /** Open dropdown and select option by text. `match` controls text matching: "contains" (default), "exact", or "regex". */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      choose_dropdown: {
        selector: string;
        text: string;
        match?: "exact" | "contains" | "regex";
        timeout?: number;
      };
    }
  /** Expand a collapsed navigation group by name. */
  | { label?: string; if?: string; capture_dom?: boolean; comment?: string; expand_menu: { group: string } }
  /** Toggle a checkbox or switch by its label text. */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      toggle: {
        label: string;
        state?: boolean;
      };
    }
  /** Close current modal/overlay. */
  | {
      label?: string;
      if?: string;
      capture_dom?: boolean;
      close_modal: {
        strategy?: "button" | "escape" | "backdrop";
      };
    };

/**
 * Per-step execution trace — captures detailed information about each step's execution
 */
export interface StepTrace {
  /** Step index in the steps array */
  step_index: number;
  /** Section where the step was executed */
  section: 'before' | 'steps' | 'after';
  /** Step type (eval, click, assert, etc.) */
  step_type: string;
  /** Human-readable label (from step.label or step.comment) */
  label?: string;
  /** Execution status */
  status: 'passed' | 'failed' | 'skipped';
  /** Time when step started (ms since test start) */
  start_time_ms: number;
  /** How long the step took to execute */
  duration_ms: number;
  /** Error message if failed */
  error?: string;
  /** Return value for eval steps */
  result?: unknown;
  /** DOM snapshot at this step (if capture_dom: true) */
  dom_snapshot?: string;
  /** Screenshot at this step (if failed or explicitly captured) */
  screenshot?: string;
  /** Console messages during this step */
  console_messages?: Array<{ type: string; text: string }>;
  /** Network requests during this step */
  network_requests?: Array<{ url: string; method: string; status: number }>;
}

/**
 * Test execution result
 * Represents the outcome of a test run
 */
export type TestResult =
  | {
      status: "passed";
      steps_completed: number;
      duration_ms: number;
      console_log: Array<{ type: string; text: string; timestamp: number }>;
      network_log: Array<{ url: string; method: string; status: number; timestamp: number }>;
      dom_snapshots?: Record<number, string>;
      /** Detailed per-step execution traces */
      step_traces?: StepTrace[];
    }
  | {
      status: "failed";
      failed_step: number;
      failed_label?: string;
      step_definition: StepDef;
      error: string;
      /** Breadcrumb trail for failures inside loops. Each entry is one nesting level, outermost first. */
      loop_context?: Array<{ iteration: number; step: number; label: string }>;
      console_errors: string[];
      dom_snapshot?: string;
      screenshot?: string;
      duration_ms: number;
      console_log: Array<{ type: string; text: string; timestamp: number }>;
      network_log: Array<{ url: string; method: string; status: number; timestamp: number }>;
      dom_snapshots?: Record<number, string>;
      /** Detailed per-step execution traces */
      step_traces?: StepTrace[];
    };

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
  method: string;
  status: number;
  timestamp: number;
}

/**
 * CDP Client interface (placeholder for actual implementation)
 */
export interface CDPClient {
  connect(url: string): Promise<void>;
  navigate(url: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  getConsoleMessages(): Promise<Array<{ type: string; text: string; timestamp: number }>>;
  getNetworkResponses(): Promise<Array<{ url: string; method: string; status: number; timestamp: number }>>;
  getDomSnapshot(): Promise<string>;
  captureScreenshot(): Promise<string>;
  select(selector: string, value: string): Promise<void>;
  pressKey(key: string, modifiers?: string[]): Promise<void>;
  hover(selector: string): Promise<void>;
  switchFrame(selector?: string): Promise<void>;
  handleDialog(action: "accept" | "dismiss", text?: string): Promise<void>;
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
      skipped?: boolean;
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
    }
  | { type: "debug:paused"; stepIndex: number; totalSteps: number }
  | { type: "debug:resumed" };

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

/**
 * Suite execution result — aggregate of multiple test runs
 */
export interface SuiteResult {
  status: "passed" | "failed";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  results: SuiteTestResult[];
}

/**
 * Individual test result within a suite run
 */
export interface SuiteTestResult {
  testId: string;
  testName: string;
  status: "passed" | "failed" | "skipped";
  duration_ms: number;
  error?: string;
  runId?: string;
}
