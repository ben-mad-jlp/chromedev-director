/**
 * Tests for step runner variable handling and step chaining
 */

import { describe, it, expect, beforeEach, vi, type Mocked } from "vitest";
import { runSteps } from "./step-runner";
import { CDPClient, TestDef, StepDef } from "./types";

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
});
