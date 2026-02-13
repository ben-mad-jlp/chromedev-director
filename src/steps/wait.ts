/**
 * Wait step handlers: wait, wait_for, wait_for_text, wait_for_text_gone
 */

import { CDPClient as CDPClientInterface } from "../types.js";
import { buildTextMatchExpr } from "./_utils.js";

/**
 * Execute a wait step
 */
export async function waitStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof step.wait !== "number") {
      return {
        success: false,
        error: "wait duration must be a number",
      };
    }

    await new Promise((resolve) => setTimeout(resolve, step.wait));
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a wait_for step
 * Polls for an element matching the selector until it appears or timeout
 */
export async function waitForStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.wait_for || typeof step.wait_for.selector !== "string") {
      return {
        success: false,
        error: "wait_for step requires selector string",
      };
    }

    const timeout = step.wait_for.timeout ?? 5000;
    const interval = 100;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const found = await client.evaluate(
          `!!document.querySelector(${JSON.stringify(step.wait_for.selector)})`
        );
        if (found) {
          return { success: true };
        }
      } catch {
        // Element not found yet, continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return {
      success: false,
      error: `Timed out waiting for selector: ${step.wait_for.selector}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a wait_for_text step
 * Polls until text appears on page
 */
export async function waitForTextStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.wait_for_text || typeof step.wait_for_text.text !== "string") {
      return { success: false, error: "wait_for_text step requires text string" };
    }
    const { text, match: matchMode, selector, timeout: timeoutMs } = step.wait_for_text;
    const timeout = timeoutMs ?? 5000;
    const interval = 200;
    const deadline = Date.now() + timeout;
    const scope = selector ? JSON.stringify(selector) : "null";
    const matchExpr = buildTextMatchExpr(text, matchMode ?? "contains");

    while (Date.now() < deadline) {
      const found = await client.evaluate(`(() => {
        const scope = ${scope} ? document.querySelector(${scope}) : document.body;
        if (!scope) return false;
        const innerText = scope.innerText;
        return ${matchExpr};
      })()`);
      if (found) return { success: true };
      if (Date.now() + interval > deadline) break;
      await new Promise(r => setTimeout(r, interval));
    }
    return { success: false, error: `wait_for_text: "${text}" not found after ${timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a wait_for_text_gone step
 * Polls until text disappears from page
 */
export async function waitForTextGoneStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.wait_for_text_gone || typeof step.wait_for_text_gone.text !== "string") {
      return { success: false, error: "wait_for_text_gone step requires text string" };
    }
    const { text, match: matchMode, selector, timeout: timeoutMs } = step.wait_for_text_gone;
    const timeout = timeoutMs ?? 5000;
    const interval = 200;
    const deadline = Date.now() + timeout;
    const scope = selector ? JSON.stringify(selector) : "null";
    const matchExpr = buildTextMatchExpr(text, matchMode ?? "contains");

    while (Date.now() < deadline) {
      const found = await client.evaluate(`(() => {
        const scope = ${scope} ? document.querySelector(${scope}) : document.body;
        if (!scope) return false;
        const innerText = scope.innerText;
        return ${matchExpr};
      })()`);
      if (!found) return { success: true };
      if (Date.now() + interval > deadline) break;
      await new Promise(r => setTimeout(r, interval));
    }
    return { success: false, error: `wait_for_text_gone: "${text}" still present after ${timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
