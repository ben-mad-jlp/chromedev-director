import { create } from 'zustand';

/**
 * Step status in the run store
 */
export type StepStatus = 'pending' | 'running' | 'passed' | 'failed';

/**
 * Log entry types
 */
export type LogEntry =
  | {
      type: 'console';
      level: 'log' | 'debug' | 'info' | 'warn' | 'warning' | 'error';
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

/**
 * WebSocket message types received from the server
 */
export type WsMessage =
  | {
      type: 'run:start';
      testId: string;
      runId: string;
    }
  | {
      type: 'run:step';
      testId: string;
      runId: string;
      stepIndex: number;
      stepLabel?: string;
      status: 'running' | 'passed' | 'failed';
      duration_ms?: number;
      error?: string;
    }
  | {
      type: 'run:complete';
      testId: string;
      runId: string;
      status: 'passed' | 'failed';
    }
  | {
      type: 'console';
      testId: string;
      runId: string;
      level: 'log' | 'debug' | 'info' | 'warn' | 'warning' | 'error';
      text: string;
    }
  | {
      type: 'network';
      testId: string;
      runId: string;
      method: string;
      url: string;
      status: number;
      duration_ms: number;
    }
  | { type: 'suite:start'; total: number }
  | { type: 'suite:test_start'; testId: string; testName: string; index: number }
  | { type: 'suite:test_complete'; testId: string; testName: string; index: number; status: 'passed' | 'failed' | 'skipped'; duration_ms: number; error?: string }
  | { type: 'suite:complete'; result: any };

/**
 * Run Store interface
 */
export interface RunStore {
  // State
  currentRunId: string | null;
  currentTestId: string | null;
  isRunning: boolean;
  logs: LogEntry[];
  stepStatuses: Record<string, StepStatus>;
  lastCompletedTestId: string | null;
  lastCompletedRunId: string | null;

  // Actions
  handleWsMessage: (message: WsMessage) => void;
  clearLogs: () => void;
  resetRun: () => void;
  clearLastCompleted: () => void;
}

/**
 * Create the run store with Zustand
 */
export const useRunStore = create<RunStore>((set, get) => ({
  // Initial state
  currentRunId: null,
  currentTestId: null,
  isRunning: false,
  logs: [],
  stepStatuses: {},
  lastCompletedTestId: null,
  lastCompletedRunId: null,

  /**
   * Handle incoming WebSocket messages and update store state accordingly
   */
  handleWsMessage: (message: WsMessage) => {
    const state = get();

    switch (message.type) {
      case 'run:start': {
        // Reset state and mark run as active
        set({
          currentRunId: message.runId,
          currentTestId: message.testId,
          isRunning: true,
          logs: [],
          stepStatuses: {},
          lastCompletedTestId: null,
          lastCompletedRunId: null,
        });
        break;
      }

      case 'run:step': {
        // Update step status
        const currentStatuses = { ...state.stepStatuses };
        const stepKey = String(message.stepIndex);

        // Update the step status map
        if (message.status === 'running') {
          currentStatuses[stepKey] = 'running';
        } else if (message.status === 'passed') {
          currentStatuses[stepKey] = 'passed';
        } else if (message.status === 'failed') {
          currentStatuses[stepKey] = 'failed';
        }

        // Add log entry for step event
        const newLogs = [...state.logs];
        newLogs.push({
          type: 'step',
          stepIndex: message.stepIndex,
          label: message.stepLabel || `Step ${message.stepIndex + 1}`,
          status: message.status,
          duration_ms: message.duration_ms,
          error: message.error,
          timestamp: Date.now(),
        });

        set({
          stepStatuses: currentStatuses,
          logs: newLogs,
        });
        break;
      }

      case 'run:complete': {
        // Mark run as complete and remember what finished
        set({
          isRunning: false,
          currentRunId: null,
          currentTestId: null,
          lastCompletedTestId: message.testId,
          lastCompletedRunId: message.runId,
        });
        break;
      }

      case 'console': {
        // Accumulate console log
        const newLogs = [...state.logs];
        newLogs.push({
          type: 'console',
          level: message.level,
          text: message.text,
          timestamp: Date.now(),
        });
        set({ logs: newLogs });
        break;
      }

      case 'network': {
        // Accumulate network log
        const newLogs = [...state.logs];
        newLogs.push({
          type: 'network',
          method: message.method,
          url: message.url,
          status: message.status,
          duration_ms: message.duration_ms,
          timestamp: Date.now(),
        });
        set({ logs: newLogs });
        break;
      }

      default: {
        // Handle suite events and other unknown message types gracefully
        if (message.type.startsWith('suite:')) {
          // Suite events are handled at the UI level if needed
          break;
        }
        console.warn('Unknown WebSocket message type:', message.type);
      }
    }
  },

  /**
   * Clear all accumulated logs
   */
  clearLogs: () => {
    set({ logs: [] });
  },

  /**
   * Reset the entire run state
   */
  resetRun: () => {
    set({
      currentRunId: null,
      currentTestId: null,
      isRunning: false,
      logs: [],
      stepStatuses: {},
      lastCompletedTestId: null,
      lastCompletedRunId: null,
    });
  },

  clearLastCompleted: () => {
    set({
      lastCompletedTestId: null,
      lastCompletedRunId: null,
    });
  },
}));
