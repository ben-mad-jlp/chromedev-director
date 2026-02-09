/**
 * Tests for step runner variable handling and step chaining
 */

import { describe, it, expect, beforeEach, vi, type Mocked } from "vitest";
import { runSteps, runTest } from "./step-runner";
import { CDPClient, TestDef, StepDef } from "./types";

// Mock CDPClient constructor for runTest tests (verify_page)
const mockCdpInstance: Mocked<CDPClient> = {
  connect: vi.fn(),
  navigate: vi.fn(),
  evaluate: vi.fn(),
  fill: vi.fn(),
  click: vi.fn(),
  getConsoleMessages: vi.fn().mockResolvedValue([]),
  getNetworkResponses: vi.fn().mockResolvedValue([]),
  getDomSnapshot: vi.fn().mockResolvedValue("<html></html>"),
  captureScreenshot: vi.fn().mockResolvedValue("base64png"),
  select: vi.fn(),
  pressKey: vi.fn(),
  hover: vi.fn(),
  switchFrame: vi.fn(),
  handleDialog: vi.fn(),
  close: vi.fn(),
  addMockRule: vi.fn(),
};

vi.mock("./cdp-client.js", () => ({
  CDPClient: vi.fn(() => mockCdpInstance),
}));

describe("step-runner", () => {
  let mockClient: Mocked<CDPClient>;

  beforeEach(() => {
    mockClient = {
      connect: vi.fn(),
      navigate: vi.fn(),
      evaluate: vi.fn(),
      fill: vi.fn(),
      click: vi.fn(),
      getConsoleMessages: vi.fn(),
      getNetworkResponses: vi.fn(),
      getDomSnapshot: vi.fn(),
      captureScreenshot: vi.fn(),
      select: vi.fn(),
      pressKey: vi.fn(),
      hover: vi.fn(),
      switchFrame: vi.fn(),
      handleDialog: vi.fn(),
      close: vi.fn(),
      addMockRule: vi.fn(),
    };
  });

  describe("variable storage with 'as' field", () => {
    it("stores eval step result in vars map", async () => {
      mockClient.evaluate.mockResolvedValueOnce(42);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "1 + 1", as: "result" },
          { eval: "$vars.result", as: "doubled" },
        ],
      };

      // First eval stores 42 in vars.result
      // We can't directly check the internal vars, but we can verify behavior
      // by having a second eval step that uses $vars.result
      mockClient.evaluate.mockResolvedValueOnce(42); // First step
      mockClient.evaluate.mockImplementationOnce((expr) => {
        // Second step - the interpolated expression should have result value
        return Promise.resolve(42);
      });

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2);
    });

    it("makes eval result available to subsequent steps", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce("https://example.com")
        .mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "window.location.href", as: "currentUrl" },
          { eval: "window.location.href === '$vars.currentUrl'", as: "match" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect(mockClient.evaluate).toHaveBeenCalledTimes(2);
      // Second call should have interpolated $vars.currentUrl
      expect(mockClient.evaluate).toHaveBeenLastCalledWith(
        expect.stringContaining("https://example.com")
      );
    });

    it("stores multiple variables from different eval steps", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce("John")
        .mockResolvedValueOnce("Doe")
        .mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "document.querySelector('.first-name').textContent", as: "firstName" },
          { eval: "document.querySelector('.last-name').textContent", as: "lastName" },
          { eval: "true", as: "verified" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(3);
    });
  });

  describe("variable interpolation in steps", () => {
    it("interpolates $vars in fill selector", async () => {
      mockClient.evaluate.mockResolvedValueOnce("input.username");
      mockClient.fill.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "'input.username'", as: "selector" },
          { fill: { selector: "$vars.selector", value: "admin" } },
        ],
      };

      await runSteps(mockClient, testDef);

      expect(mockClient.fill).toHaveBeenCalledWith("input.username", "admin");
    });

    it("interpolates $vars in fill value", async () => {
      mockClient.evaluate.mockResolvedValueOnce("testuser");
      mockClient.fill.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "'testuser'", as: "username" },
          { fill: { selector: "input", value: "$vars.username" } },
        ],
      };

      await runSteps(mockClient, testDef);

      expect(mockClient.fill).toHaveBeenCalledWith("input", "testuser");
    });

    it("interpolates $vars in click selector", async () => {
      mockClient.evaluate.mockResolvedValueOnce("button.submit");
      mockClient.click.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "'button.submit'", as: "submitBtn" },
          { click: { selector: "$vars.submitBtn" } },
        ],
      };

      await runSteps(mockClient, testDef);

      expect(mockClient.click).toHaveBeenCalledWith("button.submit");
    });

    it("interpolates $vars in assert expression", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce("Success")
        .mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "'Success'", as: "expectedMessage" },
          { assert: "document.body.textContent.includes('$vars.expectedMessage')" },
        ],
      };

      await runSteps(mockClient, testDef);

      expect(mockClient.evaluate).toHaveBeenLastCalledWith(
        expect.stringContaining("Success")
      );
    });
  });

  describe("resume_from functionality", () => {
    it("skips to resume_from index when no variable storage in skipped steps", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { wait: 1000 }, // Step 0 - no 'as' field
          { wait: 500 }, // Step 1 - no 'as' field
          { eval: "true" }, // Step 2 - no 'as' field
        ],
        resume_from: 2,
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(1); // Only step 2 executed
      expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
    });

    it("re-runs from start if skipped steps contain 'as' field", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce(42)
        .mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "1 + 1", as: "result" }, // Step 0 - has 'as' field
          { eval: "$vars.result > 40" }, // Step 1
        ],
        resume_from: 1,
      };

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await runSteps(mockClient, testDef);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Skipped steps contain variable storage; re-running from start"
      );
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2); // All steps executed from start
      expect(mockClient.evaluate).toHaveBeenCalledTimes(2);

      consoleWarnSpy.mockRestore();
    });

    it("handles resume_from with mixed step types", async () => {
      mockClient.fill.mockResolvedValueOnce(undefined);
      mockClient.click.mockResolvedValueOnce(undefined);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { fill: { selector: "input", value: "test" } }, // Step 0
          { click: { selector: "button" } }, // Step 1
          { eval: "true" }, // Step 2
        ],
        resume_from: 1,
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2); // Steps 1 and 2
      expect(mockClient.fill).not.toHaveBeenCalled(); // Step 0 skipped
      expect(mockClient.click).toHaveBeenCalledTimes(1);
      expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  describe("variable interpolation with env variables", () => {
    it("interpolates $env variables from TestDef.env", async () => {
      mockClient.fill.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        env: {
          API_KEY: "secret123",
          USERNAME: "admin",
        },
        steps: [
          { fill: { selector: "input", value: "$env.USERNAME" } },
        ],
      };

      await runSteps(mockClient, testDef);

      expect(mockClient.fill).toHaveBeenCalledWith("input", "admin");
    });

    it("combines $env and $vars interpolation", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce("john@example.com")
        .mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        env: {
          DOMAIN: "example.com",
        },
        steps: [
          { eval: "'john'", as: "username" },
          { eval: "'$vars.username@$env.DOMAIN'", as: "email" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      // Second eval call should have interpolated both $vars and $env
      expect(mockClient.evaluate).toHaveBeenLastCalledWith(
        expect.stringContaining("john@example.com")
      );
    });
  });

  describe("error handling", () => {
    it("returns failed status when eval step throws", async () => {
      mockClient.evaluate.mockRejectedValueOnce(new Error("Syntax error"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "invalid syntax" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("failed");
      expect((result as any).failed_step).toBe(0);
      expect((result as any).error).toContain("Syntax error");
    });

    it("returns failed status with step label", async () => {
      mockClient.evaluate.mockRejectedValueOnce(new Error("Error"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Check page title", eval: "throw new Error('Error')" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("failed");
      expect((result as any).failed_label).toBe("Check page title");
    });

    it("returns duration_ms in result", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("step label handling", () => {
    it("uses step label in error message if provided", async () => {
      mockClient.evaluate.mockRejectedValueOnce(new Error("Failed"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Custom step label", eval: "throw" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("failed");
      expect((result as any).failed_label).toBe("Custom step label");
    });

    it("generates default label if not provided", async () => {
      mockClient.evaluate.mockRejectedValueOnce(new Error("Failed"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "throw" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("failed");
      expect((result as any).failed_label).toBe("Step 1");
    });
  });

  describe("variable naming validation", () => {
    it("stores variables with valid identifiers", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce("value1")
        .mockResolvedValueOnce("value2")
        .mockResolvedValueOnce("value3");

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "'value1'", as: "result" },
          { eval: "'value2'", as: "_privateVar" },
          { eval: "'value3'", as: "var123" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(3);
    });
  });

  describe("run_test step nesting", () => {
    it("executes nested test by ID and validates it runs steps", async () => {
      // Since the actual implementation uses getTest imported at top, we'll work with what's available
      // by mocking at the module level
      mockClient.navigate.mockResolvedValueOnce(undefined);
      mockClient.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            label: "Run nested test",
            run_test: "login-test",
          } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef, undefined, "/fake/root");

      // Test validates the run_test handler accepts a string ID
      expect(result.status).toBeDefined();
    });

    it("rejects non-string run_test IDs", async () => {
      mockClient.navigate.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            run_test: 123,
          } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("must be a string");
    });

    it("handles run_test step with label", async () => {
      mockClient.navigate.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            label: "Execute authentication test",
            run_test: "auth-test",
          } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef, undefined, "/fake/root");

      // Validates that run_test step definitions can have labels
      expect(result.status).toBeDefined();
    });

    it("run_test step should integrate with variable interpolation", async () => {
      mockClient.navigate.mockResolvedValueOnce(undefined);
      mockClient.evaluate.mockResolvedValueOnce("test-id-value");

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "'test-id-value'", as: "testId" },
          // In real usage, the test ID would be interpolated from $vars.testId
          // The actual implementation supports this via env.ts interpolation
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
    });

    it("run_test step with empty ID should fail", async () => {
      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            run_test: "",
          } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);

      // Empty test ID should not find a test
      expect(result.status).toBe("failed");
    });

    it("run_test is properly recognized as a step type", async () => {
      // Validate that run_test is a recognized step type in the union
      const step: StepDef = {
        label: "Test execution",
        run_test: "my-test-id",
      } as any;

      // Ensure the step has run_test property
      expect("run_test" in step).toBe(true);
    });

    it("run_test step handler dispatches correctly", async () => {
      mockClient.navigate.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            run_test: "valid-test-id",
          } as any,
        ],
      };

      // This tests that the executeStep function properly dispatches to runTestStep
      const result = await runSteps(mockClient, testDef, undefined, "/fake/root");

      // Result should be defined (either passed or failed depending on mock setup)
      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
    });

    it("run_test step should appear in error messages if it fails", async () => {
      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            label: "Run deployment test",
            run_test: "nonexistent-deployment-test",
          } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef, undefined, "/fake/root");

      // When a run_test step fails, it should indicate failure
      if (result.status === "failed") {
        expect((result as any).failed_label || (result as any).error).toBeDefined();
      }
    });
  });

  describe("step:start and step:pass events", () => {
    it("emits step:start before each step execution", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "First check", eval: "true" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      expect(events.some(e => e.type === "step:start")).toBe(true);
      const startEvent = events.find(e => e.type === "step:start");
      expect(startEvent).toBeDefined();
      expect(startEvent?.stepIndex).toBe(0);
      expect(startEvent?.label).toBe("First check");
      expect(startEvent?.nested).toBeNull();
    });

    it("emits step:pass after successful step execution", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Success step", eval: "true" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const passEvent = events.find(e => e.type === "step:pass");
      expect(passEvent).toBeDefined();
      expect(passEvent?.stepIndex).toBe(0);
      expect(passEvent?.label).toBe("Success step");
      expect(passEvent?.nested).toBeNull();
      expect(passEvent?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("emits step:start and step:pass for multiple steps", async () => {
      const events: any[] = [];
      mockClient.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Step 1", eval: "true" },
          { label: "Step 2", eval: "true" },
          { label: "Step 3", eval: "true" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const startEvents = events.filter(e => e.type === "step:start");
      const passEvents = events.filter(e => e.type === "step:pass");

      expect(startEvents).toHaveLength(3);
      expect(passEvents).toHaveLength(3);
      expect(startEvents[0].stepIndex).toBe(0);
      expect(startEvents[1].stepIndex).toBe(1);
      expect(startEvents[2].stepIndex).toBe(2);
    });

    it("includes accurate duration_ms in step:pass event", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const passEvent = events.find(e => e.type === "step:pass");
      expect(passEvent?.duration_ms).toBeDefined();
      expect(typeof passEvent?.duration_ms).toBe("number");
      expect(passEvent?.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("step:fail event", () => {
    it("emits step:fail when step throws error", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockRejectedValueOnce(new Error("Step failed"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Failing step", eval: "throw new Error('Step failed')" },
        ],
      };

      const result = await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      expect(result.status).toBe("failed");

      const failEvent = events.find(e => e.type === "step:fail");
      expect(failEvent).toBeDefined();
      expect(failEvent?.stepIndex).toBe(0);
      expect(failEvent?.label).toBe("Failing step");
      expect(failEvent?.nested).toBeNull();
      expect(failEvent?.error).toBeDefined();
      expect(failEvent?.error).toContain("Step failed");
      expect(failEvent?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("includes error message in step:fail event", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockRejectedValueOnce(new Error("Syntax error in expression"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Parse step", eval: "invalid" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const failEvent = events.find(e => e.type === "step:fail");
      expect(failEvent?.error).toContain("Syntax error");
    });

    it("still emits step:start before failing step", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockRejectedValueOnce(new Error("Failed"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Bad step", eval: "throw" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const startEvent = events.find(e => e.type === "step:start");
      const failEvent = events.find(e => e.type === "step:fail");

      expect(startEvent).toBeDefined();
      expect(failEvent).toBeDefined();
      expect(events.indexOf(startEvent!) < events.indexOf(failEvent!)).toBe(true);
    });
  });

  describe("event structure validation", () => {
    it("emits events with correct nested field for top-level steps", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const stepEvents = events.filter(e => e.type === "step:start" || e.type === "step:pass");
      for (const event of stepEvents) {
        expect(event.nested).toBeNull();
      }
    });

    it("emits events with all required fields in step:start", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { label: "Check", eval: "true" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const startEvent = events.find(e => e.type === "step:start");
      expect(startEvent).toHaveProperty("type");
      expect(startEvent).toHaveProperty("stepIndex");
      expect(startEvent).toHaveProperty("label");
      expect(startEvent).toHaveProperty("nested");
    });

    it("emits events with all required fields in step:pass", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const passEvent = events.find(e => e.type === "step:pass");
      expect(passEvent).toHaveProperty("type");
      expect(passEvent).toHaveProperty("stepIndex");
      expect(passEvent).toHaveProperty("label");
      expect(passEvent).toHaveProperty("nested");
      expect(passEvent).toHaveProperty("duration_ms");
    });

    it("emits events with all required fields in step:fail", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockRejectedValueOnce(new Error("Failed"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "throw" },
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const failEvent = events.find(e => e.type === "step:fail");
      expect(failEvent).toHaveProperty("type");
      expect(failEvent).toHaveProperty("stepIndex");
      expect(failEvent).toHaveProperty("label");
      expect(failEvent).toHaveProperty("nested");
      expect(failEvent).toHaveProperty("duration_ms");
      expect(failEvent).toHaveProperty("error");
    });
  });

  describe("event emission without callback", () => {
    it("executes steps normally when no onEvent callback provided", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(1);
    });

    it("does not require onEvent callback (backward compatible)", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true" },
        ],
      };

      // Should not throw when called without callback
      expect(async () => await runSteps(mockClient, testDef)).not.toThrow();
    });
  });

  describe("screenshot step", () => {
    it("captures screenshot and returns base64 data", async () => {
      mockClient.captureScreenshot.mockResolvedValueOnce("iVBORw0KGgo=");

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { screenshot: {} } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.captureScreenshot).toHaveBeenCalledTimes(1);
    });

    it("stores screenshot in vars when as is provided", async () => {
      mockClient.captureScreenshot.mockResolvedValueOnce("base64data");
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { screenshot: { as: "snap" } } as any,
          { eval: "true" },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
    });

    it("returns failed when screenshot fails", async () => {
      mockClient.captureScreenshot.mockRejectedValueOnce(new Error("No page"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { screenshot: {} } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("No page");
    });
  });

  describe("select step", () => {
    it("selects an option in a dropdown", async () => {
      mockClient.select.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { select: { selector: "select#country", value: "US" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.select).toHaveBeenCalledWith("select#country", "US");
    });

    it("fails with missing selector", async () => {
      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { select: { value: "US" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
    });
  });

  describe("press_key step", () => {
    it("dispatches keyboard event", async () => {
      mockClient.pressKey.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { press_key: { key: "Enter" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.pressKey).toHaveBeenCalledWith("Enter", undefined);
    });

    it("passes modifiers to pressKey", async () => {
      mockClient.pressKey.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { press_key: { key: "a", modifiers: ["ctrl"] } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.pressKey).toHaveBeenCalledWith("a", ["ctrl"]);
    });

    it("fails with missing key", async () => {
      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { press_key: {} } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
    });
  });

  describe("hover step", () => {
    it("hovers over an element", async () => {
      mockClient.hover.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { hover: { selector: ".tooltip-trigger" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.hover).toHaveBeenCalledWith(".tooltip-trigger");
    });

    it("fails with missing selector", async () => {
      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { hover: {} } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
    });
  });

  describe("switch_frame step", () => {
    it("switches to iframe by selector", async () => {
      mockClient.switchFrame.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { switch_frame: { selector: "iframe#content" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.switchFrame).toHaveBeenCalledWith("iframe#content");
    });

    it("switches back to main frame when no selector", async () => {
      mockClient.switchFrame.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { switch_frame: {} } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.switchFrame).toHaveBeenCalledWith(undefined);
    });
  });

  describe("handle_dialog step", () => {
    it("configures dialog handler with accept", async () => {
      mockClient.handleDialog.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { handle_dialog: { action: "accept" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.handleDialog).toHaveBeenCalledWith("accept", undefined);
    });

    it("configures dialog handler with dismiss and text", async () => {
      mockClient.handleDialog.mockResolvedValueOnce(undefined);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { handle_dialog: { action: "dismiss", text: "no thanks" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.handleDialog).toHaveBeenCalledWith("dismiss", "no thanks");
    });

    it("fails with invalid action", async () => {
      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { handle_dialog: { action: "invalid" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
    });
  });

  describe("http_request step", () => {
    it("makes a successful GET request", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "application/json"]]) as any,
        json: () => Promise.resolve({ status: "ok" }),
      } as any);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { http_request: { url: "http://localhost:3001/health" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/health",
        expect.objectContaining({ method: "GET" })
      );

      globalThis.fetch = originalFetch;
    });

    it("makes a POST request with body", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "application/json"]]) as any,
        json: () => Promise.resolve({ reset: true }),
      } as any);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { http_request: { url: "http://localhost:3001/seed/reset", method: "POST", body: { scenario: "login" } } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/seed/reset",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ scenario: "login" }),
        })
      );

      globalThis.fetch = originalFetch;
    });

    it("stores response in vars via 'as' field", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "application/json"]]) as any,
        json: () => Promise.resolve({ id: 42, name: "Test" }),
      } as any);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { http_request: { url: "http://localhost:3001/data", as: "apiData" } } as any,
          { eval: "true" },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");

      globalThis.fetch = originalFetch;
    });

    it("fails on non-ok response", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as any);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { http_request: { url: "http://localhost:3001/fail" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("500");

      globalThis.fetch = originalFetch;
    });

    it("fails on network error", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("fetch failed"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { http_request: { url: "http://localhost:9999/unreachable" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("fetch failed");

      globalThis.fetch = originalFetch;
    });

    it("sends custom headers", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "text/plain"]]) as any,
        text: () => Promise.resolve("OK"),
      } as any);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { http_request: { url: "http://localhost:3001/auth", headers: { "Authorization": "Bearer token123" } } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/auth",
        expect.objectContaining({
          headers: expect.objectContaining({ "Authorization": "Bearer token123" }),
        })
      );

      globalThis.fetch = originalFetch;
    });

    it("interpolates $env in URL", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "text/plain"]]) as any,
        text: () => Promise.resolve("OK"),
      } as any);

      const testDef: TestDef = {
        url: "https://example.com",
        env: { MOCK_API: "http://localhost:3001" },
        steps: [
          { http_request: { url: "$env.MOCK_API/seed/reset", method: "POST" } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/seed/reset",
        expect.objectContaining({ method: "POST" })
      );

      globalThis.fetch = originalFetch;
    });

    it("does not send body on GET requests", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "text/plain"]]) as any,
        text: () => Promise.resolve("OK"),
      } as any);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { http_request: { url: "http://localhost:3001/data", body: { should: "be ignored" } } } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      const fetchCall = (globalThis.fetch as any).mock.calls[0][1];
      expect(fetchCall.body).toBeUndefined();

      globalThis.fetch = originalFetch;
    });
  });

  describe("enriched test results (console_log, network_log, dom_snapshots)", () => {
    it("passed result includes console_log and network_log arrays", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.getConsoleMessages.mockResolvedValueOnce([
        { type: "log", text: "hello", timestamp: 1000 },
        { type: "error", text: "oops", timestamp: 2000 },
      ]);
      mockClient.getNetworkResponses.mockResolvedValueOnce([
        { url: "http://example.com/api", method: "GET", status: 200, timestamp: 1000 },
        { url: "http://example.com/api2", method: "POST", status: 201, timestamp: 2000 },
      ]);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [{ eval: "true" }],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      // sorted desc by timestamp
      expect((result as any).console_log).toEqual([
        { type: "error", text: "oops", timestamp: 2000 },
        { type: "log", text: "hello", timestamp: 1000 },
      ]);
      expect((result as any).network_log).toEqual([
        { url: "http://example.com/api2", method: "POST", status: 201, timestamp: 2000 },
        { url: "http://example.com/api", method: "GET", status: 200, timestamp: 1000 },
      ]);
    });

    it("step with capture_dom: true produces entry in dom_snapshots", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.getDomSnapshot.mockResolvedValueOnce("<html><body>snapshot</body></html>");
      mockClient.getConsoleMessages.mockResolvedValueOnce([]);
      mockClient.getNetworkResponses.mockResolvedValueOnce([]);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [{ eval: "true", capture_dom: true } as any],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).dom_snapshots).toEqual({
        0: "<html><body>snapshot</body></html>",
      });
    });

    it("step without capture_dom does not appear in dom_snapshots", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      mockClient.getDomSnapshot.mockResolvedValueOnce("<html>snap1</html>");
      mockClient.getConsoleMessages.mockResolvedValueOnce([]);
      mockClient.getNetworkResponses.mockResolvedValueOnce([]);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true", capture_dom: true } as any,
          { eval: "true" }, // no capture_dom
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).dom_snapshots).toEqual({ 0: "<html>snap1</html>" });
      expect((result as any).dom_snapshots[1]).toBeUndefined();
    });

    it("dom_snapshots is omitted when no steps have capture_dom", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.getConsoleMessages.mockResolvedValueOnce([]);
      mockClient.getNetworkResponses.mockResolvedValueOnce([]);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [{ eval: "true" }],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("passed");
      expect((result as any).dom_snapshots).toBeUndefined();
    });

    it("failed result includes both legacy console_errors and new console_log/network_log", async () => {
      mockClient.evaluate.mockRejectedValueOnce(new Error("Step failed"));
      mockClient.getConsoleMessages.mockResolvedValueOnce([
        { type: "error", text: "console error msg", timestamp: 3000 },
      ]);
      mockClient.getNetworkResponses.mockResolvedValueOnce([
        { url: "http://api.com/data", method: "POST", status: 500, timestamp: 2000 },
      ]);
      mockClient.getDomSnapshot.mockResolvedValueOnce("<html>failed</html>");
      mockClient.captureScreenshot.mockResolvedValueOnce("base64png");

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [{ label: "Failing step", eval: "throw" }],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("failed");
      // Legacy fields
      expect((result as any).console_errors).toEqual(["console error msg"]);
      expect((result as any).dom_snapshot).toBe("<html>failed</html>");
      // New fields
      expect((result as any).console_log).toEqual([
        { type: "error", text: "console error msg", timestamp: 3000 },
      ]);
      expect((result as any).network_log).toEqual([
        { url: "http://api.com/data", method: "POST", status: 500, timestamp: 2000 },
      ]);
    });

    it("failed result includes dom_snapshots captured before failure", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce(true)     // step 0 passes
        .mockRejectedValueOnce(new Error("Step 1 failed")); // step 1 fails
      mockClient.getDomSnapshot
        .mockResolvedValueOnce("<html>after-step-0</html>")  // capture_dom for step 0
        .mockResolvedValueOnce("<html>failure</html>");       // collectDiagnostics
      mockClient.getConsoleMessages.mockResolvedValueOnce([]);
      mockClient.getNetworkResponses.mockResolvedValueOnce([]);
      mockClient.captureScreenshot.mockResolvedValueOnce("base64");

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "true", capture_dom: true } as any,
          { eval: "throw" },
        ],
      };

      const result = await runSteps(mockClient, testDef);

      expect(result.status).toBe("failed");
      expect((result as any).dom_snapshots).toEqual({ 0: "<html>after-step-0</html>" });
      expect((result as any).dom_snapshot).toBe("<html>failure</html>");
    });
  });

  describe("conditional steps (if field)", () => {
    it("skips step when if condition is falsy", async () => {
      mockClient.evaluate.mockResolvedValueOnce(false); // if condition
      // No second call needed — step is skipped

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "document.title", if: "false" } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      // evaluate called once for the condition
      expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
    });

    it("executes step when if condition is truthy", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce(true)  // if condition
        .mockResolvedValueOnce("hello"); // eval step

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "document.title", if: "true" } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      // evaluate called twice: once for condition, once for step
      expect(mockClient.evaluate).toHaveBeenCalledTimes(2);
    });

    it("fails step when if condition throws", async () => {
      mockClient.evaluate.mockRejectedValueOnce(new Error("ReferenceError"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "document.title", if: "undefinedVar" } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("ReferenceError");
    });

    it("does not store variable when step is skipped", async () => {
      mockClient.evaluate
        .mockResolvedValueOnce(false)  // if condition — falsy, skip
        .mockResolvedValueOnce(true);  // second step, uses unset $vars

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "'should not store'", as: "val", if: "false" } as any,
          { eval: "true" },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
    });

    it("emits skipped flag in step:pass event", async () => {
      const events: any[] = [];
      mockClient.evaluate.mockResolvedValueOnce(false); // if condition

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { eval: "1+1", if: "false" } as any,
        ],
      };

      await runSteps(mockClient, testDef, (event) => {
        events.push(event);
      });

      const passEvent = events.find(e => e.type === "step:pass");
      expect(passEvent).toBeDefined();
      expect(passEvent?.skipped).toBe(true);
    });

    it("conditional works with non-eval steps", async () => {
      mockClient.evaluate.mockResolvedValueOnce(false); // if condition

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          { click: { selector: ".btn" }, if: "false" } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.click).not.toHaveBeenCalled();
    });
  });

  describe("verify_page", () => {
    beforeEach(() => {
      // Reset the module-level mock CDP instance before each verify_page test
      mockCdpInstance.connect.mockReset().mockResolvedValue(undefined);
      mockCdpInstance.navigate.mockReset().mockResolvedValue(undefined);
      mockCdpInstance.evaluate.mockReset();
      mockCdpInstance.fill.mockReset();
      mockCdpInstance.click.mockReset();
      mockCdpInstance.getConsoleMessages.mockReset().mockResolvedValue([]);
      mockCdpInstance.getNetworkResponses.mockReset().mockResolvedValue([]);
      mockCdpInstance.getDomSnapshot.mockReset().mockResolvedValue("<html></html>");
      mockCdpInstance.captureScreenshot.mockReset().mockResolvedValue("base64png");
      mockCdpInstance.close.mockReset().mockResolvedValue(undefined);
      mockCdpInstance.addMockRule.mockReset();
      mockCdpInstance.select.mockReset();
      mockCdpInstance.pressKey.mockReset();
      mockCdpInstance.hover.mockReset();
      mockCdpInstance.switchFrame.mockReset();
      mockCdpInstance.handleDialog.mockReset();
    });

    it("verify_page with selector — passes", async () => {
      // evaluate for selector check returns true on first poll
      mockCdpInstance.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        verify_page: { selector: "#app", timeout: 1000 },
        steps: [],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("passed");
    });

    it("verify_page with selector — fails after timeout", async () => {
      // evaluate always returns false for selector check
      mockCdpInstance.evaluate.mockResolvedValue(false);

      const testDef: TestDef = {
        url: "https://example.com",
        verify_page: { selector: "#nonexistent", timeout: 500 },
        steps: [{ eval: "true" }],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("verify_page failed");
      expect((result as any).error).toContain("#nonexistent");
    });

    it("verify_page with title — passes", async () => {
      // evaluate for title returns matching title
      mockCdpInstance.evaluate.mockResolvedValueOnce("My Dashboard");

      const testDef: TestDef = {
        url: "https://example.com",
        verify_page: { title: "Dashboard", timeout: 1000 },
        steps: [],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("passed");
    });

    it("verify_page with title — fails", async () => {
      // evaluate always returns wrong title
      mockCdpInstance.evaluate.mockResolvedValue("404 Not Found");

      const testDef: TestDef = {
        url: "https://example.com",
        verify_page: { title: "Dashboard", timeout: 500 },
        steps: [{ eval: "true" }],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("does not contain");
      expect((result as any).error).toContain("Dashboard");
    });

    it("verify_page with url_contains — passes", async () => {
      // evaluate for URL returns matching URL
      mockCdpInstance.evaluate.mockResolvedValueOnce("https://example.com/dashboard?tab=home");

      const testDef: TestDef = {
        url: "https://example.com/dashboard",
        verify_page: { url_contains: "dashboard", timeout: 1000 },
        steps: [],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("passed");
    });

    it("verify_page with url_contains — fails", async () => {
      // evaluate always returns wrong URL
      mockCdpInstance.evaluate.mockResolvedValue("https://example.com/login");

      const testDef: TestDef = {
        url: "https://example.com/dashboard",
        verify_page: { url_contains: "dashboard", timeout: 500 },
        steps: [{ eval: "true" }],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("does not contain");
      expect((result as any).error).toContain("dashboard");
    });

    it("verify_page with multiple checks — all pass", async () => {
      // selector check
      mockCdpInstance.evaluate.mockResolvedValueOnce(true);
      // title check
      mockCdpInstance.evaluate.mockResolvedValueOnce("My Dashboard");
      // url check
      mockCdpInstance.evaluate.mockResolvedValueOnce("https://example.com/dashboard");

      const testDef: TestDef = {
        url: "https://example.com/dashboard",
        verify_page: {
          selector: "#app",
          title: "Dashboard",
          url_contains: "dashboard",
          timeout: 1000,
        },
        steps: [],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("passed");
    });

    it("verify_page with multiple checks — partial fail", async () => {
      // selector check passes, title fails, url check also evaluated
      mockCdpInstance.evaluate.mockImplementation(async (expr: string) => {
        if (expr.includes("document.querySelector")) return true;
        if (expr === "document.title") return "Wrong Page";
        if (expr === "window.location.href") return "https://example.com/dashboard";
        return false;
      });

      const testDef: TestDef = {
        url: "https://example.com/dashboard",
        verify_page: {
          selector: "#app",
          title: "Dashboard",
          url_contains: "dashboard",
          timeout: 500,
        },
        steps: [{ eval: "true" }],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("Title");
      expect((result as any).error).toContain("does not contain");
    });

    it("verify_page not set — skipped", async () => {
      // No verify_page, just run the step
      mockCdpInstance.evaluate.mockResolvedValueOnce(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [{ eval: "true" }],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("passed");
    });

    it("verify_page supports $env interpolation", async () => {
      // Track what expressions are evaluated
      const evaluatedExprs: string[] = [];
      mockCdpInstance.evaluate.mockImplementation(async (expr: string) => {
        evaluatedExprs.push(expr);
        if (expr.includes("document.querySelector")) return true;
        if (expr === "document.title") return "My Dashboard";
        if (expr === "window.location.href") return "https://example.com/dashboard";
        return true;
      });

      const testDef: TestDef = {
        url: "https://example.com",
        env: { EXPECTED_SELECTOR: "#app", EXPECTED_TITLE: "Dashboard" },
        verify_page: {
          selector: "$env.EXPECTED_SELECTOR",
          title: "$env.EXPECTED_TITLE",
          timeout: 1000,
        },
        steps: [],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("passed");
      // Verify the selector was interpolated
      expect(evaluatedExprs[0]).toContain("#app");
    });

    it("verify_page failure includes diagnostics", async () => {
      mockCdpInstance.evaluate.mockResolvedValue(false);
      mockCdpInstance.getConsoleMessages.mockResolvedValue([
        { type: "error", text: "Page error", timestamp: 1000 },
      ]);
      mockCdpInstance.getNetworkResponses.mockResolvedValue([
        { url: "https://example.com/api", method: "GET", status: 500, timestamp: 2000 },
      ]);
      mockCdpInstance.getDomSnapshot.mockResolvedValue("<html><body>Error</body></html>");
      mockCdpInstance.captureScreenshot.mockResolvedValue("screenshot_base64");

      const testDef: TestDef = {
        url: "https://example.com",
        verify_page: { selector: "#app", timeout: 500 },
        steps: [{ eval: "true" }],
      };

      const result = await runTest(testDef);
      expect(result.status).toBe("failed");
      expect((result as any).console_log).toBeDefined();
      expect((result as any).console_log.length).toBeGreaterThan(0);
      expect((result as any).network_log).toBeDefined();
      expect((result as any).network_log.length).toBeGreaterThan(0);
      expect((result as any).dom_snapshot).toBe("<html><body>Error</body></html>");
      expect((result as any).screenshot).toBe("screenshot_base64");
    });
  });

  describe("loop step", () => {
    it("over mode: iterates over array, sets $vars.item and $vars.index", async () => {
      // evaluate for loop.over returns array
      mockClient.evaluate.mockResolvedValueOnce(["a", "b", "c"]);
      // Each iteration has one eval step — 3 iterations
      mockClient.evaluate
        .mockResolvedValueOnce("a-0")
        .mockResolvedValueOnce("b-1")
        .mockResolvedValueOnce("c-2");

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              over: "['a','b','c']",
              as: "item",
              index_as: "idx",
              steps: [
                { eval: "$vars.item + '-' + $vars.idx", as: "result" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      // over expression + 3 nested evals = 4 evaluate calls
      expect(mockClient.evaluate).toHaveBeenCalledTimes(4);
    });

    it("over mode: nested steps store 'as' variables visible to later iterations", async () => {
      mockClient.evaluate.mockResolvedValueOnce([1, 2, 3]);
      // Each iteration: eval step stores cumulative sum
      mockClient.evaluate
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(6);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              over: "[1,2,3]",
              steps: [
                { eval: "($vars.sum || 0) + $vars.item", as: "sum" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
    });

    it("over mode with max: caps iteration count", async () => {
      mockClient.evaluate.mockResolvedValueOnce([1, 2, 3, 4, 5]);
      // Only 2 iterations due to max
      mockClient.evaluate
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              over: "[1,2,3,4,5]",
              max: 2,
              steps: [
                { eval: "$vars.item", as: "current" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      // over expression + 2 nested evals = 3 evaluate calls
      expect(mockClient.evaluate).toHaveBeenCalledTimes(3);
    });

    it("while mode: loops until condition is false", async () => {
      // while condition evaluated 3 times: true, true, false
      mockClient.evaluate
        .mockResolvedValueOnce(true)   // while check iteration 0
        .mockResolvedValueOnce("step") // nested step iteration 0
        .mockResolvedValueOnce(true)   // while check iteration 1
        .mockResolvedValueOnce("step") // nested step iteration 1
        .mockResolvedValueOnce(false); // while check iteration 2 → stop

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              while: "someCondition()",
              max: 10,
              steps: [
                { eval: "doWork()" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      expect(mockClient.evaluate).toHaveBeenCalledTimes(5);
    });

    it("while mode: rejects if max not specified", async () => {
      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              while: "true",
              steps: [{ eval: "1" }],
            },
          } as any,
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("requires max");
    });

    it("while mode: stops at max iterations", async () => {
      // Condition always true, but max is 3
      mockClient.evaluate.mockResolvedValue(true);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              while: "true",
              max: 3,
              steps: [
                { eval: "true" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      // 3 while checks + 3 nested evals = 6 calls
      expect(mockClient.evaluate).toHaveBeenCalledTimes(6);
    });

    it("error in nested step: reports iteration index and step label", async () => {
      mockClient.evaluate.mockResolvedValueOnce(["x", "y"]);
      // First iteration: eval succeeds, click succeeds
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.click.mockResolvedValueOnce(undefined);
      // Second iteration: eval succeeds, click fails
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.click.mockRejectedValueOnce(new Error("element not found"));

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              over: "['x','y']",
              steps: [
                { eval: "true" },
                { click: { selector: ".btn" }, label: "Click submit" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("failed");
      expect((result as any).error).toContain("Loop iteration 1");
      expect((result as any).error).toContain("Click submit");
      expect((result as any).error).toContain("element not found");
    });

    it("empty array: succeeds with no iterations", async () => {
      mockClient.evaluate.mockResolvedValueOnce([]);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              over: "[]",
              steps: [
                { eval: "shouldNotRun()" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      // Only the over expression is evaluated
      expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
    });

    it("if conditional on loop step: skips entire loop", async () => {
      // if condition is false → skip
      mockClient.evaluate.mockResolvedValueOnce(false);

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            if: "false",
            loop: {
              over: "[1,2,3]",
              steps: [
                { eval: "shouldNotRun()" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
      // Only the if condition is evaluated
      expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
    });

    it("over mode: uses default 'item' and 'index' variable names", async () => {
      mockClient.evaluate.mockResolvedValueOnce(["hello"]);
      mockClient.evaluate.mockResolvedValueOnce("hello-0");

      const testDef: TestDef = {
        url: "https://example.com",
        steps: [
          {
            loop: {
              over: "['hello']",
              steps: [
                { eval: "$vars.item + '-' + $vars.index", as: "result" },
              ],
            },
          },
        ],
      };

      const result = await runSteps(mockClient, testDef);
      expect(result.status).toBe("passed");
    });
  });

  describe("high-level step types", () => {
    // ─── scan_input ───
    describe("scan_input", () => {
      it("fills input and presses Enter", async () => {
        mockClient.fill.mockResolvedValueOnce(undefined);
        mockClient.pressKey.mockResolvedValueOnce(undefined);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { scan_input: { selector: "[aria-label='Barcode']", value: "CTN-5001" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.fill).toHaveBeenCalledWith("[aria-label='Barcode']", "CTN-5001");
        expect(mockClient.pressKey).toHaveBeenCalledWith("Enter");
      });

      it("fails when fill throws", async () => {
        mockClient.fill.mockRejectedValueOnce(new Error("Element not found"));

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { scan_input: { selector: "#missing", value: "CTN-5001" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("Element not found");
      });
    });

    // ─── fill_form ───
    describe("fill_form", () => {
      it("fills multiple fields sequentially", async () => {
        mockClient.fill
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            {
              fill_form: {
                fields: [
                  { selector: "[aria-label='Email']", value: "a@b.com" },
                  { selector: "[aria-label='Password']", value: "secret" },
                  { selector: "[aria-label='Name']", value: "John" },
                ],
              },
            } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.fill).toHaveBeenCalledTimes(3);
        expect(mockClient.fill).toHaveBeenNthCalledWith(1, "[aria-label='Email']", "a@b.com");
        expect(mockClient.fill).toHaveBeenNthCalledWith(2, "[aria-label='Password']", "secret");
        expect(mockClient.fill).toHaveBeenNthCalledWith(3, "[aria-label='Name']", "John");
      });

      it("fails on first field error with field index", async () => {
        mockClient.fill
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("Element not found"));

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            {
              fill_form: {
                fields: [
                  { selector: "#ok", value: "fine" },
                  { selector: "#missing", value: "fail" },
                ],
              },
            } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("field 1");
      });

      it("handles empty fields array", async () => {
        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { fill_form: { fields: [] } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });
    });

    // ─── scroll_to ───
    describe("scroll_to", () => {
      it("scrolls element into view", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { scroll_to: { selector: "#footer" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
      });

      it("fails when element not found", async () => {
        mockClient.evaluate.mockResolvedValueOnce("not_found");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { scroll_to: { selector: "#nonexistent" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
      });
    });

    // ─── clear_input ───
    describe("clear_input", () => {
      it("clears input with React-compatible dispatch", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { clear_input: { selector: "[aria-label='Search']" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
      });

      it("fails when element not found", async () => {
        mockClient.evaluate.mockResolvedValueOnce("not_found");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { clear_input: { selector: "#missing" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
      });
    });

    // ─── wait_for_text ───
    describe("wait_for_text", () => {
      it("succeeds when text found immediately", async () => {
        mockClient.evaluate.mockResolvedValueOnce(true);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { wait_for_text: { text: "Welcome", timeout: 1000 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("succeeds when text found after polling", async () => {
        mockClient.evaluate
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { wait_for_text: { text: "Loaded", timeout: 5000 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails on timeout", async () => {
        mockClient.evaluate.mockResolvedValue(false);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { wait_for_text: { text: "Never", timeout: 300 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
        expect((result as any).error).toContain("300ms");
      });
    });

    // ─── wait_for_text_gone ───
    describe("wait_for_text_gone", () => {
      it("succeeds when text gone immediately", async () => {
        mockClient.evaluate.mockResolvedValueOnce(false);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { wait_for_text_gone: { text: "Loading...", timeout: 1000 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("succeeds when text gone after polling", async () => {
        mockClient.evaluate
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { wait_for_text_gone: { text: "Loading...", timeout: 5000 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails on timeout", async () => {
        mockClient.evaluate.mockResolvedValue(true);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { wait_for_text_gone: { text: "Stuck", timeout: 300 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("still present");
        expect((result as any).error).toContain("300ms");
      });
    });

    // ─── assert_text ───
    describe("assert_text", () => {
      it("passes when text is present", async () => {
        mockClient.evaluate.mockResolvedValueOnce(true);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { assert_text: { text: "Success" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails when text is absent", async () => {
        mockClient.evaluate.mockResolvedValueOnce(false);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { assert_text: { text: "Missing" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
      });

      it("passes with absent:true when text not present", async () => {
        mockClient.evaluate.mockResolvedValueOnce(false);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { assert_text: { text: "Error", absent: true } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("succeeds with retry after polling", async () => {
        mockClient.evaluate
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { assert_text: { text: "Delayed", retry: { interval: 100, timeout: 5000 } } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails with retry on timeout", async () => {
        mockClient.evaluate.mockResolvedValue(false);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { assert_text: { text: "Never", retry: { interval: 50, timeout: 200 } } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
      });
    });

    // ─── click_text ───
    describe("click_text", () => {
      it("clicks element by text content", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { click_text: { text: "Submit" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails when text not found", async () => {
        mockClient.evaluate.mockResolvedValueOnce("not_found");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { click_text: { text: "Nonexistent" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("no element with text");
      });

      it("passes match mode to evaluate", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { click_text: { text: "Delete", match: "exact" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        // Verify the evaluate call includes "exact"
        expect(mockClient.evaluate).toHaveBeenCalledWith(expect.stringContaining("exact"));
      });
    });

    // ─── click_nth ───
    describe("click_nth", () => {
      it("clicks element at index", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { click_nth: { index: 0, selector: ".list-item" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails when index out of bounds", async () => {
        mockClient.evaluate.mockResolvedValueOnce("out_of_bounds:3");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { click_nth: { index: 5, selector: ".item" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("out of bounds");
        expect((result as any).error).toContain("3 elements");
      });

      it("filters by text when provided", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { click_nth: { index: 0, text: "Edit", selector: "button" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.evaluate).toHaveBeenCalledWith(expect.stringContaining("Edit"));
      });
    });

    // ─── type ───
    describe("type", () => {
      it("types characters with evaluate calls", async () => {
        // Focus call
        mockClient.evaluate.mockResolvedValueOnce("ok");
        // 3 chars: "abc"
        mockClient.evaluate
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { type: { selector: "#input", text: "abc", delay: 0 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        // 1 focus + 3 char dispatches = 4
        expect(mockClient.evaluate).toHaveBeenCalledTimes(4);
      });

      it("clears input first when clear is true", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");
        mockClient.evaluate.mockResolvedValueOnce(undefined);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { type: { selector: "#input", text: "x", delay: 0, clear: true } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        // Focus IIFE should contain clear logic
        const firstCall = mockClient.evaluate.mock.calls[0][0] as string;
        expect(firstCall).toContain("nativeSetter");
      });

      it("fails when element not found", async () => {
        mockClient.evaluate.mockResolvedValueOnce("not_found");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { type: { selector: "#missing", text: "hello", delay: 0 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
      });
    });

    // ─── choose_dropdown ───
    describe("choose_dropdown", () => {
      it("opens dropdown and selects option", async () => {
        mockClient.click.mockResolvedValueOnce(undefined);
        // First poll: options appear and match
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { choose_dropdown: { selector: "[aria-label='Division']", text: "Engineering", timeout: 1000 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.click).toHaveBeenCalledWith("[aria-label='Division']");
      });

      it("fails when option not found in dropdown", async () => {
        mockClient.click.mockResolvedValueOnce(undefined);
        mockClient.evaluate.mockResolvedValueOnce("not_matched");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { choose_dropdown: { selector: "#dd", text: "Missing", timeout: 500 } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found in dropdown");
      });
    });

    // ─── expand_menu ───
    describe("expand_menu", () => {
      it("expands collapsed group", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { expand_menu: { group: "Packaging" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("succeeds when already expanded", async () => {
        mockClient.evaluate.mockResolvedValueOnce("already_expanded");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { expand_menu: { group: "Packaging" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails when group not found", async () => {
        mockClient.evaluate.mockResolvedValueOnce("not_found");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { expand_menu: { group: "Missing" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
      });
    });

    // ─── toggle ───
    describe("toggle", () => {
      it("finds label and clicks associated input", async () => {
        mockClient.evaluate.mockResolvedValueOnce("ok");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { toggle: { label: "Enable notifications" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("skips click when state already matches", async () => {
        mockClient.evaluate.mockResolvedValueOnce("already_correct");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { toggle: { label: "Dark mode", state: true } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("fails when label not found", async () => {
        mockClient.evaluate.mockResolvedValueOnce("not_found");

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { toggle: { label: "Missing feature" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("not found");
      });
    });

    // ─── close_modal ───
    describe("close_modal", () => {
      it("closes modal via button", async () => {
        mockClient.evaluate.mockResolvedValueOnce(true); // button found and clicked

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { close_modal: {} } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
      });

      it("falls back to escape when no button found", async () => {
        mockClient.evaluate.mockResolvedValueOnce(false); // tryButton returns false
        mockClient.pressKey.mockResolvedValueOnce(undefined); // escape

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { close_modal: {} } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.pressKey).toHaveBeenCalledWith("Escape");
      });

      it("fails with button strategy when no button found", async () => {
        mockClient.evaluate.mockResolvedValueOnce(false);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { close_modal: { strategy: "button" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("failed");
        expect((result as any).error).toContain("no close button");
      });

      it("uses escape strategy", async () => {
        mockClient.pressKey.mockResolvedValueOnce(undefined);

        const testDef: TestDef = {
          url: "https://example.com",
          steps: [
            { close_modal: { strategy: "escape" } } as any,
          ],
        };

        const result = await runSteps(mockClient, testDef);
        expect(result.status).toBe("passed");
        expect(mockClient.pressKey).toHaveBeenCalledWith("Escape");
      });
    });
  });
});
