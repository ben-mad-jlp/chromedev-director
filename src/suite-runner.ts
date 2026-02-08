/**
 * Suite runner for executing multiple tests sequentially
 * Supports filtering by tag or explicit test IDs, with optional stop-on-failure
 */

import { SuiteResult, SuiteTestResult, OnEvent, TestResult } from "./types.js";
import { runTest } from "./step-runner.js";
import * as storage from "./storage.js";

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
 * Run a suite of tests sequentially
 *
 * @param options - Suite configuration (tag or testIds, port, stopOnFailure)
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

  const results: SuiteTestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;

  // Emit suite:start
  if (onSuiteEvent) {
    try {
      onSuiteEvent({ type: "suite:start", total: tests.length });
    } catch { /* ignore listener errors */ }
  }

  for (let i = 0; i < tests.length; i++) {
    const { id: testId, name: testName } = tests[i];

    if (stopped) {
      // Mark remaining as skipped
      results.push({
        testId,
        testName,
        status: "skipped",
        duration_ms: 0,
      });
      skipped++;
      continue;
    }

    // Emit suite:test_start
    if (onSuiteEvent) {
      try {
        onSuiteEvent({ type: "suite:test_start", testId, testName, index: i });
      } catch { /* ignore listener errors */ }
    }

    const testStartTime = Date.now();
    let testResult: TestResult;
    let runId: string | undefined;

    try {
      // Load the test definition
      const saved = await storage.getTest(options.storageDir, testId);
      if (!saved) {
        throw new Error(`Test not found: ${testId}`);
      }

      // Run the test
      testResult = await runTest(saved.definition, port, onTestEvent, projectRoot);

      // Save the run result
      const savedRun = await storage.saveRun(options.storageDir, testId, testResult);
      runId = savedRun.id;
    } catch (error) {
      const duration_ms = Date.now() - testStartTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      results.push({
        testId,
        testName,
        status: "failed",
        duration_ms,
        error: errorMsg,
      });
      failed++;

      if (onSuiteEvent) {
        try {
          onSuiteEvent({ type: "suite:test_complete", testId, testName, index: i, status: "failed", duration_ms, error: errorMsg });
        } catch { /* ignore listener errors */ }
      }

      if (options.stopOnFailure) {
        stopped = true;
      }
      continue;
    }

    const duration_ms = Date.now() - testStartTime;

    if (testResult.status === "passed") {
      results.push({
        testId,
        testName,
        status: "passed",
        duration_ms,
        runId,
      });
      passed++;
    } else {
      results.push({
        testId,
        testName,
        status: "failed",
        duration_ms,
        error: testResult.error,
        runId,
      });
      failed++;

      if (options.stopOnFailure) {
        stopped = true;
      }
    }

    // Emit suite:test_complete
    if (onSuiteEvent) {
      try {
        onSuiteEvent({
          type: "suite:test_complete",
          testId,
          testName,
          index: i,
          status: testResult.status,
          duration_ms,
          ...(testResult.status === "failed" ? { error: testResult.error } : {}),
        });
      } catch { /* ignore listener errors */ }
    }
  }

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
  if (onSuiteEvent) {
    try {
      onSuiteEvent({ type: "suite:complete", result: suiteResult });
    } catch { /* ignore listener errors */ }
  }

  return suiteResult;
}
