/**
 * V4's compiled danmaku vocabulary.
 *
 * These four deterministic generators are executable game design, not asset
 * pack data. They live with the v4 edition while the generic registry, emitter
 * and geometry primitives remain in `content/pattern-registry.ts`. Guest packs
 * may arrange these names but cannot inject arbitrary code.
 */

import type { BulletSpec } from '../../sim/bullet';
import { aimAngle, definePattern, fan, ring } from '../../content/pattern-registry';

/** Stable public vocabulary used by v4 campaign data and guest packs. */
export const V4_PATTERN_NAMES = ['ring', 'spiral', 'aimed-fan', 'spray'] as const;

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
