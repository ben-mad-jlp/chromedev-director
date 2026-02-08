import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LogEntry } from './LogEntry';
import LogEntryComponent from './LogEntry';

interface LogPanelProps {
  logs: LogEntry[];
  isRunning: boolean;
  onClear?: () => void;
}

/**
 * LogPanel component — collapsible panel displaying log entries from test runs
 *
 * Features:
 * - Collapsible/expandable header with chevron icon
 * - Drag-to-resize handle between header and content
 * - Defaults to expanded during runs, collapsed when idle
 * - Auto-scroll to bottom when new logs arrive
 * - Pauses auto-scroll if user scrolls up manually
 * - Shows log count in header
 * - Renders LogEntry components for each log entry
 * - Optional clear button to clear all logs
 */
export function LogPanel({ logs, isRunning, onClear }: LogPanelProps) {
  // Track if panel is expanded (auto-expand on run start)
  const [isExpanded, setIsExpanded] = useState(false);

  // Track if user has manually scrolled up (pauses auto-scroll)
  const [autoScroll, setAutoScroll] = useState(true);

  // Resizable panel height (default 256px = max-h-64)
  const [panelHeight, setPanelHeight] = useState(256);

  // Reference to the scrollable container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Refs for drag state to avoid stale closures
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Auto-expand when a run starts
  useEffect(() => {
    if (isRunning) {
      setIsExpanded(true);
      setAutoScroll(true);
    }
  }, [isRunning]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        const container = scrollContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      }, 0);
    }
  }, [logs, autoScroll]);

  // Handle manual scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 50;

    // Resume auto-scroll if user scrolls back near bottom
    if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    }
    // Pause auto-scroll if user scrolls up
    else if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  };

  // Drag-to-resize handlers
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const delta = startYRef.current - e.clientY;
    const newHeight = Math.min(600, Math.max(100, startHeightRef.current + delta));
    setPanelHeight(newHeight);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleMouseMove]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight, handleMouseMove, handleMouseUp]);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div className="border-t border-gray-200 bg-white">
      {/* Drag handle */}
      {isExpanded && (
        <div
          onMouseDown={handleDragStart}
          className="h-1 bg-gray-200 hover:bg-blue-400 cursor-row-resize transition-colors"
        />
      )}

      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronDown
            className={`w-5 h-5 transition-transform ${
              isExpanded ? 'rotate-0' : '-rotate-90'
            }`}
          />
          <h3 className="text-sm font-semibold text-gray-900">
            Console & Network
          </h3>
          <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
            {logs.length}
          </span>
        </div>
        {isExpanded && onClear && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 hover:bg-gray-200 rounded"
          >
            Clear
          </button>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="overflow-y-auto bg-gray-50 border-t border-gray-200"
          style={{ height: panelHeight }}
        >
          {logs.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No logs yet. Run a test to see output here.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {logs.map((log, index) => (
                <LogEntryComponent key={index} entry={log} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LogPanel;
