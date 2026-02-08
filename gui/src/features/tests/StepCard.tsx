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

            {/* Step label */}
            <span className="font-medium text-sm break-words">{label}</span>
          </div>

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
