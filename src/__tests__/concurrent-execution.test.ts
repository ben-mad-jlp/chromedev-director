/**
 * Concurrent execution tests for chromedev-director
 * Tests parallel test execution with real Chrome connections
 * Verifies event listener management, cleanup, and isolation
 *
 * To run these tests:
 * 1. Start Chrome with: google-chrome --headless --disable-gpu --remote-debugging-port=9222
 * 2. Run: npm test -- concurrent-execution.test.ts
 *
 * These tests are skipped by default if Chrome is not available
 */

import { describe, it, expect, beforeAll } from "vitest";
import { runSuite } from "../suite-runner.js";
import { TestDef } from "../types.js";
import * as storage from "../storage.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";

// Skip tests if Chrome is not available
const skipIfNoChromeAvailable = process.env.SKIP_E2E_TESTS === "true";

describe("Concurrent Execution E2E Tests", () => {
  let tempDir: string;

  beforeAll(async () => {
    if (skipIfNoChromeAvailable) {
      console.log("Skipping concurrent execution tests: Chrome not available");
      return;
    }

    // Create temporary storage directory with subdirectories
    tempDir = path.join(os.tmpdir(), `chromedev-concurrent-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, "tests"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "runs"), { recursive: true });
  });

  it("should run 3 simple tests concurrently with separate tabs", async () => {
    if (skipIfNoChromeAvailable) return;

    // Create three tests with delays so we can see the tabs existing concurrently
    const test1: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "document.body.style.backgroundColor = 'lightblue'" },
        { eval: "document.body.innerHTML = '<h1>Test 1 Running...</h1>'" },
        { wait: 2000 }, // Wait 2 seconds
        { eval: "document.body.innerHTML = '<h1>Test 1 Complete!</h1>'" },
        { eval: "1 + 1 === 2" },
      ],
    };

    const test2: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "document.body.style.backgroundColor = 'lightgreen'" },
        { eval: "document.body.innerHTML = '<h1>Test 2 Running...</h1>'" },
        { wait: 2000 }, // Wait 2 seconds
        { eval: "document.body.innerHTML = '<h1>Test 2 Complete!</h1>'" },
        { eval: "2 * 3 === 6" },
      ],
    };

    const test3: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "document.body.style.backgroundColor = 'lightcoral'" },
        { eval: "document.body.innerHTML = '<h1>Test 3 Running...</h1>'" },
        { wait: 2000 }, // Wait 2 seconds
        { eval: "document.body.innerHTML = '<h1>Test 3 Complete!</h1>'" },
        { eval: "10 - 5 === 5" },
      ],
    };

    // Save tests
    await storage.saveTest(tempDir, "concurrent-1", "Test 1", test1);
    await storage.saveTest(tempDir, "concurrent-2", "Test 2", test2);
    await storage.saveTest(tempDir, "concurrent-3", "Test 3", test3);

    // Run tests concurrently
    const result = await runSuite({
      testIds: ["concurrent-1", "concurrent-2", "concurrent-3"],
      storageDir: tempDir,
      port: 9222,
      concurrency: 3,
    });

    // Verify all tests passed
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.status).toBe("passed");

    // Verify each test completed successfully
    for (const testResult of result.results) {
      expect(testResult.status).toBe("passed");
      expect(testResult.duration_ms).toBeGreaterThan(0);
    }
  }, 60000);

  it("should handle 5 concurrent tests with visual indicators", async () => {
    if (skipIfNoChromeAvailable) return;

    const colors = ['#FFB6C1', '#87CEEB', '#90EE90', '#FFD700', '#DDA0DD'];
    const tests: Array<{ id: string; def: TestDef }> = [];

    // Create 5 tests with unique visual indicators
    for (let i = 1; i <= 5; i++) {
      tests.push({
        id: `multi-test-${i}`,
        def: {
          url: "about:blank",
          steps: [
            { eval: `document.body.style.backgroundColor = '${colors[i-1]}'` },
            { eval: `document.body.innerHTML = '<div style="font-size: 48px; text-align: center; margin-top: 100px;"><h1>Tab ${i}</h1><p>Testing concurrent execution...</p></div>'` },
            { wait: 3000 }, // Wait 3 seconds so all tabs are visible
            { eval: `document.body.innerHTML += '<p style="text-align: center; font-size: 24px;">✓ Complete</p>'` },
            { eval: `${i} * ${i} === ${i * i}` },
          ],
        },
      });
    }

    // Save all tests
    for (const test of tests) {
      await storage.saveTest(tempDir, test.id, `Multi Test ${test.id}`, test.def);
    }

    // Run all tests concurrently
    const result = await runSuite({
      testIds: tests.map((t) => t.id),
      storageDir: tempDir,
      port: 9222,
      concurrency: 5,
    });

    // Verify all tests passed
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(5);
    expect(result.status).toBe("passed");
  }, 60000);

  it("should handle mixed success and failure in concurrent execution", async () => {
    if (skipIfNoChromeAvailable) return;

    // Create tests that will pass and fail
    const passingTest: TestDef = {
      url: "about:blank",
      steps: [{ eval: "true" }],
    };

    const failingTest: TestDef = {
      url: "about:blank",
      steps: [{ eval: "false" }],
    };

    await storage.saveTest(tempDir, "mixed-pass-1", "Pass 1", passingTest);
    await storage.saveTest(tempDir, "mixed-fail", "Fail", failingTest);
    await storage.saveTest(tempDir, "mixed-pass-2", "Pass 2", passingTest);

    // Run concurrently
    const result = await runSuite({
      testIds: ["mixed-pass-1", "mixed-fail", "mixed-pass-2"],
      storageDir: tempDir,
      port: 9222,
      concurrency: 3,
    });

    // Verify counts
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(3);
    expect(result.status).toBe("failed"); // Suite fails if any test fails

    // Verify the failing test is identified
    const failedTest = result.results.find((r) => r.testId === "mixed-fail");
    expect(failedTest?.status).toBe("failed");

    // Verify passing tests
    const passingTests = result.results.filter((r) => r.testId !== "mixed-fail");
    expect(passingTests.every((t) => t.status === "passed")).toBe(true);
  }, 30000);

  it("should cleanup event listeners across multiple sequential runs", async () => {
    if (skipIfNoChromeAvailable) return;

    const test: TestDef = {
      url: "about:blank",
      steps: [{ eval: "console.log('test message'); true" }],
    };

    await storage.saveTest(tempDir, "cleanup-test", "Cleanup Test", test);

    // Run the same test multiple times sequentially
    // Each run should properly clean up event listeners from the previous run
    for (let i = 0; i < 3; i++) {
      const result = await runSuite({
        testIds: ["cleanup-test"],
        storageDir: tempDir,
        port: 9222,
        concurrency: 1,
      });

      expect(result.passed).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.status).toBe("passed");
    }
  }, 45000);

  it("should handle rapid concurrent execution without listener accumulation", async () => {
    if (skipIfNoChromeAvailable) return;

    // Create multiple simple tests
    const testIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const testId = `rapid-${i}`;
      testIds.push(testId);

      await storage.saveTest(tempDir, testId, `Rapid Test ${i}`, {
        url: "about:blank",
        steps: [{ eval: `${i} === ${i}` }],
      });
    }

    // Run with concurrency 3 to test connection pooling and reuse
    const result = await runSuite({
      testIds,
      storageDir: tempDir,
      port: 9222,
      concurrency: 3,
    });

    // All tests should pass without errors
    expect(result.passed).toBe(6);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(6);
    expect(result.status).toBe("passed");

    // Verify no test took an unusually long time (would indicate deadlock or listener issues)
    const maxDuration = Math.max(...result.results.map((r) => r.duration_ms));
    expect(maxDuration).toBeLessThan(10000); // Should complete quickly
  }, 45000);

  it("should isolate console events between concurrent tests", async () => {
    if (skipIfNoChromeAvailable) return;

    // Create tests that log different messages
    const test1: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "console.log('Message from test 1'); true" },
      ],
    };

    const test2: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "console.log('Message from test 2'); true" },
      ],
    };

    await storage.saveTest(tempDir, "console-1", "Console Test 1", test1);
    await storage.saveTest(tempDir, "console-2", "Console Test 2", test2);

    // Run concurrently
    const result = await runSuite({
      testIds: ["console-1", "console-2"],
      storageDir: tempDir,
      port: 9222,
      concurrency: 2,
    });

    // Both tests should pass
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.status).toBe("passed");
  }, 30000);

  it("should run 8 tabs concurrently with clear visual identification", async () => {
    if (skipIfNoChromeAvailable) return;

    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
    ];
    const testIds: string[] = [];

    // Create 8 visually distinct tests
    for (let i = 1; i <= 8; i++) {
      const testId = `visual-tab-${i}`;
      testIds.push(testId);

      await storage.saveTest(tempDir, testId, `Visual Tab ${i}`, {
        url: "about:blank",
        steps: [
          { eval: `document.body.style.backgroundColor = '${colors[i-1]}'` },
          { eval: `document.body.style.margin = '0'; document.body.style.display = 'flex'; document.body.style.alignItems = 'center'; document.body.style.justifyContent = 'center';` },
          { eval: `document.body.innerHTML = '<div style="text-align: center;"><h1 style="font-size: 72px; margin: 0;">TAB ${i}</h1><p style="font-size: 36px; margin: 20px;">Running concurrently...</p></div>'` },
          { wait: 4000 }, // Wait 4 seconds so all 8 tabs are visible at once
          { eval: `document.body.innerHTML = '<div style="text-align: center;"><h1 style="font-size: 72px; margin: 0; color: white;">TAB ${i}</h1><p style="font-size: 48px; margin: 20px; color: white;">✓ DONE</p></div>'` },
          { eval: `true` },
        ],
      });
    }

    console.log('\n🎨 Watch for 8 colored tabs opening concurrently!\n');

    // Run all 8 tests concurrently
    const result = await runSuite({
      testIds,
      storageDir: tempDir,
      port: 9222,
      concurrency: 8,
    });

    // All tests should pass
    expect(result.passed).toBe(8);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(8);
    expect(result.status).toBe("passed");

    console.log('\n✅ All 8 concurrent tabs completed successfully!\n');
  }, 90000);
});
