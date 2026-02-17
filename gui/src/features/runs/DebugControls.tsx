import React from 'react';
import { SkipForward, Play, Square } from 'lucide-react';
import { useRunStore } from '@/stores/run-store';
import { sendDebugStep, sendDebugContinue, sendDebugStop } from '@/lib/ws';

/**
 * DebugControls toolbar — shown when test is paused in debug mode.
 * Provides Step, Continue, and Stop buttons that send commands via WebSocket.
 */
export const DebugControls: React.FC = () => {
  const { isPaused, pausedAtStep, currentRunId } = useRunStore((state) => ({
    isPaused: state.isPaused,
    pausedAtStep: state.pausedAtStep,
    currentRunId: state.currentRunId,
  }));

  if (!isPaused || currentRunId == null) return null;

  const stepLabel = pausedAtStep != null ? `Paused before step ${pausedAtStep + 1}` : 'Paused';

  return (
    <div className="flex items-center gap-3 px-6 py-3 bg-amber-50 border-b border-amber-200">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span className="text-sm font-medium text-amber-800">{stepLabel}</span>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={() => sendDebugStep(currentRunId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          title="Execute one step, then pause again"
        >
          <SkipForward className="w-4 h-4" />
          Step
        </button>
        <button
          onClick={() => sendDebugContinue(currentRunId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
          title="Run all remaining steps"
        >
          <Play className="w-4 h-4" />
          Continue
        </button>
        <button
          onClick={() => sendDebugStop(currentRunId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
          title="Stop the test"
        >
          <Square className="w-4 h-4" />
          Stop
        </button>
      </div>
    </div>
  );
};

export default DebugControls;
