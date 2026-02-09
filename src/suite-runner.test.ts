/**
 * Tests for suite runner
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSuite, SuiteEvent } from "./suite-runner";
import * as storage from "./storage";

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
