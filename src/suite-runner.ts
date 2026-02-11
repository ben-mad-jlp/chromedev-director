/**
 * Suite runner for executing multiple tests with optional concurrency
 * Supports filtering by tag or explicit test IDs, with optional stop-on-failure
 */

import { SuiteResult, SuiteTestResult, OnEvent, TestResult } from "./types.js";
import { runTest } from "./step-runner.js";
import * as storage from "./storage.js";
import { SessionManager } from "./session-manager.js";

/**
 * Simple counting semaphore for limiting concurrency
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private count: number;
  constructor(max: number) { this.count = max; }
  async acquire(): Promise<void> {
    if (this.count > 0) { this.count--; return; }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.count++;
  }
}

/**
 * Options for running a suite of tests
 */
export interface SuiteOptions {
  /** Filter tests by tag */
  tag?: string;
  /** Explicit list of test IDs to run */
  testIds?: string[];
  /** Chrome DevTools Protocol port (default 9222) */
  port?: number;
  /** Stop running tests after first failure (default false) */
  stopOnFailure?: boolean;
  /** Storage directory for loading tests and saving results */
  storageDir: string;
  /** Project root for resolving nested test IDs */
  projectRoot?: string;
  /** Max tests to run in parallel (default 1). When > 1, each test gets its own Chrome tab. */
  concurrency?: number;
}

/**
 * Event types emitted during suite execution
 */
export type SuiteEvent =
  | { type: "suite:start"; total: number }
  | { type: "suite:test_start"; testId: string; testName: string; index: number }
  | { type: "suite:test_complete"; testId: string; testName: string; index: number; status: "passed" | "failed" | "skipped"; duration_ms: number; error?: string }
  | { type: "suite:complete"; result: SuiteResult };

export type OnSuiteEvent = (event: SuiteEvent) => void;

/**
 * Safely emit a suite event, ignoring listener errors
 */
function emitSuiteEvent(onSuiteEvent: OnSuiteEvent | undefined, event: SuiteEvent): void {
  if (onSuiteEvent) {
    try {
      onSuiteEvent(event);
    } catch { /* ignore listener errors */ }
  }
}

/**
 * Run a suite of tests with optional concurrency
 *
 * @param options - Suite configuration (tag or testIds, port, stopOnFailure, concurrency)
 * @param onSuiteEvent - Optional callback for suite-level events
 * @param onTestEvent - Optional callback for individual test step events
 * @returns Aggregate suite result
 */
export async function runSuite(
  options: SuiteOptions,
  onSuiteEvent?: OnSuiteEvent,
  onTestEvent?: OnEvent
): Promise<SuiteResult> {
  const startTime = Date.now();
  const port = options.port ?? 9222;
  const projectRoot = options.projectRoot ?? process.cwd();
  const concurrency = options.concurrency ?? 1;

  // Resolve test list
  let tests: Array<{ id: string; name: string }>;

  if (options.testIds && options.testIds.length > 0) {
    // Load each test by ID
    const loaded: Array<{ id: string; name: string }> = [];
    for (const testId of options.testIds) {
      const saved = await storage.getTest(options.storageDir, testId);
      if (saved) {
        loaded.push({ id: saved.id, name: saved.name });
      }
    }
    tests = loaded;
  } else if (options.tag) {
    // Filter by tag
    const allTests = await storage.listTests(options.storageDir, { tag: options.tag });
    tests = allTests.map(t => ({ id: t.id, name: t.name }));
  } else {
    throw new Error("Either tag or testIds must be provided");
  }

  // Pre-allocate results array — each index written by exactly one promise
  const results: SuiteTestResult[] = new Array(tests.length);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;

  // Emit suite:start
  emitSuiteEvent(onSuiteEvent, { type: "suite:start", total: tests.length });

  // Initialize session manager for concurrent test isolation
  const sessionManager = new SessionManager(options.storageDir);
  await sessionManager.load();

  // When concurrency > 1, each test gets its own session ID for tab isolation
  const semaphore = new Semaphore(concurrency);

  const promises: Promise<void>[] = [];

  for (let i = 0; i < tests.length; i++) {
    const index = i;
    const { id: testId, name: testName } = tests[i];

    const task = async () => {
      // Check stopped flag before acquiring semaphore
      if (stopped) {
        results[index] = { testId, testName, status: "skipped", duration_ms: 0 };
        skipped++;
        return;
      }

      await semaphore.acquire();

      // Check stopped flag again after acquiring (may have changed while waiting)
      if (stopped) {
        semaphore.release();
        results[index] = { testId, testName, status: "skipped", duration_ms: 0 };
        skipped++;
        return;
      }

      // Emit suite:test_start
      emitSuiteEvent(onSuiteEvent, { type: "suite:test_start", testId, testName, index });

      const testStartTime = Date.now();
      let testResult: TestResult;
      let runId: string | undefined;

      try {
        // Load the test definition
        const saved = await storage.getTest(options.storageDir, testId);
        if (!saved) {
          throw new Error(`Test not found: ${testId}`);
        }

        // Run the test with unique session ID for tab isolation when concurrent
        // Use suite-specific session IDs to avoid interference between concurrent tests
        const sessionId = concurrency > 1 ? `suite-${testId}-${Date.now()}` : `suite-sequential-${Date.now()}`;
        testResult = await runTest(saved.definition, port, onTestEvent, projectRoot, undefined, concurrency > 1, sessionId, sessionManager);

        // Save the run result
        const savedRun = await storage.saveRun(options.storageDir, testId, testResult);
        runId = savedRun.id;
      } catch (error) {
        const duration_ms = Date.now() - testStartTime;
        const errorMsg = error instanceof Error ? error.message : String(error);

        results[index] = { testId, testName, status: "failed", duration_ms, error: errorMsg };
        failed++;

        emitSuiteEvent(onSuiteEvent, { type: "suite:test_complete", testId, testName, index, status: "failed", duration_ms, error: errorMsg });

        if (options.stopOnFailure) {
          stopped = true;
        }

        semaphore.release();
        return;
      }

      const duration_ms = Date.now() - testStartTime;

      if (testResult.status === "passed") {
        results[index] = { testId, testName, status: "passed", duration_ms, runId };
        passed++;
      } else {
        results[index] = { testId, testName, status: "failed", duration_ms, error: testResult.error, runId };
        failed++;

        if (options.stopOnFailure) {
          stopped = true;
        }
      }

      // Emit suite:test_complete
      emitSuiteEvent(onSuiteEvent, {
        type: "suite:test_complete",
        testId,
        testName,
        index,
        status: testResult.status,
        duration_ms,
        ...(testResult.status === "failed" ? { error: testResult.error } : {}),
      });

      semaphore.release();
    };

    promises.push(task());
  }

  await Promise.all(promises);

  const suiteResult: SuiteResult = {
    status: failed > 0 ? "failed" : "passed",
    total: tests.length,
    passed,
    failed,
    skipped,
    duration_ms: Date.now() - startTime,
    results,
  };

  // Emit suite:complete
  emitSuiteEvent(onSuiteEvent, { type: "suite:complete", result: suiteResult });

  return suiteResult;
}
