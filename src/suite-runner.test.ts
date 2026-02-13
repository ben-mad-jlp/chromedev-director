/**
 * Tests for suite runner
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSuite, SuiteEvent } from "./suite-runner";
import * as storage from "./storage";

// Track CDP mock calls for cleanup verification
const mockCloseTarget = vi.fn().mockResolvedValue({});
const mockCDPClose = vi.fn().mockResolvedValue({});

// Mock chrome-remote-interface for suite cleanup
vi.mock("chrome-remote-interface", () => ({
  default: vi.fn().mockImplementation(async () => ({
    Target: {
      closeTarget: mockCloseTarget,
    },
    close: mockCDPClose,
  })),
}));

// Mock storage module
vi.mock("./storage", () => ({
  getTest: vi.fn(),
  listTests: vi.fn(),
  saveRun: vi.fn(),
}));

// Mock step-runner module
vi.mock("./step-runner", () => ({
  runTest: vi.fn(),
}));

import { runTest } from "./step-runner";

describe("suite-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseTarget.mockClear();
    mockCDPClose.mockClear();
  });

  it("throws when neither tag nor testIds are provided", async () => {
    await expect(
      runSuite({ storageDir: "/tmp/test" })
    ).rejects.toThrow("Either tag or testIds must be provided");
  });

  it("runs tests by testIds and returns aggregate result", async () => {
    const mockTest1 = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };
    const mockTest2 = { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest1) // resolving test-1 in list
      .mockResolvedValueOnce(mockTest2) // resolving test-2 in list
      .mockResolvedValueOnce(mockTest1) // running test-1
      .mockResolvedValueOnce(mockTest2); // running test-2

    (runTest as any)
      .mockResolvedValueOnce({ status: "passed", steps_completed: 1, duration_ms: 100, console_log: [], network_log: [] })
      .mockResolvedValueOnce({ status: "passed", steps_completed: 2, duration_ms: 200, console_log: [], network_log: [] });

    (storage.saveRun as any)
      .mockResolvedValueOnce({ id: "run-1" })
      .mockResolvedValueOnce({ id: "run-2" });

    const result = await runSuite({
      testIds: ["test-1", "test-2"],
      storageDir: "/tmp/test",
    });

    expect(result.status).toBe("passed");
    expect(result.total).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].testId).toBe("test-1");
    expect(result.results[0].status).toBe("passed");
    expect(result.results[1].testId).toBe("test-2");
    expect(result.results[1].status).toBe("passed");
  });

  it("runs tests by tag", async () => {
    const mockTests = [
      { id: "smoke-1", name: "Smoke 1", definition: { url: "http://localhost", steps: [] } },
    ];

    (storage.listTests as any).mockResolvedValueOnce(mockTests);
    (storage.getTest as any).mockResolvedValueOnce(mockTests[0]);

    (runTest as any).mockResolvedValueOnce({
      status: "passed",
      steps_completed: 1,
      duration_ms: 50,
      console_log: [],
      network_log: [],
    });

    (storage.saveRun as any).mockResolvedValueOnce({ id: "run-1" });

    const result = await runSuite({
      tag: "smoke",
      storageDir: "/tmp/test",
    });

    expect(result.status).toBe("passed");
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(storage.listTests).toHaveBeenCalledWith("/tmp/test", { tag: "smoke" });
  });

  it("handles test failure and continues by default", async () => {
    const mockTest1 = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };
    const mockTest2 = { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest1) // resolve list
      .mockResolvedValueOnce(mockTest2) // resolve list
      .mockResolvedValueOnce(mockTest1) // run test-1
      .mockResolvedValueOnce(mockTest2); // run test-2

    (runTest as any)
      .mockResolvedValueOnce({ status: "failed", failed_step: 0, error: "assertion failed", console_errors: [], duration_ms: 100, console_log: [], network_log: [] })
      .mockResolvedValueOnce({ status: "passed", steps_completed: 1, duration_ms: 200, console_log: [], network_log: [] });

    (storage.saveRun as any)
      .mockResolvedValueOnce({ id: "run-1" })
      .mockResolvedValueOnce({ id: "run-2" });

    const result = await runSuite({
      testIds: ["test-1", "test-2"],
      storageDir: "/tmp/test",
    });

    expect(result.status).toBe("failed");
    expect(result.total).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[1].status).toBe("passed");
  });

  it("stops on first failure when stopOnFailure is true", async () => {
    const mockTest1 = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };
    const mockTest2 = { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest1) // resolve list test-1
      .mockResolvedValueOnce(mockTest2) // resolve list test-2
      .mockResolvedValueOnce(mockTest1); // run test-1 (test-2 is skipped)

    (runTest as any)
      .mockResolvedValueOnce({ status: "failed", failed_step: 0, error: "fail", console_errors: [], duration_ms: 100, console_log: [], network_log: [] });

    (storage.saveRun as any).mockResolvedValueOnce({ id: "run-1" });

    const result = await runSuite({
      testIds: ["test-1", "test-2"],
      storageDir: "/tmp/test",
      stopOnFailure: true,
    });

    expect(result.status).toBe("failed");
    expect(result.total).toBe(2);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[1].status).toBe("skipped");
    // runTest should only be called once (test-2 is skipped)
    expect(runTest).toHaveBeenCalledTimes(1);
  });

  it("emits suite events", async () => {
    const events: SuiteEvent[] = [];
    const mockTest = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest)   // resolve list
      .mockResolvedValueOnce(mockTest);  // run test

    (runTest as any).mockResolvedValueOnce({
      status: "passed",
      steps_completed: 1,
      duration_ms: 50,
      console_log: [],
      network_log: [],
    });

    (storage.saveRun as any).mockResolvedValueOnce({ id: "run-1" });

    await runSuite(
      { testIds: ["test-1"], storageDir: "/tmp/test" },
      (event) => events.push(event)
    );

    expect(events.some(e => e.type === "suite:start")).toBe(true);
    expect(events.some(e => e.type === "suite:test_start")).toBe(true);
    expect(events.some(e => e.type === "suite:test_complete")).toBe(true);
    expect(events.some(e => e.type === "suite:complete")).toBe(true);
  });

  it("skips missing tests when resolving by testIds", async () => {
    const mockTest = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest)   // resolve list: test-1
      .mockResolvedValueOnce(null)       // resolve list: missing-test — not found
      .mockResolvedValueOnce(mockTest);  // run test-1

    (runTest as any).mockResolvedValueOnce({
      status: "passed",
      steps_completed: 1,
      duration_ms: 50,
      console_log: [],
      network_log: [],
    });

    (storage.saveRun as any).mockResolvedValueOnce({ id: "run-1" });

    const result = await runSuite({
      testIds: ["test-1", "missing-test"],
      storageDir: "/tmp/test",
    });

    // Only test-1 was found and ran
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
  });
});

describe("suite-runner concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs multiple tests concurrently with concurrency > 1", async () => {
    const mockTests = [
      { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } },
      { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } },
      { id: "test-3", name: "Test 3", definition: { url: "http://localhost", steps: [] } },
    ];

    // Track concurrency: record when tests start/end
    const runningCount = { current: 0, max: 0 };

    // getTest: first 3 calls for list resolution, next 3 for running
    (storage.getTest as any)
      .mockResolvedValueOnce(mockTests[0])
      .mockResolvedValueOnce(mockTests[1])
      .mockResolvedValueOnce(mockTests[2])
      .mockResolvedValueOnce(mockTests[0])
      .mockResolvedValueOnce(mockTests[1])
      .mockResolvedValueOnce(mockTests[2]);

    (runTest as any).mockImplementation(async () => {
      runningCount.current++;
      if (runningCount.current > runningCount.max) {
        runningCount.max = runningCount.current;
      }
      // Simulate some async work
      await new Promise(r => setTimeout(r, 10));
      runningCount.current--;
      return { status: "passed", steps_completed: 1, duration_ms: 10, console_log: [], network_log: [] };
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    const result = await runSuite({
      testIds: ["test-1", "test-2", "test-3"],
      storageDir: "/tmp/test",
      concurrency: 3,
    });

    expect(result.status).toBe("passed");
    expect(result.total).toBe(3);
    expect(result.passed).toBe(3);
    // With concurrency 3 and 3 tests, all should run in parallel
    expect(runningCount.max).toBeGreaterThan(1);
  });

  it("passes createTab=true when concurrency > 1", async () => {
    const mockTest = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest) // resolve list
      .mockResolvedValueOnce(mockTest); // run test

    (runTest as any).mockResolvedValueOnce({
      status: "passed", steps_completed: 1, duration_ms: 10, console_log: [], network_log: [],
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    await runSuite({
      testIds: ["test-1"],
      storageDir: "/tmp/test",
      concurrency: 2,
    });

    // runTest should be called with createTab=true (6th argument)
    expect(runTest).toHaveBeenCalledTimes(1);
    const call = (runTest as any).mock.calls[0];
    expect(call[5]).toBe(true); // createTab param
  });

  it("does not pass createTab when concurrency is 1", async () => {
    const mockTest = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest) // resolve list
      .mockResolvedValueOnce(mockTest); // run test

    (runTest as any).mockResolvedValueOnce({
      status: "passed", steps_completed: 1, duration_ms: 10, console_log: [], network_log: [],
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    await runSuite({
      testIds: ["test-1"],
      storageDir: "/tmp/test",
      concurrency: 1,
    });

    expect(runTest).toHaveBeenCalledTimes(1);
    const call = (runTest as any).mock.calls[0];
    expect(call[5]).toBe(false); // createTab param should be false
  });

  it("preserves result ordering regardless of completion order", async () => {
    const mockTests = [
      { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } },
      { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } },
      { id: "test-3", name: "Test 3", definition: { url: "http://localhost", steps: [] } },
    ];

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTests[0])
      .mockResolvedValueOnce(mockTests[1])
      .mockResolvedValueOnce(mockTests[2])
      .mockResolvedValueOnce(mockTests[0])
      .mockResolvedValueOnce(mockTests[1])
      .mockResolvedValueOnce(mockTests[2]);

    // Make tests complete in reverse order
    let callCount = 0;
    (runTest as any).mockImplementation(async () => {
      const delay = [30, 20, 10][callCount++] ?? 10;
      await new Promise(r => setTimeout(r, delay));
      return { status: "passed", steps_completed: 1, duration_ms: delay, console_log: [], network_log: [] };
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    const result = await runSuite({
      testIds: ["test-1", "test-2", "test-3"],
      storageDir: "/tmp/test",
      concurrency: 3,
    });

    // Results should be in original order despite different completion times
    expect(result.results[0].testId).toBe("test-1");
    expect(result.results[1].testId).toBe("test-2");
    expect(result.results[2].testId).toBe("test-3");
  });

  it("respects semaphore limit", async () => {
    const mockTests = [
      { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } },
      { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } },
      { id: "test-3", name: "Test 3", definition: { url: "http://localhost", steps: [] } },
      { id: "test-4", name: "Test 4", definition: { url: "http://localhost", steps: [] } },
    ];

    const runningCount = { current: 0, max: 0 };

    // getTest: 4 for list + 4 for run
    (storage.getTest as any).mockImplementation(async (_dir: string, id: string) => {
      return mockTests.find(t => t.id === id) ?? null;
    });

    (runTest as any).mockImplementation(async () => {
      runningCount.current++;
      if (runningCount.current > runningCount.max) {
        runningCount.max = runningCount.current;
      }
      await new Promise(r => setTimeout(r, 20));
      runningCount.current--;
      return { status: "passed", steps_completed: 1, duration_ms: 20, console_log: [], network_log: [] };
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    const result = await runSuite({
      testIds: ["test-1", "test-2", "test-3", "test-4"],
      storageDir: "/tmp/test",
      concurrency: 2,
    });

    expect(result.passed).toBe(4);
    // Max concurrent should not exceed 2
    expect(runningCount.max).toBeLessThanOrEqual(2);
  });

  it("stopOnFailure with concurrency skips pending tests", async () => {
    const mockTests = [
      { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } },
      { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } },
      { id: "test-3", name: "Test 3", definition: { url: "http://localhost", steps: [] } },
    ];

    (storage.getTest as any).mockImplementation(async (_dir: string, id: string) => {
      return mockTests.find(t => t.id === id) ?? null;
    });

    let callIndex = 0;
    (runTest as any).mockImplementation(async () => {
      const idx = callIndex++;
      if (idx === 0) {
        // First test fails immediately
        return { status: "failed", failed_step: 0, error: "fail", console_errors: [], duration_ms: 5, console_log: [], network_log: [] };
      }
      // Other tests take longer
      await new Promise(r => setTimeout(r, 50));
      return { status: "passed", steps_completed: 1, duration_ms: 50, console_log: [], network_log: [] };
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    const result = await runSuite({
      testIds: ["test-1", "test-2", "test-3"],
      storageDir: "/tmp/test",
      stopOnFailure: true,
      concurrency: 1, // sequential to ensure predictable ordering
    });

    expect(result.failed).toBe(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.results[0].status).toBe("failed");
  });

  it("defaults to concurrency 1 (sequential) when not specified", async () => {
    const mockTest = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest)
      .mockResolvedValueOnce(mockTest);

    (runTest as any).mockResolvedValueOnce({
      status: "passed", steps_completed: 1, duration_ms: 10, console_log: [], network_log: [],
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    const result = await runSuite({
      testIds: ["test-1"],
      storageDir: "/tmp/test",
      // no concurrency specified
    });

    expect(result.passed).toBe(1);
    // createTab should be false when concurrency is 1
    const call = (runTest as any).mock.calls[0];
    expect(call[5]).toBe(false);
  });

  it("generates unique sessionIds with index to prevent collisions", async () => {
    const mockTests = [
      { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } },
      { id: "test-2", name: "Test 2", definition: { url: "http://localhost", steps: [] } },
    ];

    (storage.getTest as any).mockImplementation(async (_dir: string, id: string) => {
      return mockTests.find(t => t.id === id) ?? null;
    });

    (runTest as any).mockResolvedValue({
      status: "passed", steps_completed: 1, duration_ms: 10, console_log: [], network_log: [],
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    await runSuite({
      testIds: ["test-1", "test-2"],
      storageDir: "/tmp/test",
      concurrency: 2,
    });

    // Verify each runTest call got a different sessionId (7th argument, index 6)
    const calls = (runTest as any).mock.calls;
    const sessionIds = calls.map((c: any[]) => c[6]);
    const uniqueIds = new Set(sessionIds);
    expect(uniqueIds.size).toBe(sessionIds.length);

    // Each sessionId should end with the index
    expect(sessionIds[0]).toMatch(/-0$/);
    expect(sessionIds[1]).toMatch(/-1$/);
  });

  it("cleans up suite sessions after all tests complete", async () => {
    const mockTest = { id: "test-1", name: "Test 1", definition: { url: "http://localhost", steps: [] } };

    (storage.getTest as any)
      .mockResolvedValueOnce(mockTest) // resolve list
      .mockResolvedValueOnce(mockTest); // run test

    (runTest as any).mockResolvedValueOnce({
      status: "passed", steps_completed: 1, duration_ms: 10, console_log: [], network_log: [],
    });

    (storage.saveRun as any).mockResolvedValue({ id: "run-x" });

    await runSuite({
      testIds: ["test-1"],
      storageDir: "/tmp/test",
      concurrency: 2,
    });

    // Cleanup should have attempted to close the tab via CDP
    // The CDP mock was called for cleanup
    const CDP = (await import("chrome-remote-interface")).default;
    expect(CDP).toHaveBeenCalled();
    // Should close the CDP connection after cleanup
    expect(mockCDPClose).toHaveBeenCalled();
  });
});
