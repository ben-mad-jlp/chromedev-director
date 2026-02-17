/**
 * DebugController — Promise-gate for step-by-step test debugging
 *
 * The step loop calls `gate(stepIndex)` before each step.
 * In debug/step mode, `gate()` awaits a Promise that only resolves
 * when an external command arrives (step/continue/stop).
 */

export interface DebugControllerOptions {
  /** Milliseconds to pause between steps (0 = no delay) */
  stepDelay?: number;
  /** Start in debug (step-by-step) mode */
  debug?: boolean;
  /** Called when the controller pauses before a step */
  onPause?: (stepIndex: number, totalSteps: number) => void;
  /** Called when the controller resumes */
  onResume?: () => void;
}

type GateResolve = (action: 'step' | 'continue' | 'stop') => void;

export class DebugController {
  private _stepDelay: number;
  private _stepMode: boolean;
  private _stopped = false;
  private _paused = false;
  private _gateResolve: GateResolve | null = null;
  private _onPause: ((stepIndex: number, totalSteps: number) => void) | undefined;
  private _onResume: (() => void) | undefined;
  private _isFirstStep = true;
  private _runToTarget: number | null = null;

  constructor(opts: DebugControllerOptions = {}) {
    this._stepDelay = opts.stepDelay ?? 0;
    this._stepMode = opts.debug ?? false;
    this._onPause = opts.onPause;
    this._onResume = opts.onResume;
  }

  /**
   * Called at the top of the step loop before each step.
   * Applies stepDelay (skip for first step), then if in step mode,
   * blocks until step()/continue()/stop() is called.
   */
  async gate(stepIndex: number, totalSteps?: number): Promise<void> {
    if (this._stopped) {
      throw new Error('Stopped by user');
    }

    // Apply step delay (skip for first step)
    if (this._stepDelay > 0 && !this._isFirstStep) {
      await new Promise<void>(r => setTimeout(r, this._stepDelay));
    }
    this._isFirstStep = false;

    if (this._stopped) {
      throw new Error('Stopped by user');
    }

    // If running to a target step, skip pause until we reach it
    if (this._runToTarget != null && stepIndex < this._runToTarget) {
      return;
    }
    if (this._runToTarget != null && stepIndex >= this._runToTarget) {
      // Reached the target — re-enter step mode and clear target
      this._stepMode = true;
      this._runToTarget = null;
    }

    // If in step mode, block until command arrives
    if (this._stepMode) {
      this._paused = true;
      this._onPause?.(stepIndex, totalSteps ?? 0);

      const action = await new Promise<'step' | 'continue' | 'stop'>(resolve => {
        this._gateResolve = resolve;
      });

      this._paused = false;
      this._gateResolve = null;

      if (action === 'stop') {
        this._stopped = true;
        throw new Error('Stopped by user');
      }

      if (action === 'continue') {
        this._stepMode = false;
      }
      // 'step' keeps _stepMode = true

      this._onResume?.();
    }
  }

  /** Execute one step, then pause again */
  step(): void {
    this._stepMode = true;
    if (this._gateResolve) {
      this._gateResolve('step');
    }
  }

  /** Run all remaining steps freely */
  continue(): void {
    if (this._gateResolve) {
      this._gateResolve('continue');
    } else {
      this._stepMode = false;
    }
  }

  /** Run until the given step index, then pause */
  runTo(targetStep: number): void {
    this._runToTarget = targetStep;
    this._stepMode = false;
    if (this._gateResolve) {
      this._gateResolve('continue');
    }
  }

  /** Abort the test */
  stop(): void {
    this._stopped = true;
    if (this._gateResolve) {
      this._gateResolve('stop');
    }
  }

  get isPaused(): boolean {
    return this._paused;
  }

  get isStopped(): boolean {
    return this._stopped;
  }
}
