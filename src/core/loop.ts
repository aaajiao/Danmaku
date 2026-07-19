/**
 * Fixed-timestep driver.
 *
 * The simulation is frame-locked: one tick is one frame, and every constant in
 * the content data is expressed in pixels per frame. Upstream ran one tick per
 * rAF, so it ran 2.4x too fast on a 144Hz display. We decouple that here.
 *
 * `tick()` never receives a delta. It must not — see CLAUDE.md, rule 1.
 * `render()` receives `alpha`, the 0..1 interpolation factor between the last
 * two ticks, and is the only place frame-rate independence is allowed to exist.
 */

export const TICK_HZ = 60;
const STEP_MS = 1000 / TICK_HZ;

/** Ticks we refuse to exceed in one frame, so a stalled tab cannot spiral. */
const MAX_CATCHUP = 5;

export interface LoopCallbacks {
  tick(): void;
  render(alpha: number): void;
}

export class Loop {
  #callbacks: LoopCallbacks;
  #accumulator = 0;
  #lastTime = 0;
  #running = false;
  #frame = 0;

  /** Number of ticks simulated since start. This is the sim's clock. */
  count = 0;

  constructor(callbacks: LoopCallbacks) {
    this.#callbacks = callbacks;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = performance.now();
    this.#accumulator = 0;
    this.#frame = requestAnimationFrame(this.#onFrame);
  }

  stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#frame);
  }

  #onFrame = (now: number): void => {
    if (!this.#running) return;
    this.#frame = requestAnimationFrame(this.#onFrame);

    this.#accumulator += now - this.#lastTime;
    this.#lastTime = now;

    let steps = 0;
    while (this.#accumulator >= STEP_MS && steps < MAX_CATCHUP) {
      this.#callbacks.tick();
      this.count++;
      this.#accumulator -= STEP_MS;
      steps++;
    }

    // A stall we could not fully absorb within MAX_CATCHUP: discard the
    // remainder rather than fast-forwarding.
    //
    // The threshold has to be one step, not MAX_CATCHUP steps. Anything left
    // over is time the loop has already refused to simulate, and it feeds
    // `alpha` directly — leaving up to MAX_CATCHUP steps behind hands render()
    // an alpha of up to MAX_CATCHUP, which extrapolates rather than
    // interpolates and throws every view position wildly past its target.
    if (this.#accumulator > STEP_MS) this.#accumulator = 0;

    this.#callbacks.render(this.#accumulator / STEP_MS);
  };
}
