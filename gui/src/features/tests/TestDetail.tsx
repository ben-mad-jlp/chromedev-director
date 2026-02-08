import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { RunButton, type RunButtonState } from '@/features/runs/RunButton';
import LogPanel from '@/features/runs/LogPanel';
import RunInputsDialog from '@/components/RunInputsDialog';
import StepsTab from './StepsTab';
import ResultsTab from '@/features/history/ResultsTab';
import type { SavedTest } from '@/lib/types';
import * as api from '@/lib/api';
import { useRunStore } from '@/stores/run-store';
import { getChromeStatus } from '@/lib/api';

type TabId = 'steps' | 'results';

export interface TestDetailProps {
  // Component can accept test directly if needed (for composition)
  test?: SavedTest;
}

/**
 * TestDetail component
 *
 * Displays a single test's details with:
 * - Header with test name, URL, and Run button
 * - Tabs for Steps and Results (combined history + run detail)
 * - LogPanel showing console/network output and step progress
 *
 * Features:
 * - Fetches test by ID from URL params
 * - Displays loading and error states
 * - Wires RunButton to api.runTest()
 * - Wires LogPanel with logs and isRunning from run-store
 * - Passes stepStatuses to StepsTab for live status overlays
 * - Handles Chrome offline state in RunButton
 * - Auto-switches to Results tab on run completion
 */
export const TestDetail: React.FC<TestDetailProps> = ({ test: initialTest }) => {
  // Route params
  const { testId } = useParams<{ testId: string }>();

  // Local state for fetching test
  const [test, setTest] = useState<SavedTest | null>(initialTest ?? null);
  const [isLoading, setIsLoading] = useState(!initialTest && !!testId);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('steps');

  // Run store state
  const { isRunning, logs, stepStatuses, clearLogs, lastCompletedTestId, clearLastCompleted } = useRunStore((state) => ({
    isRunning: state.isRunning,
    logs: state.logs,
    stepStatuses: state.stepStatuses,
    clearLogs: state.clearLogs,
    lastCompletedTestId: state.lastCompletedTestId,
    clearLastCompleted: state.clearLastCompleted,
  }));

  // Chrome status for RunButton state
  const [chromeConnected, setChromeConnected] = useState(true);

  // Inputs dialog state
  const [showInputsDialog, setShowInputsDialog] = useState(false);

  // Fetch test on mount or when testId changes
  useEffect(() => {
    if (initialTest) {
      // Use provided test
      setTest(initialTest);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (!testId) {
      setError('No test ID provided');
      setIsLoading(false);
      return;
    }

    const fetchTest = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetchedTest = await api.getTest(testId);
        setTest(fetchedTest);
      } catch (err) {
        const message =
          err instanceof api.ApiError
            ? err.status === 404
              ? `Test "${testId}" not found`
              : `Failed to load test (HTTP ${err.status})`
            : err instanceof Error
              ? err.message
              : 'Unknown error loading test';
        setError(message);
        setTest(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTest();
  }, [testId, initialTest]);

  // Auto-switch to Results tab when a run completes for this test
  useEffect(() => {
    if (!lastCompletedTestId || !testId) return;
    if (lastCompletedTestId !== testId) return;

    setActiveTab('results');
    clearLastCompleted();
  }, [lastCompletedTestId, testId, clearLastCompleted]);

  // Check Chrome status periodically
  useEffect(() => {
    const checkChrome = async () => {
      try {
        const status = await getChromeStatus();
        setChromeConnected(status.connected);
      } catch {
        setChromeConnected(false);
      }
    };

    // Check immediately and then every 5 seconds
    checkChrome();
    const interval = setInterval(checkChrome, 5000);

    return () => clearInterval(interval);
  }, []);

  // Determine RunButton state
  const getRunButtonState = (): RunButtonState => {
    if (!chromeConnected) return 'chrome-offline';
    if (isRunning) return 'running';
    return 'idle';
  };

  // Handle run button click — show inputs dialog if test has inputs
  const handleRunTest = async () => {
    if (!test) return;

    if (test.definition.inputs && test.definition.inputs.length > 0) {
      setShowInputsDialog(true);
      return;
    }

    await executeRun();
  };

  // Execute the test run with optional input values
  const executeRun = async (inputValues?: Record<string, unknown>) => {
    if (!test) return;

    try {
      await api.runTest(test.id, inputValues);
    } catch (err) {
      const message =
        err instanceof api.ApiError
          ? `Failed to start test run: HTTP ${err.status}`
          : err instanceof Error
            ? err.message
            : 'Failed to start test run';
      console.error(message, err);
    }
  };

  // Handle inputs dialog submit
  const handleInputsSubmit = (values: Record<string, unknown>) => {
    setShowInputsDialog(false);
    executeRun(values);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">Loading test...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !test) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="p-6 max-w-sm">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-red-900">Error</h2>
              <p className="text-sm text-red-700 mt-1">{error || 'Test not found'}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header with test name, URL, and Run button */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-grow min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{test.name}</h1>
            {test.description && (
              <p className="text-sm text-gray-600 mt-1">{test.description}</p>
            )}
            <p className="text-sm text-gray-500 mt-2">
              <span className="font-mono">{test.definition.url}</span>
            </p>
          </div>

          {/* Run button */}
          <div className="flex-shrink-0">
            <RunButton
              state={getRunButtonState()}
              onClick={handleRunTest}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-grow flex flex-col overflow-hidden">
        {/* Tab buttons */}
        <div className="border-b border-gray-200 bg-white">
          <div className="px-6 flex gap-8">
            {(['steps', 'results'] as TabId[]).map((tabId) => (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`py-3 px-1 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tabId
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                {tabId.charAt(0).toUpperCase() + tabId.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-grow overflow-hidden flex flex-col">
          {activeTab === 'steps' && (
            <StepsTab test={test} stepStatuses={stepStatuses} />
          )}
          {activeTab === 'results' && (
            <ResultsTab testId={test.id} />
          )}
        </div>
      </div>

      {/* LogPanel below tabs */}
      <LogPanel
        logs={logs}
        isRunning={isRunning}
        onClear={clearLogs}
      />

      {/* Runtime inputs dialog */}
      {test.definition.inputs && test.definition.inputs.length > 0 && (
        <RunInputsDialog
          open={showInputsDialog}
          inputs={test.definition.inputs}
          onSubmit={handleInputsSubmit}
          onClose={() => setShowInputsDialog(false)}
        />
      )}
    </div>
  );
};

export default TestDetail;
