import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import type { StepDef } from '@/lib/types';

export interface StepCardProps {
  step: StepDef;
  index: number;
  status?: 'pending' | 'running' | 'passed' | 'failed';
}

/**
 * Get the step type from a StepDef union type
 */
function getStepType(step: StepDef): string {
  if ('eval' in step) return 'evaluate';
  if ('fill' in step) return 'fill';
  if ('click' in step) return 'click';
  if ('assert' in step) return 'assert';
  if ('wait' in step) return 'wait';
  if ('wait_for' in step) return 'wait_for';
  if ('console_check' in step) return 'console_check';
  if ('network_check' in step) return 'network_check';
  if ('mock_network' in step) return 'mock_network';
  if ('run_test' in step) return 'run_test';
  if ('screenshot' in step) return 'screenshot';
  if ('select' in step) return 'select';
  if ('press_key' in step) return 'press_key';
  if ('hover' in step) return 'hover';
  if ('switch_frame' in step) return 'switch_frame';
  if ('handle_dialog' in step) return 'handle_dialog';
  if ('http_request' in step) return 'http_request';
  if ('loop' in step) return 'loop';
  if ('scan_input' in step) return 'scan_input';
  if ('fill_form' in step) return 'fill_form';
  if ('scroll_to' in step) return 'scroll_to';
  if ('clear_input' in step) return 'clear_input';
  if ('wait_for_text' in step) return 'wait_for_text';
  if ('wait_for_text_gone' in step) return 'wait_for_text_gone';
  if ('assert_text' in step) return 'assert_text';
  if ('click_text' in step) return 'click_text';
  if ('click_nth' in step) return 'click_nth';
  if ('type' in step) return 'type';
  if ('choose_dropdown' in step) return 'choose_dropdown';
  if ('expand_menu' in step) return 'expand_menu';
  if ('toggle' in step) return 'toggle';
  if ('close_modal' in step) return 'close_modal';
  return 'unknown';
}

/**
 * Generate a label for a step based on its type and content
 * Falls back to explicit step.label if provided
 */
function getStepLabel(step: StepDef): string {
  if (step.label) return step.label;

  const type = getStepType(step);

  switch (type) {
    case 'fill':
      if ('fill' in step) {
        return `Fill ${step.fill.selector}`;
      }
      break;
    case 'click':
      if ('click' in step) {
        return `Click ${step.click.selector}`;
      }
      break;
    case 'assert':
      if ('assert' in step) {
        const preview = step.assert.length > 40
          ? step.assert.slice(0, 40) + '...'
          : step.assert;
        return `Assert ${preview}`;
      }
      break;
    case 'evaluate':
      if ('eval' in step) {
        return step.as ? `Eval → $vars.${step.as}` : 'Evaluate';
      }
      break;
    case 'wait':
      if ('wait' in step) {
        return `Wait ${step.wait}ms`;
      }
      break;
    case 'wait_for':
      if ('wait_for' in step) {
        return `Wait for ${step.wait_for.selector}`;
      }
      break;
    case 'run_test':
      if ('run_test' in step) {
        return `Run ${step.run_test}`;
      }
      break;
    case 'console_check':
      return 'Console check';
    case 'network_check':
      return 'Network check';
    case 'mock_network':
      if ('mock_network' in step) {
        return `Mock ${step.mock_network.match}`;
      }
      break;
    case 'screenshot':
      if ('screenshot' in step) {
        return step.screenshot.as ? `Screenshot → $vars.${step.screenshot.as}` : 'Screenshot';
      }
      break;
    case 'select':
      if ('select' in step) {
        return `Select ${step.select.selector}`;
      }
      break;
    case 'press_key':
      if ('press_key' in step) {
        const mods = step.press_key.modifiers?.join('+');
        return mods ? `Press ${mods}+${step.press_key.key}` : `Press ${step.press_key.key}`;
      }
      break;
    case 'hover':
      if ('hover' in step) {
        return `Hover ${step.hover.selector}`;
      }
      break;
    case 'switch_frame':
      if ('switch_frame' in step) {
        return step.switch_frame.selector ? `Switch to ${step.switch_frame.selector}` : 'Switch to main frame';
      }
      break;
    case 'handle_dialog':
      if ('handle_dialog' in step) {
        return `Dialog: ${step.handle_dialog.action}`;
      }
      break;
    case 'http_request':
      if ('http_request' in step) {
        const method = step.http_request.method || 'GET';
        const url = step.http_request.url.length > 40
          ? step.http_request.url.slice(0, 40) + '...'
          : step.http_request.url;
        return `${method} ${url}`;
      }
      break;
    case 'loop':
      if ('loop' in step) {
        if (step.loop.over) return `Loop over ${step.loop.over}`;
        if (step.loop.while) return `Loop while ${step.loop.while}`;
        return 'Loop';
      }
      break;
    case 'scan_input':
      if ('scan_input' in step) {
        return `Scan ${step.scan_input.selector}`;
      }
      break;
    case 'fill_form':
      if ('fill_form' in step) {
        return `Fill form (${step.fill_form.fields.length} fields)`;
      }
      break;
    case 'scroll_to':
      if ('scroll_to' in step) {
        return `Scroll to ${step.scroll_to.selector}`;
      }
      break;
    case 'clear_input':
      if ('clear_input' in step) {
        return `Clear ${step.clear_input.selector}`;
      }
      break;
    case 'wait_for_text':
      if ('wait_for_text' in step) {
        return `Wait for text "${step.wait_for_text.text}"`;
      }
      break;
    case 'wait_for_text_gone':
      if ('wait_for_text_gone' in step) {
        return `Wait for text gone "${step.wait_for_text_gone.text}"`;
      }
      break;
    case 'assert_text':
      if ('assert_text' in step) {
        return step.assert_text.absent
          ? `Assert text absent "${step.assert_text.text}"`
          : `Assert text "${step.assert_text.text}"`;
      }
      break;
    case 'click_text':
      if ('click_text' in step) {
        return `Click text "${step.click_text.text}"`;
      }
      break;
    case 'click_nth':
      if ('click_nth' in step) {
        const target = step.click_nth.text || step.click_nth.selector || '';
        return `Click #${step.click_nth.index} ${target}`.trim();
      }
      break;
    case 'type':
      if ('type' in step) {
        return `Type "${step.type.text}" into ${step.type.selector}`;
      }
      break;
    case 'choose_dropdown':
      if ('choose_dropdown' in step) {
        return `Choose "${step.choose_dropdown.text}" from ${step.choose_dropdown.selector}`;
      }
      break;
    case 'expand_menu':
      if ('expand_menu' in step) {
        return `Expand menu "${step.expand_menu.group}"`;
      }
      break;
    case 'toggle':
      if ('toggle' in step) {
        return `Toggle "${step.toggle.label}"`;
      }
      break;
    case 'close_modal':
      if ('close_modal' in step) {
        return step.close_modal.strategy
          ? `Close modal (${step.close_modal.strategy})`
          : 'Close modal';
      }
      break;
  }

  return 'Unknown step';
}

/**
 * Get the color scheme for a step type badge
 */
function getBadgeVariant(
  type: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (type) {
    case 'fill':
      return 'default'; // blue
    case 'click':
      return 'secondary'; // green
    case 'assert':
      return 'destructive'; // red/purple
    case 'evaluate':
      return 'outline'; // orange-like
    case 'wait':
    case 'wait_for':
      return 'secondary'; // yellow-like
    case 'navigate':
      return 'outline'; // gray
    case 'run_test':
      return 'secondary'; // amber
    case 'console_check':
    case 'network_check':
      return 'default'; // teal
    case 'mock_network':
      return 'outline'; // indigo
    case 'screenshot':
      return 'secondary';
    case 'select':
      return 'default';
    case 'press_key':
      return 'secondary';
    case 'hover':
      return 'secondary';
    case 'switch_frame':
      return 'outline';
    case 'handle_dialog':
      return 'outline';
    case 'http_request':
      return 'outline';
    case 'scan_input':
    case 'fill_form':
    case 'clear_input':
    case 'type':
    case 'choose_dropdown':
    case 'toggle':
      return 'default';
    case 'scroll_to':
    case 'wait_for_text':
    case 'wait_for_text_gone':
    case 'click_text':
    case 'click_nth':
      return 'secondary';
    case 'assert_text':
      return 'destructive';
    case 'expand_menu':
    case 'close_modal':
    case 'loop':
      return 'outline';
    default:
      return 'default';
  }
}

/**
 * Get inline details to show for a step (selector, value, expression preview)
 * Shows truncated content for collapsed view
 */
function getStepDetails(step: StepDef): React.ReactNode {
  if ('fill' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.fill.selector}</span>
        {step.fill.value && (
          <>
            {' '}&rarr;{' '}
            <span className="font-mono">
              {step.fill.value.length > 30
                ? step.fill.value.slice(0, 30) + '...'
                : step.fill.value}
            </span>
          </>
        )}
      </div>
    );
  }

  if ('click' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.click.selector}</span>
      </div>
    );
  }

  if ('assert' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1 font-mono">
        {step.assert.length > 50
          ? step.assert.slice(0, 50) + '...'
          : step.assert}
      </div>
    );
  }

  if ('eval' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1 font-mono">
        {step.eval.length > 50
          ? step.eval.slice(0, 50) + '...'
          : step.eval}
      </div>
    );
  }

  if ('wait_for' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.wait_for.selector}</span>
        {step.wait_for.timeout && (
          <>
            {' '}
            (timeout: {step.wait_for.timeout}ms)
          </>
        )}
      </div>
    );
  }

  if ('mock_network' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.mock_network.match}</span>
        {' '}&rarr;{' '}
        <span>
          {step.mock_network.status}
          {step.mock_network.delay && ` (${step.mock_network.delay}ms delay)`}
        </span>
      </div>
    );
  }

  if ('select' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.select.selector}</span>
        {' '}&rarr;{' '}
        <span className="font-mono">{step.select.value}</span>
      </div>
    );
  }

  if ('hover' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.hover.selector}</span>
      </div>
    );
  }

  if ('switch_frame' in step && step.switch_frame.selector) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.switch_frame.selector}</span>
      </div>
    );
  }

  if ('http_request' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.http_request.url}</span>
        {' '}&rarr;{' '}
        <span>{step.http_request.method || 'GET'}</span>
      </div>
    );
  }

  if ('loop' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        {step.loop.over && <span>over: <span className="font-mono">{step.loop.over}</span></span>}
        {step.loop.while && <span>while: <span className="font-mono">{step.loop.while}</span></span>}
        {' '}({step.loop.steps.length} steps)
      </div>
    );
  }

  if ('scan_input' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.scan_input.selector}</span>
        {' '}&rarr;{' '}
        <span className="font-mono">{step.scan_input.value}</span>
      </div>
    );
  }

  if ('fill_form' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        {step.fill_form.fields.length} fields
      </div>
    );
  }

  if ('scroll_to' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.scroll_to.selector}</span>
      </div>
    );
  }

  if ('clear_input' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.clear_input.selector}</span>
      </div>
    );
  }

  if ('wait_for_text' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">"{step.wait_for_text.text}"</span>
        {step.wait_for_text.timeout != null && ` (timeout: ${step.wait_for_text.timeout}ms)`}
      </div>
    );
  }

  if ('wait_for_text_gone' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">"{step.wait_for_text_gone.text}"</span>
        {step.wait_for_text_gone.timeout != null && ` (timeout: ${step.wait_for_text_gone.timeout}ms)`}
      </div>
    );
  }

  if ('assert_text' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">"{step.assert_text.text}"</span>
        {step.assert_text.absent && ' (absent)'}
      </div>
    );
  }

  if ('click_text' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">"{step.click_text.text}"</span>
        {step.click_text.match && ` (${step.click_text.match})`}
      </div>
    );
  }

  if ('click_nth' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        #{step.click_nth.index}
        {step.click_nth.selector && <span className="font-mono"> {step.click_nth.selector}</span>}
        {step.click_nth.text && <span> "{step.click_nth.text}"</span>}
      </div>
    );
  }

  if ('type' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.type.selector}</span>
        {' '}&rarr;{' '}
        <span className="font-mono">"{step.type.text}"</span>
      </div>
    );
  }

  if ('choose_dropdown' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        <span className="font-mono">{step.choose_dropdown.selector}</span>
        {' '}&rarr;{' '}
        <span>"{step.choose_dropdown.text}"</span>
      </div>
    );
  }

  if ('expand_menu' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        "{step.expand_menu.group}"
      </div>
    );
  }

  if ('toggle' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        "{step.toggle.label}"
        {step.toggle.state != null && ` → ${step.toggle.state ? 'on' : 'off'}`}
      </div>
    );
  }

  if ('close_modal' in step) {
    return (
      <div className="text-sm text-muted-foreground mt-1">
        {step.close_modal.strategy && `Strategy: ${step.close_modal.strategy}`}
      </div>
    );
  }

  return null;
}

/**
 * Get full untruncated details for expanded view
 */
function getStepFullDetails(step: StepDef): React.ReactNode {
  if ('eval' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Expression</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.eval}
        </pre>
        {step.as && (
          <p className="text-xs text-gray-500 mt-1">
            Stores result in <span className="font-mono">$vars.{step.as}</span>
          </p>
        )}
      </div>
    );
  }

  if ('assert' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Assertion</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.assert}
        </pre>
        {step.retry && (
          <p className="text-xs text-gray-500 mt-1">
            Retry: every {step.retry.interval}ms, timeout {step.retry.timeout}ms
          </p>
        )}
      </div>
    );
  }

  if ('fill' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.fill.selector}
        </pre>
        <p className="text-xs font-semibold text-gray-500">Value</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.fill.value}
        </pre>
      </div>
    );
  }

  if ('click' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.click.selector}
        </pre>
      </div>
    );
  }

  if ('wait_for' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.wait_for.selector}
        </pre>
        {step.wait_for.timeout != null && (
          <p className="text-xs text-gray-500">
            Timeout: {step.wait_for.timeout}ms
          </p>
        )}
      </div>
    );
  }

  if ('mock_network' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Match Pattern</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.mock_network.match}
        </pre>
        <p className="text-xs font-semibold text-gray-500">Status: {step.mock_network.status}</p>
        {step.mock_network.body != null && (
          <>
            <p className="text-xs font-semibold text-gray-500">Body</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {typeof step.mock_network.body === 'string'
                ? step.mock_network.body
                : JSON.stringify(step.mock_network.body, null, 2)}
            </pre>
          </>
        )}
        {step.mock_network.delay != null && (
          <p className="text-xs text-gray-500">Delay: {step.mock_network.delay}ms</p>
        )}
      </div>
    );
  }

  if ('console_check' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Checking levels</p>
        <p className="text-xs font-mono">{step.console_check.join(', ')}</p>
      </div>
    );
  }

  if ('network_check' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-gray-500">
          Checks for 4xx/5xx network responses
        </p>
      </div>
    );
  }

  if ('run_test' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Test ID</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.run_test}
        </pre>
      </div>
    );
  }

  if ('wait' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-gray-500">Wait {step.wait}ms</p>
      </div>
    );
  }

  if ('screenshot' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-gray-500">Captures PNG screenshot</p>
        {step.screenshot.as && (
          <p className="text-xs text-gray-500">
            Stores base64 in <span className="font-mono">$vars.{step.screenshot.as}</span>
          </p>
        )}
      </div>
    );
  }

  if ('select' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.select.selector}
        </pre>
        <p className="text-xs font-semibold text-gray-500">Value</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.select.value}
        </pre>
      </div>
    );
  }

  if ('press_key' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Key: {step.press_key.key}</p>
        {step.press_key.modifiers && step.press_key.modifiers.length > 0 && (
          <p className="text-xs text-gray-500">
            Modifiers: {step.press_key.modifiers.join(', ')}
          </p>
        )}
      </div>
    );
  }

  if ('hover' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.hover.selector}
        </pre>
      </div>
    );
  }

  if ('switch_frame' in step) {
    return (
      <div className="mt-2 space-y-1">
        {step.switch_frame.selector ? (
          <>
            <p className="text-xs font-semibold text-gray-500">iframe Selector</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.switch_frame.selector}
            </pre>
          </>
        ) : (
          <p className="text-xs text-gray-500">Returns to main frame</p>
        )}
      </div>
    );
  }

  if ('handle_dialog' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Action: {step.handle_dialog.action}</p>
        {step.handle_dialog.text != null && (
          <p className="text-xs text-gray-500">
            Prompt text: {step.handle_dialog.text}
          </p>
        )}
      </div>
    );
  }

  if ('http_request' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">URL</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.http_request.url}
        </pre>
        <p className="text-xs font-semibold text-gray-500">Method: {step.http_request.method || 'GET'}</p>
        {step.http_request.body != null && (
          <>
            <p className="text-xs font-semibold text-gray-500">Body</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {typeof step.http_request.body === 'string'
                ? step.http_request.body
                : JSON.stringify(step.http_request.body, null, 2)}
            </pre>
          </>
        )}
        {step.http_request.headers != null && (
          <>
            <p className="text-xs font-semibold text-gray-500">Headers</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {JSON.stringify(step.http_request.headers, null, 2)}
            </pre>
          </>
        )}
        {step.http_request.as && (
          <p className="text-xs text-gray-500">
            Stores response in <span className="font-mono">$vars.{step.http_request.as}</span>
          </p>
        )}
      </div>
    );
  }

  if ('loop' in step) {
    return (
      <div className="mt-2 space-y-1">
        {step.loop.over && (
          <>
            <p className="text-xs font-semibold text-gray-500">Over</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.loop.over}
            </pre>
          </>
        )}
        {step.loop.while && (
          <>
            <p className="text-xs font-semibold text-gray-500">While</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.loop.while}
            </pre>
          </>
        )}
        {step.loop.as && (
          <p className="text-xs text-gray-500">Item as: <span className="font-mono">$vars.{step.loop.as}</span></p>
        )}
        {step.loop.index_as && (
          <p className="text-xs text-gray-500">Index as: <span className="font-mono">$vars.{step.loop.index_as}</span></p>
        )}
        {step.loop.max != null && (
          <p className="text-xs text-gray-500">Max iterations: {step.loop.max}</p>
        )}
        <p className="text-xs font-semibold text-gray-500 mt-2">Steps ({step.loop.steps.length})</p>
        <div className="ml-2 border-l-2 border-gray-200 pl-2" onClick={(e) => e.stopPropagation()}>
          {step.loop.steps.map((innerStep, i) => (
            <StepCard key={i} step={innerStep} index={i} />
          ))}
        </div>
      </div>
    );
  }

  if ('scan_input' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.scan_input.selector}
        </pre>
        <p className="text-xs font-semibold text-gray-500">Value</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.scan_input.value}
        </pre>
      </div>
    );
  }

  if ('fill_form' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Fields ({step.fill_form.fields.length})</p>
        {step.fill_form.fields.map((field, i) => (
          <div key={i} className="text-xs font-mono bg-gray-100 rounded p-2">
            <span className="text-gray-600">{field.selector}</span>
            {' '}&rarr;{' '}
            <span>{field.value}</span>
          </div>
        ))}
      </div>
    );
  }

  if ('scroll_to' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.scroll_to.selector}
        </pre>
      </div>
    );
  }

  if ('clear_input' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.clear_input.selector}
        </pre>
      </div>
    );
  }

  if ('wait_for_text' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Text</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.wait_for_text.text}
        </pre>
        {step.wait_for_text.selector && (
          <>
            <p className="text-xs font-semibold text-gray-500">Selector</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.wait_for_text.selector}
            </pre>
          </>
        )}
        {step.wait_for_text.timeout != null && (
          <p className="text-xs text-gray-500">Timeout: {step.wait_for_text.timeout}ms</p>
        )}
      </div>
    );
  }

  if ('wait_for_text_gone' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Text</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.wait_for_text_gone.text}
        </pre>
        {step.wait_for_text_gone.selector && (
          <>
            <p className="text-xs font-semibold text-gray-500">Selector</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.wait_for_text_gone.selector}
            </pre>
          </>
        )}
        {step.wait_for_text_gone.timeout != null && (
          <p className="text-xs text-gray-500">Timeout: {step.wait_for_text_gone.timeout}ms</p>
        )}
      </div>
    );
  }

  if ('assert_text' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Text</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.assert_text.text}
        </pre>
        {step.assert_text.absent && (
          <p className="text-xs text-gray-500">Asserts text is absent</p>
        )}
        {step.assert_text.selector && (
          <>
            <p className="text-xs font-semibold text-gray-500">Selector</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.assert_text.selector}
            </pre>
          </>
        )}
        {step.assert_text.retry && (
          <p className="text-xs text-gray-500">
            Retry: every {step.assert_text.retry.interval}ms, timeout {step.assert_text.retry.timeout}ms
          </p>
        )}
      </div>
    );
  }

  if ('click_text' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Text</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.click_text.text}
        </pre>
        {step.click_text.match && (
          <p className="text-xs text-gray-500">Match: {step.click_text.match}</p>
        )}
        {step.click_text.selector && (
          <>
            <p className="text-xs font-semibold text-gray-500">Selector</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.click_text.selector}
            </pre>
          </>
        )}
      </div>
    );
  }

  if ('click_nth' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Index: {step.click_nth.index}</p>
        {step.click_nth.selector && (
          <>
            <p className="text-xs font-semibold text-gray-500">Selector</p>
            <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
              {step.click_nth.selector}
            </pre>
          </>
        )}
        {step.click_nth.text && (
          <p className="text-xs text-gray-500">Text: "{step.click_nth.text}"</p>
        )}
        {step.click_nth.match && (
          <p className="text-xs text-gray-500">Match: {step.click_nth.match}</p>
        )}
      </div>
    );
  }

  if ('type' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.type.selector}
        </pre>
        <p className="text-xs font-semibold text-gray-500">Text</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.type.text}
        </pre>
        {step.type.delay != null && (
          <p className="text-xs text-gray-500">Delay: {step.type.delay}ms per character</p>
        )}
        {step.type.clear && (
          <p className="text-xs text-gray-500">Clears input first</p>
        )}
      </div>
    );
  }

  if ('choose_dropdown' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Selector</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.choose_dropdown.selector}
        </pre>
        <p className="text-xs font-semibold text-gray-500">Text</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.choose_dropdown.text}
        </pre>
        {step.choose_dropdown.match && (
          <p className="text-xs text-gray-500">Match: {step.choose_dropdown.match}</p>
        )}
        {step.choose_dropdown.timeout != null && (
          <p className="text-xs text-gray-500">Timeout: {step.choose_dropdown.timeout}ms</p>
        )}
      </div>
    );
  }

  if ('expand_menu' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Group</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.expand_menu.group}
        </pre>
      </div>
    );
  }

  if ('toggle' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs font-semibold text-gray-500">Label</p>
        <pre className="text-xs font-mono bg-gray-100 rounded p-2 whitespace-pre-wrap break-words overflow-x-auto">
          {step.toggle.label}
        </pre>
        {step.toggle.state != null && (
          <p className="text-xs text-gray-500">Target state: {step.toggle.state ? 'on' : 'off'}</p>
        )}
      </div>
    );
  }

  if ('close_modal' in step) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-gray-500">Closes current modal/overlay</p>
        {step.close_modal.strategy && (
          <p className="text-xs text-gray-500">Strategy: {step.close_modal.strategy}</p>
        )}
      </div>
    );
  }

  return null;
}

/**
 * StepCard component
 * Displays a single test step with type badge, auto-generated label,
 * details, and optional status overlay for live execution.
 * Click to expand and see full untruncated step details.
 */
export const StepCard: React.FC<StepCardProps> = ({
  step,
  index,
  status,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const stepType = getStepType(step);
  const label = getStepLabel(step);
  const details = getStepDetails(step);
  const fullDetails = getStepFullDetails(step);
  const badgeVariant = getBadgeVariant(stepType);

  // Determine border and icon styling based on status
  const statusBorderMap: Record<'pending' | 'running' | 'passed' | 'failed', string> = {
    pending: '',
    running: 'border-l-4 border-l-blue-500 bg-blue-50',
    passed: 'border-l-4 border-l-green-500 bg-green-50',
    failed: 'border-l-4 border-l-red-500 bg-red-50',
  };
  const statusBorderClass = statusBorderMap[status || 'pending'];

  const statusIconMap: Record<'running' | 'passed' | 'failed' | 'pending', string> = {
    running: '⟳',
    passed: '✓',
    failed: '✗',
    pending: '',
  };
  const statusIcon = status ? statusIconMap[status] : '';

  const statusTextColorMap: Record<'running' | 'passed' | 'failed' | 'pending', string> = {
    running: 'text-blue-600',
    passed: 'text-green-600',
    failed: 'text-red-600',
    pending: '',
  };
  const statusText = status ? statusTextColorMap[status] : '';

  return (
    <Card
      onClick={() => setIsExpanded(!isExpanded)}
      className={`relative p-4 mb-3 transition-all cursor-pointer hover:shadow-sm ${statusBorderClass}`}
    >
      <div className="flex items-start gap-3">
        {/* Expand indicator */}
        <div className="flex-shrink-0 mt-0.5">
          <ChevronRight
            className={`w-4 h-4 text-gray-400 transition-transform ${
              isExpanded ? 'rotate-90' : ''
            }`}
          />
        </div>

        {/* Step index number */}
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
          <span className="text-xs font-semibold text-muted-foreground">
            {index + 1}
          </span>
        </div>

        {/* Main content */}
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Type badge */}
            <Badge variant={badgeVariant} className="text-xs">
              {stepType}
            </Badge>

            {/* Conditional badge */}
            {'if' in step && step.if != null && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                if: {step.if.length > 20 ? step.if.slice(0, 20) + '...' : step.if}
              </Badge>
            )}

            {/* Step label */}
            <span className="font-medium text-sm break-words">{label}</span>
          </div>

          {/* Step comment/annotation */}
          {'comment' in step && step.comment && (
            <div className="mt-2 text-xs text-gray-600 italic border-l-2 border-gray-300 pl-2">
              💬 {step.comment}
            </div>
          )}

          {/* Collapsed: truncated details */}
          {!isExpanded && details}

          {/* Expanded: full details */}
          {isExpanded && fullDetails}
        </div>

        {/* Status icon */}
        {status && statusIcon && (
          <div className={`flex-shrink-0 text-lg font-semibold ${statusText}`}>
            {statusIcon}
          </div>
        )}
      </div>
    </Card>
  );
};

export default StepCard;
