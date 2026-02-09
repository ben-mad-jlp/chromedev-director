import React, { useState } from 'react';
import { ChevronDown, CheckCircle, XCircle } from 'lucide-react';
import type { StepDef } from '@/lib/types';

/**
 * Step result - outcome of a single step execution
 */
export interface StepResult {
  status: 'passed' | 'failed';
  duration_ms: number;
  errorMessage?: string;
}

/**
 * Props for ResultStepCard component
 */
export interface ResultStepCardProps {
  step: StepDef;
  index: number;
  result: StepResult;
}

/**
 * Get a human-readable description of the step
 */
function getStepDescription(step: StepDef): string {
  if ('label' in step && step.label) {
    return step.label;
  }

  if ('eval' in step) {
    return `Evaluate: ${step.eval.substring(0, 50)}${step.eval.length > 50 ? '...' : ''}`;
  }
  if ('fill' in step) {
    return `Fill "${step.fill.selector}" with "${step.fill.value}"`;
  }
  if ('click' in step) {
    return `Click "${step.click.selector}"`;
  }
  if ('assert' in step) {
    return `Assert: ${step.assert.substring(0, 50)}${step.assert.length > 50 ? '...' : ''}`;
  }
  if ('wait' in step) {
    return `Wait ${step.wait}ms`;
  }
  if ('wait_for' in step) {
    return `Wait for "${step.wait_for.selector}"`;
  }
  if ('console_check' in step) {
    return `Check console for: ${step.console_check.join(', ')}`;
  }
  if ('network_check' in step) {
    return 'Check network responses';
  }
  if ('mock_network' in step) {
    return `Mock network: ${step.mock_network.match}`;
  }
  if ('run_test' in step) {
    return `Run test: ${step.run_test}`;
  }
  if ('screenshot' in step) {
    return step.screenshot.as ? `Screenshot → $vars.${step.screenshot.as}` : 'Screenshot';
  }
  if ('select' in step) {
    return `Select "${step.select.value}" in "${step.select.selector}"`;
  }
  if ('press_key' in step) {
    const mods = step.press_key.modifiers?.join('+');
    return mods ? `Press ${mods}+${step.press_key.key}` : `Press ${step.press_key.key}`;
  }
  if ('hover' in step) {
    return `Hover "${step.hover.selector}"`;
  }
  if ('switch_frame' in step) {
    return step.switch_frame.selector ? `Switch to "${step.switch_frame.selector}"` : 'Switch to main frame';
  }
  if ('handle_dialog' in step) {
    return `Dialog: ${step.handle_dialog.action}`;
  }
  if ('http_request' in step) {
    const method = step.http_request.method || 'GET';
    return `${method} ${step.http_request.url}`;
  }
  if ('loop' in step) {
    return 'Loop';
  }
  if ('scan_input' in step) {
    return `Scan "${step.scan_input.selector}"`;
  }
  if ('fill_form' in step) {
    return `Fill form (${step.fill_form.fields.length} fields)`;
  }
  if ('scroll_to' in step) {
    return `Scroll to "${step.scroll_to.selector}"`;
  }
  if ('clear_input' in step) {
    return `Clear "${step.clear_input.selector}"`;
  }
  if ('wait_for_text' in step) {
    return `Wait for text "${step.wait_for_text.text}"`;
  }
  if ('wait_for_text_gone' in step) {
    return `Wait for text gone "${step.wait_for_text_gone.text}"`;
  }
  if ('assert_text' in step) {
    return `Assert text: "${step.assert_text.text}"`;
  }
  if ('click_text' in step) {
    return `Click text "${step.click_text.text}"`;
  }
  if ('click_nth' in step) {
    return `Click #${step.click_nth.index}`;
  }
  if ('type' in step) {
    return `Type "${step.type.text}" into "${step.type.selector}"`;
  }
  if ('choose_dropdown' in step) {
    return `Choose "${step.choose_dropdown.text}"`;
  }
  if ('expand_menu' in step) {
    return `Expand menu "${step.expand_menu.group}"`;
  }
  if ('toggle' in step) {
    return `Toggle "${step.toggle.label}"`;
  }
  if ('close_modal' in step) {
    return 'Close modal';
  }

  return 'Unknown step';
}

/**
 * Format duration in milliseconds to readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * ResultStepCard - Display a test step result with status, duration, and optional error details
 *
 * Features:
 * - Status icon (checkmark for pass, X for fail)
 * - Step description/label
 * - Duration display
 * - Expandable error section for failed steps
 * - Tailwind CSS styling
 */
export const ResultStepCard: React.FC<ResultStepCardProps> = ({ step, index, result }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isPassed = result.status === 'passed';

  return (
    <div
      className={`
        border-l-4 rounded-lg p-4 mb-3 transition-all
        ${isPassed ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}
      `}
    >
      {/* Header row: Icon, Description, Duration */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Status Icon */}
          <div className="flex-shrink-0">
            {isPassed ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600" />
            )}
          </div>

          {/* Step Index and Description */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-gray-700">Step {index + 1}</span>
              <p className="text-sm text-gray-700 truncate">{getStepDescription(step)}</p>
            </div>
          </div>
        </div>

        {/* Duration */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-sm font-medium ${isPassed ? 'text-green-700' : 'text-red-700'}`}>
            {formatDuration(result.duration_ms)}
          </span>

          {/* Expand button for failed steps */}
          {!isPassed && result.errorMessage && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-600 hover:text-gray-800 transition-colors"
              aria-label={isExpanded ? 'Collapse error details' : 'Expand error details'}
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Error Details (expandable, only for failed steps) */}
      {!isPassed && result.errorMessage && isExpanded && (
        <div className="mt-3 pt-3 border-t border-red-200">
          <div className="bg-white rounded p-3 border border-red-200">
            <p className="text-xs font-semibold text-red-800 mb-2">Error Details</p>
            <pre className="text-xs text-red-700 overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {result.errorMessage}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultStepCard;
