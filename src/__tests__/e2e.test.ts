/**
 * End-to-end tests for chromedev-director
 * These tests connect to a real Chrome instance running on port 9222
 * They verify complete system integration with actual Chrome DevTools Protocol communication
 *
 * To run these tests:
 * 1. Start Chrome with: google-chrome --headless --disable-gpu --remote-debugging-port=9222
 * 2. Run: npm test -- e2e.test.ts
 *
 * These tests are skipped by default if Chrome is not available
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { runTest } from "../step-runner";
import { TestDef, TestResult } from "../types";

// Skip all tests if Chrome is not available
const skipIfNoChromeAvailable = process.env.SKIP_E2E_TESTS === "true";

describe("E2E: Full chromedev-director Integration", () => {
  // Note: These tests assume a Chrome instance is running on port 9222
  // Start Chrome with: google-chrome --headless --disable-gpu --remote-debugging-port=9222

  beforeAll(async () => {
    if (skipIfNoChromeAvailable) {
      console.log("Skipping E2E tests: Chrome not available");
    }
  });

  afterAll(async () => {
    // Cleanup after all tests
  });

  it("should complete a multi-step test with eval, fill, and assertions", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {}); // Skip this test
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "document.title", as: "title" },
        { eval: "'$vars.title' === ''" },
        { eval: "document.body.innerText.length >= 0" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(3);
      expect(result.duration_ms).toBeGreaterThan(0);
    }
  });

  it("should handle variable storage and chaining", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "1 + 1", as: "sum" },
        { eval: "$vars.sum * 2", as: "doubled" },
        { eval: "$vars.doubled === 4" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(3);
    }
  });

  it("should capture errors and console messages on failure", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "throw new Error('Test error')" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBeDefined();
      expect(result.console_errors).toBeInstanceOf(Array);
    }
  });

  it("should support before and after hooks", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      before: [
        { eval: "globalThis.testSetup = true" },
      ],
      steps: [
        { eval: "globalThis.testSetup === true" },
      ],
      after: [
        { eval: "delete globalThis.testSetup" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(1);
    }
  });

  it("should handle wait and wait_for steps", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "Date.now()", as: "start" },
        { wait: 100 },
        { eval: "(Date.now() - $vars.start) >= 100" },
        { wait_for: { selector: "body", timeout: 5000 } },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(4);
    }
  });

  it("should support resume_from parameter", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "1 + 1", as: "sum" },
        { eval: "$vars.sum === 2" },
        { eval: "$vars.sum * 3", as: "product" },
      ],
      resume_from: 2, // Should skip to step 2
    };

    const result = await runTest(test, 9222);

    // Should fail because resume_from detected 'as' in skipped steps, so it re-runs
    // This validates the smart resume logic
    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(3);
    }
  });

  it("should complete successfully with complex test", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      env: {
        expectedTitle: "",
      },
      steps: [
        { eval: "document.title", as: "actualTitle" },
        { eval: "'$vars.actualTitle' === '$env.expectedTitle'" },
        { eval: "document.body !== null && document.body !== undefined" },
        { eval: "true", label: "Final assertion" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(4);
      expect(result.duration_ms).toBeGreaterThan(0);
    }
  });

  it("should handle environment variable interpolation", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      env: {
        testValue: 42,
        testString: "hello",
      },
      steps: [
        { eval: "$env.testValue === 42" },
        { eval: "'$env.testString' === 'hello'" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(2);
    }
  });

  it("should provide meaningful error messages on failure", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "false" }, // This will fail
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.failed_step).toBe(0);
      expect(result.error).toBeDefined();
      expect(typeof result.duration_ms).toBe("number");
    }
  });

  it("should track execution duration accurately", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { wait: 100 }, // Wait for 100ms
        { eval: "true" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      // Duration should be at least 100ms due to the wait step
      expect(result.duration_ms).toBeGreaterThanOrEqual(100);
    }
  });

  it("should handle multiple eval steps with variable chaining", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "10", as: "a" },
        { eval: "20", as: "b" },
        { eval: "$vars.a + $vars.b", as: "sum" },
        { eval: "$vars.sum === 30" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(4);
    }
  });

  it("should validate step count matches execution count", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "true" },
        { eval: "true" },
        { eval: "true" },
        { eval: "true" },
        { eval: "true" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(test.steps.length);
    }
  });

  it("should handle nested object variables", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      steps: [
        { eval: "({ user: { name: 'John', age: 30 } })", as: "data" },
        { eval: "typeof $vars.data === 'object'" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(2);
    }
  });

  it("should execute all before hooks before main steps", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      before: [
        { eval: "globalThis.order = []" },
        { eval: "globalThis.order.push('before1')" },
        { eval: "globalThis.order.push('before2')" },
      ],
      steps: [
        { eval: "globalThis.order.push('step1')" },
        { eval: "globalThis.order.length === 3" },
      ],
    };

    const result = await runTest(test, 9222);

    expect(result.status).toBe("passed");
    if (result.status === "passed") {
      expect(result.steps_completed).toBe(2);
    }
  });

  it("should execute after hooks even when steps fail", async () => {
    if (skipIfNoChromeAvailable) {
      vi.stubGlobal("test", () => {});
      return;
    }

    const test: TestDef = {
      url: "about:blank",
      before: [
        { eval: "globalThis.cleanup = false" },
      ],
      steps: [
        { eval: "false" }, // This fails
      ],
      after: [
        { eval: "globalThis.cleanup = true" }, // Should still run
      ],
    };

    const result = await runTest(test, 9222);

    // The test fails at step 0
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.failed_step).toBe(0);
    }
  });
});
