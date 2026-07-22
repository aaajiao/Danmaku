/**
 * The frame clock: pure, integer, render-side.
 *
 * A strip's current frame is a total function of the strip's geometry and a
 * clock. The clock MUST be a run-relative, tick-only integer — an entity's own
 * `.age` (`p.age`, `item.age`, `b.age`), which starts at 0 when the entity
 * spawns and is reproduced bit-for-bit by a replay. It must NEVER be
 * `performance.now`, a rAF timestamp, the interpolation `alpha`, or the
 * program-global `loop.count`: any of those desynchronises a looping strip's
 * frame phase from a replay visually while every test stays green, the exact
 * class of bug CLAUDE.md rule 1 forbids for backgrounds. `Background.uTick` is
 * the precedent and it is instance-local/run-relative, not global.
 *
 * These functions live in `render/`, outside both the `determinism` and
 * `architecture` scans by construction, and may be imported freely by the
 * shell. `Math.floor`/`%`/`Math.min` on integers are IEEE-754-exact, so rule 3
 * is satisfied regardless (and render is exempt in any case — these values
 * reach the framebuffer and stop).
 */

import type { Strip } from './atlas';

/**
 * The frame index a strip shows at `clock` ticks of run-relative age. A
 * one-shot clamps at its last frame; a loop wraps. `frames <= 1` is always 0.
 */
export function stripFrame(s: Strip, clock: number): number {
  if (s.frames <= 1) return 0;
  const step = Math.floor(clock / s.ticksPerFrame);
  return s.mode === 'loop' ? step % s.frames : Math.min(s.frames - 1, step);
}

/**
 * Ticks a one-shot runs before its last frame finishes, so an effect's `life`
 * can be set to match exactly (a frame-animated explosion is one particle that
 * dies as its last frame ends — no completion flag, CLAUDE.md rule 8).
 */
export function stripLength(s: Strip): number {
  return s.frames * s.ticksPerFrame;
}

/** True once a one-shot has played its last frame; a loop never finishes. */
export function stripDone(s: Strip, clock: number): boolean {
  return s.mode === 'once' && clock >= stripLength(s);
}
