import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, Trash2, RefreshCw, Bug } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { RunButton, type RunButtonState } from '@/features/runs/RunButton';
import DebugControls from '@/features/runs/DebugControls';
import LogPanel from '@/features/runs/LogPanel';
import RunInputsDialog from '@/components/RunInputsDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import SessionSelector from '@/components/SessionSelector';
import StepsTab from './StepsTab';
import ResultsTab from '@/features/history/ResultsTab';
import TraceTab from '@/features/history/TraceTab';
import FlowDiagramTab from './FlowDiagramTab';
import type { SavedTest } from '@/lib/types';
import * as api from '@/lib/api';
import type { RunTestOptions } from '@/lib/api';
import { sendDebugRunTo } from '@/lib/ws';
import { useRunStore } from '@/stores/run-store';
import { useTestStore } from '@/stores/test-store';
import { useSessionStore } from '@/stores/session-store';
import { getChromeStatus } from '@/lib/api';

type TabId = 'steps' | 'results' | 'trace' | 'flow';

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
  const navigate = useNavigate();

  // Local state for fetching test
  const [test, setTest] = useState<SavedTest | null>(initialTest ?? null);
  const [isLoading, setIsLoading] = useState(!initialTest && !!testId);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('steps');

  // Run store state
  const { isRunning, isPaused, pausedAtStep, currentRunId, logs, stepStatuses, clearLogs, lastCompletedTestId, clearLastCompleted } = useRunStore((state) => ({
    isRunning: state.isRunning,
    isPaused: state.isPaused,
    pausedAtStep: state.pausedAtStep,
    currentRunId: state.currentRunId,
    logs: state.logs,
    stepStatuses: state.stepStatuses,
    clearLogs: state.clearLogs,
    lastCompletedTestId: state.lastCompletedTestId,
    clearLastCompleted: state.clearLastCompleted,
  }));

  // Test store actions
  const { updateTestRemote, deleteTestRemote } = useTestStore((state) => ({
    updateTestRemote: state.updateTestRemote,
    deleteTestRemote: state.deleteTestRemote,
  }));

  // Session store
  const { selectedSessionId } = useSessionStore((state) => ({
    selectedSessionId: state.selectedSessionId,
  }));

  // Chrome status for RunButton state
  const [chromeConnected, setChromeConnected] = useState(true);

  // Inputs dialog state
  const [showInputsDialog, setShowInputsDialog] = useState(false);

  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Inline editing state for name
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Inline editing state for description
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const descriptionInputRef = useRef<HTMLInputElement>(null);

  // Step delay state in seconds (persisted in localStorage)
  const [stepDelaySec, setStepDelaySec] = useState<number>(() => {
    const saved = localStorage.getItem('chromedev-step-delay-sec');
    return saved ? parseFloat(saved) || 0 : 0;
  });

  // Reusable fetch function — called on mount and by refresh button
  const fetchTest = async () => {
    if (!testId) {
      setError('No test ID provided');
      setIsLoading(false);
      return;
    }
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

  // Fetch test on mount or when testId changes
  useEffect(() => {
    if (initialTest) {
      setTest(initialTest);
      setIsLoading(false);
      setError(null);
      return;
    }

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
    if (isPaused) return 'paused';
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

  // Track whether the next inputs dialog submission should trigger debug mode
  const pendingDebugRef = useRef(false);

  // Handle debug button click — run with debug mode enabled
  const handleDebugTest = async () => {
    if (!test) return;

    if (test.definition.inputs && test.definition.inputs.length > 0) {
      // For debug, we still need inputs — show dialog then run with debug
      setShowInputsDialog(true);
      pendingDebugRef.current = true;
      return;
    }

    const delayMs = Math.round(stepDelaySec * 1000);
    await executeRun(undefined, { debug: true, stepDelay: delayMs });
  };

  // Execute the test run with optional input values and run options
  const executeRun = async (inputValues?: Record<string, unknown>, options?: RunTestOptions) => {
    if (!test) return;

    const delayMs = Math.round(stepDelaySec * 1000);
    const runOptions: RunTestOptions = { ...options };
    if (delayMs > 0 && !runOptions.stepDelay) {
      runOptions.stepDelay = delayMs;
    }

    try {
      await api.runTest(test.id, inputValues, selectedSessionId ?? undefined, runOptions);
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 409) {
        // Another run is active (likely a stuck debug session) — offer to force-stop
        const shouldStop = window.confirm(
          'Another test run is active (possibly a stuck debug session).\n\nForce stop it and retry?'
        );
        if (shouldStop) {
          try {
            await api.forceStopActiveRun();
            // Wait a moment for the run to finish cleaning up
            await new Promise(r => setTimeout(r, 500));
            // Retry the run
            await api.runTest(test.id, inputValues, selectedSessionId ?? undefined, runOptions);
          } catch (retryErr) {
            console.error('Failed to retry after force stop:', retryErr);
          }
        }
        return;
      }
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
    if (pendingDebugRef.current) {
      pendingDebugRef.current = false;
      const delayMs = Math.round(stepDelaySec * 1000);
      executeRun(values, { debug: true, stepDelay: delayMs });
    } else {
      executeRun(values);
    }
  };

  // --- Inline editing: Name ---
  const startEditingName = () => {
    if (!test) return;
    setNameValue(test.name);
    setEditingName(true);
    // Focus happens via useEffect below
  };

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const saveName = async () => {
    if (!test || !testId) return;
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === test.name) {
      setEditingName(false);
      return;
    }
    try {
      const updated = await updateTestRemote(testId, { name: trimmed });
      setTest(updated);
    } catch {
      // Revert on error — store already set the error
    }
    setEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveName();
    } else if (e.key === 'Escape') {
      setEditingName(false);
    }
  };

  // --- Inline editing: Description ---
  const startEditingDescription = () => {
    if (!test) return;
    setDescriptionValue(test.description ?? '');
    setEditingDescription(true);
  };

  useEffect(() => {
    if (editingDescription && descriptionInputRef.current) {
      descriptionInputRef.current.focus();
      descriptionInputRef.current.select();
    }
  }, [editingDescription]);

  const saveDescription = async () => {
    if (!test || !testId) return;
    const trimmed = descriptionValue.trim();
    if (trimmed === (test.description ?? '')) {
      setEditingDescription(false);
      return;
    }
    try {
      const updates = trimmed ? { description: trimmed } : { description: '' };
      const updated = await updateTestRemote(testId, updates);
      setTest(updated);
    } catch {
      // Revert on error
    }
    setEditingDescription(false);
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveDescription();
    } else if (e.key === 'Escape') {
      setEditingDescription(false);
    }
  };

  // --- Delete ---
  const handleDelete = async () => {
    if (!testId) return;
    try {
      await deleteTestRemote(testId);
      navigate('/');
    } catch {
      // Store already set the error
    }
    setShowDeleteDialog(false);
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
            {/* Editable name */}
            <div className="flex items-center gap-1">
              {editingName ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={handleNameKeyDown}
                  className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 outline-none flex-1"
                />
              ) : (
                <h1
                  className="text-2xl font-bold text-gray-900 cursor-pointer hover:text-blue-700 transition-colors"
                  onClick={startEditingName}
                  title="Click to rename"
                >
                  {test.name}
                </h1>
              )}
              <button
                onClick={fetchTest}
                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                title="Refresh test from disk"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Delete test"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-gray-500 font-mono">{test.id}</span>
              <span className="text-xs text-gray-500" title={new Date(test.updatedAt).toLocaleString()}>
                Updated {new Date(test.updatedAt).toLocaleString()}
              </span>
            </div>

            {/* Editable description */}
            {editingDescription ? (
              <input
                ref={descriptionInputRef}
                type="text"
                value={descriptionValue}
                onChange={(e) => setDescriptionValue(e.target.value)}
                onBlur={saveDescription}
                onKeyDown={handleDescriptionKeyDown}
                placeholder="Add description..."
                className="text-sm text-gray-600 mt-1 bg-transparent border-b-2 border-blue-500 outline-none w-full"
              />
            ) : (
              <p
                className="text-sm mt-1 cursor-pointer hover:text-blue-700 transition-colors"
                onClick={startEditingDescription}
                title="Click to edit description"
              >
                <span className={test.description ? 'text-gray-600' : 'text-gray-400 italic'}>
                  {test.description || 'Add description...'}
                </span>
              </p>
            )}

            <p className="text-sm text-gray-500 mt-2">
              <span className="font-mono">{test.definition.url}</span>
            </p>
          </div>

          {/* Controls: Session, delay, debug, run */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <SessionSelector className="w-64" disabled={isRunning} />

            {/* Step delay input */}
            <div className="flex items-center gap-1">
              <label htmlFor="step-delay" className="text-xs text-gray-500 whitespace-nowrap">
                Delay
              </label>
              <input
                id="step-delay"
                type="number"
                min={0}
                step={0.5}
                value={stepDelaySec}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setStepDelaySec(val);
                  localStorage.setItem('chromedev-step-delay-sec', String(val));
                }}
                disabled={isRunning}
                className="w-16 px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                title="Seconds to pause between steps"
              />
              <span className="text-xs text-gray-400">s</span>
            </div>
            <button
              onClick={handleDebugTest}
              disabled={isRunning || !chromeConnected}
              className={`px-3 py-2 rounded-md font-medium text-sm transition-colors inline-flex items-center gap-1.5 ${
                isRunning || !chromeConnected
                  ? 'bg-amber-100 text-amber-400 cursor-not-allowed opacity-75'
                  : 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer'
              }`}
              title="Run test in debug mode (pause before each step)"
            >
              <Bug className="w-4 h-4" />
              Debug
            </button>
            <RunButton
              state={getRunButtonState()}
              onClick={handleRunTest}
            />
          </div>
        </div>
      </div>

      {/* Debug controls bar — shown when paused */}
      <DebugControls />

      {/* Tabs */}
      <div className="flex-grow flex flex-col overflow-hidden">
        {/* Tab buttons */}
        <div className="border-b border-gray-200 bg-white">
          <div className="px-6 flex gap-8">
            {(['steps', 'results', 'trace', 'flow'] as TabId[]).map((tabId) => (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`py-3 px-1 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tabId
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                {tabId === 'flow' ? 'Flow Diagram' : tabId.charAt(0).toUpperCase() + tabId.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-grow overflow-hidden flex flex-col">
          {activeTab === 'steps' && (
            <StepsTab
              test={test}
              stepStatuses={stepStatuses}
              pausedAtStep={pausedAtStep}
              onRunTo={isPaused && currentRunId ? (stepIndex) => sendDebugRunTo(currentRunId, stepIndex) : undefined}
            />
          )}
          {activeTab === 'results' && (
            <ResultsTab testId={test.id} />
          )}
          {activeTab === 'trace' && (
            <TraceTab testId={test.id} />
          )}
          {activeTab === 'flow' && (
            <FlowDiagramTab testId={test.id} />
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

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete Test"
        message={`Delete "${test.name}"? This will remove the test and all its run history.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setShowDeleteDialog(false)}
      />
    </div>
  );
};

export default TestDetail;
