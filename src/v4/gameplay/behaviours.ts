/**
 * V4 motion behaviours — the escape hatch for movement the polar model cannot say.
 *
 * `MotionParams` describes a heading and its derivatives. That covers most
 * danmaku, and where it does not, the missing piece is almost always a
 * *relationship*: to the player (homing), to a point (orbit), or to a clock
 * (waver, accelerate-to). A behaviour is invoked once per tick with the vector,
 * a `MotionContext`, and the run's generator, and rewrites the polar state in
 * place — so everything downstream (`moveX`/`moveY`, reflection, clamps) keeps
 * working unchanged.
 *
 * ## Windows, not forever
 *
 * Every behaviour here takes `delay` and `duration`, and outside that window it
 * does nothing at all. This is a design rule, not a convenience. A shot that
 * steers forever is unavoidable, and an unavoidable shot is not a pattern — it
 * is a tax. The interesting shape is the one that commits: it tracks, it stops,
 * and the space it left is the dodge. `duration` therefore defaults to a finite
 * value; a behaviour that should run for the bullet's whole life must say so.
 *
 * ## The window clock is `vector.age`, not `context.age`
 *
 * `context.age` is the *entity's* age — ticks since the bullet spawned — which
 * is what a pattern gates its fire on. A behaviour's window has to be relative
 * to the segment that declared it, or a `MotionTimeline` handing this vector a
 * homing segment at tick 200 would find the window already expired. `init()`
 * resets `vector.age`, so it counts exactly the ticks that this segment has
 * been in force. Behaviours run before `step()` increments it, so the first
 * invocation of a segment sees age 0.
 *
 * ## These behaviours make no RNG draws
 *
 * The generator is passed and deliberately unused. That is worth stating,
 * because it is a property the content depends on: draw order is part of the
 * determinism contract (CLAUDE.md, rule 2), so a behaviour that drew would make
 * *attaching* it to a pattern shift every subsequent bullet in the run.
 * Behaviours here perturb no stream, which is what makes them safe to add to an
 * existing pattern. A future behaviour that genuinely needs randomness must
 * take it from the passed `rng` — never from the module-level `sim` — and must
 * be understood as changing every fixture that runs alongside it.
 *
 * All trigonometry comes from `core/trig` (CLAUDE.md, rule 3), and the only
 * other `Math` used is `abs`/`min`/`max`/`sqrt`, all of which are exactly
 * specified.
 */

import { atan2Deg, cosDeg, deltaDeg, sinDeg } from '../../core/trig';
import { defineBehaviour, type MotionContext, type MoveVector } from '../../sim/motion';

type Options = Readonly<Record<string, number>>;

function option(options: Options, key: string, fallback: number): number {
  return options[key] ?? fallback;
}

/**
 * Whether the behaviour is inside its authored window this tick.
 *
 * `duration <= 0` means "no window at all" rather than "unlimited". The
 * opposite reading is available — `maxBounces` in `sim/bullet.ts` uses 0 for
 * unlimited — but it is the wrong default here: an author who omits a duration
 * gets this module's stated default, and one who writes `duration: 0` is
 * disabling the behaviour, which is a thing worth being able to say from data.
 */
function inWindow(age: number, delay: number, duration: number): boolean {
  return age >= delay && age < delay + duration;
}

/**
 * Turn toward the aim target by at most `turnRate` degrees per tick.
 *
 * Options: `turnRate` (deg/tick, default 3), `delay` (ticks before steering
 * begins, default 0), `duration` (ticks of steering, default 60).
 *
 * The turn is the *shortest* one. `theta` accumulates without bound through
 * `w`, so a bullet that has spun three times reads 1090 where the target reads
 * 10; a naive `target - theta` would be -1080 and send it the long way round
 * for hundreds of ticks. `deltaDeg` wraps the difference into (-180, 180],
 * which is the only reason large accumulated headings behave like small ones.
 */
defineBehaviour('homing', (vector: MoveVector, context: MotionContext) => {
  const options = vector.options;
  const delay = option(options, 'delay', 0);
  const duration = option(options, 'duration', 60);
  if (!inWindow(vector.age, delay, duration)) return;

  const dx = context.targetX - context.x;
  const dy = context.targetY - context.y;
  // Sitting exactly on the target has no heading to seek. `atan2Deg` answers 0
  // there, which would snap the bullet east for no reason the player can read.
  if (dx === 0 && dy === 0) return;

  const turnRate = option(options, 'turnRate', 3);
  const delta = deltaDeg(vector.theta, atan2Deg(dy, dx));
  const step = Math.min(Math.abs(delta), Math.abs(turnRate));
  vector.theta += delta < 0 ? -step : step;
});

/**
 * Wobble the heading sinusoidally about where it would otherwise point.
 *
 * Options: `amplitude` (degrees of swing either side, default 15), `period`
 * (ticks per full cycle, default 60), `delay`, `duration` (default 600).
 *
 * Applied as the *difference* between this tick's offset and last tick's, not
 * as an assignment, so the wobble rides on top of whatever else moves the
 * heading — `w`, a reflection, a homing segment — instead of overwriting it.
 * The differences telescope: after k ticks the accumulated deviation is exactly
 * `amplitude * sin(360k / period)`, which is zero at every whole period. That
 * is what keeps a wavering bullet travelling along its authored heading rather
 * than curving away from it, and it means a `duration` that is a multiple of
 * `period` hands the heading back unchanged when the window closes.
 */
defineBehaviour('waver', (vector: MoveVector) => {
  const options = vector.options;
  const delay = option(options, 'delay', 0);
  const duration = option(options, 'duration', 600);
  const age = vector.age;
  if (!inWindow(age, delay, duration)) return;

  const period = Math.max(1, option(options, 'period', 60));
  const amplitude = option(options, 'amplitude', 15);
  const phase = age - delay;

  const previous = amplitude * sinDeg((360 * phase) / period);
  const current = amplitude * sinDeg((360 * (phase + 1)) / period);
  vector.theta += current - previous;
});

/**
 * Ease `r` toward `speed` across `duration` ticks — the hang-then-snap bullet.
 *
 * Options: `speed` (target px/tick, default 4), `duration` (ticks of the ramp,
 * default 30), `delay` (ticks of hang before it starts, default 0).
 *
 * The ease is a smoothstep, applied without storing the starting speed
 * anywhere. Holding per-vector state would mean a side table keyed by pooled
 * objects, and pooled objects are reused — the bookkeeping to invalidate it on
 * respawn is exactly the kind that rots. Instead each tick closes a computed
 * *fraction of the remaining gap*: if the eased curve should have covered
 * `e(t)` of the distance by now and `e(t-1)` was covered already, then closing
 * `(e(t) - e(t-1)) / (1 - e(t-1))` of what is left reproduces the curve
 * exactly, whatever the speed started at. The final tick has `e = 1`, so `r`
 * lands on `speed` rather than approaching it.
 */
defineBehaviour('accelerate-to', (vector: MoveVector) => {
  const options = vector.options;
  const delay = option(options, 'delay', 0);
  const duration = Math.max(1, option(options, 'duration', 30));
  const age = vector.age;
  if (!inWindow(age, delay, duration)) return;

  const speed = option(options, 'speed', 4);
  const t = (age - delay + 1) / duration;
  const previousT = (age - delay) / duration;
  const covered = smoothstep(previousT);
  const remaining = 1 - covered;

  // A degenerate final step: the curve is already complete, so there is no
  // fraction left to take one of. Landing on the target is the honest answer.
  if (remaining <= 0) {
    vector.r = speed;
    return;
  }

  vector.r += (speed - vector.r) * ((smoothstep(t) - covered) / remaining);
});

/**
 * Hold the bullet on a circle, then let it go tangentially.
 *
 * Options: `centerX`, `centerY` (the point circled, default 0,0), `aimAtTarget`
 * (non-zero to circle the aim target instead — a moving centre), `radius`
 * (default 60), `angularSpeed` (deg/tick, signed; default 3), `delay`,
 * `duration` (default 120).
 *
 * A behaviour cannot move an entity — it only rewrites the vector, and the
 * caller integrates. So rather than assigning a position, this computes where
 * the bullet should be next tick and solves for the single step that gets it
 * there: heading from `atan2Deg`, speed from the chord length. Reading the
 * current position back from the context each tick makes it self-correcting,
 * so a bullet spawned off the ring spirals onto it instead of orbiting a
 * phantom centre forever.
 *
 * When the window ends the behaviour simply stops, leaving the last chord's
 * heading and speed in place — which is the tangent. That is the release, and
 * it costs nothing to author: a ring of bullets around a boss becomes a ring
 * that suddenly flies outward, all from one segment.
 */
defineBehaviour('orbit', (vector: MoveVector, context: MotionContext) => {
  const options = vector.options;
  const delay = option(options, 'delay', 0);
  const duration = option(options, 'duration', 120);
  if (!inWindow(vector.age, delay, duration)) return;

  const aimAtTarget = option(options, 'aimAtTarget', 0) !== 0;
  const centerX = aimAtTarget ? context.targetX : option(options, 'centerX', 0);
  const centerY = aimAtTarget ? context.targetY : option(options, 'centerY', 0);

  const dx = context.x - centerX;
  const dy = context.y - centerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const radius = option(options, 'radius', 60);

  // Dead centre has no angle to advance from. Fall back to the vector's own
  // heading so the bullet leaves the singularity on the next tick rather than
  // being pinned there by a zero-length step.
  const phase = distance === 0 ? vector.theta : atan2Deg(dy, dx);
  const next = phase + option(options, 'angularSpeed', 3);

  // Ease the radius rather than snapping to it: a bullet that starts wide
  // should be seen to be gathered in.
  const nextDistance = distance + (radius - distance) * 0.25;
  const stepX = centerX + nextDistance * cosDeg(next) - context.x;
  const stepY = centerY + nextDistance * sinDeg(next) - context.y;

  vector.theta = atan2Deg(stepY, stepX);
  vector.r = Math.sqrt(stepX * stepX + stepY * stepY);
});

/**
 * Hold the aimed heading through the telegraph, then sweep it — the laser verb.
 *
 * A beam is a promise about where a line will be. If it turns while it is still
 * a warning the promise is void, so `theta` is left exactly as fired — through
 * `aimed-fan`, which sets the heading at the player — for `hold` ticks. Only
 * then does the wedge open: `rate` degrees are added per tick inside a finite
 * window, and the total swing is capped by `arc`. This is *aim → then sweep*,
 * the one shape the polar model cannot already say.
 *
 * Two things it depends on, both from the spec, not from here:
 *
 * - Set `hold` to the laser's `warmup` so the sweep begins the instant the
 *   telegraph becomes lethal. For a single-segment beam `vector.age` and the
 *   bullet's `age` (which drives `warmup`/`lethal`) advance together, so the two
 *   clocks line up; the coupling is pinned by a test where the content lives.
 * - The spec MUST set `motion.w = 0`. `w` integrates from tick 0 (`step()`
 *   adds it before the behaviour runs), so it would sweep the beam *during* its
 *   own telegraph — exactly what this avoids — and a `timeline` cannot stand in,
 *   because re-initialising a segment resets `theta` and forgets the aimed
 *   heading. With no other writer to `theta` in the window, the once-per-tick
 *   `theta += rate` is a pure, order-independent function of `vector.age`: as
 *   replay-robust as an absolute sinusoid, and it keeps the aim the absolute
 *   form throws away.
 *
 * Options: `hold` (ticks the aim is held before the sweep, default 0), `rate`
 * (deg/tick, signed; default 2), `duration` (ticks of turning after `hold`,
 * default 90), `arc` (max total degrees swept, 0 = unbounded). No RNG; the only
 * `Math` is `abs`, which the spec fixes exactly, so this is rule-3-clean.
 */
defineBehaviour('beam-sweep', (vector: MoveVector) => {
  const options = vector.options;
  const hold = option(options, 'hold', 0);
  const duration = option(options, 'duration', 90);
  if (!inWindow(vector.age, hold, duration)) return;

  const rate = option(options, 'rate', 2);
  const arc = option(options, 'arc', 0);
  // A fixed wedge: once the beam has swept `arc` degrees it stops, even if the
  // window still has ticks left. `age - hold` is the ticks since the sweep
  // began, so `|rate| * (age - hold)` is the magnitude already turned. The test
  // is on what has accumulated *before* this tick's step, so the swing halts on
  // the first tick that would carry it to or past the bound — landing within one
  // `rate` of `arc`, never short of it.
  if (arc > 0 && Math.abs(rate) * (vector.age - hold) >= arc) return;

  vector.theta += rate;
});

/** Smoothstep on [0, 1], clamped. Polynomial, so exactly reproducible. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
