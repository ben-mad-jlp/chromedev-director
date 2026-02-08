import { AlertCircle, Loader2 } from 'lucide-react';

export type RunButtonState = 'idle' | 'running' | 'busy' | 'chrome-offline';

interface RunButtonProps {
  state: RunButtonState;
  onClick?: () => void;
}

/**
 * RunButton component with 4 states:
 * - idle: "Run" button, enabled, clickable
 * - running: "Running..." with spinner, disabled
 * - busy: "Run queued" with spinner, disabled (another test is running)
 * - chrome-offline: "Chrome offline" with warning icon, disabled
 */
export function RunButton({ state, onClick }: RunButtonProps) {
  const isDisabled = state !== 'idle';

  const renderContent = () => {
    switch (state) {
      case 'idle':
        return <span>Run</span>;

      case 'running':
        return (
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Running...</span>
          </div>
        );

      case 'busy':
        return (
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Run queued</span>
          </div>
        );

      case 'chrome-offline':
        return (
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>Chrome offline</span>
          </div>
        );

      default:
        const _exhaustive: never = state;
        return _exhaustive;
    }
  };

  const getButtonStyles = () => {
    switch (state) {
      case 'idle':
        return 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer';

      case 'running':
        return 'bg-blue-500 text-white cursor-not-allowed opacity-75';

      case 'busy':
        return 'bg-gray-400 text-gray-200 cursor-not-allowed opacity-75';

      case 'chrome-offline':
        return 'bg-red-100 text-red-800 border-red-300 cursor-not-allowed opacity-75';

      default:
        const _exhaustive: never = state;
        return _exhaustive;
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`
        px-4 py-2 rounded-md font-medium text-sm transition-colors
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
        ${getButtonStyles()}
      `}
      title={state === 'chrome-offline' ? 'Chrome is not connected' : undefined}
    >
      {renderContent()}
    </button>
  );
}
