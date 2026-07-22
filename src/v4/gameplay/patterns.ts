/**
 * V4's compiled danmaku vocabulary.
 *
 * These deterministic generators are executable game design, not asset
 * pack data. They live with the v4 edition while the generic registry, emitter
 * and geometry primitives remain in `content/pattern-registry.ts`. Guest packs
 * may arrange these names but cannot inject arbitrary code.
 */

import type { BulletSpec } from '../../sim/bullet';
import { sinDeg } from '../../core/trig';
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
