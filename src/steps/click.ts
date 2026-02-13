/**
 * Click step handlers: click, click_text, click_nth
 */

import { CDPClient as CDPClientInterface } from "../types.js";

/**
 * Execute a click step
 */
export async function clickStep(
  step: any,
  client: CDPClientInterface,
  vars: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.click || typeof step.click.selector !== "string") {
      return {
        success: false,
        error: "click step requires selector string",
      };
    }

    await client.click(step.click.selector);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a click_text step
 * Clicks an element by visible text content
 */
export async function clickTextStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.click_text || typeof step.click_text.text !== "string") {
      return { success: false, error: "click_text step requires text string" };
    }
    const { text, match, selector } = step.click_text;
    const matchMode = match ?? "contains";
    const scope = selector ? JSON.stringify(selector) : "null";

    // Build per-element match expression (uses `elText` variable)
    let elMatchExpr: string;
    if (matchMode === "regex") {
      elMatchExpr = `new RegExp(${JSON.stringify(text)}).test(elText)`;
    } else if (matchMode === "exact") {
      elMatchExpr = `elText.trim() === ${JSON.stringify(text)}`;
    } else {
      elMatchExpr = `elText.includes(${JSON.stringify(text)})`;
    }

    const result = await client.evaluate(`(() => {
      const scopeEl = ${scope} ? document.querySelector(${scope}) : document.body;
      if (!scopeEl) return 'scope_not_found';
      const candidates = scopeEl.querySelectorAll('[role="button"], [tabindex="0"], button, a, [dir="auto"]');
      for (const el of candidates) {
        const elText = el.textContent || '';
        if (${elMatchExpr}) {
          const clickable = el.closest('[tabindex="0"], [role="button"], button, a') || el;
          clickable.click();
          return 'ok';
        }
      }
      return 'not_found';
    })()`);

    if (result === "scope_not_found") {
      return { success: false, error: `click_text: scope selector not found: ${selector}` };
    }
    if (result === "not_found") {
      return { success: false, error: `click_text: no element with text "${text}" found` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a click_nth step
 * Clicks the Nth element matching selector or text pattern
 */
export async function clickNthStep(
  step: any,
  client: CDPClientInterface
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!step.click_nth || typeof step.click_nth.index !== "number") {
      return { success: false, error: "click_nth step requires index number" };
    }
    const { index, text, selector, match } = step.click_nth;
    const cssSelector = selector ?? '[role="button"], [tabindex="0"]';
    const matchMode = match ?? "contains";

    // Build per-element filter expression (uses `elText` variable)
    let filterExpr: string;
    if (matchMode === "regex") {
      filterExpr = `new RegExp(${JSON.stringify(text ?? "")}).test(elText)`;
    } else if (matchMode === "exact") {
      filterExpr = `elText.trim() === ${JSON.stringify(text ?? "")}`;
    } else {
      filterExpr = `elText.includes(${JSON.stringify(text ?? "")})`;
    }

    const result = await client.evaluate(`(() => {
      const all = Array.from(document.querySelectorAll(${JSON.stringify(cssSelector)}));
      const hasText = ${text != null};
      let filtered = all;
      if (hasText) {
        filtered = all.filter(el => {
          const elText = el.textContent || '';
          return ${filterExpr};
        });
      }
      const idx = ${index};
      if (idx < 0 || idx >= filtered.length) return 'out_of_bounds:' + filtered.length;
      filtered[idx].click();
      return 'ok';
    })()`);

    if (typeof result === "string" && result.startsWith("out_of_bounds:")) {
      const count = result.split(":")[1];
      return { success: false, error: `click_nth: index ${index} out of bounds (${count} elements found)` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
