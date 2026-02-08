import React from 'react';
import { Card } from '@/components/ui/card';
import StepCard from './StepCard';
import NestedTestBlock from './NestedTestBlock';
import type { SavedTest, StepDef } from '@/lib/types';

export interface StepsTabProps {
  test: SavedTest;
  stepStatuses?: Record<string, 'pending' | 'running' | 'passed' | 'failed'>;
}

/**
 * Get a unique key for a step to match against stepStatuses
 * Uses the step index as the key
 */
function getStepKey(index: number): string {
  return `${index}`;
}

/**
 * StepsTab component
 *
 * Displays the test steps in a scrollable area.
 * Maps regular steps to StepCard components and run_test steps to NestedTestBlock.
 * Supports optional status overlays for live execution progress.
 *
 * Features:
 * - Maps test.definition.steps to appropriate components
 * - Shows status overlays when stepStatuses are provided
 * - Handles empty step lists gracefully
 * - Scrollable area for long step lists
 * - Optional "before" hooks section (collapsible, muted)
 * - Proper spacing and indentation
 */
export const StepsTab: React.FC<StepsTabProps> = ({
  test,
  stepStatuses,
}) => {
  const { steps, before } = test.definition;
  const hasBeforeHooks = before && before.length > 0;

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Before hooks section */}
        {hasBeforeHooks && (
          <details className="group">
            <summary className="cursor-pointer py-2 px-3 rounded hover:bg-muted transition-colors">
              <span className="text-sm text-muted-foreground font-medium">
                Before Hooks ({before.length} step{before.length !== 1 ? 's' : ''})
              </span>
            </summary>
            <div className="mt-3 ml-4 space-y-3 pb-4 border-l-2 border-muted pl-4">
              {before.map((beforeStep, idx) => (
                <div key={idx}>
                  {beforeStep && 'run_test' in beforeStep ? (
                    <NestedTestBlock
                      step={beforeStep as StepDef & { run_test: string }}
                      depth={0}
                      index={idx}
                    />
                  ) : (
                    <StepCard
                      step={beforeStep}
                      index={idx}
                      status={stepStatuses?.[getStepKey(idx)]}
                    />
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Main steps section */}
        {steps.length === 0 ? (
          <Card className="p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No steps defined yet.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div key={idx}>
                {step && 'run_test' in step ? (
                  <NestedTestBlock
                    step={step as StepDef & { run_test: string }}
                    depth={0}
                    index={idx}
                  />
                ) : (
                  <StepCard
                    step={step}
                    index={idx}
                    status={stepStatuses?.[getStepKey(idx)]}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StepsTab;
