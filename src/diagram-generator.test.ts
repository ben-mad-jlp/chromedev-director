import { describe, it, expect } from 'vitest';
import { generateTestFlowDiagram } from './diagram-generator.js';
import type { SavedTest } from './types.js';

describe('generateTestFlowDiagram', () => {
  it('should generate diagram for simple linear flow', () => {
    const test: SavedTest = {
      id: 'test-1',
      name: 'Simple Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: "true", as: "initialized" },
          { fill: { selector: '#username', value: 'test@example.com' } },
          { fill: { selector: '#password', value: 'password123' } },
          { click: { selector: '#login-btn' } },
          { assert: 'document.title === "Dashboard"' }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('graph TD');
    expect(diagram).toContain('MAIN STEPS');
    expect(diagram).toContain('Evaluate');
    expect(diagram).toContain('Fill');
    expect(diagram).toContain('Click');
    expect(diagram).toContain('Assert');
    expect(diagram).toContain('END');
  });

  it('should show variable annotations', () => {
    const test: SavedTest = {
      id: 'test-2',
      name: 'Variable Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: 'document.querySelector("#user-id").value', as: 'userId' },
          { eval: 'fetch("/api/user/" + $vars.userId)', as: 'userData' },
          { assert: '$vars.userData.status === "active"' }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('📦 sets $vars.userId');
    expect(diagram).toContain('📥 uses $vars.userId');
    expect(diagram).toContain('📦 sets $vars.userData');
    expect(diagram).toContain('📥 uses $vars.userData');
  });

  it('should show before, steps, and after sections', () => {
    const test: SavedTest = {
      id: 'test-3',
      name: 'Sections Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        before: [
          { mock_network: { match: 'https://api.example.com/*', status: 200, body: '{}' } }
        ],
        steps: [
          { eval: "true", as: "initialized" },
          { click: { selector: '#test-btn' } }
        ],
        after: [
          { eval: 'localStorage.clear()' }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('BEFORE SECTION');
    expect(diagram).toContain('MAIN STEPS');
    expect(diagram).toContain('AFTER SECTION');
    expect(diagram).toContain('Mock network');
  });

  it('should handle conditional steps', () => {
    const test: SavedTest = {
      id: 'test-4',
      name: 'Conditional Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: 'Math.random()', as: 'rand' },
          { if: '$vars.rand > 0.5', click: { selector: '#button-a' } } as any
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('if $vars.rand > 0.5');
    expect(diagram).toContain('true');
    expect(diagram).toContain('false');
  });

  it('should handle run_test steps', () => {
    const test: SavedTest = {
      id: 'test-5',
      name: 'Nested Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: "true", as: "initialized" },
          { run_test: 'login-helper' },
          { assert: 'document.title === "Dashboard"' }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('🔗 Run test: login-helper');
  });

  it('should handle empty sections gracefully', () => {
    const test: SavedTest = {
      id: 'test-6',
      name: 'Minimal Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: "true", as: "initialized" }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('graph TD');
    expect(diagram).not.toContain('BEFORE SECTION');
    expect(diagram).not.toContain('AFTER SECTION');
    expect(diagram).toContain('MAIN STEPS');
    expect(diagram).toContain('END');
  });

  it('should handle loop steps', () => {
    const test: SavedTest = {
      id: 'test-7',
      name: 'Loop Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          {
            loop: {
              max: 3,
              steps: [
                { click: { selector: '.item' } }
              ]
            }
          }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('Loop');
  });

  it('should show wait steps with duration', () => {
    const test: SavedTest = {
      id: 'test-8',
      name: 'Wait Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          { eval: "true", as: "initialized" },
          { wait: 1000 },
          { click: { selector: '#btn' } }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('Wait 1000ms');
  });

  it('should display step comments', () => {
    const test: SavedTest = {
      id: 'test-9',
      name: 'Commented Test',
      description: '',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      definition: {
        url: 'https://example.com',
        steps: [
          {
            eval: 'document.querySelector("#user-id").value',
            as: 'userId',
            comment: 'Extract user ID from hidden field after login'
          },
          {
            click: { selector: '#dashboard' },
            comment: 'Navigate to main dashboard'
          }
        ]
      }
    };

    const diagram = generateTestFlowDiagram(test);

    expect(diagram).toContain('💬 Extract user ID from hidden field after login');
    expect(diagram).toContain('💬 Navigate to main dashboard');
  });
});
