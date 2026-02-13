import type { SavedTest, StepDef } from './types.js';

/**
 * Information about where a variable is set and used
 */
export interface VariableDependency {
  /** The step that sets this variable */
  set_by: StepLocation | null;
  /** All steps that use this variable */
  used_by: StepLocation[];
}

/**
 * Location of a step within a test
 */
export interface StepLocation {
  section: 'before' | 'steps' | 'after';
  index: number;
  step_label: string;
  /** Position within loop body (0-based), undefined for non-nested steps */
  nested_index?: number;
}

/**
 * Result of dependency analysis
 */
export interface DependencyAnalysis {
  /** Map of variable name to dependency info */
  variables: Record<string, VariableDependency>;
  /** Variables that are used but never set */
  undefined_variables: string[];
  /** Variables that are set but never used */
  unused_variables: string[];
}

/**
 * Get a human-readable label for a step
 */
function getStepLabel(step: StepDef): string {
  // Use comment if available
  if ('comment' in step && step.comment) {
    return step.comment;
  }

  // Otherwise, generate label from step type
  if ('eval' in step) return `Evaluate: ${step.eval.substring(0, 30)}...`;
  if ('fill' in step) return `Fill ${step.fill.selector}`;
  if ('click' in step) return `Click ${step.click.selector}`;
  if ('assert' in step) return `Assert: ${step.assert.substring(0, 30)}...`;
  if ('wait_for' in step) return `Wait for ${step.wait_for.selector}`;
  if ('wait' in step) return `Wait ${step.wait}ms`;
  if ('console_check' in step) return 'Console check';
  if ('network_check' in step) return 'Network check';
  if ('mock_network' in step) return `Mock ${step.mock_network.match}`;
  if ('run_test' in step) return `Run test: ${step.run_test}`;
  if ('loop' in step) return 'Loop';
  if ('if' in step) return `If ${step.if}`;
  if ('screenshot' in step) return 'Take screenshot';
  if ('press_key' in step) return `Press key: ${step.press_key.key}`;
  if ('hover' in step) return `Hover ${step.hover.selector}`;
  if ('scroll_to' in step) return `Scroll to ${step.scroll_to.selector}`;
  if ('select' in step) return `Select ${step.select.value}`;
  if ('switch_frame' in step) return 'Switch frame';
  if ('handle_dialog' in step) return `Handle dialog: ${step.handle_dialog.action}`;
  return 'Step';
}

/**
 * Extract all $vars references from a step
 */
function extractVarReferences(step: StepDef): string[] {
  const stepJson = JSON.stringify(step);
  const matches = stepJson.matchAll(/\$vars\.(\w+)/g);
  return Array.from(matches, m => m[1]);
}

/**
 * Process nested steps within a loop body, tracking each with its own nested_index
 */
function processNestedSteps(
  nestedSteps: StepDef[],
  parentLocation: StepLocation,
  variables: Record<string, VariableDependency>,
  usedVars: Set<string>,
  setVars: Set<string>
): void {
  for (let i = 0; i < nestedSteps.length; i++) {
    const nestedStep = nestedSteps[i];
    const nestedLabel = getStepLabel(nestedStep);
    const nestedLocation: StepLocation = {
      section: parentLocation.section,
      index: parentLocation.index,
      nested_index: i,
      step_label: `Loop step ${i}: ${nestedLabel}`
    };

    // Check variable references
    const nestedRefs = extractVarReferences(nestedStep);
    for (const varName of nestedRefs) {
      usedVars.add(varName);
      if (!variables[varName]) {
        variables[varName] = { set_by: null, used_by: [] };
      }
      variables[varName].used_by.push(nestedLocation);
    }

    // Check if nested step sets a variable
    if ('as' in nestedStep && nestedStep.as) {
      const varName = nestedStep.as;
      setVars.add(varName);
      if (!variables[varName]) {
        variables[varName] = { set_by: null, used_by: [] };
      }
      if (!variables[varName].set_by) {
        variables[varName].set_by = nestedLocation;
      }
    }

    // Recurse into nested loops (loop within loop)
    if ('loop' in nestedStep && nestedStep.loop.steps) {
      processNestedSteps(nestedStep.loop.steps, nestedLocation, variables, usedVars, setVars);
    }
  }
}

/**
 * Analyze variable dependencies in a test.
 * Finds which steps produce and consume variables.
 */
export function analyzeVariableDependencies(test: SavedTest): DependencyAnalysis {
  const variables: Record<string, VariableDependency> = {};
  const usedVars = new Set<string>();
  const setVars = new Set<string>();

  // Process a section of steps
  const processSection = (steps: StepDef[], sectionName: 'before' | 'steps' | 'after') => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const location: StepLocation = {
        section: sectionName,
        index: i,
        step_label: getStepLabel(step)
      };

      // Check if this step sets a variable
      if ('as' in step && step.as) {
        const varName = step.as;
        setVars.add(varName);

        if (!variables[varName]) {
          variables[varName] = {
            set_by: null,
            used_by: []
          };
        }

        // Record where this variable is set
        variables[varName].set_by = location;
      }

      // Check if this step uses variables
      const referencedVars = extractVarReferences(step);
      for (const varName of referencedVars) {
        usedVars.add(varName);

        if (!variables[varName]) {
          variables[varName] = {
            set_by: null,
            used_by: []
          };
        }

        // Record where this variable is used
        variables[varName].used_by.push(location);
      }

      // Handle nested structures (loop)
      if ('loop' in step && step.loop.steps) {
        processNestedSteps(step.loop.steps, location, variables, usedVars, setVars);
      }
    }
  };

  // Process all sections
  if (test.definition.before) {
    processSection(test.definition.before, 'before');
  }
  processSection(test.definition.steps, 'steps');
  if (test.definition.after) {
    processSection(test.definition.after, 'after');
  }

  // Find undefined variables (used but never set)
  const undefined_variables = Array.from(usedVars).filter(v => !setVars.has(v));

  // Find unused variables (set but never used)
  const unused_variables = Array.from(setVars).filter(v => !usedVars.has(v));

  return {
    variables,
    undefined_variables,
    unused_variables
  };
}

/**
 * Check if removing a step would break variable dependencies
 */
export function checkRemoveStepSafety(
  test: SavedTest,
  section: 'before' | 'steps' | 'after',
  index: number
): { safe: boolean; reason?: string } {
  const sections = {
    before: test.definition.before ?? [],
    steps: test.definition.steps,
    after: test.definition.after ?? []
  };

  const step = sections[section][index];
  if (!step) {
    return { safe: false, reason: 'Step not found' };
  }

  // Check if this step sets a variable
  if ('as' in step && step.as) {
    const varName = step.as;

    // Check if this variable is used anywhere
    const allSteps = [
      ...(test.definition.before ?? []),
      ...test.definition.steps,
      ...(test.definition.after ?? [])
    ];

    const isUsed = allSteps.some((s) => {
      // Don't count the step being removed
      if (s === step) return false;

      const stepJson = JSON.stringify(s);
      return stepJson.includes(`$vars.${varName}`);
    });

    if (isUsed) {
      return {
        safe: false,
        reason: `Step sets $vars.${varName} which is used by other steps`
      };
    }
  }

  return { safe: true };
}
