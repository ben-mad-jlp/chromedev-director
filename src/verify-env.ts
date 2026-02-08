/**
 * Verification script for env.ts functions
 * Tests the interpolation logic without requiring test framework
 */

import { interpolate, interpolateStep } from "./env";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}: ${(e as Error).message}`);
    process.exit(1);
  }
}

function assertEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

// Test interpolate()
test("interpolate: replaces $env.KEY", () => {
  const result = interpolate("url: $env.API_URL", {
    API_URL: "https://api.example.com",
  });
  assertEqual(result, "url: https://api.example.com");
});

test("interpolate: handles multiple $env.KEY patterns", () => {
  const result = interpolate("$env.HOST:$env.PORT", {
    HOST: "localhost",
    PORT: 3000,
  });
  assertEqual(result, "localhost:3000");
});

test("interpolate: leaves unknown $env.KEY as-is", () => {
  const result = interpolate("missing: $env.MISSING", {});
  assertEqual(result, "missing: $env.MISSING");
});

test("interpolate: replaces $vars.KEY with variable value", () => {
  const result = interpolate("count: $vars.count", {}, { count: 42 });
  assertEqual(result, "count: 42");
});

test("interpolate: handles mixed patterns", () => {
  const result = interpolate(
    "$env.PROTO://$env.HOST:$env.PORT/$vars.path",
    {
      PROTO: "https",
      HOST: "localhost",
      PORT: 8443,
    },
    { path: "api/v1" }
  );
  assertEqual(result, "https://localhost:8443/api/v1");
});

test("interpolate: handles empty template", () => {
  const result = interpolate("", { FOO: "bar" });
  assertEqual(result, "");
});

test("interpolate: handles template with no patterns", () => {
  const result = interpolate("plain text", { FOO: "bar" });
  assertEqual(result, "plain text");
});

test("interpolate: converts non-string values to string", () => {
  const result = interpolate("port: $env.PORT", {
    PORT: 8080,
  });
  assertEqual(result, "port: 8080");
});

// Test interpolateStep()
test("interpolateStep: interpolates eval expression", () => {
  const step = interpolateStep(
    { eval: "window.location.href === '$vars.expectedUrl'" },
    {},
    { expectedUrl: "https://example.com" }
  );
  assertEqual(step, {
    eval: "window.location.href === 'https://example.com'",
  });
});

test("interpolateStep: preserves eval as field", () => {
  const step = interpolateStep(
    { eval: "1 + 1", as: "result" },
    {},
    {}
  );
  assertEqual(step, {
    eval: "1 + 1",
    as: "result",
  });
});

test("interpolateStep: interpolates fill selector and value", () => {
  const step = interpolateStep(
    {
      fill: {
        selector: "$vars.inputSelector",
        value: "$env.USERNAME",
      },
    },
    { USERNAME: "admin" },
    { inputSelector: "input.username" }
  );
  assertEqual(step, {
    fill: {
      selector: "input.username",
      value: "admin",
    },
  });
});

test("interpolateStep: interpolates click selector", () => {
  const step = interpolateStep(
    { click: { selector: "$vars.buttonSelector" } },
    {},
    { buttonSelector: "button.submit" }
  );
  assertEqual(step, {
    click: { selector: "button.submit" },
  });
});

test("interpolateStep: interpolates assert expression", () => {
  const step = interpolateStep(
    { assert: "document.title === '$vars.expectedTitle'" },
    {},
    { expectedTitle: "Home Page" }
  );
  assertEqual(step, {
    assert: "document.title === 'Home Page'",
  });
});

test("interpolateStep: preserves retry config", () => {
  const step = interpolateStep(
    {
      assert: "$vars.condition",
      retry: { interval: 100, timeout: 5000 },
    },
    {},
    { condition: "true" }
  );
  assertEqual(step, {
    assert: "true",
    retry: { interval: 100, timeout: 5000 },
  });
});

test("interpolateStep: returns wait step as-is", () => {
  const step = interpolateStep({ wait: 1000 }, {}, {});
  assertEqual(step, { wait: 1000 });
});

test("interpolateStep: interpolates wait_for selector", () => {
  const step = interpolateStep(
    { wait_for: { selector: "$vars.selector" } },
    {},
    { selector: ".loading-complete" }
  );
  assertEqual(step, {
    wait_for: { selector: ".loading-complete" },
  });
});

test("interpolateStep: preserves timeout config", () => {
  const step = interpolateStep(
    { wait_for: { selector: "div", timeout: 5000 } },
    {},
    {}
  );
  assertEqual(step, {
    wait_for: { selector: "div", timeout: 5000 },
  });
});

test("interpolateStep: returns console_check step as-is", () => {
  const step = interpolateStep(
    { console_check: ["error", "warn"] },
    {},
    {}
  );
  assertEqual(step, { console_check: ["error", "warn"] });
});

test("interpolateStep: returns network_check step as-is", () => {
  const step = interpolateStep({ network_check: true }, {}, {});
  assertEqual(step, { network_check: true });
});

test("interpolateStep: interpolates mock_network match pattern", () => {
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
  assertEqual(step, {
    mock_network: {
      match: "https://api.example.com/users",
      status: 200,
    },
  });
});

test("interpolateStep: interpolates string body", () => {
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
  assertEqual(step, {
    mock_network: {
      match: "/api/user",
      status: 200,
      body: '{"name": "john"}',
    },
  });
});

test("interpolateStep: preserves object body as-is", () => {
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
  assertEqual(step, {
    mock_network: {
      match: "/api/user",
      status: 200,
      body,
    },
  });
});

test("interpolateStep: preserves delay config", () => {
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
  assertEqual(step, {
    mock_network: {
      match: "/api/slow",
      status: 200,
      delay: 2000,
    },
  });
});

test("interpolateStep: handles complex scenarios", () => {
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
  assertEqual(step, {
    label: "Fill username with test data",
    fill: {
      selector: "input.user",
      value: "admin",
    },
  });
});

console.log("\nAll tests passed!");
