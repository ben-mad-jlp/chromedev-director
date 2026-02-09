import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import HistoryItem from './HistoryItem';
import { listResults } from '../../lib/api';
import { subscribeToWebSocket, connectWebSocket } from '../../lib/ws';
import type { TestRun } from '../../lib/types';

/**
 * Props for the ResultsTab component
 */
export interface ResultsTabProps {
  /** The test ID to fetch results for */
  testId: string;
}

/**
 * FailureDetail — shown when a failed run is expanded.
 * Displays error message, failed step info, console errors, and DOM snapshot.
 */
const FailureDetail: React.FC<{ run: TestRun }> = ({ run }) => {
  const result = run.result;
  if (result.status !== 'failed') return null;

  return (
    <div className="space-y-3 pt-3 pb-1">
      {/* Error location + message */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-xs font-semibold text-red-800 mb-1">
          Failed at step {result.failed_step + 1}
          {result.failed_label ? ` — ${result.failed_label}` : ''}
        </p>

        {/* Loop context breadcrumb */}
        {result.loop_context && result.loop_context.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap text-xs text-red-700 mb-2 font-mono">
            {result.loop_context.map((ctx, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-red-400">&rarr;</span>}
                <span className="bg-red-100 rounded px-1.5 py-0.5">
                  Iter {ctx.iteration}, Step {ctx.step + 1}{ctx.label ? `: ${ctx.label}` : ''}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        <pre className="text-xs text-red-700 font-mono whitespace-pre-wrap break-words">
          {result.error}
        </pre>
      </div>

      {/* Console errors */}
      {result.console_errors.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-700 mb-2">
            Console Errors ({result.console_errors.length})
          </p>
          <div className="space-y-1">
            {result.console_errors.map((err, i) => (
              <pre
                key={i}
                className="text-xs text-red-700 font-mono bg-red-50 rounded p-2 whitespace-pre-wrap break-words"
              >
                {err}
              </pre>
            ))}
          </div>
        </div>
      )}

      {/* DOM snapshot */}
      {result.dom_snapshot && (
        <details className="bg-white border border-gray-200 rounded-lg">
          <summary className="px-4 py-3 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-50">
            DOM Snapshot
          </summary>
          <pre className="px-4 pb-4 text-xs font-mono text-gray-600 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
            {result.dom_snapshot}
          </pre>
        </details>
      )}
    </div>
  );
};

/**
 * ResultsTab component — Combined history list + expandable run detail
 *
 * Replaces the old separate History and Results tabs with a single
 * accordion-style list where clicking a run expands its details inline.
 *
 * Features:
 * - Fetches results from API on mount
 * - Auto-refreshes when run:complete WebSocket event fires for this test
 * - Accordion expand/collapse for each run
 * - Shows loading, empty, and error states
 * - Refresh button
 */
export const ResultsTab: React.FC<ResultsTabProps> = ({ testId }) => {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * Fetch test results from API
   */
  const fetchResults = useCallback(async () => {
    try {
      setError(null);
      const results = await listResults(testId);
      // Sort by startedAt descending (newest first)
      results.sort((a, b) => {
        const timeA = new Date(a.startedAt).getTime();
        const timeB = new Date(b.startedAt).getTime();
        return timeB - timeA;
      });
      setRuns(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch results';
      setError(message);
      console.error('[ResultsTab] Error fetching results:', err);
    }
  }, [testId]);

  /**
   * Handle manual refresh button click
   */
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchResults();
    } finally {
      setIsRefreshing(false);
    }
  };

  /**
   * Setup: Fetch initial results and subscribe to run:complete events
   */
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const init = async () => {
      try {
        // Ensure WebSocket is connected
        await connectWebSocket();

        // Fetch initial results
        await fetchResults();

        // Subscribe to run:complete events
        unsubscribe = subscribeToWebSocket('run:complete', (data: any) => {
          // Only refresh if this event is for our test
          if (data?.testId === testId) {
            fetchResults();
          }
        });
      } catch (err) {
        console.error('[ResultsTab] Failed to initialize:', err);
      } finally {
        setIsLoading(false);
      }
    };

    init();

    // Cleanup: unsubscribe from WebSocket on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [testId, fetchResults]);

  /**
   * Toggle a failed run's expanded state
   */
  const toggleRun = (run: TestRun) => {
    if (run.status !== 'failed') return;
    setExpandedRunId((prev) => (prev === run.id ? null : run.id));
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Results</h2>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <div className="flex justify-center mb-2">
            <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
          </div>
          <p className="text-sm text-gray-600">Loading results...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Results</h2>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
            title="Retry loading results"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Retry
          </button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-900">Failed to load results</p>
            <p className="text-xs text-red-800">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (runs.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Results</h2>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
            title="Refresh results"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-600">No results yet.</p>
          <p className="text-xs text-gray-500 mt-1">Run this test to see results here.</p>
        </div>
      </div>
    );
  }

  // Loaded state with results
  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Results</h2>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
          title="Refresh results"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {runs.map((run) => (
          <div key={run.id}>
            <HistoryItem
              run={run}
              isExpanded={expandedRunId === run.id}
              onClick={() => toggleRun(run)}
            />
            {expandedRunId === run.id && run.status === 'failed' && (
              <div className="ml-4 mr-1">
                <FailureDetail run={run} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResultsTab;
