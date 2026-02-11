import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { RunButton, type RunButtonState } from '@/features/runs/RunButton';
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
  const { isRunning, logs, stepStatuses, clearLogs, lastCompletedTestId, clearLastCompleted } = useRunStore((state) => ({
    isRunning: state.isRunning,
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
      await api.runTest(test.id, inputValues, selectedSessionId ?? undefined);
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
            {editingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={saveName}
                onKeyDown={handleNameKeyDown}
                className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 outline-none w-full"
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

          {/* Session selector + Refresh + Delete + Run buttons */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <SessionSelector className="w-64" disabled={isRunning} />
            <button
              onClick={fetchTest}
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              title="Refresh test from disk"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              title="Delete test"
            >
              <Trash2 className="w-5 h-5" />
            </button>
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
            <StepsTab test={test} stepStatuses={stepStatuses} />
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
