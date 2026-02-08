import React, { useState, useEffect } from 'react';
import { ChevronDown, AlertCircle, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StepCard from './StepCard';
import type { StepDef, SavedTest } from '@/lib/types';

export interface NestedTestBlockProps {
  step: StepDef & { run_test: string };
  depth: number;
  index?: number;
}

const MAX_DEPTH = 3;

/**
 * Calculate staleness: returns true if test data is older than 5 minutes
 */
function isStale(updatedAt: string): boolean {
  const updateTime = new Date(updatedAt).getTime();
  const now = Date.now();
  const fiveMinutesMs = 5 * 60 * 1000;
  return now - updateTime > fiveMinutesMs;
}

/**
 * Format timestamp for display
 */
function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * NestedTestBlock component
 *
 * Displays a run_test step that references another test.
 * On expand, fetches the nested test and renders its steps recursively.
 *
 * Features:
 * - Expandable/collapsible display
 * - Fetches nested test on demand via GET /api/tests/{testId}
 * - Recursive rendering with depth limit (max 3 levels)
 * - Shows "max depth reached" message at depth 3
 * - Displays staleness badge if test data is older than 5 minutes
 * - Loading spinner while fetching
 * - Error handling with alert message
 * - Proper indentation to show nesting hierarchy
 */
export const NestedTestBlock: React.FC<NestedTestBlockProps> = ({
  step,
  depth,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [nestedTest, setNestedTest] = useState<SavedTest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stale = nestedTest != null && isStale(nestedTest.updatedAt);

  // Fetch nested test on expand
  useEffect(() => {
    if (!isExpanded || nestedTest != null || isLoading) {
      return;
    }

    const fetchNestedTest = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const testId = step.run_test;
        const response = await fetch(`/api/tests/${encodeURIComponent(testId)}`);

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? `Test "${testId}" not found`
              : `Failed to load test (HTTP ${response.status})`
          );
        }

        const data = await response.json() as { test: SavedTest };
        setNestedTest(data.test);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown error loading test';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNestedTest();
  }, [isExpanded, nestedTest, isLoading, step.run_test]);

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const atMaxDepth = depth >= MAX_DEPTH;
  const label = step.label || `Run ${step.run_test}`;

  return (
    <div style={{ marginLeft: `${depth * 16}px` }} className="mb-3">
      <Card
        className={`relative p-4 transition-all ${
          isExpanded ? 'border-2 border-blue-400 bg-blue-50' : ''
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Expand/collapse icon */}
          <button
            onClick={handleToggleExpand}
            disabled={isLoading}
            className={`flex-shrink-0 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            aria-label={isExpanded ? 'Collapse nested test' : 'Expand nested test'}
          >
            <ChevronDown className="w-5 h-5 text-gray-600" />
          </button>

          {/* Main content */}
          <div className="flex-grow min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Type badge */}
              <Badge variant="secondary" className="text-xs">
                nested test
              </Badge>

              {/* Label */}
              <span className="font-medium text-sm break-words">{label}</span>

              {/* Staleness badge */}
              {stale && (
                <Badge
                  variant="destructive"
                  className="text-xs font-semibold flex items-center gap-1"
                >
                  <AlertCircle className="w-3 h-3" />
                  stale ({formatTimeAgo(nestedTest!.updatedAt)})
                </Badge>
              )}

              {/* At-max-depth indicator */}
              {atMaxDepth && isExpanded && (
                <Badge variant="outline" className="text-xs">
                  max depth reached
                </Badge>
              )}
            </div>

            {/* Loading spinner */}
            {isLoading && (
              <div className="flex items-center gap-2 mt-2 text-sm text-blue-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading nested test steps...</span>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 mt-2 p-3 bg-red-100 border border-red-300 rounded">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-red-700">{error}</span>
              </div>
            )}

            {/* Nested steps (expanded, loaded, not at max depth) */}
            {isExpanded && nestedTest != null && !error && !atMaxDepth && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                {nestedTest.definition.steps.length === 0 ? (
                  <div className="text-sm text-gray-500 italic">
                    (nested test has no steps)
                  </div>
                ) : (
                  <div className="space-y-3">
                    {nestedTest.definition.steps.map((nestedStep, idx) => (
                      <div key={idx}>
                        {nestedStep && 'run_test' in nestedStep ? (
                          // Recursively render nested tests
                          <NestedTestBlock
                            step={nestedStep as StepDef & { run_test: string }}
                            depth={depth + 1}
                            index={idx}
                          />
                        ) : (
                          // Render regular steps
                          <StepCard step={nestedStep} index={idx} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Max depth message */}
            {isExpanded && atMaxDepth && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="text-sm text-gray-600 italic bg-yellow-50 p-3 rounded border border-yellow-200">
                  Maximum nesting depth ({MAX_DEPTH} levels) reached.
                  Nested test details are not displayed beyond this point.
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default NestedTestBlock;
