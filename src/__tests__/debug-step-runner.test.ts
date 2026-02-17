import { describe, it, expect, vi } from 'vitest';
import { runSteps } from '../step-runner.js';
import { DebugController } from '../debug-controller.js';
import type { TestDef, CDPClient, RunEvent } from '../types.js';

/**
 * Create a mock CDP client for testing
 */
function createMockClient(): CDPClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(true),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    getConsoleMessages: vi.fn().mockResolvedValue([]),
    getNetworkResponses: vi.fn().mockResolvedValue([]),
    getDomSnapshot: vi.fn().mockResolvedValue('<html></html>'),
    captureScreenshot: vi.fn().mockResolvedValue('base64data'),
    select: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    switchFrame: vi.fn().mockResolvedValue(undefined),
    handleDialog: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    addMockRule: vi.fn(),
  };
}

describe('step-runner debug integration', () => {
  it('should apply stepDelay between steps', async () => {
    const controller = new DebugController({ stepDelay: 30 });
    const client = createMockClient();
    const testDef: TestDef = {
      url: 'http://localhost:3000',
      steps: [
        { eval: '1', as: 'a' },
        { eval: '2', as: 'b' },
        { eval: '3', as: 'c' },
      ],
    };

    const start = Date.now();
    const result = await runSteps(client, testDef, undefined, undefined, controller);
    const elapsed = Date.now() - start;

    expect(result.status).toBe('passed');
    // 2 delays (between step 0->1 and 1->2), no delay before step 0
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it('should stop test when debug controller is stopped', async () => {
    const controller = new DebugController({ debug: true });
    const client = createMockClient();
    const testDef: TestDef = {
      url: 'http://localhost:3000',
      steps: [
        { eval: '1' },
        { eval: '2' },
      ],
    };

    // Start the test, it will pause at step 0
    const resultPromise = runSteps(client, testDef, undefined, undefined, controller);

    // Wait for it to pause, then stop
    await new Promise(r => setTimeout(r, 50));
    expect(controller.isPaused).toBe(true);
    controller.stop();

    const result = await resultPromise;
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toBe('Stopped by user');
  });

  it('should step through then continue', async () => {
    const events: RunEvent[] = [];
    const controller = new DebugController({ debug: true });
    const client = createMockClient();
    const testDef: TestDef = {
      url: 'http://localhost:3000',
      steps: [
        { eval: '1', label: 'Step A' },
        { eval: '2', label: 'Step B' },
        { eval: '3', label: 'Step C' },
      ],
    };

    const resultPromise = runSteps(client, testDef, (e) => events.push(e), undefined, controller);

    // Wait for pause at step 0
    await new Promise(r => setTimeout(r, 50));
    expect(controller.isPaused).toBe(true);

    // Step once
    controller.step();
    await new Promise(r => setTimeout(r, 50));

    // Should be paused at step 1
    expect(controller.isPaused).toBe(true);

    // Continue — run remaining steps freely
    controller.continue();

    const result = await resultPromise;
    expect(result.status).toBe('passed');

    // All steps should have started
    const stepStarts = events.filter(e => e.type === 'step:start');
    expect(stepStarts.length).toBe(3);
  });

  it('should run after hooks when stopped', async () => {
    const events: RunEvent[] = [];
    const controller = new DebugController({ debug: true });
    const client = createMockClient();
    const testDef: TestDef = {
      url: 'http://localhost:3000',
      after: [{ eval: '"cleanup"', label: 'Cleanup' }],
      steps: [
        { eval: '1' },
      ],
    };

    const resultPromise = runSteps(client, testDef, (e) => events.push(e), undefined, controller);

    await new Promise(r => setTimeout(r, 50));
    controller.stop();

    const result = await resultPromise;
    expect(result.status).toBe('failed');

    // After hooks should have run
    const afterEvents = events.filter(e => e.type === 'step:start' && e.stepIndex <= -100);
    expect(afterEvents.length).toBe(1);
  });

  it('should fire onPause and onResume callbacks', async () => {
    const pauseArgs: Array<[number, number]> = [];
    let resumeCount = 0;
    const controller = new DebugController({
      debug: true,
      onPause: (stepIndex, totalSteps) => {
        pauseArgs.push([stepIndex, totalSteps]);
      },
      onResume: () => {
        resumeCount++;
      },
    });
    const client = createMockClient();
    const testDef: TestDef = {
      url: 'http://localhost:3000',
      steps: [{ eval: '1' }, { eval: '2' }],
    };

    const resultPromise = runSteps(client, testDef, undefined, undefined, controller);

    // Wait for pause at step 0
    await new Promise(r => setTimeout(r, 50));
    expect(pauseArgs).toEqual([[0, 2]]);

    controller.step();
    await new Promise(r => setTimeout(r, 50));
    expect(pauseArgs).toEqual([[0, 2], [1, 2]]);
    expect(resumeCount).toBe(1);

    controller.continue();
    await resultPromise;
    expect(resumeCount).toBe(2);
  });

  it('should not delay or pause when no controller is provided', async () => {
    const client = createMockClient();
    const testDef: TestDef = {
      url: 'http://localhost:3000',
      steps: [
        { eval: '1' },
        { eval: '2' },
        { eval: '3' },
      ],
    };

    const start = Date.now();
    const result = await runSteps(client, testDef);
    const elapsed = Date.now() - start;

    expect(result.status).toBe('passed');
    expect(elapsed).toBeLessThan(200); // Should be fast without delay
  });
});
