import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Filter, Search } from 'lucide-react';
import type { StepTrace } from '@/lib/types';
import * as api from '@/lib/api';
import TraceStepCard from './TraceStepCard';

export interface TraceTabProps {
  testId: string;
  runId?: string; // If not provided, shows latest run
}

/**
 * TraceTab - Display detailed step-by-step execution traces
 *
 * Features:
 * - Fetches step_traces from API via getResult()
 * - Displays vertical timeline grouped by section (before/steps/after)
 * - Status filter: all, passed, failed, skipped
 * - Search by label/step type
 * - Expandable step cards showing full details
 * - Auto-expands failed steps
 */
export const TraceTab: React.FC<TraceTabProps> = ({ testId, runId }) => {
  const [traces, setTraces] = useState<StepTrace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed' | 'skipped'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadTraces();
  }, [testId, runId]);

  const loadTraces = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get latest run if runId not provided
      let actualRunId = runId;
      if (!actualRunId) {
        const runs = await api.listResults(testId);
        if (runs.length === 0) {
          setError('No test runs found');
          setIsLoading(false);
          return;
        }
        actualRunId = runs[0].id;
      }

      // Fetch run with step_traces section
      const run = await api.getResult(testId, actualRunId, ['step_traces']);

      const stepTraces = run.result.step_traces || [];
      setTraces(stepTraces);

      // Auto-expand failed steps
      const failedIndices = stepTraces
        .filter((t) => t.status === 'failed')
        .map((t) => t.step_index);
      setExpandedSteps(new Set(failedIndices));
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleStep = (stepIndex: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepIndex)) {
        next.delete(stepIndex);
      } else {
        next.add(stepIndex);
      }
      return next;
    });
  };

  // Filter traces
  const filteredTraces = traces.filter((trace) => {
    if (statusFilter !== 'all' && trace.status !== statusFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesLabel = trace.label?.toLowerCase().includes(query);
      const matchesType = trace.step_type.toLowerCase().includes(query);
      if (!matchesLabel && !matchesType) return false;
    }
    return true;
  });

  // Group by section
  const beforeTraces = filteredTraces.filter((t) => t.section === 'before');
  const stepTraces = filteredTraces.filter((t) => t.section === 'steps');
  const afterTraces = filteredTraces.filter((t) => t.section === 'after');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600">
        <AlertCircle className="h-5 w-5 mr-2" />
        {error}
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No trace data available for this run
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-lg">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-sm rounded-md border border-gray-300 bg-white px-2 py-1"
          >
            <option value="all">All Status</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>

        <div className="flex-1 flex items-center gap-2">
          <Search className="h-4 w-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search steps..."
            className="flex-1 text-sm rounded-md border border-gray-300 bg-white px-2 py-1"
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-6">
        {/* Before section */}
        {beforeTraces.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
              Before Hooks
            </h3>
            <div className="space-y-2">
              {beforeTraces.map((trace) => (
                <TraceStepCard
                  key={trace.step_index}
                  trace={trace}
                  isExpanded={expandedSteps.has(trace.step_index)}
                  onToggle={() => toggleStep(trace.step_index)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Main steps section */}
        {stepTraces.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
              Test Steps
            </h3>
            <div className="space-y-2">
              {stepTraces.map((trace) => (
                <TraceStepCard
                  key={trace.step_index}
                  trace={trace}
                  isExpanded={expandedSteps.has(trace.step_index)}
                  onToggle={() => toggleStep(trace.step_index)}
                />
              ))}
            </div>
          </div>
        )}

        {/* After section */}
        {afterTraces.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
              After Hooks
            </h3>
            <div className="space-y-2">
              {afterTraces.map((trace) => (
                <TraceStepCard
                  key={trace.step_index}
                  trace={trace}
                  isExpanded={expandedSteps.has(trace.step_index)}
                  onToggle={() => toggleStep(trace.step_index)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TraceTab;
