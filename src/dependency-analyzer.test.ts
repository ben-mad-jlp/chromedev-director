import { describe, it, expect } from 'vitest';
import { analyzeVariableDependencies, checkRemoveStepSafety } from './dependency-analyzer.js';
import type { SavedTest } from './types.js';

describe('analyzeVariableDependencies', () => {
  it('should identify variable producers and consumers', () => {
    const test: SavedTest = {
      id: 'test-1',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: '123', as: 'userId' },
          { eval: 'document.title', as: 'pageTitle' },
          { eval: 'fetch("/api/user/" + $vars.userId)', as: 'userData' },
          { assert: '$vars.userData.name === "John"' }
        ]
      }
    };

    const analysis = analyzeVariableDependencies(test);

    // userId is set by step 0 and used by step 2
    expect(analysis.variables['userId']).toBeDefined();
    expect(analysis.variables['userId'].set_by?.index).toBe(0);
    expect(analysis.variables['userId'].used_by.length).toBe(1);
    expect(analysis.variables['userId'].used_by[0].index).toBe(2);

    // userData is set by step 2 and used by step 3
    expect(analysis.variables['userData']).toBeDefined();
    expect(analysis.variables['userData'].set_by?.index).toBe(2);
    expect(analysis.variables['userData'].used_by.length).toBe(1);
    expect(analysis.variables['userData'].used_by[0].index).toBe(3);

    // pageTitle is set but never used
    expect(analysis.unused_variables).toContain('pageTitle');
  });

  it('should detect undefined variables (used but never set)', () => {
    const test: SavedTest = {
      id: 'test-2',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: '$vars.nonExistent + 1', as: 'result' }
        ]
      }
    };

    const analysis = analyzeVariableDependencies(test);

    expect(analysis.undefined_variables).toContain('nonExistent');
  });

  it('should detect unused variables (set but never used)', () => {
    const test: SavedTest = {
      id: 'test-3',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: '42', as: 'unusedVar' },
          { eval: '100', as: 'usedVar' },
          { assert: '$vars.usedVar > 50' }
        ]
      }
    };

    const analysis = analyzeVariableDependencies(test);

    expect(analysis.unused_variables).toContain('unusedVar');
    expect(analysis.unused_variables).not.toContain('usedVar');
  });

  it('should track variables across before, steps, and after sections', () => {
    const test: SavedTest = {
      id: 'test-4',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        before: [
          { eval: '"mock-token"', as: 'authToken' }
        ],
        steps: [
          { eval: 'fetch("/api/data", { headers: { "Authorization": ' + '$vars.authToken' + ' } })', as: 'data' }
        ],
        after: [
          { eval: `console.log("Fetched:", $vars.data)` }
        ]
      }
    };

    const analysis = analyzeVariableDependencies(test);

    // authToken set in before, used in steps
    expect(analysis.variables['authToken'].set_by?.section).toBe('before');
    expect(analysis.variables['authToken'].used_by[0].section).toBe('steps');

    // data set in steps, used in after
    expect(analysis.variables['data'].set_by?.section).toBe('steps');
    expect(analysis.variables['data'].used_by[0].section).toBe('after');
  });

  it('should handle variables in conditional expressions', () => {
    const test: SavedTest = {
      id: 'test-5',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: '5', as: 'count' },
          { if: '$vars.count > 3', click: { selector: '#button' } } as any
        ]
      }
    };

    const analysis = analyzeVariableDependencies(test);

    // count is used in the conditional
    expect(analysis.variables['count'].used_by.length).toBeGreaterThan(0);
  });

  it('should handle nested loop steps', () => {
    const test: SavedTest = {
      id: 'test-6',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: '0', as: 'counter' },
          {
            loop: {
              max: 3,
              steps: [
                { eval: '$vars.counter + 1', as: 'counter' }
              ]
            }
          },
          { assert: '$vars.counter === 3' }
        ]
      }
    };

    const analysis = analyzeVariableDependencies(test);

    // counter is set and used in loop
    expect(analysis.variables['counter']).toBeDefined();
    expect(analysis.variables['counter'].set_by).toBeDefined();
    expect(analysis.variables['counter'].used_by.length).toBeGreaterThan(0);
  });

  it('should use comments as step labels when available', () => {
    const test: SavedTest = {
      id: 'test-7',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          {
            eval: '123',
            as: 'userId',
            comment: 'Get user ID from session'
          },
          {
            eval: 'fetch("/api/user/" + $vars.userId)',
            comment: 'Fetch user profile data'
          }
        ]
      }
    };

    const analysis = analyzeVariableDependencies(test);

    // Comments should be used as step labels
    expect(analysis.variables['userId'].set_by?.step_label).toBe('Get user ID from session');
    expect(analysis.variables['userId'].used_by[0].step_label).toBe('Fetch user profile data');
  });
});

describe('checkRemoveStepSafety', () => {
  it('should allow removing step that does not set variables', () => {
    const test: SavedTest = {
      id: 'test-1',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: 'true', as: 'initialized' },
          { click: { selector: '#button' } },
          { assert: 'true' }
        ]
      }
    };

    const result = checkRemoveStepSafety(test, 'steps', 1);

    expect(result.safe).toBe(true);
  });

  it('should prevent removing step that sets a used variable', () => {
    const test: SavedTest = {
      id: 'test-2',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: '123', as: 'userId' },
          { eval: 'fetch("/api/user/" + $vars.userId)' }
        ]
      }
    };

    const result = checkRemoveStepSafety(test, 'steps', 0);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('$vars.userId');
  });

  it('should allow removing step that sets unused variable', () => {
    const test: SavedTest = {
      id: 'test-3',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: '123', as: 'unusedVar' },
          { assert: 'true' }
        ]
      }
    };

    const result = checkRemoveStepSafety(test, 'steps', 0);

    expect(result.safe).toBe(true);
  });

  it('should handle removing from before section', () => {
    const test: SavedTest = {
      id: 'test-4',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        before: [
          { eval: '"token"', as: 'authToken' }
        ],
        steps: [
          { eval: 'fetch("/api", { headers: { "Auth": ' + '$vars.authToken' + ' } })' }
        ]
      }
    };

    const result = checkRemoveStepSafety(test, 'before', 0);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('$vars.authToken');
  });

  it('should return error for invalid index', () => {
    const test: SavedTest = {
      id: 'test-5',
      name: 'Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: 'true', as: 'initialized' }
        ]
      }
    };

    const result = checkRemoveStepSafety(test, 'steps', 999);

    expect(result.safe).toBe(false);
    expect(result.reason).toBe('Step not found');
  });
});
