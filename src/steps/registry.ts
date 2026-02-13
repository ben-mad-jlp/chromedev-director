/**
 * Step handler registry — maps step type names to their handler functions.
 * Used by executeStep() in step-runner.ts to dispatch steps.
 */

import { evalStep, screenshotStep } from "./eval.js";
import { fillStep, fillFormStep, clearInputStep, scanInputStep, typeStep, selectStep } from "./input.js";
import { clickStep, clickTextStep, clickNthStep } from "./click.js";
import { hoverStep, scrollToStep, switchFrameStep, pressKeyStep } from "./navigation.js";
import { assertStep, assertTextStep } from "./assert.js";
import { waitStep, waitForStep, waitForTextStep, waitForTextGoneStep } from "./wait.js";
import { networkCheckStep, consoleCheckStep, mockNetworkStep, httpRequestStep } from "./network.js";
import { loopStep, runTestStep } from "./control.js";
import { handleDialogStep, closeModalStep, chooseDropdownStep, expandMenuStep, toggleStep } from "./ui.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StepHandlerFn = (...args: any[]) => Promise<{ success: boolean; error?: string; value?: unknown; skipped?: boolean; loop_context?: Array<{ iteration: number; step: number; label: string }> }>;

export const STEP_REGISTRY: Record<string, StepHandlerFn> = {
  eval: evalStep,
  screenshot: screenshotStep,
  fill: fillStep,
  fill_form: fillFormStep,
  clear_input: clearInputStep,
  scan_input: scanInputStep,
  type: typeStep,
  select: selectStep,
  click: clickStep,
  click_text: clickTextStep,
  click_nth: clickNthStep,
  hover: hoverStep,
  scroll_to: scrollToStep,
  switch_frame: switchFrameStep,
  press_key: pressKeyStep,
  assert: assertStep,
  assert_text: assertTextStep,
  wait: waitStep,
  wait_for: waitForStep,
  wait_for_text: waitForTextStep,
  wait_for_text_gone: waitForTextGoneStep,
  network_check: networkCheckStep,
  console_check: consoleCheckStep,
  mock_network: mockNetworkStep,
  http_request: httpRequestStep,
  loop: loopStep,
  run_test: runTestStep,
  handle_dialog: handleDialogStep,
  close_modal: closeModalStep,
  choose_dropdown: chooseDropdownStep,
  expand_menu: expandMenuStep,
  toggle: toggleStep,
};
