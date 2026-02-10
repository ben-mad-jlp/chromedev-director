import { describe, it, expect } from 'vitest';
import { validateEdit, hasErrors, formatValidationResults, defaultRules, type EditChange } from './validation-rules.js';
import type { TestDef } from './types.js';

describe('validation rules', () => {
  describe('mock_network_placement', () => {
    it('should reject mock_network in steps section', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 0,
        step: {
          mock_network: {
            match: 'https://api.example.com/*',
            status: 200,
            body: '{}'
          }
        }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('mock_network');
      expect(results[0].message).toContain('before');
    });

    it('should accept mock_network in before section', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'before',
        index: 0,
        step: {
          mock_network: {
            match: 'https://api.example.com/*',
            status: 200,
            body: '{}'
          }
        }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(false);
    });
  });

  describe('variable_dependency_check', () => {
    it('should prevent removing step that sets used variable', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { eval: '123', as: 'userId' },
          { eval: 'fetch("/api/user/" + $vars.userId)' }
        ]
      };

      const change: EditChange = {
        action: 'remove',
        section: 'steps',
        index: 0
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('$vars.userId');
    });

    it('should allow removing step that sets unused variable', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { eval: '123', as: 'unusedVar' },
          { assert: 'true' }
        ]
      };

      const change: EditChange = {
        action: 'remove',
        section: 'steps',
        index: 0
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(false);
    });
  });

  describe('duplicate_step_warning', () => {
    it('should warn when adding duplicate step', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { click: { selector: '#button' } }
        ]
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 1,
        step: { click: { selector: '#button' } }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(false); // Warning, not error
      expect(results.length).toBe(1);
      expect(results[0].severity).toBe('warning');
      expect(results[0].message).toContain('identical');
    });

    it('should not warn when adding unique step', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { click: { selector: '#button-a' } }
        ]
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 1,
        step: { click: { selector: '#button-b' } }
      };

      const results = validateEdit(test, change);

      expect(results.length).toBe(0);
    });
  });

  describe('index_bounds_check', () => {
    it('should reject add with invalid index', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { eval: "true", as: "initialized" }
        ]
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 10,
        step: { click: { selector: '#button' } }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('Invalid index');
    });

    it('should allow add at end (index === length)', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { eval: "true", as: "initialized" }
        ]
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 1,
        step: { click: { selector: '#button' } }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(false);
    });

    it('should reject remove with invalid index', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { eval: "true", as: "initialized" }
        ]
      };

      const change: EditChange = {
        action: 'remove',
        section: 'steps',
        index: 5
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      // Either bounds check or variable check will catch this
      expect(results[0].message).toMatch(/Invalid index|Step not found/);
    });

    it('should handle empty sections', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 0,
        step: { eval: 'true', as: 'initialized' }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(false);
    });
  });

  describe('move_bounds_check', () => {
    it('should reject move with invalid source index', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { eval: 'true', as: 'initialized' },
          { click: { selector: '#button' } }
        ]
      };

      const change: EditChange = {
        action: 'move',
        section: 'steps',
        index: 10,
        to_index: 0
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('source index');
    });

    it('should reject move with invalid target index', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: [
          { eval: 'true', as: 'initialized' },
          { click: { selector: '#button' } }
        ]
      };

      const change: EditChange = {
        action: 'move',
        section: 'steps',
        index: 0,
        to_index: 10
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('target index');
    });
  });

  describe('conditional_step_structure', () => {
    it('should reject conditional step without action', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 0,
        step: { if: '$vars.x > 5' } as any
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('Conditional step');
      expect(results[0].message).toContain('action');
    });

    it('should accept conditional step with action', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 0,
        step: { if: '$vars.x > 5', click: { selector: '#button' } } as any
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(false);
    });
  });

  describe('loop_structure_check', () => {
    it('should reject loop without steps', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 0,
        step: { loop: { max: 3, steps: [] } }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('non-empty "steps" array');
    });

    it('should reject loop without over, while, or max', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 0,
        step: { loop: { steps: [{ click: { selector: '#btn' } }] } } as any
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(true);
      expect(results[0].message).toContain('over');
      expect(results[0].message).toContain('while');
      expect(results[0].message).toContain('max');
    });

    it('should accept valid loop with max', () => {
      const test: TestDef = {
        url: 'https://example.com',
        steps: []
      };

      const change: EditChange = {
        action: 'add',
        section: 'steps',
        index: 0,
        step: {
          loop: {
            max: 3,
            steps: [{ click: { selector: '#btn' } }]
          }
        }
      };

      const results = validateEdit(test, change);

      expect(hasErrors(results)).toBe(false);
    });
  });
});

describe('formatValidationResults', () => {
  it('should format errors and warnings', () => {
    const results = [
      { valid: false, severity: 'error' as const, message: '[rule1] This is an error' },
      { valid: true, severity: 'warning' as const, message: '[rule2] This is a warning' }
    ];

    const formatted = formatValidationResults(results);

    expect(formatted).toContain('❌ ERRORS:');
    expect(formatted).toContain('This is an error');
    expect(formatted).toContain('⚠️  WARNINGS:');
    expect(formatted).toContain('This is a warning');
  });

  it('should show only errors when no warnings', () => {
    const results = [
      { valid: false, severity: 'error' as const, message: '[rule1] This is an error' }
    ];

    const formatted = formatValidationResults(results);

    expect(formatted).toContain('❌ ERRORS:');
    expect(formatted).not.toContain('⚠️  WARNINGS:');
  });

  it('should handle empty results', () => {
    const results: any[] = [];

    const formatted = formatValidationResults(results);

    expect(formatted).toContain('All validation checks passed');
  });
});
