/**
 * Navigation step handlers: hover, scroll_to, switch_frame, press_key
 */

import { CDPClient as CDPClientInterface } from "../types.js";

/**
 * Execute a hover step
 */
export async function hoverStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.hover || typeof step.hover.selector !== "string") {
      return {
        success: false,
        error: "hover step requires selector string",
      };
    }

    await client.hover(step.hover.selector);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a scroll_to step
 * Scrolls an element into view
 */
export async function scrollToStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.scroll_to || typeof step.scroll_to.selector !== "string") {
      return { success: false, error: "scroll_to step requires selector string" };
    }
    const selector = step.scroll_to.selector;
    const result = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return 'ok';
    })()`);
    if (result === "not_found") {
      return { success: false, error: `scroll_to: element not found: ${selector}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a switch_frame step
 */
export async function switchFrameStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.switchFrame(step.switch_frame?.selector);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a press_key step
 */
export async function pressKeyStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.press_key || typeof step.press_key.key !== "string") {
      return {
        success: false,
        error: "press_key step requires key string",
      };
    }

    await client.pressKey(step.press_key.key, step.press_key.modifiers);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
