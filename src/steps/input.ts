/**
 * Input step handlers: fill, fill_form, clear_input, scan_input, type, select
 */

import { CDPClient as CDPClientInterface } from "../types.js";

/**
 * Execute a fill step
 */
export async function fillStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.fill || typeof step.fill.selector !== "string" || typeof step.fill.value !== "string") {
      return {
        success: false,
        error: "fill step requires selector and value strings",
      };
    }

    await client.fill(step.fill.selector, step.fill.value);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a fill_form step
 * Fills multiple form fields sequentially
 */
export async function fillFormStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.fill_form || !Array.isArray(step.fill_form.fields)) {
      return { success: false, error: "fill_form step requires a fields array" };
    }
    for (let i = 0; i < step.fill_form.fields.length; i++) {
      const field = step.fill_form.fields[i];
      if (typeof field.selector !== "string" || typeof field.value !== "string") {
        return { success: false, error: `fill_form field ${i} requires selector and value strings` };
      }
      try {
        await client.fill(field.selector, field.value);
      } catch (err) {
        return { success: false, error: `fill_form field ${i} (${field.selector}): ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a clear_input step
 * Clears an input with proper React event dispatching
 */
export async function clearInputStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.clear_input || typeof step.clear_input.selector !== "string") {
      return { success: false, error: "clear_input step requires selector string" };
    }
    const selector = step.clear_input.selector;
    const result = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, '');
      } else {
        el.value = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    if (result === "not_found") {
      return { success: false, error: `clear_input: element not found: ${selector}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a scan_input step
 * Fills an input and presses Enter (barcode scanner pattern)
 */
export async function scanInputStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.scan_input || typeof step.scan_input.selector !== "string" || typeof step.scan_input.value !== "string") {
      return { success: false, error: "scan_input step requires selector and value strings" };
    }
    await client.fill(step.scan_input.selector, step.scan_input.value);
    await client.pressKey("Enter");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a type step
 * Types text character by character with delays
 */
export async function typeStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.type || typeof step.type.selector !== "string" || typeof step.type.text !== "string") {
      return { success: false, error: "type step requires selector and text strings" };
    }
    const { selector, text, delay: delayMs, clear: shouldClear } = step.type;
    const delay = delayMs ?? 50;

    // Focus the element (and optionally clear)
    const focusResult = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      el.focus();
      ${shouldClear ? `
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) { nativeSetter.call(el, ''); } else { el.value = ''; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      ` : ""}
      return 'ok';
    })()`);

    if (focusResult === "not_found") {
      return { success: false, error: `type: element not found: ${selector}` };
    }

    // Type each character with a delay
    for (const char of text) {
      await client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(char)}, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ${JSON.stringify(char)}, bubbles: true }));
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) { nativeSetter.call(el, el.value + ${JSON.stringify(char)}); } else { el.value += ${JSON.stringify(char)}; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(char)}, bubbles: true }));
      })()`);
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a select step
 */
export async function selectStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.select || typeof step.select.selector !== "string" || typeof step.select.value !== "string") {
      return {
        success: false,
        error: "select step requires selector and value strings",
      };
    }

    await client.select(step.select.selector, step.select.value);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
