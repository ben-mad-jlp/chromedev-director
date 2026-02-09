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
 * Set of var keys that have been synced to window.__cdp_vars in the browser.
 * When a key is in this set, $vars.KEY interpolation in eval expressions
 * emits `window.__cdp_vars.KEY` instead of inlining the JSON — keeping
 * expressions small and avoiding "Object reference chain is too long" errors
 * in nested loops.
 */
const browserSyncedVars = new Set<string>();

/**
 * Mark a var key as synced to the browser's window.__cdp_vars.
 * Called by loopStep after injecting values into the page.
 */
export function markVarSynced(key: string): void {
  browserSyncedVars.add(key);
}

/**
 * Remove a var key from the browser-synced set.
 * Called when a loop finishes to clean up.
 */
export function unmarkVarSynced(key: string): void {
  browserSyncedVars.delete(key);
}

/**
 * Check if a var key is synced to the browser.
 */
export function isVarSynced(key: string): boolean {
  return browserSyncedVars.has(key);
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
      // For vars synced to the browser (loop variables with complex values),
      // emit a window.__cdp_vars reference instead of inlining the JSON.
      // This prevents eval expressions from growing exponentially in nested loops.
      if (browserSyncedVars.has(key)) {
        return `window.__cdp_vars[${JSON.stringify(key)}]`;
      }
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

  // Handle if condition (common to all step types)
  const interpolatedIf = "if" in step && step.if != null
    ? interpolate(step.if, env, vars)
    : undefined;

  // Common fields spread
  const common = {
    ...(interpolatedLabel && { label: interpolatedLabel }),
    ...(interpolatedIf != null ? { if: interpolatedIf } : {}),
  };

  // eval step
  if ("eval" in step) {
    return {
      ...common,
      eval: interpolate(step.eval, env, vars),
      ...(step.as && { as: step.as }),
    };
  }

  // fill step
  if ("fill" in step) {
    return {
      ...common,
      fill: {
        selector: interpolate(step.fill.selector, env, vars),
        value: interpolate(step.fill.value, env, vars),
      },
    };
  }

  // click step
  if ("click" in step) {
    return {
      ...common,
      click: {
        selector: interpolate(step.click.selector, env, vars),
      },
    };
  }

  // assert step
  if ("assert" in step) {
    return {
      ...common,
      assert: interpolate(step.assert, env, vars),
      ...(step.retry && { retry: step.retry }),
    };
  }

  // wait step
  if ("wait" in step) {
    return {
      ...common,
      wait: step.wait,
    };
  }

  // wait_for step
  if ("wait_for" in step) {
    return {
      ...common,
      wait_for: {
        selector: interpolate(step.wait_for.selector, env, vars),
        ...(step.wait_for.timeout != null ? { timeout: step.wait_for.timeout } : {}),
      },
    };
  }

  // console_check step
  if ("console_check" in step) {
    return {
      ...common,
      console_check: step.console_check,
    };
  }

  // network_check step
  if ("network_check" in step) {
    return {
      ...common,
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
      ...common,
      mock_network: {
        match: interpolate(step.mock_network.match, env, vars),
        status: step.mock_network.status,
        ...(interpolatedBody != null ? { body: interpolatedBody } : {}),
        ...(step.mock_network.delay != null ? { delay: step.mock_network.delay } : {}),
      },
    } as StepDef;
  }

  // run_test step
  if ("run_test" in step) {
    return {
      ...common,
      run_test: typeof step.run_test === "string" ? interpolate(step.run_test, env, vars) : step.run_test,
    };
  }

  // screenshot step
  if ("screenshot" in step) {
    return {
      ...common,
      screenshot: {
        ...(step.screenshot.as && { as: step.screenshot.as }),
      },
    };
  }

  // select step
  if ("select" in step) {
    return {
      ...common,
      select: {
        selector: interpolate(step.select.selector, env, vars),
        value: interpolate(step.select.value, env, vars),
      },
    };
  }

  // press_key step
  if ("press_key" in step) {
    return {
      ...common,
      press_key: {
        key: interpolate(step.press_key.key, env, vars),
        ...(step.press_key.modifiers && { modifiers: step.press_key.modifiers }),
      },
    };
  }

  // hover step
  if ("hover" in step) {
    return {
      ...common,
      hover: {
        selector: interpolate(step.hover.selector, env, vars),
      },
    };
  }

  // switch_frame step
  if ("switch_frame" in step) {
    return {
      ...common,
      switch_frame: {
        ...(step.switch_frame.selector != null
          ? { selector: interpolate(step.switch_frame.selector, env, vars) }
          : {}),
      },
    };
  }

  // handle_dialog step
  if ("handle_dialog" in step) {
    return {
      ...common,
      handle_dialog: {
        action: step.handle_dialog.action,
        ...(step.handle_dialog.text != null
          ? { text: interpolate(step.handle_dialog.text, env, vars) }
          : {}),
      },
    };
  }

  // http_request step
  if ("http_request" in step) {
    return {
      ...common,
      http_request: {
        url: interpolate(step.http_request.url, env, vars),
        ...(step.http_request.method != null ? { method: step.http_request.method } : {}),
        ...(step.http_request.body != null
          ? { body: typeof step.http_request.body === "string"
              ? interpolate(step.http_request.body, env, vars)
              : step.http_request.body }
          : {}),
        ...(step.http_request.headers != null ? { headers: step.http_request.headers } : {}),
        ...(step.http_request.as != null ? { as: step.http_request.as } : {}),
      },
    };
  }

  // loop step — interpolate over/while strings only, NOT nested steps
  // Nested steps are interpolated per-iteration at execution time
  if ("loop" in step) {
    return {
      ...common,
      loop: {
        ...(step.loop.over != null ? { over: interpolate(step.loop.over, env, vars) } : {}),
        ...(step.loop.while != null ? { while: interpolate(step.loop.while, env, vars) } : {}),
        ...(step.loop.as != null ? { as: step.loop.as } : {}),
        ...(step.loop.index_as != null ? { index_as: step.loop.index_as } : {}),
        ...(step.loop.max != null ? { max: step.loop.max } : {}),
        steps: step.loop.steps,
      },
    };
  }

  // scan_input step
  if ("scan_input" in step) {
    return {
      ...common,
      scan_input: {
        selector: interpolate(step.scan_input.selector, env, vars),
        value: interpolate(step.scan_input.value, env, vars),
      },
    };
  }

  // fill_form step
  if ("fill_form" in step) {
    return {
      ...common,
      fill_form: {
        fields: step.fill_form.fields.map(f => ({
          selector: interpolate(f.selector, env, vars),
          value: interpolate(f.value, env, vars),
        })),
      },
    };
  }

  // scroll_to step
  if ("scroll_to" in step) {
    return {
      ...common,
      scroll_to: {
        selector: interpolate(step.scroll_to.selector, env, vars),
      },
    };
  }

  // clear_input step
  if ("clear_input" in step) {
    return {
      ...common,
      clear_input: {
        selector: interpolate(step.clear_input.selector, env, vars),
      },
    };
  }

  // wait_for_text step
  if ("wait_for_text" in step) {
    return {
      ...common,
      wait_for_text: {
        text: interpolate(step.wait_for_text.text, env, vars),
        ...(step.wait_for_text.match != null ? { match: step.wait_for_text.match } : {}),
        ...(step.wait_for_text.selector != null
          ? { selector: interpolate(step.wait_for_text.selector, env, vars) }
          : {}),
        ...(step.wait_for_text.timeout != null ? { timeout: step.wait_for_text.timeout } : {}),
      },
    };
  }

  // wait_for_text_gone step
  if ("wait_for_text_gone" in step) {
    return {
      ...common,
      wait_for_text_gone: {
        text: interpolate(step.wait_for_text_gone.text, env, vars),
        ...(step.wait_for_text_gone.match != null ? { match: step.wait_for_text_gone.match } : {}),
        ...(step.wait_for_text_gone.selector != null
          ? { selector: interpolate(step.wait_for_text_gone.selector, env, vars) }
          : {}),
        ...(step.wait_for_text_gone.timeout != null ? { timeout: step.wait_for_text_gone.timeout } : {}),
      },
    };
  }

  // assert_text step
  if ("assert_text" in step) {
    return {
      ...common,
      assert_text: {
        text: interpolate(step.assert_text.text, env, vars),
        ...(step.assert_text.match != null ? { match: step.assert_text.match } : {}),
        ...(step.assert_text.absent != null ? { absent: step.assert_text.absent } : {}),
        ...(step.assert_text.selector != null
          ? { selector: interpolate(step.assert_text.selector, env, vars) }
          : {}),
        ...(step.assert_text.retry != null ? { retry: step.assert_text.retry } : {}),
      },
    };
  }

  // click_text step
  if ("click_text" in step) {
    return {
      ...common,
      click_text: {
        text: interpolate(step.click_text.text, env, vars),
        ...(step.click_text.match != null ? { match: step.click_text.match } : {}),
        ...(step.click_text.selector != null
          ? { selector: interpolate(step.click_text.selector, env, vars) }
          : {}),
      },
    };
  }

  // click_nth step
  if ("click_nth" in step) {
    return {
      ...common,
      click_nth: {
        index: step.click_nth.index,
        ...(step.click_nth.text != null
          ? { text: interpolate(step.click_nth.text, env, vars) }
          : {}),
        ...(step.click_nth.selector != null
          ? { selector: interpolate(step.click_nth.selector, env, vars) }
          : {}),
        ...(step.click_nth.match != null ? { match: step.click_nth.match } : {}),
      },
    };
  }

  // type step
  if ("type" in step) {
    return {
      ...common,
      type: {
        selector: interpolate(step.type.selector, env, vars),
        text: interpolate(step.type.text, env, vars),
        ...(step.type.delay != null ? { delay: step.type.delay } : {}),
        ...(step.type.clear != null ? { clear: step.type.clear } : {}),
      },
    };
  }

  // choose_dropdown step
  if ("choose_dropdown" in step) {
    return {
      ...common,
      choose_dropdown: {
        selector: interpolate(step.choose_dropdown.selector, env, vars),
        text: interpolate(step.choose_dropdown.text, env, vars),
        ...(step.choose_dropdown.match != null ? { match: step.choose_dropdown.match } : {}),
        ...(step.choose_dropdown.timeout != null ? { timeout: step.choose_dropdown.timeout } : {}),
      },
    };
  }

  // expand_menu step
  if ("expand_menu" in step) {
    return {
      ...common,
      expand_menu: {
        group: interpolate(step.expand_menu.group, env, vars),
      },
    };
  }

  // toggle step
  if ("toggle" in step) {
    return {
      ...common,
      toggle: {
        label: interpolate(step.toggle.label, env, vars),
        ...(step.toggle.state != null ? { state: step.toggle.state } : {}),
      },
    };
  }

  // close_modal step
  if ("close_modal" in step) {
    return {
      ...common,
      close_modal: {
        ...(step.close_modal.strategy != null ? { strategy: step.close_modal.strategy } : {}),
      },
    };
  }

  // Fallback: return the step as-is (shouldn't reach here with valid StepDef)
  return step;
}
