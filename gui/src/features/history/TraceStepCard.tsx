import React from 'react';
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { StepTrace } from '@/lib/types';

export interface TraceStepCardProps {
  trace: StepTrace;
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * TraceStepCard - Individual step trace card with details
 *
 * Compact view: status icon, step type, label, duration
 * Expanded view: error, result, DOM snapshot, console messages, network requests
 *
 * Features:
 * - Color-coded status indicators
 * - Copy buttons for DOM/screenshot
 * - Formatted timing info
 * - Truncated DOM preview with "Show More" button
 */
export const TraceStepCard: React.FC<TraceStepCardProps> = ({ trace, isExpanded, onToggle }) => {
  const getStatusIcon = () => {
    switch (trace.status) {
      case 'passed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'skipped':
        return <MinusCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBgColor = () => {
    switch (trace.status) {
      case 'passed':
        return 'bg-green-50 border-green-200';
      case 'failed':
        return 'bg-red-50 border-red-200';
      case 'skipped':
        return 'bg-gray-50 border-gray-200';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className={`border rounded-lg ${getStatusBgColor()}`}>
      {/* Header - Always visible */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {getStatusIcon()}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs font-mono text-gray-500">#{trace.step_index}</span>
            <span className="font-medium text-sm truncate">
              {trace.label || trace.step_type}
            </span>
            <span className="text-xs text-gray-500 font-mono">{trace.step_type}</span>
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {trace.duration_ms}ms
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-200 pt-3">
          {/* Error */}
          {trace.error && (
            <div>
              <h4 className="text-xs font-semibold text-red-700 mb-1">Error</h4>
              <pre className="text-xs bg-white p-2 rounded border border-red-200 overflow-x-auto">
                {trace.error}
              </pre>
            </div>
          )}

          {/* Result */}
          {trace.result !== undefined && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">Result</h4>
              <pre className="text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto">
                {JSON.stringify(trace.result, null, 2)}
              </pre>
            </div>
          )}

          {/* DOM Snapshot */}
          {trace.dom_snapshot && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-semibold text-gray-700">DOM Snapshot</h4>
                <button
                  onClick={() => copyToClipboard(trace.dom_snapshot!)}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
              <pre className="text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto max-h-40">
                {trace.dom_snapshot}
              </pre>
            </div>
          )}

          {/* Screenshot */}
          {trace.screenshot && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">Screenshot</h4>
              <img
                src={`data:image/png;base64,${trace.screenshot}`}
                alt="Step screenshot"
                className="max-w-full rounded border border-gray-200"
              />
            </div>
          )}

          {/* Console Messages */}
          {trace.console_messages && trace.console_messages.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">
                Console ({trace.console_messages.length})
              </h4>
              <div className="space-y-1">
                {trace.console_messages.map((msg, i) => (
                  <div key={i} className="text-xs bg-white p-2 rounded border border-gray-200">
                    <span className={`font-semibold ${
                      msg.type === 'error' ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      [{msg.type}]
                    </span>{' '}
                    {msg.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Network Requests */}
          {trace.network_requests && trace.network_requests.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">
                Network ({trace.network_requests.length})
              </h4>
              <div className="space-y-1">
                {trace.network_requests.map((req, i) => (
                  <div key={i} className="text-xs bg-white p-2 rounded border border-gray-200">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${
                        req.status >= 400 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {req.status}
                      </span>
                      <span className="text-gray-600">{req.method}</span>
                      <span className="truncate">{req.url}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TraceStepCard;
