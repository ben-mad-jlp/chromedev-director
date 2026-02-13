/**
 * Shared utilities for step handlers
 */

import { CDPClient as CDPClientInterface, OnEvent, RunEvent, StepDef } from "../types.js";

/**
 * Context for tracking nested test execution (cycle detection)
 */
export interface RunContext {
  visitedTests: Set<string>;
}

/**
 * Return type for step handler functions
 */
export interface StepResult {
  success: boolean;
  error?: string;
  value?: unknown;
  skipped?: boolean;
  loop_context?: Array<{ iteration: number; step: number; label: string }>;
}

/**
 * Signature for the executeStep callback passed to loop/run_test handlers
 */
export type ExecuteStepFn = (
  step: StepDef,
  client: CDPClientInterface,
  vars: Record<string, unknown>,
  onEvent?: OnEvent,
  projectRoot?: string,
  context?: RunContext,
  isHook?: boolean
) => Promise<StepResult>;

/**
 * Safely emit an event if an onEvent callback is provided
 * No-ops when onEvent is undefined
 */
export function emit(onEvent: OnEvent | undefined, event: RunEvent): void {
  if (onEvent) {
    try {
      onEvent(event);
    } catch {
      // Ignore listener errors so they don't affect test execution
    }
  }
}

/**
 * Build a JS expression that tests `innerText` against `text` using the given match mode.
 * The returned expression assumes `innerText` and `text` variables are in scope in the browser.
 * For regex mode, `text` is the pattern string passed to `new RegExp()`.
 */
export function buildTextMatchExpr(text: string, matchMode: string): string {
  if (matchMode === "regex") {
    return `new RegExp(${JSON.stringify(text)}).test(innerText)`;
  }
  if (matchMode === "exact") {
    return `innerText.trim() === ${JSON.stringify(text)}`;
  }
  // "contains" (default)
  return `innerText.includes(${JSON.stringify(text)})`;
}
