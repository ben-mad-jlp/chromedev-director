import { describe, it, expect, vi } from 'vitest';
import { DebugController } from '../debug-controller.js';

describe('DebugController', () => {
  describe('stepDelay', () => {
    it('should not delay on first step', async () => {
      const controller = new DebugController({ stepDelay: 5000 });
      const start = Date.now();
      await controller.gate(0, 3);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // First step should be instant
    });

    it('should delay between steps', async () => {
      const controller = new DebugController({ stepDelay: 50 });
      await controller.gate(0, 3); // First step, no delay
      const start = Date.now();
      await controller.gate(1, 3); // Second step, should delay
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some variance
      expect(elapsed).toBeLessThan(200);
    });

    it('should not delay when stepDelay is 0', async () => {
      const controller = new DebugController({ stepDelay: 0 });
      await controller.gate(0, 3);
      const start = Date.now();
      await controller.gate(1, 3);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('debug mode (step-by-step)', () => {
    it('should pause in debug mode and resume on step()', async () => {
      const onPause = vi.fn();
      const onResume = vi.fn();
      const controller = new DebugController({ debug: true, onPause, onResume });

      // gate() should block until step() is called
      let resolved = false;
      const gatePromise = controller.gate(0, 5).then(() => { resolved = true; });

      // Should be paused
      await new Promise(r => setTimeout(r, 10));
      expect(resolved).toBe(false);
      expect(controller.isPaused).toBe(true);
      expect(onPause).toHaveBeenCalledWith(0, 5);

      // Step should resolve the gate
      controller.step();
      await gatePromise;
      expect(resolved).toBe(true);
      expect(controller.isPaused).toBe(false);
      expect(onResume).toHaveBeenCalled();
    });

    it('should pause again after step()', async () => {
      const controller = new DebugController({ debug: true });

      // First gate - step through
      let firstResolved = false;
      const firstGate = controller.gate(0, 3).then(() => { firstResolved = true; });
      await new Promise(r => setTimeout(r, 10));
      controller.step();
      await firstGate;
      expect(firstResolved).toBe(true);

      // Second gate should pause again
      let secondResolved = false;
      const secondGate = controller.gate(1, 3).then(() => { secondResolved = true; });
      await new Promise(r => setTimeout(r, 10));
      expect(secondResolved).toBe(false);
      expect(controller.isPaused).toBe(true);

      controller.step();
      await secondGate;
      expect(secondResolved).toBe(true);
    });

    it('should run freely after continue()', async () => {
      const controller = new DebugController({ debug: true });

      // First gate - continue
      const firstGate = controller.gate(0, 3);
      await new Promise(r => setTimeout(r, 10));
      controller.continue();
      await firstGate;

      // Subsequent gates should not pause
      const start = Date.now();
      await controller.gate(1, 3);
      await controller.gate(2, 3);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('stop', () => {
    it('should throw on stop while paused', async () => {
      const controller = new DebugController({ debug: true });

      const gatePromise = controller.gate(0, 3);
      await new Promise(r => setTimeout(r, 10));

      controller.stop();
      await expect(gatePromise).rejects.toThrow('Stopped by user');
      expect(controller.isStopped).toBe(true);
    });

    it('should throw on next gate after stop', async () => {
      const controller = new DebugController();
      controller.stop();
      await expect(controller.gate(0, 3)).rejects.toThrow('Stopped by user');
    });

    it('should throw even with stepDelay after stop', async () => {
      const controller = new DebugController({ stepDelay: 50 });
      await controller.gate(0, 3); // First step passes
      controller.stop();
      await expect(controller.gate(1, 3)).rejects.toThrow('Stopped by user');
    });
  });

  describe('combined stepDelay + debug', () => {
    it('should apply delay then pause', async () => {
      const onPause = vi.fn();
      const controller = new DebugController({ stepDelay: 30, debug: true, onPause });

      // First step: no delay, but pauses
      const gate0 = controller.gate(0, 2);
      await new Promise(r => setTimeout(r, 10));
      expect(onPause).toHaveBeenCalledWith(0, 2);
      controller.step();
      await gate0;

      // Second step: delay then pause
      const start = Date.now();
      let paused = false;
      const gate1Promise = controller.gate(1, 2).then(() => { paused = true; });

      // Wait for delay + pause
      await new Promise(r => setTimeout(r, 50));
      expect(onPause).toHaveBeenCalledTimes(2);
      expect(paused).toBe(false); // Still paused

      controller.continue();
      await gate1Promise;
      expect(paused).toBe(true);
    });
  });

  describe('continue without being paused', () => {
    it('should disable step mode when called without pause', () => {
      const controller = new DebugController({ debug: true });
      controller.continue();
      // Should not throw and should not be in step mode anymore
      expect(controller.isPaused).toBe(false);
    });
  });

  describe('runTo', () => {
    it('should skip pauses until reaching the target step', async () => {
      const onPause = vi.fn();
      const controller = new DebugController({ debug: true, onPause });

      // Gate at step 0 — pauses
      const gate0 = controller.gate(0, 5);
      await new Promise(r => setTimeout(r, 10));
      expect(controller.isPaused).toBe(true);
      expect(onPause).toHaveBeenCalledWith(0, 5);

      // Run to step 3 — resumes and skips steps 1 and 2
      controller.runTo(3);
      await gate0;

      // Steps 1 and 2 should pass through without pausing
      await controller.gate(1, 5);
      expect(controller.isPaused).toBe(false);

      await controller.gate(2, 5);
      expect(controller.isPaused).toBe(false);

      // Step 3 should pause (target reached, re-enters step mode)
      const gate3 = controller.gate(3, 5);
      await new Promise(r => setTimeout(r, 10));
      expect(controller.isPaused).toBe(true);
      expect(onPause).toHaveBeenCalledWith(3, 5);

      controller.continue();
      await gate3;
    });

    it('should work when target is the next step', async () => {
      const onPause = vi.fn();
      const controller = new DebugController({ debug: true, onPause });

      // Gate at step 0 — pauses
      const gate0 = controller.gate(0, 3);
      await new Promise(r => setTimeout(r, 10));

      // Run to step 1 (the very next step)
      controller.runTo(1);
      await gate0;

      // Step 1 should pause
      const gate1 = controller.gate(1, 3);
      await new Promise(r => setTimeout(r, 10));
      expect(controller.isPaused).toBe(true);
      expect(onPause).toHaveBeenCalledWith(1, 3);

      controller.continue();
      await gate1;
    });
  });
});
