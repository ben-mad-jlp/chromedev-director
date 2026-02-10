import type { TestDef, StepDef } from './types.js';
import { checkRemoveStepSafety } from './dependency-analyzer.js';

/**
 * Represents a proposed edit to a test
 */
export interface EditChange {
  action: 'add' | 'remove' | 'update' | 'move';
  section: 'before' | 'steps' | 'after';
  index?: number;
  step?: StepDef;
  to_index?: number; // For move operations
}

/**
 * Result of validation
 */
export interface ValidationResult {
  valid: boolean;
  message?: string;
  severity?: 'error' | 'warning';
}

/**
 * A validation rule that checks if an edit is valid
 */
export interface ValidationRule {
  name: string;
  check: (test: TestDef, change: EditChange) => ValidationResult;
}

/**
 * Pre-defined validation rules
 */
export const defaultRules: ValidationRule[] = [
  {
    name: 'mock_network_placement',
    check: (test, change) => {
      if (change.action === 'add' && change.step && 'mock_network' in change.step) {
        if (change.section !== 'before') {
          return {
            valid: false,
            severity: 'error',
            message: 'mock_network steps should be in the "before" section for setup. ' +
                    'Network mocking must be configured before navigation.'
          };
        }
      }
      return { valid: true };
    }
  },

  {
    name: 'variable_dependency_check',
    check: (test, change) => {
      if (change.action === 'remove' && change.index != null) {
        // Create a minimal SavedTest object for the check
        const savedTest = {
          id: 'temp',
          name: 'temp',
          description: '',
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          definition: test
        };
        const safety = checkRemoveStepSafety(savedTest, change.section, change.index);
        if (!safety.safe) {
          return {
            valid: false,
            severity: 'error',
            message: `Cannot remove step: ${safety.reason}`
          };
        }
      }
      return { valid: true };
    }
  },

  {
    name: 'duplicate_step_warning',
    check: (test, change) => {
      if (change.action === 'add' && change.step) {
        const sections = {
          before: test.before ?? [],
          steps: test.steps,
          after: test.after ?? []
        };

        const existingSteps = sections[change.section];
        const stepJson = JSON.stringify(change.step);

        const isDuplicate = existingSteps.some(s =>
          JSON.stringify(s) === stepJson
        );

        if (isDuplicate) {
          return {
            valid: true, // Warning, not error
            severity: 'warning',
            message: 'Warning: This step appears to be identical to an existing step. ' +
                    'Consider if this is intentional or if you meant to replace the existing step.'
          };
        }
      }
      return { valid: true };
    }
  },

  {
    name: 'index_bounds_check',
    check: (test, change) => {
      if (change.index != null) {
        const sections = {
          before: test.before ?? [],
          steps: test.steps,
          after: test.after ?? []
        };

        const sectionLength = sections[change.section].length;

        if (change.action === 'add') {
          // Allow index === length (append)
          if (change.index < 0 || change.index > sectionLength) {
            return {
              valid: false,
              severity: 'error',
              message: `Invalid index ${change.index}. Section "${change.section}" has ${sectionLength} steps. ` +
                      `Valid range is 0-${sectionLength}.`
            };
          }
        } else if (change.action === 'remove' || change.action === 'update') {
          if (change.index < 0 || change.index >= sectionLength) {
            return {
              valid: false,
              severity: 'error',
              message: `Invalid index ${change.index}. Section "${change.section}" has ${sectionLength} steps. ` +
                      `Valid range is 0-${sectionLength - 1}.`
            };
          }
        }
      }
      return { valid: true };
    }
  },

  {
    name: 'move_bounds_check',
    check: (test, change) => {
      if (change.action === 'move' && change.to_index != null && change.index != null) {
        const sections = {
          before: test.before ?? [],
          steps: test.steps,
          after: test.after ?? []
        };

        const sectionLength = sections[change.section].length;

        if (change.index < 0 || change.index >= sectionLength) {
          return {
            valid: false,
            severity: 'error',
            message: `Invalid source index ${change.index}. Section "${change.section}" has ${sectionLength} steps.`
          };
        }

        if (change.to_index < 0 || change.to_index >= sectionLength) {
          return {
            valid: false,
            severity: 'error',
            message: `Invalid target index ${change.to_index}. Section "${change.section}" has ${sectionLength} steps.`
          };
        }
      }
      return { valid: true };
    }
  },

  {
    name: 'conditional_step_structure',
    check: (test, change) => {
      if (change.action === 'add' && change.step && 'if' in change.step) {
        const step = change.step as any;

        // Check if the conditional step has at least one action
        const hasAction = Object.keys(step).some(key =>
          key !== 'if' && key !== 'as' && key !== 'comment'
        );

        if (!hasAction) {
          return {
            valid: false,
            severity: 'error',
            message: 'Conditional step (with "if") must have at least one action to perform. ' +
                    'Example: { "if": "$vars.x > 5", "click": "button" }'
          };
        }
      }
      return { valid: true };
    }
  },

  {
    name: 'loop_structure_check',
    check: (test, change) => {
      if (change.action === 'add' && change.step && 'loop' in change.step) {
        const step = change.step as any;

        if (!step.loop.steps || step.loop.steps.length === 0) {
          return {
            valid: false,
            severity: 'error',
            message: 'Loop step must have a non-empty "steps" array in the loop configuration.'
          };
        }

        // Check that loop has either over, while, or max
        if (!step.loop.over && !step.loop.while && !step.loop.max) {
          return {
            valid: false,
            severity: 'error',
            message: 'Loop step must specify either "over" (array expression), "while" (condition), or "max" (number).'
          };
        }
      }
      return { valid: true };
    }
  }
];

/**
 * Validate a proposed edit against all rules
 */
export function validateEdit(
  test: TestDef,
  change: EditChange,
  rules: ValidationRule[] = defaultRules
): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const rule of rules) {
    const result = rule.check(test, change);
    if (!result.valid || result.severity === 'warning') {
      results.push({
        ...result,
        message: `[${rule.name}] ${result.message}`
      });
    }
  }

  return results;
}

/**
 * Check if validation results contain any errors
 */
export function hasErrors(results: ValidationResult[]): boolean {
  return results.some(r => !r.valid || r.severity === 'error');
}

/**
 * Format validation results as a human-readable string
 */
export function formatValidationResults(results: ValidationResult[]): string {
  if (results.length === 0) {
    return 'All validation checks passed.';
  }

  const errors = results.filter(r => !r.valid || r.severity === 'error');
  const warnings = results.filter(r => r.valid && r.severity === 'warning');

  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push('❌ ERRORS:');
    for (const error of errors) {
      lines.push(`  - ${error.message}`);
    }
  }

  if (warnings.length > 0) {
    if (errors.length > 0) lines.push('');
    lines.push('⚠️  WARNINGS:');
    for (const warning of warnings) {
      lines.push(`  - ${warning.message}`);
    }
  }

  return lines.join('\n');
}
