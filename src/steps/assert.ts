/**
 * Assert step handlers: assert, assert_text
 */

import { CDPClient as CDPClientInterface } from "../types.js";
import { buildTextMatchExpr } from "./_utils.js";

/**
 * Execute an assert step with retry logic
 * Supports configurable retry interval and timeout
 */
export async function assertStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof step.assert !== "string") {
      return {
        success: false,
        error: "assert expression must be a string",
      };
    }

    const retry = step.retry || { interval: 100, timeout: 5000 };

    // Retry loop with timeout — always evaluate at least once
    const startTime = Date.now();
    let lastError: string | undefined;
    let firstAttempt = true;

    while (firstAttempt || Date.now() - startTime < retry.timeout) {
      firstAttempt = false;

      try {
        const result = await client.evaluate(step.assert);
        if (result) {
          return { success: true };
        }
        lastError = `Assertion failed: ${step.assert}`;
      } catch (evalError) {
        lastError = evalError instanceof Error ? evalError.message : String(evalError);
      }

      // Don't sleep after the last attempt
      if (Date.now() - startTime < retry.timeout) {
        await new Promise((resolve) => setTimeout(resolve, retry.interval));
      }
    }

    return {
      success: false,
      error: lastError || `Assertion failed after retries: ${step.assert}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute an assert_text step
 * Asserts page contains (or doesn't contain) specific text
 */
export async function assertTextStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.assert_text || typeof step.assert_text.text !== "string") {
      return { success: false, error: "assert_text step requires text string" };
    }
    const { text, absent, match: matchMode, selector, retry } = step.assert_text;
    const scope = selector ? JSON.stringify(selector) : "null";
    const matchExpr = buildTextMatchExpr(text, matchMode ?? "contains");

    const checkOnce = async (): Promise<boolean> => {
      const found = await client.evaluate(`(() => {
        const scope = ${scope} ? document.querySelector(${scope}) : document.body;
        if (!scope) return false;
        const innerText = scope.innerText;
        return ${matchExpr};
      })()`);
      return absent ? !found : !!found;
    };

    if (!retry) {
      const pass = await checkOnce();
      if (pass) return { success: true };
      return { success: false, error: absent ? `assert_text: "${text}" is present (expected absent)` : `assert_text: "${text}" not found` };
    }

    // Retry loop
    const deadline = Date.now() + retry.timeout;
    while (Date.now() < deadline) {
      const pass = await checkOnce();
      if (pass) return { success: true };
      if (Date.now() + retry.interval > deadline) break;
      await new Promise(r => setTimeout(r, retry.interval));
    }
    return { success: false, error: absent ? `assert_text: "${text}" still present after ${retry.timeout}ms` : `assert_text: "${text}" not found after ${retry.timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
