/**
 * Integration tests for full network mocking with multi-step tests
 * Verifies that mocking works end-to-end with all test types combined
 */

import { describe, it, expect, beforeEach, vi, type Mocked } from "vitest";
import { runSteps } from "../step-runner";
import { CDPClient, TestDef } from "../types";

describe("Integration: Full Network Mocking with Multi-Step Tests", () => {
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
      close: vi.fn(),
      addMockRule: vi.fn(),
    };
  });

  describe("Test 1: Mock API error response and validate error handling", () => {
    it("should handle mocked 500 error", async () => {
      mockClient.evaluate.mockResolvedValueOnce(500);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/data",
              status: 500,
              body: { error: "Server error" },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/data').then(r => r.status)",
            as: "response",
          },
          {
            eval: "$vars.response === 500",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2);
      expect(mockClient.addMockRule).toHaveBeenCalledWith(
        "**/api/data",
        500,
        { error: "Server error" },
        undefined
      );
    });

    it("should return correct error body with 500 response", async () => {
      mockClient.evaluate.mockResolvedValueOnce({ error: "Server error" });

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/data",
              status: 500,
              body: { error: "Server error" },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/data').then(r => r.json())",
            as: "errorBody",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect(mockClient.addMockRule).toHaveBeenCalled();
    });
  });

  describe("Test 2: Multiple endpoints with selective mocking", () => {
    it("should mock multiple endpoints selectively", async () => {
      mockClient.evaluate.mockResolvedValueOnce([200, 404]);

      const test: TestDef = {
        url: "about:blank",
        before: [
          { mock_network: { match: "**/users", status: 200, body: { users: [] } } },
          { mock_network: { match: "**/posts", status: 404 } },
        ],
        steps: [
          {
            eval: "Promise.all([fetch('/users'), fetch('/posts')]).then(rs => rs.map(r => r.status))",
            as: "statuses",
          },
          {
            eval: "$vars.statuses[0] === 200 && $vars.statuses[1] === 404",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2);
      expect(mockClient.addMockRule).toHaveBeenCalledTimes(2);
    });

    it("should handle three different endpoint mocks", async () => {
      mockClient.evaluate.mockResolvedValueOnce([200, 404, 500]);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/endpoint1",
              status: 200,
              body: { data: "response1" },
            },
          },
          {
            mock_network: {
              match: "**/api/endpoint2",
              status: 404,
            },
          },
          {
            mock_network: {
              match: "**/api/endpoint3",
              status: 500,
              body: { error: "error3" },
            },
          },
        ],
        steps: [
          {
            eval: "Promise.all([fetch('/api/endpoint1'), fetch('/api/endpoint2'), fetch('/api/endpoint3')]).then(rs => rs.map(r => r.status))",
            as: "statuses",
          },
          {
            eval: "$vars.statuses[0] === 200 && $vars.statuses[1] === 404 && $vars.statuses[2] === 500",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect(mockClient.addMockRule).toHaveBeenCalledTimes(3);
    });
  });

  describe("Test 3: Delayed mock response", () => {
    it("should apply delay to mocked response", async () => {
      mockClient.evaluate.mockResolvedValueOnce(0);
      mockClient.evaluate.mockResolvedValueOnce(150);

      const test: TestDef = {
        url: "about:blank",
        before: [
          { mock_network: { match: "**", status: 200, delay: 200 } },
        ],
        steps: [
          { eval: "Date.now()", as: "start" },
          { wait: 50 },
          {
            eval: "Date.now() - $vars.start",
            as: "elapsed",
          },
          {
            eval: "$vars.elapsed >= 200",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(4);
      expect(mockClient.addMockRule).toHaveBeenCalledWith(
        "**",
        200,
        undefined,
        200
      );
    });

    it("should support custom delay values for different endpoints", async () => {
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/fast",
              status: 200,
              delay: 100,
            },
          },
          {
            mock_network: {
              match: "**/api/slow",
              status: 200,
              delay: 500,
            },
          },
        ],
        steps: [
          { eval: "true" },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect(mockClient.addMockRule).toHaveBeenNthCalledWith(
        1,
        "**/api/fast",
        200,
        undefined,
        100
      );
      expect(mockClient.addMockRule).toHaveBeenNthCalledWith(
        2,
        "**/api/slow",
        200,
        undefined,
        500
      );
    });
  });

  describe("Test 4: Mock response body with JSON data", () => {
    it("should return correct JSON mock body", async () => {
      mockClient.evaluate.mockResolvedValueOnce({ id: 1, name: "John", email: "john@example.com" });
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/user",
              status: 200,
              body: { id: 1, name: "John", email: "john@example.com" },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/user').then(r => r.json())",
            as: "userData",
          },
          {
            eval: "$vars.userData.name === 'John' && $vars.userData.email === 'john@example.com'",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2);
    });

    it("should handle complex nested JSON response bodies", async () => {
      const complexBody = {
        data: {
          users: [
            { id: 1, name: "Alice", roles: ["admin", "user"] },
            { id: 2, name: "Bob", roles: ["user"] },
          ],
          meta: {
            total: 2,
            page: 1,
            pageSize: 10,
          },
        },
      };

      mockClient.evaluate.mockResolvedValueOnce(complexBody);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/users",
              status: 200,
              body: complexBody,
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/users').then(r => r.json())",
            as: "response",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect(mockClient.addMockRule).toHaveBeenCalledWith(
        "**/api/users",
        200,
        complexBody,
        undefined
      );
    });
  });

  describe("Test 5: Combine mocking with fill/click/assert", () => {
    it("should work with fill and click steps", async () => {
      mockClient.fill.mockResolvedValueOnce(undefined);
      mockClient.click.mockResolvedValueOnce(undefined);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        env: { apiUrl: "/api" },
        before: [
          {
            mock_network: {
              match: "**/api/submit",
              status: 201,
              body: { success: true, id: 123 },
            },
          },
        ],
        steps: [
          { fill: { selector: "input#name", value: "Test User" } },
          { click: { selector: "button#submit" } },
          {
            assert: "true",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(3);
      expect(mockClient.fill).toHaveBeenCalledWith("input#name", "Test User");
      expect(mockClient.click).toHaveBeenCalledWith("button#submit");
      expect(mockClient.addMockRule).toHaveBeenCalledWith(
        "**/api/submit",
        201,
        { success: true, id: 123 },
        undefined
      );
    });

    it("should combine multiple mocks with form interactions", async () => {
      mockClient.fill.mockResolvedValueOnce(undefined);
      mockClient.click.mockResolvedValueOnce(undefined);
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/login",
              status: 200,
              body: { token: "abc123" },
            },
          },
          {
            mock_network: {
              match: "**/api/profile",
              status: 200,
              body: { user: "john", role: "admin" },
            },
          },
        ],
        steps: [
          { fill: { selector: "input#username", value: "john" } },
          { fill: { selector: "input#password", value: "secret" } },
          { click: { selector: "button#login" } },
          { eval: "true" },
          { eval: "true" },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(5);
      expect(mockClient.addMockRule).toHaveBeenCalledTimes(2);
    });
  });

  describe("Test 6: Wildcard pattern matching", () => {
    it("should match wildcard patterns correctly", async () => {
      mockClient.evaluate.mockResolvedValueOnce([200, 200]);

      const test: TestDef = {
        url: "about:blank",
        before: [
          { mock_network: { match: "**/api/**", status: 200, body: {} } },
        ],
        steps: [
          {
            eval: "Promise.all([fetch('/api/v1/users'), fetch('/api/v2/posts')]).then(rs => rs.map(r => r.status))",
            as: "statuses",
          },
          {
            eval: "$vars.statuses[0] === 200 && $vars.statuses[1] === 200",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect(mockClient.addMockRule).toHaveBeenCalledWith(
        "**/api/**",
        200,
        {},
        undefined
      );
    });

    it("should handle multiple wildcard patterns", async () => {
      mockClient.evaluate.mockResolvedValueOnce([200, 404]);

      const test: TestDef = {
        url: "about:blank",
        before: [
          { mock_network: { match: "**/api/**", status: 200, body: { data: true } } },
          { mock_network: { match: "**/other/**", status: 404 } },
        ],
        steps: [
          {
            eval: "Promise.all([fetch('/api/test'), fetch('/other/test')]).then(rs => rs.map(r => r.status))",
            as: "statuses",
          },
          {
            eval: "$vars.statuses[0] === 200 && $vars.statuses[1] === 404",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2);
      expect(mockClient.addMockRule).toHaveBeenCalledTimes(2);
    });

    it("should support catch-all wildcard pattern", async () => {
      mockClient.evaluate.mockResolvedValueOnce(200);

      const test: TestDef = {
        url: "about:blank",
        before: [
          { mock_network: { match: "**", status: 200 } },
        ],
        steps: [
          {
            eval: "fetch('/any/endpoint').then(r => r.status)",
            as: "status",
          },
          {
            eval: "$vars.status === 200",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect(mockClient.addMockRule).toHaveBeenCalledWith("**", 200, undefined, undefined);
    });
  });

  describe("Test 7: Mocking with variable interpolation and assertions", () => {
    it("should work with env variables in mock patterns", async () => {
      mockClient.evaluate.mockResolvedValueOnce({ data: "success" });

      const test: TestDef = {
        url: "about:blank",
        env: { apiUrl: "/api", endpoint: "users" },
        before: [
          {
            mock_network: {
              match: "**/api/**",
              status: 200,
              body: { data: "success" },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/users').then(r => r.json())",
            as: "result",
          },
          {
            eval: "$vars.result.data === 'success'",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(2);
    });

    it("should validate response data with multiple assertions", async () => {
      mockClient.evaluate.mockResolvedValueOnce({ status: "ok", count: 5 });
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/status",
              status: 200,
              body: { status: "ok", count: 5 },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/status').then(r => r.json())",
            as: "data",
          },
          {
            eval: "$vars.data.status === 'ok'",
          },
          {
            eval: "$vars.data.count === 5",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(3);
    });
  });

  describe("Test 8: Advanced integration scenarios", () => {
    it("should combine all mocking features together", async () => {
      mockClient.fill.mockResolvedValueOnce(undefined);
      mockClient.click.mockResolvedValueOnce(undefined);
      mockClient.evaluate.mockResolvedValueOnce(0);
      mockClient.evaluate.mockResolvedValueOnce([200, 201, 404]);
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/login",
              status: 200,
              body: { token: "auth123" },
              delay: 50,
            },
          },
          {
            mock_network: {
              match: "**/api/users/*",
              status: 201,
              body: { id: 1, created: true },
              delay: 100,
            },
          },
          {
            mock_network: {
              match: "**/api/delete/**",
              status: 404,
            },
          },
        ],
        steps: [
          { fill: { selector: "input#user", value: "testuser" } },
          { click: { selector: "button#submit" } },
          { eval: "Date.now()", as: "start" },
          {
            eval: "Promise.all([fetch('/api/login'), fetch('/api/users/1'), fetch('/api/delete/1')]).then(rs => rs.map(r => r.status))",
            as: "statuses",
          },
          {
            eval: "$vars.statuses[0] === 200 && $vars.statuses[1] === 201 && $vars.statuses[2] === 404",
          },
          {
            eval: "Date.now() - $vars.start > 150",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(6);
      expect(mockClient.addMockRule).toHaveBeenCalledTimes(3);
      expect(mockClient.fill).toHaveBeenCalled();
      expect(mockClient.click).toHaveBeenCalled();
    });

    it("should handle sequential API calls with dependent mocks", async () => {
      mockClient.evaluate.mockResolvedValueOnce({ id: 123 });
      mockClient.evaluate.mockResolvedValueOnce(123);
      mockClient.evaluate.mockResolvedValueOnce({ id: 123, name: "User" });
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/users",
              status: 201,
              body: { id: 123 },
            },
          },
          {
            mock_network: {
              match: "**/api/users/123",
              status: 200,
              body: { id: 123, name: "User" },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/users', { method: 'POST' }).then(r => r.json())",
            as: "created",
          },
          {
            eval: "$vars.created.id",
            as: "userId",
          },
          {
            eval: "fetch('/api/users/' + $vars.userId).then(r => r.json())",
            as: "fetched",
          },
          {
            eval: "$vars.fetched.id === $vars.userId",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(4);
    });
  });

  describe("Test 9: Error handling in mocked scenarios", () => {
    it("should handle assertion failures after mocking", async () => {
      mockClient.evaluate.mockResolvedValueOnce({ status: "error" });
      mockClient.evaluate.mockResolvedValueOnce(false); // assertion fails

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/data",
              status: 200,
              body: { status: "error" },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/data').then(r => r.json())",
            as: "result",
          },
          {
            eval: "$vars.result.status === 'success'", // this should fail
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("failed");
      expect((result as any).failed_step).toBe(1);
    });

    it("should handle multiple sequential assertions", async () => {
      mockClient.evaluate.mockResolvedValueOnce({ value: 42 });
      mockClient.evaluate.mockResolvedValueOnce(true);
      mockClient.evaluate.mockResolvedValueOnce(true);

      const test: TestDef = {
        url: "about:blank",
        before: [
          {
            mock_network: {
              match: "**/api/math",
              status: 200,
              body: { value: 42 },
            },
          },
        ],
        steps: [
          {
            eval: "fetch('/api/math').then(r => r.json())",
            as: "data",
          },
          {
            eval: "$vars.data.value > 0",
          },
          {
            eval: "$vars.data.value === 42",
          },
        ],
      };

      const result = await runSteps(mockClient, test);
      expect(result.status).toBe("passed");
      expect((result as any).steps_completed).toBe(3);
    });
  });
});
