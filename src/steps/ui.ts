/**
 * UI step handlers: handle_dialog, close_modal, choose_dropdown, expand_menu, toggle
 */

import { CDPClient as CDPClientInterface } from "../types.js";

/**
 * Execute a handle_dialog step
 */
export async function handleDialogStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.handle_dialog || !["accept", "dismiss"].includes(step.handle_dialog.action)) {
      return {
        success: false,
        error: 'handle_dialog step requires action ("accept" or "dismiss")',
      };
    }

    await client.handleDialog(step.handle_dialog.action, step.handle_dialog.text);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a close_modal step
 * Closes current modal/overlay using multiple strategies
 */
export async function closeModalStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    const strategy = step.close_modal?.strategy;

    const tryButton = async (): Promise<boolean> => {
      const result = await client.evaluate(`(() => {
        const selectors = [
          '[aria-label="Close modal"]',
          '[aria-label="Close"]',
          '.close-button',
          'button.close',
          '[data-dismiss="modal"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { el.click(); return true; }
        }
        return false;
      })()`);
      return !!result;
    };

    const tryEscape = async (): Promise<boolean> => {
      await client.pressKey("Escape");
      return true;
    };

    const tryBackdrop = async (): Promise<boolean> => {
      const result = await client.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog && dialog.parentElement) {
          dialog.parentElement.click();
          return true;
        }
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
          backdrop.click();
          return true;
        }
        return false;
      })()`);
      return !!result;
    };

    if (strategy === "button") {
      const ok = await tryButton();
      return ok ? { success: true } : { success: false, error: "close_modal: no close button found" };
    }
    if (strategy === "escape") {
      await tryEscape();
      return { success: true };
    }
    if (strategy === "backdrop") {
      const ok = await tryBackdrop();
      return ok ? { success: true } : { success: false, error: "close_modal: no modal backdrop found" };
    }

    // Default: try all strategies in order
    if (await tryButton()) return { success: true };
    await tryEscape();
    // Escape always "succeeds" — we can't verify the modal closed without DOM checks
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a choose_dropdown step
 * Opens dropdown and selects an option by text
 */
export async function chooseDropdownStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.choose_dropdown || typeof step.choose_dropdown.selector !== "string" || typeof step.choose_dropdown.text !== "string") {
      return { success: false, error: "choose_dropdown step requires selector and text strings" };
    }
    const { selector, text, match: matchMode, timeout: timeoutMs } = step.choose_dropdown;
    const timeout = timeoutMs ?? 3000;

    // Build the matching logic based on match mode
    let matchExpr: string;
    if (matchMode === "regex") {
      matchExpr = `new RegExp(${JSON.stringify(text)}).test(opt.textContent)`;
    } else if (matchMode === "exact") {
      matchExpr = `opt.textContent && opt.textContent.trim() === ${JSON.stringify(text)}`;
    } else {
      // "contains" (default)
      matchExpr = `opt.textContent && opt.textContent.includes(${JSON.stringify(text)})`;
    }

    // Phase 1: Click to open
    await client.click(selector);

    // Phase 2: Poll for options to appear
    const interval = 200;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await client.evaluate(`(() => {
        const options = document.querySelectorAll('[role="menuitem"], [role="option"]');
        if (options.length === 0) return 'no_options';
        for (const opt of options) {
          if (${matchExpr}) {
            opt.click();
            return 'ok';
          }
        }
        return 'not_matched';
      })()`);
      if (result === "ok") return { success: true };
      if (result === "not_matched") {
        return { success: false, error: `choose_dropdown: option "${text}" not found in dropdown (match: ${matchMode || "contains"})` };
      }
      // no_options — keep polling
      if (Date.now() + interval > deadline) break;
      await new Promise(r => setTimeout(r, interval));
    }
    return { success: false, error: `choose_dropdown: no options appeared after ${timeout}ms` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute an expand_menu step
 * Expands a collapsed navigation group by name
 */
export async function expandMenuStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.expand_menu || typeof step.expand_menu.group !== "string") {
      return { success: false, error: "expand_menu step requires group string" };
    }
    const group = step.expand_menu.group;

    const result = await client.evaluate(`(() => {
      const group = ${JSON.stringify(group)};
      const collapsed = group + ', collapsed';
      const expanded = group + ', expanded';
      const all = document.querySelectorAll('[aria-label]');
      for (const el of all) {
        const label = el.getAttribute('aria-label');
        if (label === expanded) return 'already_expanded';
        if (label === collapsed) {
          el.click();
          return 'ok';
        }
      }
      return 'not_found';
    })()`);

    if (result === "not_found") {
      return { success: false, error: `expand_menu: group "${group}" not found` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a toggle step
 * Toggles a checkbox or switch by its label text
 */
export async function toggleStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.toggle || typeof step.toggle.label !== "string") {
      return { success: false, error: "toggle step requires label string" };
    }
    const { label: labelText, state } = step.toggle;

    const result = await client.evaluate(`(() => {
      const labelText = ${JSON.stringify(labelText)};
      const desiredState = ${state != null ? JSON.stringify(state) : "null"};
      const labels = document.querySelectorAll('label');
      for (const lbl of labels) {
        if (!lbl.textContent || !lbl.textContent.includes(labelText)) continue;
        // Find associated input
        let input = lbl.htmlFor ? document.getElementById(lbl.htmlFor) : null;
        if (!input) input = lbl.querySelector('input[type="checkbox"], input[type="radio"]');
        if (!input) input = lbl.closest('[role="switch"], [role="checkbox"]') || lbl.querySelector('[role="switch"], [role="checkbox"]');
        if (!input) continue;
        // Check current state
        const currentState = input.checked ?? (input.getAttribute('aria-checked') === 'true');
        if (desiredState !== null && currentState === desiredState) return 'already_correct';
        input.click();
        return 'ok';
      }
      return 'not_found';
    })()`);

    if (result === "not_found") {
      return { success: false, error: `toggle: label "${labelText}" not found` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
