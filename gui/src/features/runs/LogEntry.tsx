/**
 * LogEntry.tsx
 * Component for displaying individual log entries from test runs
 * Supports console messages, network requests, and step progress
 */

import React from 'react';

/**
 * Union type for all log entry types
 * - console: captured console output (log, warning, error)
 * - network: captured network requests and responses
 * - step: step execution progress and completion
 */
export type LogEntry =
  | {
      type: 'console';
      level: 'log' | 'warning' | 'error' | 'info' | 'debug' | 'warn';
      text: string;
      timestamp: number;
    }
  | {
      type: 'network';
      method: string;
      url: string;
      status: number;
      duration_ms: number;
      timestamp: number;
    }
  | {
      type: 'step';
      stepIndex: number;
      label: string;
      status: 'running' | 'passed' | 'failed';
      duration_ms?: number;
      error?: string;
      timestamp: number;
    };

interface LogEntryProps {
  entry: LogEntry;
}

/**
 * LogEntry component — displays different log entry types with appropriate styling
 *
 * - Console entries: colored by level (default gray, yellow for warning, red for error)
 * - Network entries: method + URL with status code color (green 2xx, yellow 3xx, red 4xx/5xx)
 * - Step entries: divider-style with status icon and duration
 */
export const LogEntry: React.FC<LogEntryProps> = ({ entry }) => {
  switch (entry.type) {
    case 'console':
      return <ConsoleEntry entry={entry} />;
    case 'network':
      return <NetworkEntry entry={entry} />;
    case 'step':
      return <StepEntry entry={entry} />;
    default:
      return null;
  }
};

/**
 * ConsoleEntry — displays console output with level-based styling
 */
function ConsoleEntry({
  entry,
}: {
  entry: Extract<LogEntry, { type: 'console' }>;
}) {
  // Determine styling based on console level
  const getLevelStyles = (): { badgeBg: string; badgeText: string; textColor: string } => {
    switch (entry.level) {
      case 'error':
        return { badgeBg: 'bg-red-100', badgeText: 'text-red-700', textColor: 'text-red-600' };
      case 'warning':
      case 'warn':
        return { badgeBg: 'bg-yellow-100', badgeText: 'text-yellow-700', textColor: 'text-yellow-600' };
      case 'info':
      case 'debug':
      case 'log':
      default:
        return { badgeBg: 'bg-gray-100', badgeText: 'text-gray-700', textColor: 'text-gray-700' };
    }
  };

  const { badgeBg, badgeText, textColor } = getLevelStyles();

  // Format level label (capitalize)
  const levelLabel = entry.level.charAt(0).toUpperCase() + entry.level.slice(1);

  return (
    <div className="flex gap-3 py-2 px-3 border-b border-gray-100 hover:bg-gray-50">
      <span className={`flex-shrink-0 mt-0.5 px-2 py-1 rounded text-xs font-medium ${badgeBg} ${badgeText}`}>
        {levelLabel}
      </span>
      <code className={`flex-1 text-sm font-mono break-words ${textColor}`}>
        {entry.text}
      </code>
    </div>
  );
}

/**
 * NetworkEntry — displays network request/response with status-based styling
 */
function NetworkEntry({
  entry,
}: {
  entry: Extract<LogEntry, { type: 'network' }>;
}) {
  // Determine status badge color based on HTTP status code
  const getStatusStyles = (): { statusBg: string; statusText: string; bgColor: string } => {
    if (entry.status >= 200 && entry.status < 300) {
      return { statusBg: 'bg-green-100', statusText: 'text-green-700', bgColor: 'bg-green-50' };
    } else if (entry.status >= 300 && entry.status < 400) {
      return { statusBg: 'bg-yellow-100', statusText: 'text-yellow-700', bgColor: 'bg-yellow-50' };
    } else {
      return { statusBg: 'bg-red-100', statusText: 'text-red-700', bgColor: 'bg-red-50' };
    }
  };

  const { statusBg, statusText, bgColor } = getStatusStyles();

  // Truncate URL if too long (show first 60 chars + ellipsis)
  const displayUrl = entry.url.length > 60 ? entry.url.substring(0, 60) + '...' : entry.url;

  return (
    <div className={`flex gap-3 py-2 px-3 border-b border-gray-100 ${bgColor}`}>
      <span className="flex-shrink-0 mt-0.5 px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 font-mono">
        {entry.method}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono truncate text-gray-700">
          {displayUrl}
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0 text-sm">
        <span className={`px-2 py-1 rounded text-xs font-medium font-mono ${statusBg} ${statusText}`}>
          {entry.status}
        </span>
        <span className="text-gray-500 text-xs whitespace-nowrap">
          {entry.duration_ms}ms
        </span>
      </div>
    </div>
  );
}

/**
 * StepEntry — displays step progress as a divider-style entry
 */
function StepEntry({
  entry,
}: {
  entry: Extract<LogEntry, { type: 'step' }>;
}) {
  // Determine styling based on step status
  const getStatusDisplay = (): { icon: string; bgColor: string; textColor: string } => {
    switch (entry.status) {
      case 'running':
        return {
          icon: '⏳',
          bgColor: 'bg-blue-50',
          textColor: 'text-blue-700',
        };
      case 'passed':
        return {
          icon: '✓',
          bgColor: 'bg-green-50',
          textColor: 'text-green-700',
        };
      case 'failed':
        return {
          icon: '✗',
          bgColor: 'bg-red-50',
          textColor: 'text-red-700',
        };
      default:
        return {
          icon: '•',
          bgColor: 'bg-gray-50',
          textColor: 'text-gray-700',
        };
    }
  };

  const { icon, bgColor, textColor } = getStatusDisplay();

  return (
    <div className={`flex gap-2 items-center py-2 px-3 border-y border-gray-200 ${bgColor} font-medium`}>
      <span className={`text-lg flex-shrink-0 ${textColor}`}>{icon}</span>
      <span className={`text-sm ${textColor}`}>
        Step {entry.stepIndex + 1}: {entry.label}
      </span>
      {entry.status === 'passed' && entry.duration_ms !== undefined && (
        <span className="ml-auto text-xs text-gray-600">
          {entry.duration_ms}ms
        </span>
      )}
      {entry.status === 'failed' && entry.error && (
        <span className="ml-auto text-xs text-red-600">
          {entry.error.substring(0, 50)}
          {entry.error.length > 50 ? '...' : ''}
        </span>
      )}
    </div>
  );
}

export default LogEntry;
