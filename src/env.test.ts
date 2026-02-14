/**
 * Tests for environment variable and variable interpolation
 */

import { interpolate, interpolateStep } from "./env";

describe("interpolate", () => {
  describe("$env.KEY patterns", () => {
    it("replaces $env.KEY with env variable value", () => {
      const result = interpolate("url: $env.API_URL", {
        API_URL: "https://api.example.com",
      });
      expect(result).toBe("url: https://api.example.com");
    });

    it("handles multiple $env.KEY patterns", () => {
      const result = interpolate("$env.HOST:$env.PORT", {
        HOST: "localhost",
        PORT: 3000,
      });
      expect(result).toBe("localhost:3000");
    });

    it("leaves unknown $env.KEY as-is", () => {
      const result = interpolate("missing: $env.MISSING", {});
      expect(result).toBe("missing: $env.MISSING");
    });

    it("converts non-string env values to string", () => {
      const result = interpolate("port: $env.PORT", {
        PORT: 8080,
      });
      expect(result).toBe("port: 8080");
    });

    it("handles boolean env values", () => {
      const result = interpolate("debug: $env.DEBUG", {
        DEBUG: true,
      });
      expect(result).toBe("debug: true");
    });

    it("handles null/undefined env values", () => {
      const result = interpolate("value: $env.NULL_VAR", {
        NULL_VAR: null,
      });
      expect(result).toBe("value: null");
    });
  });

  describe("$vars.KEY patterns", () => {
    it("replaces $vars.KEY with variable value", () => {
      const result = interpolate("count: $vars.count", {}, { count: 42 });
      expect(result).toBe("count: 42");
    });

    it("handles multiple $vars.KEY patterns", () => {
      const result = interpolate(
        "$vars.first $vars.last",
        {},
        { first: "John", last: "Doe" }
      );
      expect(result).toBe("John Doe");
    });

    it("leaves unknown $vars.KEY as-is", () => {
      const result = interpolate("missing: $vars.MISSING", {});
      expect(result).toBe("missing: $vars.MISSING");
    });

    it("converts non-string var values to string", () => {
      const result = interpolate("value: $vars.num", {}, { num: 123 });
      expect(result).toBe("value: 123");
    });
  });

  describe("$vars nested dot-path patterns", () => {
    it("resolves $vars.a.b to nested value", () => {
      const result = interpolate("id: $vars.env.id", {}, { env: { id: "env-123" } });
      expect(result).toBe("id: env-123");
    });

    it("resolves deeply nested paths $vars.a.b.c", () => {
      const result = interpolate("val: $vars.a.b.c", {}, { a: { b: { c: "deep" } } });
      expect(result).toBe("val: deep");
    });

    it("leaves unresolvable nested path as-is when root key missing", () => {
      const result = interpolate("val: $vars.missing.id", {}, {});
      expect(result).toBe("val: $vars.missing.id");
    });

    it("leaves unresolvable nested path as-is when intermediate is not object", () => {
      const result = interpolate("val: $vars.str.id", {}, { str: "hello" });
      expect(result).toBe("val: $vars.str.id");
    });

    it("leaves unresolvable nested path as-is when leaf key missing", () => {
      const result = interpolate("val: $vars.env.missing", {}, { env: { id: "123" } });
      expect(result).toBe("val: $vars.env.missing");
    });

    it("resolves nested path with numeric value", () => {
      const result = interpolate("port: $vars.env.port", {}, { env: { port: 3002 } });
      expect(result).toBe("port: 3002");
    });

    it("works alongside flat vars in the same template", () => {
      const result = interpolate(
        "url: $vars.base?envId=$vars.env.id",
        {},
        { base: "http://localhost:8081", env: { id: "env-abc" } }
      );
      expect(result).toBe("url: http://localhost:8081?envId=env-abc");
    });

    it("single-level keys still work (backward compat)", () => {
      const result = interpolate("count: $vars.count", {}, { count: 42 });
      expect(result).toBe("count: 42");
    });

    it("JSON-serializes nested object when path resolves to object", () => {
      const result = interpolate("data: $vars.env", {}, { env: { id: "abc", port: 3002 } });
      expect(result).toBe('data: {"id":"abc","port":3002}');
    });

    it("resolves null intermediate as match (leaves as-is)", () => {
      const result = interpolate("val: $vars.env.id", {}, { env: null });
      expect(result).toBe("val: $vars.env.id");
    });
  });

  describe("combined patterns", () => {
    it("processes $env.KEY before $vars.KEY", () => {
      const result = interpolate(
        "URL: $env.BASE_URL, user: $vars.user",
        { BASE_URL: "https://api.example.com" },
        { user: "admin" }
      );
      expect(result).toBe(
        "URL: https://api.example.com, user: admin"
      );
    });

    it("handles mixed patterns in same string", () => {
      const result = interpolate(
        "$env.PROTO://$env.HOST:$env.PORT/$vars.path",
        {
          PROTO: "https",
          HOST: "localhost",
          PORT: 8443,
        },
        { path: "api/v1" }
      );
      expect(result).toBe("https://localhost:8443/api/v1");
    });
  });

  describe("edge cases", () => {
    it("handles empty template", () => {
      const result = interpolate("", { FOO: "bar" });
      expect(result).toBe("");
    });

    it("handles template with no patterns", () => {
      const result = interpolate("plain text", { FOO: "bar" });
      expect(result).toBe("plain text");
    });

    it("handles empty env and vars", () => {
      const result = interpolate("$env.FOO and $vars.BAR");
      expect(result).toBe("$env.FOO and $vars.BAR");
    });

    it("only replaces valid identifier patterns", () => {
      const result = interpolate("$env.123invalid $env._valid", {
        _valid: "works",
      });
      expect(result).toBe("$env.123invalid works");
    });

    it("handles adjacent patterns", () => {
      const result = interpolate("$env.A$env.B", {
        A: "1",
        B: "2",
      });
      expect(result).toBe("12");
    });

    it("handles patterns at start and end", () => {
      const result = interpolate("$env.START and $vars.END", {
        START: "begin",
      }, {
        END: "finish",
      });
      expect(result).toBe("begin and finish");
    });
  });

  describe("special characters in values", () => {
    it("handles values with spaces", () => {
      const result = interpolate("name: $vars.name", {}, { name: "John Doe" });
      expect(result).toBe("name: John Doe");
    });

    it("handles values with special regex characters", () => {
      const result = interpolate("pattern: $env.REGEX", {
        REGEX: ".*[a-z]+",
      });
      expect(result).toBe("pattern: .*[a-z]+");
    });

    it("handles values with $ character", () => {
      const result = interpolate("price: $vars.price", {}, { price: "$100" });
      expect(result).toBe("price: $100");
    });
  });
});

describe("interpolateStep", () => {
  describe("eval step", () => {
    it("interpolates eval expression", () => {
      const step = interpolateStep(
        { eval: "window.location.href === '$vars.expectedUrl'" },
        {},
        { expectedUrl: "https://example.com" }
      );
      expect(step).toEqual({
        eval: "window.location.href === 'https://example.com'",
      });
    });

    it("preserves eval as field", () => {
      const step = interpolateStep(
        { eval: "1 + 1", as: "result" },
        {},
        {}
      );
      expect(step).toEqual({
        eval: "1 + 1",
        as: "result",
      });
    });

    it("interpolates label in eval step", () => {
      const step = interpolateStep(
        { label: "Check $vars.thing", eval: "true" },
        {},
        { thing: "homepage" }
      );
      expect(step).toEqual({
        label: "Check homepage",
        eval: "true",
      });
    });
  });

  describe("fill step", () => {
    it("interpolates fill selector and value", () => {
      const step = interpolateStep(
        { fill: { selector: "$vars.inputSelector", value: "$env.USERNAME" } },
        { USERNAME: "admin" },
        { inputSelector: "input.username" }
      );
      expect(step).toEqual({
        fill: {
          selector: "input.username",
          value: "admin",
        },
      });
    });

    it("interpolates label in fill step", () => {
      const step = interpolateStep(
        { label: "Fill $vars.field", fill: { selector: "input", value: "test" } },
        {},
        { field: "email" }
      );
      expect(step).toEqual({
        label: "Fill email",
        fill: { selector: "input", value: "test" },
      });
    });
  });

  describe("click step", () => {
    it("interpolates click selector", () => {
      const step = interpolateStep(
        { click: { selector: "$vars.buttonSelector" } },
        {},
        { buttonSelector: "button.submit" }
      );
      expect(step).toEqual({
        click: { selector: "button.submit" },
      });
    });

    it("interpolates label in click step", () => {
      const step = interpolateStep(
        { label: "Click $env.BUTTON", click: { selector: ".btn" } },
        { BUTTON: "submit button" },
        {}
      );
      expect(step).toEqual({
        label: "Click submit button",
        click: { selector: ".btn" },
      });
    });
  });

  describe("assert step", () => {
    it("interpolates assert expression", () => {
      const step = interpolateStep(
        { assert: "document.title === '$vars.expectedTitle'" },
        {},
        { expectedTitle: "Home Page" }
      );
      expect(step).toEqual({
        assert: "document.title === 'Home Page'",
      });
    });

    it("preserves retry config", () => {
      const step = interpolateStep(
        {
          assert: "$vars.condition",
          retry: { interval: 100, timeout: 5000 },
        },
        {},
        { condition: "true" }
      );
      expect(step).toEqual({
        assert: "true",
        retry: { interval: 100, timeout: 5000 },
      });
    });

    it("interpolates label in assert step", () => {
      const step = interpolateStep(
        { label: "Verify $vars.thing", assert: "true" },
        {},
        { thing: "result" }
      );
      expect(step).toEqual({
        label: "Verify result",
        assert: "true",
      });
    });
  });

  describe("wait step", () => {
    it("returns wait step as-is", () => {
      const step = interpolateStep({ wait: 1000 }, {}, {});
      expect(step).toEqual({ wait: 1000 });
    });

    it("includes label in wait step", () => {
      const step = interpolateStep(
        { label: "Wait $vars.seconds seconds", wait: 1000 },
        {},
        { seconds: "1" }
      );
      expect(step).toEqual({
        label: "Wait 1 seconds",
        wait: 1000,
      });
    });
  });

  describe("wait_for step", () => {
    it("interpolates wait_for selector", () => {
      const step = interpolateStep(
        { wait_for: { selector: "$vars.selector" } },
        {},
        { selector: ".loading-complete" }
      );
      expect(step).toEqual({
        wait_for: { selector: ".loading-complete" },
      });
    });

    it("preserves timeout config", () => {
      const step = interpolateStep(
        { wait_for: { selector: "div", timeout: 5000 } },
        {},
        {}
      );
      expect(step).toEqual({
        wait_for: { selector: "div", timeout: 5000 },
      });
    });

    it("interpolates label in wait_for step", () => {
      const step = interpolateStep(
        { label: "Wait for $vars.element", wait_for: { selector: "div" } },
        {},
        { element: "modal" }
      );
      expect(step).toEqual({
        label: "Wait for modal",
        wait_for: { selector: "div" },
      });
    });
  });

  describe("console_check step", () => {
    it("returns console_check step as-is", () => {
      const step = interpolateStep(
        { console_check: ["error", "warn"] },
        {},
        {}
      );
      expect(step).toEqual({ console_check: ["error", "warn"] });
    });

    it("includes label in console_check step", () => {
      const step = interpolateStep(
        { label: "Check for $vars.severity", console_check: ["error"] },
        {},
        { severity: "errors" }
      );
      expect(step).toEqual({
        label: "Check for errors",
        console_check: ["error"],
      });
    });
  });

  describe("network_check step", () => {
    it("returns network_check step as-is", () => {
      const step = interpolateStep({ network_check: true }, {}, {});
      expect(step).toEqual({ network_check: true });
    });

    it("includes label in network_check step", () => {
      const step = interpolateStep(
        { label: "Check $vars.type network", network_check: false },
        {},
        { type: "mock" }
      );
      expect(step).toEqual({
        label: "Check mock network",
        network_check: false,
      });
    });
  });

  describe("mock_network step", () => {
    it("interpolates mock_network match pattern", () => {
      const step = interpolateStep(
        {
          mock_network: {
            match: "$env.API_URL/users",
            status: 200,
          },
        },
        { API_URL: "https://api.example.com" },
        {}
      );
      expect(step).toEqual({
        mock_network: {
          match: "https://api.example.com/users",
          status: 200,
        },
      });
    });

    it("interpolates string body", () => {
      const step = interpolateStep(
        {
          mock_network: {
            match: "/api/user",
            status: 200,
            body: '{"name": "$vars.username"}',
          },
        },
        {},
        { username: "john" }
      );
      expect(step).toEqual({
        mock_network: {
          match: "/api/user",
          status: 200,
          body: '{"name": "john"}',
        },
      });
    });

    it("preserves object body as-is", () => {
      const body = { name: "john", id: 123 };
      const step = interpolateStep(
        {
          mock_network: {
            match: "/api/user",
            status: 200,
            body,
          },
        },
        {},
        {}
      );
      expect(step).toEqual({
        mock_network: {
          match: "/api/user",
          status: 200,
          body,
        },
      });
    });

    it("preserves delay config", () => {
      const step = interpolateStep(
        {
          mock_network: {
            match: "/api/slow",
            status: 200,
            delay: 2000,
          },
        },
        {},
        {}
      );
      expect(step).toEqual({
        mock_network: {
          match: "/api/slow",
          status: 200,
          delay: 2000,
        },
      });
    });

    it("interpolates label in mock_network step", () => {
      const step = interpolateStep(
        {
          label: "Mock $vars.endpoint",
          mock_network: {
            match: "/api/test",
            status: 200,
          },
        },
        {},
        { endpoint: "users endpoint" }
      );
      expect(step).toEqual({
        label: "Mock users endpoint",
        mock_network: {
          match: "/api/test",
          status: 200,
        },
      });
    });
  });

  describe("http_request step", () => {
    it("interpolates url", () => {
      const step = interpolateStep(
        { http_request: { url: "http://localhost:3001/api/envs/$vars.env.id", method: "DELETE" } } as any,
        {},
        { env: { id: "env-abc" } }
      );
      expect(step).toEqual({
        http_request: { url: "http://localhost:3001/api/envs/env-abc", method: "DELETE" },
      });
    });

    it("interpolates string body", () => {
      const step = interpolateStep(
        { http_request: { url: "http://localhost/api", method: "POST", body: '{"id":"$vars.envId"}' } } as any,
        {},
        { envId: "env-123" }
      );
      expect(step).toEqual({
        http_request: { url: "http://localhost/api", method: "POST", body: '{"id":"env-123"}' },
      });
    });

    it("interpolates $vars in object body string values", () => {
      const step = interpolateStep(
        {
          http_request: {
            url: "http://localhost/api",
            method: "POST",
            body: { workflow: "picking", envId: "$vars.env.id" },
          },
        } as any,
        {},
        { env: { id: "env-xyz" } }
      );
      expect(step).toEqual({
        http_request: {
          url: "http://localhost/api",
          method: "POST",
          body: { workflow: "picking", envId: "env-xyz" },
        },
      });
    });

    it("interpolates nested object body values", () => {
      const step = interpolateStep(
        {
          http_request: {
            url: "http://localhost/api",
            method: "POST",
            body: { config: { name: "$env.NAME" }, ids: ["$vars.id1", "$vars.id2"] },
          },
        } as any,
        { NAME: "test" },
        { id1: "a", id2: "b" }
      );
      expect(step).toEqual({
        http_request: {
          url: "http://localhost/api",
          method: "POST",
          body: { config: { name: "test" }, ids: ["a", "b"] },
        },
      });
    });

    it("preserves non-string body values (numbers, booleans)", () => {
      const step = interpolateStep(
        {
          http_request: {
            url: "http://localhost/api",
            method: "POST",
            body: { count: 5, active: true, label: "$vars.label" },
          },
        } as any,
        {},
        { label: "test" }
      );
      expect(step).toEqual({
        http_request: {
          url: "http://localhost/api",
          method: "POST",
          body: { count: 5, active: true, label: "test" },
        },
      });
    });

    it("preserves as field", () => {
      const step = interpolateStep(
        { http_request: { url: "http://localhost/api", as: "result" } } as any,
        {},
        {}
      );
      expect(step).toEqual({
        http_request: { url: "http://localhost/api", as: "result" },
      });
    });
  });

  describe("complex interpolation scenarios", () => {
    it("handles multiple variables in a single step", () => {
      const step = interpolateStep(
        {
          label: "Fill $vars.field with $env.VALUE",
          fill: {
            selector: "$vars.selector",
            value: "$env.DEFAULT_VALUE",
          },
        },
        {
          VALUE: "test data",
          DEFAULT_VALUE: "admin",
        },
        {
          field: "username",
          selector: "input.user",
        }
      );
      expect(step).toEqual({
        label: "Fill username with test data",
        fill: {
          selector: "input.user",
          value: "admin",
        },
      });
    });

    it("handles missing variables gracefully", () => {
      const step = interpolateStep(
        {
          eval: "value === '$vars.expected'",
        },
        {},
        {}
      );
      expect(step).toEqual({
        eval: "value === '$vars.expected'",
      });
    });
  });

  describe("high-level step interpolation", () => {
    it("scan_input: interpolates selector and value", () => {
      const step = interpolateStep(
        { scan_input: { selector: "$vars.input", value: "$env.CODE" } } as any,
        { CODE: "CTN-5001" },
        { input: "[aria-label='Barcode']" }
      );
      expect(step).toEqual({
        scan_input: { selector: "[aria-label='Barcode']", value: "CTN-5001" },
      });
    });

    it("fill_form: interpolates each field's selector and value", () => {
      const step = interpolateStep(
        {
          fill_form: {
            fields: [
              { selector: "$vars.emailInput", value: "$env.EMAIL" },
              { selector: "#password", value: "$vars.pw" },
            ],
          },
        } as any,
        { EMAIL: "a@b.com" },
        { emailInput: "[aria-label='Email']", pw: "secret" }
      );
      expect(step).toEqual({
        fill_form: {
          fields: [
            { selector: "[aria-label='Email']", value: "a@b.com" },
            { selector: "#password", value: "secret" },
          ],
        },
      });
    });

    it("scroll_to: interpolates selector", () => {
      const step = interpolateStep(
        { scroll_to: { selector: "$vars.target" } } as any,
        {},
        { target: "#footer" }
      );
      expect(step).toEqual({ scroll_to: { selector: "#footer" } });
    });

    it("clear_input: interpolates selector", () => {
      const step = interpolateStep(
        { clear_input: { selector: "$env.FIELD" } } as any,
        { FIELD: "[aria-label='Search']" },
        {}
      );
      expect(step).toEqual({ clear_input: { selector: "[aria-label='Search']" } });
    });

    it("wait_for_text: interpolates text and selector, preserves timeout", () => {
      const step = interpolateStep(
        { wait_for_text: { text: "$vars.msg", selector: "$vars.scope", timeout: 3000 } } as any,
        {},
        { msg: "Welcome", scope: "#main" }
      );
      expect(step).toEqual({
        wait_for_text: { text: "Welcome", selector: "#main", timeout: 3000 },
      });
    });

    it("wait_for_text_gone: interpolates text and selector, preserves timeout", () => {
      const step = interpolateStep(
        { wait_for_text_gone: { text: "$env.LOADER", timeout: 5000 } } as any,
        { LOADER: "Loading..." },
        {}
      );
      expect(step).toEqual({
        wait_for_text_gone: { text: "Loading...", timeout: 5000 },
      });
    });

    it("assert_text: interpolates text and selector, preserves absent and retry", () => {
      const step = interpolateStep(
        {
          assert_text: {
            text: "$vars.expected",
            absent: true,
            selector: "$vars.scope",
            retry: { interval: 200, timeout: 3000 },
          },
        } as any,
        {},
        { expected: "Error", scope: "#alerts" }
      );
      expect(step).toEqual({
        assert_text: {
          text: "Error",
          absent: true,
          selector: "#alerts",
          retry: { interval: 200, timeout: 3000 },
        },
      });
    });

    it("click_text: interpolates text and selector, preserves match", () => {
      const step = interpolateStep(
        { click_text: { text: "$vars.btn", match: "exact", selector: "$vars.scope" } } as any,
        {},
        { btn: "Submit", scope: "#form" }
      );
      expect(step).toEqual({
        click_text: { text: "Submit", match: "exact", selector: "#form" },
      });
    });

    it("click_nth: interpolates text and selector, preserves index and match", () => {
      const step = interpolateStep(
        { click_nth: { index: 2, text: "$vars.label", selector: "$env.SEL", match: "contains" } } as any,
        { SEL: "button" },
        { label: "Edit" }
      );
      expect(step).toEqual({
        click_nth: { index: 2, text: "Edit", selector: "button", match: "contains" },
      });
    });

    it("type: interpolates selector and text, preserves delay and clear", () => {
      const step = interpolateStep(
        { type: { selector: "$vars.input", text: "$env.QUERY", delay: 100, clear: true } } as any,
        { QUERY: "react hooks" },
        { input: "#search" }
      );
      expect(step).toEqual({
        type: { selector: "#search", text: "react hooks", delay: 100, clear: true },
      });
    });

    it("choose_dropdown: interpolates selector and text, preserves timeout", () => {
      const step = interpolateStep(
        { choose_dropdown: { selector: "$vars.dd", text: "$env.OPT", timeout: 5000 } } as any,
        { OPT: "Engineering" },
        { dd: "[aria-label='Division']" }
      );
      expect(step).toEqual({
        choose_dropdown: { selector: "[aria-label='Division']", text: "Engineering", timeout: 5000 },
      });
    });

    it("expand_menu: interpolates group", () => {
      const step = interpolateStep(
        { expand_menu: { group: "$vars.menuName" } } as any,
        {},
        { menuName: "Packaging" }
      );
      expect(step).toEqual({ expand_menu: { group: "Packaging" } });
    });

    it("toggle: interpolates inner label, preserves state", () => {
      const step = interpolateStep(
        { toggle: { label: "$vars.feature", state: true } } as any,
        {},
        { feature: "Dark mode" }
      );
      expect(step).toEqual({ toggle: { label: "Dark mode", state: true } });
    });

    it("close_modal: preserves strategy (no strings to interpolate)", () => {
      const step = interpolateStep(
        { close_modal: { strategy: "escape" } } as any,
        {},
        {}
      );
      expect(step).toEqual({ close_modal: { strategy: "escape" } });
    });

    it("close_modal: empty object preserved", () => {
      const step = interpolateStep(
        { close_modal: {} } as any,
        {},
        {}
      );
      expect(step).toEqual({ close_modal: {} });
    });
  });
});
