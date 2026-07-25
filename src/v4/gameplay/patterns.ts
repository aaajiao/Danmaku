/**
 * V4's compiled danmaku vocabulary.
 *
 * These deterministic generators are executable game design, not asset
 * pack data. They live with the v4 edition while the generic registry, emitter
 * and geometry primitives remain in `content/pattern-registry.ts`. Guest packs
 * may arrange these names but cannot inject arbitrary code.
 */

import type { BulletSpec } from '../../sim/bullet';
import { atan2Deg, cosDeg, sinDeg } from '../../core/trig';
import { aimAngle, definePattern, fan, ring } from '../../content/pattern-registry';

/** Stable public vocabulary used by v4 campaign data and guest packs. */
export const V4_PATTERN_NAMES = [
  'ring',
  'spiral',
  'aimed-fan',
  'spray',
  'alternating-fan',
  'gap-ring',
  'weave',
  'lane-wall',
  'moon-gate',
  'verdict-shear',
  'archive-trace',
  'memory-groove',
] as const;

/**
 * `spec` is the one option with no sensible default — there is no bullet
 * shape a pattern could safely assume in its place — so a missing spec must
 * fail loudly, naming the pattern, rather than default silently like every
 * other field. `options` itself may be entirely absent (an unconfigured
 * pattern slot); that is just another way of missing `spec`.
 */
function requireSpec<T extends { spec: BulletSpec }>(
  options: Readonly<Partial<T>> | undefined,
  patternName: string,
): BulletSpec {
  if (options?.spec === undefined) {
    throw new Error(`pattern "${patternName}" requires a "spec" option`);
  }
  return options.spec;
}

interface RingOptions {
  spec: BulletSpec;
  count?: number;
  period?: number;
  /** Degrees added per volley — the classic rotating flower. */
  rotation?: number;
  duration?: number;
}

definePattern({
  name: 'ring',
  description: 'Evenly spaced full circle, optionally rotating each volley.',
  create(options?: Readonly<Partial<RingOptions>>) {
    const spec = requireSpec(options, 'ring');
    const count = options?.count ?? 16;
    const period = options?.period ?? 30;
    const rotation = options?.rotation ?? 7;
    const duration = options?.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      ring(context, spec, count, volley * rotation);
      volley++;
      return true;
    };
  },
});

interface SpiralOptions {
  spec: BulletSpec;
  /** Simultaneous arms. */
  arms?: number;
  /** Degrees advanced per tick. */
  step?: number;
  period?: number;
  duration?: number;
}

definePattern({
  name: 'spiral',
  description: 'Continuous rotating arms.',
  create(options?: Readonly<Partial<SpiralOptions>>) {
    const spec = requireSpec(options, 'spiral');
    const arms = options?.arms ?? 3;
    const step = options?.step ?? 11;
    const period = options?.period ?? 3;
    const duration = options?.duration ?? 0;
    let angle = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      for (let i = 0; i < arms; i++) {
        const bullet = context.bullets.spawn(
          context.x,
          context.y,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = angle + (360 / arms) * i;
      }
      angle += step;
      return true;
    };
  },
});

interface AimedOptions {
  spec: BulletSpec;
  count?: number;
  spread?: number;
  period?: number;
  duration?: number;
}

definePattern({
  name: 'aimed-fan',
  description: 'Spread fired at the player. The pressure staple.',
  create(options?: Readonly<Partial<AimedOptions>>) {
    const spec = requireSpec(options, 'aimed-fan');
    const count = options?.count ?? 5;
    const spread = options?.spread ?? 40;
    const period = options?.period ?? 45;
    const duration = options?.duration ?? 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      fan(context, spec, count, aimAngle(context), spread);
      return true;
    };
  },
});

interface SprayOptions {
  spec: BulletSpec;
  count?: number;
  period?: number;
  /** Angular window; omit for a full circle. */
  centre?: number;
  spread?: number;
  duration?: number;
}

definePattern({
  name: 'spray',
  description: 'Randomised scatter. Draws from the sim stream.',
  create(options?: Readonly<Partial<SprayOptions>>) {
    const spec = requireSpec(options, 'spray');
    const count = options?.count ?? 3;
    const period = options?.period ?? 6;
    const spread = options?.spread ?? 360;
    const duration = options?.duration ?? 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      const centre = options?.centre ?? aimAngle(context);
      for (let i = 0; i < count; i++) {
        const bullet = context.bullets.spawn(
          context.x,
          context.y,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = centre + context.rng.range(-spread / 2, spread / 2);
      }
      return true;
    };
  },
});

interface AlternatingFanOptions extends AimedOptions {
  /** Degrees the whole fan steps to either side of the current player bearing. */
  swing?: number;
}

/** A readable left/right gesture: adjacent volleys do not reuse the same lanes. */
definePattern({
  name: 'alternating-fan',
  description: 'Aimed fan whose centre alternates around the player bearing.',
  create(options?: Readonly<Partial<AlternatingFanOptions>>) {
    const spec = requireSpec(options, 'alternating-fan');
    const count = options?.count ?? 5;
    const spread = options?.spread ?? 32;
    const period = options?.period ?? 48;
    const swing = options?.swing ?? 14;
    const duration = options?.duration ?? 0;
    let side = -1;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      fan(context, spec, count, aimAngle(context) + side * swing, spread);
      side = side === -1 ? 1 : -1;
      return true;
    };
  },
});

interface GapRingOptions extends RingOptions {
  /** Width in degrees of the opening centred toward the player. */
  gap?: number;
}

function signedAngleDelta(angle: number, centre: number): number {
  return ((angle - centre + 540) % 360) - 180;
}

/** A circular wave that authors negative space instead of filling every bearing. */
definePattern({
  name: 'gap-ring',
  description: 'Rotating ring with a player-facing safe opening.',
  create(options?: Readonly<Partial<GapRingOptions>>) {
    const spec = requireSpec(options, 'gap-ring');
    const count = options?.count ?? 24;
    const period = options?.period ?? 72;
    const rotation = options?.rotation ?? 9;
    const gap = options?.gap ?? 42;
    const duration = options?.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      if (count <= 0) {
        volley++;
        return true;
      }

      const safeBearing = aimAngle(context);
      const step = 360 / count;
      for (let i = 0; i < count; i++) {
        const theta = volley * rotation + i * step;
        if (Math.abs(signedAngleDelta(theta, safeBearing)) < gap / 2) continue;
        const bullet = context.bullets.spawn(
          context.x,
          context.y,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = theta;
      }
      // Time owns the rotation. A saturated pool may truncate a volley, but it
      // must not freeze the next opening in place.
      volley++;
      return true;
    };
  },
});

interface WeaveOptions {
  spec: BulletSpec;
  period?: number;
  /** Phase advance in degrees per volley. */
  step?: number;
  /** Maximum angular distance either side of the current player bearing. */
  amplitude?: number;
  /** Number of nested mirrored thread pairs. */
  pairs?: number;
  duration?: number;
}

/** Mirrored threads cross the aim line and repeatedly open a central diamond. */
definePattern({
  name: 'weave',
  description: 'Mirrored crossing threads with a moving central opening.',
  create(options?: Readonly<Partial<WeaveOptions>>) {
    const spec = requireSpec(options, 'weave');
    const period = options?.period ?? 4;
    const step = options?.step ?? 13;
    const amplitude = options?.amplitude ?? 38;
    const pairs = Math.max(1, Math.floor(options?.pairs ?? 1));
    const duration = options?.duration ?? 0;
    // Begin open rather than stacking the first mirrored pair on the aim line.
    let phase = 90;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      const centre = aimAngle(context);
      const wave = sinDeg(phase);
      for (let i = 0; i < pairs; i++) {
        const offset = wave * amplitude * ((i + 1) / pairs);
        for (const sign of [-1, 1] as const) {
          const bullet = context.bullets.spawn(
            context.x,
            context.y,
            spec,
            context.faction,
            context.rng,
          );
          if (!bullet) {
            phase += step;
            return true;
          }
          bullet.vector.theta = centre + sign * offset;
        }
      }
      phase += step;
      return true;
    };
  },
});

interface LaneWallOptions {
  spec: BulletSpec;
  period?: number;
  columns?: number;
  /** Initial zero-based opening. It is wrapped when difficulty changes columns. */
  gapColumn?: number;
  /** Number of adjacent columns kept empty. */
  gapWidth?: number;
  /** Columns the opening moves per volley; negative moves left. */
  shift?: number;
  /** Authored field span. Defaults leave a 24px margin on v4's 480px field. */
  left?: number;
  right?: number;
  /** Heading and speed override the bullet spec only when explicitly supplied. */
  direction?: number;
  speed?: number;
  duration?: number;
}

function wrapped(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** A field-width advancing wall whose opening migrates between volleys. */
definePattern({
  name: 'lane-wall',
  description: 'Horizontal bullet wall with a migrating safe lane.',
  create(options?: Readonly<Partial<LaneWallOptions>>) {
    const spec = requireSpec(options, 'lane-wall');
    const period = options?.period ?? 72;
    const columns = Math.max(3, Math.floor(options?.columns ?? 9));
    const initialGap = Math.floor(options?.gapColumn ?? Math.floor(columns / 2));
    const gapWidth = Math.min(columns - 1, Math.max(1, Math.floor(options?.gapWidth ?? 1)));
    const shift = Math.floor(options?.shift ?? 1);
    const left = options?.left ?? 24;
    const right = options?.right ?? 456;
    const direction = options?.direction ?? 90;
    const speed = options?.speed;
    const duration = options?.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      const gap = wrapped(initialGap + volley * shift, columns);
      for (let i = 0; i < columns; i++) {
        const distanceFromGap = wrapped(i - gap, columns);
        if (distanceFromGap < gapWidth) continue;
        const x = left + ((i + 0.5) / columns) * (right - left);
        const bullet = context.bullets.spawn(
          x,
          context.y,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = direction;
        if (speed !== undefined) bullet.vector.r = speed;
      }
      volley++;
      return true;
    };
  },
});

interface MoonGateOptions {
  spec: BulletSpec;
  period?: number;
  count?: number;
  /** Number of evenly spaced openings cut through the moon wheel. */
  gates?: number;
  /** Width of each opening in degrees. */
  gap?: number;
  /** Radius at which the wheel is declared around the Boss. */
  radius?: number;
  /** Degrees the whole wheel advances per declaration. */
  rotation?: number;
  /** Tangential turn applied to the expanding wheel, alternating by volley. */
  twist?: number;
  duration?: number;
}

/**
 * Sentinel's spatial verb: a moon wheel already open in three places when it
 * appears, rather than another ring collapsing out of the Boss's centre.
 *
 * The closest opening is declared from the player's bearing, then the whole
 * wheel advances by `rotation` on later volleys. Alternating tangential twist
 * makes adjacent wheels peel in opposite directions while every opening stays
 * authored and visible. Position and heading use the exact trig table (rule 3).
 */
definePattern({
  name: 'moon-gate',
  description: 'Offset moon wheel with three rotating crossings and alternating tide.',
  create(options?: Readonly<Partial<MoonGateOptions>>) {
    const spec = requireSpec(options, 'moon-gate');
    const period = Math.max(1, Math.floor(options?.period ?? 72));
    const count = Math.max(3, Math.floor(options?.count ?? 24));
    const gates = Math.max(1, Math.floor(options?.gates ?? 3));
    const gap = Math.max(0, Math.min(359, options?.gap ?? 32));
    const radius = Math.max(0, options?.radius ?? 34);
    const rotation = options?.rotation ?? 11;
    const twist = options?.twist ?? 9;
    const duration = options?.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;

      const base = aimAngle(context) + volley * rotation;
      const step = 360 / count;
      const gateStep = 360 / gates;
      const tangent = volley % 2 === 0 ? twist : -twist;
      for (let i = 0; i < count; i++) {
        const theta = base + i * step;
        let insideOpening = false;
        for (let gate = 0; gate < gates; gate++) {
          if (Math.abs(signedAngleDelta(theta, base + gate * gateStep)) < gap / 2) {
            insideOpening = true;
            break;
          }
        }
        if (insideOpening) continue;

        const bullet = context.bullets.spawn(
          context.x + cosDeg(theta) * radius,
          context.y + sinDeg(theta) * radius,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = theta + tangent;
      }
      // The declaration clock advances even if the pool truncates this wheel.
      volley++;
      return true;
    };
  },
});

interface VerdictShearOptions {
  spec: BulletSpec;
  period?: number;
  columns?: number;
  /** Width in field pixels of the appeal lane locked at declaration time. */
  gapWidth?: number;
  /** Degrees each side leans toward the appeal lane. */
  shear?: number;
  /** Reverse the two rulings on alternating volleys. */
  alternate?: number;
  left?: number;
  right?: number;
  speed?: number;
  duration?: number;
}

/**
 * Magistrate's spatial verb: one declaration divides the whole field into two
 * rulings. Bullets to the left and right of the sampled appeal lane lean toward
 * one another, then exchange directions on the next declaration.
 */
definePattern({
  name: 'verdict-shear',
  description: 'Field-wide split verdict whose two sides shear around one appeal lane.',
  create(options?: Readonly<Partial<VerdictShearOptions>>) {
    const spec = requireSpec(options, 'verdict-shear');
    const period = Math.max(1, Math.floor(options?.period ?? 68));
    const columns = Math.max(3, Math.floor(options?.columns ?? 13));
    const gapWidth = Math.max(1, options?.gapWidth ?? 72);
    const shear = options?.shear ?? 18;
    const alternate = (options?.alternate ?? 1) !== 0;
    const left = options?.left ?? 18;
    const right = options?.right ?? 462;
    const speed = options?.speed;
    const duration = options?.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;

      const appeal = Math.max(left, Math.min(right, context.targetX));
      const reversed = alternate && volley % 2 === 1;
      for (let i = 0; i < columns; i++) {
        const x = left + ((i + 0.5) / columns) * (right - left);
        if (Math.abs(x - appeal) < gapWidth / 2) continue;
        const inward = x < appeal ? -shear : shear;
        const bullet = context.bullets.spawn(
          x,
          context.y,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = 90 + (reversed ? -inward : inward);
        if (speed !== undefined) bullet.vector.r = speed;
      }
      volley++;
      return true;
    };
  },
});

interface ArchiveTraceOptions {
  spec: BulletSpec;
  period?: number;
  /** Fixed ticks between the recorded crossing and its filed replay. */
  delay?: number;
  /** Parallel folio spines that converge on the archived position. */
  folios?: number;
  spacing?: number;
  stagger?: number;
  duration?: number;
}

interface TracePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Chancellor's spatial verb: it preserves a trace, not the crossing.
 *
 * A bounded ring buffer records the player's position every tick. After the
 * authored delay, parallel folio spines fire at that old position. The opening
 * is therefore produced by continuing to move; no wall clock or RNG participates.
 */
definePattern({
  name: 'archive-trace',
  description: 'Delayed folio volley aimed at the player position the archive retained.',
  create(options?: Readonly<Partial<ArchiveTraceOptions>>) {
    const spec = requireSpec(options, 'archive-trace');
    const period = Math.max(1, Math.floor(options?.period ?? 54));
    const delay = Math.max(0, Math.floor(options?.delay ?? 72));
    const folios = Math.max(1, Math.floor(options?.folios ?? 5));
    const spacing = options?.spacing ?? 18;
    const stagger = options?.stagger ?? 3;
    const duration = options?.duration ?? 0;
    const history: (TracePoint | undefined)[] = new Array(delay + 1);
    let cursor = 0;
    let samples = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;

      history[cursor] = { x: context.targetX, y: context.targetY };
      cursor = (cursor + 1) % history.length;
      samples++;

      if (context.age % period !== 0 || samples <= delay) return true;
      const archived = history[cursor];
      if (archived === undefined) return true;

      const middle = (folios - 1) / 2;
      for (let i = 0; i < folios; i++) {
        const offset = (i - middle) * spacing;
        const sourceX = context.x + offset;
        const sourceY = context.y + Math.abs(i - middle) * stagger;
        const bullet = context.bullets.spawn(
          sourceX,
          sourceY,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = atan2Deg(archived.y - sourceY, archived.x - sourceX);
      }
      return true;
    };
  },
});

interface MemoryGrooveOptions {
  spec: BulletSpec;
  period?: number;
  /** Ticks between the live player and the route returned as a wall opening. */
  delay?: number;
  /** Older sample used to retain the route's direction as lateral wall drift. */
  trail?: number;
  columns?: number;
  gapWidth?: number;
  left?: number;
  right?: number;
  speed?: number;
  driftScale?: number;
  maxDrift?: number;
  duration?: number;
}

/**
 * Regent's spatial verb: the player's own prior passage hardens into order.
 *
 * Each wall opens at an old player x. A second, older sample supplies a bounded
 * lateral heading, so the whole safe groove keeps the direction in which it was
 * worn instead of becoming a static lane. The history is fixed-size and local
 * to one pattern instance; a phase restart begins a new record.
 */
definePattern({
  name: 'memory-groove',
  description: 'Delayed wall whose drifting opening replays the player route that wore it.',
  create(options?: Readonly<Partial<MemoryGrooveOptions>>) {
    const spec = requireSpec(options, 'memory-groove');
    const period = Math.max(1, Math.floor(options?.period ?? 58));
    const delay = Math.max(0, Math.floor(options?.delay ?? 84));
    const trail = Math.max(1, Math.floor(options?.trail ?? 18));
    const columns = Math.max(3, Math.floor(options?.columns ?? 13));
    const gapWidth = Math.max(1, options?.gapWidth ?? 76);
    const left = options?.left ?? 18;
    const right = options?.right ?? 462;
    const speed = options?.speed;
    const driftScale = options?.driftScale ?? 4;
    const maxDrift = Math.abs(options?.maxDrift ?? 14);
    const duration = options?.duration ?? 0;
    const history: (TracePoint | undefined)[] = new Array(delay + trail + 1);
    let cursor = 0;
    let samples = 0;

    const sampleAgo = (ticks: number): TracePoint | undefined => {
      const at = wrapped(cursor - 1 - ticks, history.length);
      return history[at];
    };

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;

      history[cursor] = { x: context.targetX, y: context.targetY };
      cursor = (cursor + 1) % history.length;
      samples++;

      if (
        context.age % period !== 0
        || samples <= delay + trail
      ) return true;

      const passage = sampleAgo(delay);
      const earlier = sampleAgo(delay + trail);
      if (passage === undefined || earlier === undefined) return true;
      const gap = Math.max(left, Math.min(right, passage.x));
      const rawDrift = ((passage.x - earlier.x) / trail) * driftScale;
      const drift = Math.max(-maxDrift, Math.min(maxDrift, rawDrift));

      for (let i = 0; i < columns; i++) {
        const x = left + ((i + 0.5) / columns) * (right - left);
        if (Math.abs(x - gap) < gapWidth / 2) continue;
        const bullet = context.bullets.spawn(
          x,
          context.y,
          spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = 90 + drift;
        if (speed !== undefined) bullet.vector.r = speed;
      }
      return true;
    };
  },
});
