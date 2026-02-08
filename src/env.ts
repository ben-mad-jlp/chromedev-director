/**
 * Environment variable and variable interpolation for chromedev-director
 * Provides string interpolation for $env.KEY and $vars.KEY patterns
 */

import { StepDef } from "./types.js";

/**
 * Converts a value to a string suitable for interpolation.
 * Objects and arrays are JSON-serialized; primitives use String().
 */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Interpolates $env.KEY and $vars.KEY patterns in a template string
 *
 * @param template - The template string containing patterns to replace
 * @param env - Environment variables object
 * @param vars - Variables object
 * @returns The interpolated string with patterns replaced
 *
 * @example
 * interpolate("url: $env.API_URL/path", { API_URL: "https://api.example.com" })
 * // Returns: "url: https://api.example.com/path"
 *
 * @example
 * interpolate("value: $vars.count", {}, { count: 42 })
 * // Returns: "value: 42"
 *
 * @example
 * interpolate("missing: $env.MISSING", {})
 * // Returns: "missing: $env.MISSING" (unchanged)
 */
export function interpolate(
  template: string,
  env: Record<string, unknown> = {},
  vars: Record<string, unknown> = {}
): string {
  let result = template;

  // Replace $env.KEY patterns
  result = result.replace(/\$env\.([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, key) => {
    if (key in env) {
      return stringifyValue(env[key]);
    }
    return match;
  });

  // Replace $vars.KEY patterns (runs after $env to allow env vars in vars)
  result = result.replace(/\$vars\.([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, key) => {
    if (key in vars) {
      return stringifyValue(vars[key]);
    }
    return match;
  });

  return result;
}

/**
 * Interpolates all string values in a step definition
 * Recursively handles all step types (eval, fill, assert, etc.)
 *
 * @param step - The step definition to interpolate
 * @param env - Environment variables object
 * @param vars - Variables object
 * @returns A new step definition with all string values interpolated
 *
 * @example
 * interpolateStep(
 *   { fill: { selector: ".input", value: "$vars.username" } },
 *   {},
 *   { username: "admin" }
 * )
 * // Returns: { fill: { selector: ".input", value: "admin" } }
 */
export function interpolateStep(
  step: StepDef,
  env: Record<string, unknown> = {},
  vars: Record<string, unknown> = {}
): StepDef {
  // Handle label if present (common to all step types)
  const interpolatedLabel = step.label
    ? interpolate(step.label, env, vars)
    : undefined;

  // eval step
  if ("eval" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      eval: interpolate(step.eval, env, vars),
      ...(step.as && { as: step.as }),
    };
  }

  // fill step
  if ("fill" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      fill: {
        selector: interpolate(step.fill.selector, env, vars),
        value: interpolate(step.fill.value, env, vars),
      },
    };
  }

  // click step
  if ("click" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      click: {
        selector: interpolate(step.click.selector, env, vars),
      },
    };
  }

  // assert step
  if ("assert" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      assert: interpolate(step.assert, env, vars),
      ...(step.retry && { retry: step.retry }),
    };
  }

  // wait step
  if ("wait" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      wait: step.wait,
    };
  }

  // wait_for step
  if ("wait_for" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      wait_for: {
        selector: interpolate(step.wait_for.selector, env, vars),
        ...(step.wait_for.timeout != null ? { timeout: step.wait_for.timeout } : {}),
      },
    };
  }

  // console_check step
  if ("console_check" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      console_check: step.console_check,
    };
  }

  // network_check step
  if ("network_check" in step) {
    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      network_check: step.network_check,
    };
  }

  // mock_network step
  if ("mock_network" in step) {
    const interpolatedBody =
      typeof step.mock_network.body === "string"
        ? interpolate(step.mock_network.body, env, vars)
        : step.mock_network.body;

    return {
      ...(interpolatedLabel && { label: interpolatedLabel }),
      mock_network: {
        match: interpolate(step.mock_network.match, env, vars),
        status: step.mock_network.status,
        ...(interpolatedBody != null ? { body: interpolatedBody } : {}),
        ...(step.mock_network.delay != null ? { delay: step.mock_network.delay } : {}),
      },
    } as StepDef;
  }

  // Fallback: return the step as-is (shouldn't reach here with valid StepDef)
  return step;
}
