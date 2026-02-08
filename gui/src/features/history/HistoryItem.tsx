import React from 'react';
import { CheckCircle, XCircle, AlertCircle, ChevronRight } from 'lucide-react';
import { relativeTime, formatDuration } from '@/lib/utils';
import { fullTimestamp } from '@/lib/utils';
import type { TestRun } from '@/lib/types';

/**
 * Props for HistoryItem component
 */
export interface HistoryItemProps {
  /** Test run data to display */
  run: TestRun;
  /** Optional click handler to navigate to run details */
  onClick?: () => void;
  /** Whether this item is expanded (shows chevron rotation) */
  isExpanded?: boolean;
  /** Optional CSS class for custom styling */
  className?: string;
}

/**
 * Get passed/total step counts from a TestRun result
 */
function getStepSummary(run: TestRun): { passed: number; total: number } {
  const result = run.result;

  if (result.status === 'passed') {
    return {
      passed: result.steps_completed,
      total: result.steps_completed,
    };
  }

  if (result.status === 'failed') {
    // Failed at step N (0-indexed), so total is failed_step + 1
    return {
      passed: result.failed_step,
      total: result.failed_step + 1,
    };
  }

  // Running - unknown counts
  return { passed: 0, total: 0 };
}

/**
 * Check if a test run is stale (> 24 hours old)
 */
function isStale(completedAt: string): boolean {
  const completedTime = new Date(completedAt).getTime();
  const now = Date.now();
  const dayInMs = 24 * 60 * 60 * 1000;

  return now - completedTime > dayInMs;
}

/**
 * HistoryItem - Display a single test run as a row in the history list
 *
 * Features:
 * - Status icon (✓ for pass, ✗ for fail)
 * - Relative timestamp with full date tooltip
 * - Test duration formatted (e.g., "2.3s")
 * - Mini step summary bar with passed/failed segments
 * - Passed/total step count text
 * - Staleness indicator (⚠) for runs older than 24 hours
 * - Clickable row to navigate to run details
 * - Tailwind CSS styling with flexbox layout
 */
export const HistoryItem: React.FC<HistoryItemProps> = ({
  run,
  onClick,
  isExpanded = false,
  className = '',
}) => {
  const isPassed = run.status === 'passed';
  const duration = run.duration_ms ?? 0;
  const { passed, total } = getStepSummary(run);
  const completedAt = run.completedAt || run.startedAt;
  const stale = run.completedAt && isStale(run.completedAt);

  const relativeDate = new Date(completedAt);
  const fullDate = fullTimestamp(relativeDate);

  // Calculate percentages for the mini bar
  const passedPercent = total > 0 ? (passed / total) * 100 : 0;
  const failedPercent = total > 0 ? ((total - passed) / total) * 100 : 0;

  const isFailed = !isPassed;

  return (
    <div
      onClick={isFailed ? onClick : undefined}
      className={`
        border rounded-lg p-4 transition-all
        ${isFailed ? 'cursor-pointer hover:bg-gray-50 hover:shadow-sm' : ''}
        ${isPassed ? 'border-gray-200' : 'border-red-200'}
        ${className}
      `}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: Chevron (failed only) + Status Icon */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFailed && (
            <ChevronRight
              className={`w-4 h-4 text-gray-400 transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          )}
          {isPassed ? (
            <CheckCircle className="w-6 h-6 text-green-600" />
          ) : (
            <XCircle className="w-6 h-6 text-red-600" />
          )}
        </div>

        {/* Center: Main info */}
        <div className="flex-1 min-w-0">
          {/* Top row: Timestamp */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-sm text-gray-600 hover:text-gray-800 cursor-help"
              title={fullDate}
            >
              {relativeTime(relativeDate)}
            </span>
            {stale && (
              <AlertCircle className="w-4 h-4 text-amber-500" />
            )}
          </div>

          {/* Middle row: Duration and step count */}
          <div className="flex items-center gap-3 mb-2 text-sm">
            <span className="text-gray-700 font-medium">
              {duration > 0 ? formatDuration(duration) : 'running'}
            </span>
            <span className="text-gray-600">
              {passed}/{total} steps
            </span>
          </div>

          {/* Mini bar: Step summary */}
          <div className="w-full bg-gray-100 rounded h-2 overflow-hidden">
            {total > 0 && (
              <>
                <div
                  className="h-full bg-green-500 float-left"
                  style={{ width: `${passedPercent}%` }}
                />
                {failedPercent > 0 && (
                  <div
                    className="h-full bg-red-500 float-left"
                    style={{ width: `${failedPercent}%` }}
                  />
                )}
              </>
            )}
            {total === 0 && (
              <div className="h-full bg-gray-300" />
            )}
          </div>
        </div>

        {/* Right: Status text */}
        <div className="flex-shrink-0 text-right">
          <span
            className={`
              text-sm font-medium
              ${isPassed ? 'text-green-600' : 'text-red-600'}
            `}
          >
            {isPassed ? 'Passed' : 'Failed'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default HistoryItem;
