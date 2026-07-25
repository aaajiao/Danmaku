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
import {
  aimAngle,
  definePattern,
  fan,
  ring,
  type EmitContext,
  type Pattern,
} from '../../content/pattern-registry';

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

function bounded(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function whole(value: number | undefined, fallback: number, minimum = 1): number {
  return Math.max(minimum, Math.floor(value ?? fallback));
}

function spawnDirected(
  context: EmitContext,
  spec: BulletSpec,
  x: number,
  y: number,
  theta: number,
  speed?: number,
): boolean {
  const bullet = context.bullets.spawn(
    x,
    y,
    spec,
    context.faction,
    context.rng,
  );
  if (!bullet) return false;
  bullet.vector.theta = theta;
  if (speed !== undefined) bullet.vector.r = speed;
  return true;
}

function fanFrom(
  context: EmitContext,
  spec: BulletSpec,
  x: number,
  y: number,
  count: number,
  centre: number,
  spread: number,
  speed?: number,
): void {
  const step = count > 1 ? spread / (count - 1) : 0;
  const start = count > 1 ? centre - spread / 2 : centre;
  for (let i = 0; i < count; i++) {
    if (!spawnDirected(context, spec, x, y, start + i * step, speed)) break;
  }
}

function assertFamilyRole(
  pattern: string,
  form: string,
  role: string | undefined,
  roles: Readonly<Record<string, readonly string[]>>,
): string {
  const allowed = roles[form];
  if (allowed === undefined) {
    throw new Error(
      `pattern "${pattern}" does not support form "${form}" — valid forms: ${Object.keys(roles).join(', ')}`,
    );
  }
  if (role === undefined || !allowed.includes(role)) {
    throw new Error(
      `pattern "${pattern}" form "${form}" requires role ${allowed.join(' | ')}, got ${JSON.stringify(role)}`,
    );
  }
  return role;
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
  /** Built-in v4 phase grammar. Omit both fields for the public legacy wheel. */
  form?: string;
  role?: string;
  period?: number;
  count?: number;
  spread?: number;
  swing?: number;
  arms?: number;
  step?: number;
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

const MOON_GATE_ROLES = {
  scan: ['sweep', 'wheel'],
  corolla: ['tide', 'stamen'],
  vigil: ['iris', 'wheel', 'crosshair'],
  eclipse: ['corona', 'closure', 'occlusion'],
} as const;

/**
 * Sentinel's built-in family. Every shot is born on one of the three moon
 * apertures or on the arc joining them; none falls back to a centre fan/spiral.
 *
 * The previous source position is sampled every tick, not only on a volley.
 * That makes a pacing Sentinel pull the wheel a bounded distance along its
 * travel without introducing a velocity field into the generic EmitContext.
 */
function createMoonGateFamily(
  options: Readonly<Partial<MoonGateOptions>>,
): Pattern {
  const spec = requireSpec(options, 'moon-gate');
  const form = options.form!;
  const role = assertFamilyRole('moon-gate', form, options.role, MOON_GATE_ROLES);
  const period = whole(options.period, 72);
  const count = whole(options.count ?? options.arms, 12, 1);
  const gates = whole(options.gates, 3);
  const gap = bounded(options.gap ?? 34, 0, 359);
  const radius = Math.max(8, options.radius ?? (
    form === 'scan' ? 30 : form === 'corolla' ? 42 : form === 'vigil' ? 38 : 48
  ));
  const rotation = options.rotation ?? options.step ?? 11;
  const twist = options.twist ?? 9;
  const spread = options.spread ?? 30;
  const swing = options.swing ?? 12;
  const duration = options.duration ?? 0;
  const formOffset = form === 'scan' ? 0 : form === 'corolla' ? 17 : form === 'vigil' ? 31 : 47;
  let volley = 0;
  let previousX = 0;
  let previousY = 0;
  let hasPrevious = false;

  return (context) => {
    const dx = hasPrevious ? context.x - previousX : 0;
    const dy = hasPrevious ? context.y - previousY : 0;
    previousX = context.x;
    previousY = context.y;
    hasPrevious = true;

    if (duration > 0 && context.age >= duration) return false;
    if (context.age % period !== 0) return true;

    // One tick of source movement is amplified into a visible but bounded lead.
    // At normal authored Boss speeds this is 5–12px, never a detached emitter.
    const centreX = context.x + bounded(dx * 8, -16, 16);
    const centreY = context.y + bounded(dy * 8, -16, 16);
    const aim = atan2Deg(context.targetY - centreY, context.targetX - centreX);
    const base = aim + formOffset + volley * rotation;
    const tangent = volley % 2 === 0 ? twist : -twist;

    const gatePoint = (theta: number, atRadius = radius): readonly [number, number] => [
      centreX + cosDeg(theta) * atRadius,
      centreY + sinDeg(theta) * atRadius,
    ];

    const emitWheel = (
      opening: number,
      radialWave: number,
      headingBias: number,
    ): void => {
      const step = 360 / count;
      const gateStep = 360 / gates;
      for (let i = 0; i < count; i++) {
        const theta = base + i * step;
        let open = false;
        for (let gateIndex = 0; gateIndex < gates; gateIndex++) {
          if (
            Math.abs(signedAngleDelta(theta, base + gateIndex * gateStep))
            < opening / 2
          ) {
            open = true;
            break;
          }
        }
        if (open) continue;

        const localRadius = radius + cosDeg((theta - base) * gates) * radialWave;
        const [x, y] = gatePoint(theta, localRadius);
        if (!spawnDirected(context, spec, x, y, theta + tangent + headingBias)) break;
      }
    };

    switch (`${form}.${role}`) {
      case 'scan.sweep': {
        const gateTheta = base + (volley % gates) * (360 / gates);
        const [x, y] = gatePoint(gateTheta);
        fanFrom(
          context,
          spec,
          x,
          y,
          count,
          atan2Deg(context.targetY - y, context.targetX - x)
            + (volley % 2 === 0 ? -swing : swing),
          spread,
        );
        break;
      }
      case 'scan.wheel':
        emitWheel(gap, 0, 0);
        break;
      case 'corolla.tide':
        // A three-lobed radius modulation makes the braking petals bloom rather
        // than merely recolour the scan wheel.
        emitWheel(gap, radius * 0.24, tangent * 0.35);
        break;
      case 'corolla.stamen': {
        const gateTheta = base + (volley % gates) * (360 / gates);
        const [x, y] = gatePoint(gateTheta, radius * 0.72);
        fanFrom(
          context,
          spec,
          x,
          y,
          count,
          atan2Deg(context.targetY - y, context.targetX - x)
            + (volley % 2 === 0 ? -swing : swing),
          spread,
        );
        break;
      }
      case 'vigil.iris': {
        const aperture = Math.max(18, spread || 54);
        const step = count > 1 ? aperture / (count - 1) : 0;
        for (let i = 0; i < count; i++) {
          const theta = aim - aperture / 2 + i * step + formOffset + volley * rotation;
          const [x, y] = gatePoint(theta);
          if (!spawnDirected(context, spec, x, y, theta + tangent)) break;
        }
        break;
      }
      case 'vigil.wheel':
        emitWheel(Math.max(18, gap - 2), radius * 0.08, tangent * 0.2);
        break;
      case 'vigil.crosshair': {
        const gateTheta = base + (volley % gates) * (360 / gates);
        const [x, y] = gatePoint(gateTheta);
        fanFrom(
          context,
          spec,
          x,
          y,
          count,
          atan2Deg(context.targetY - y, context.targetX - x)
            + (volley % 2 === 0 ? swing : -swing),
          spread,
        );
        break;
      }
      case 'eclipse.corona': {
        for (let i = 0; i < count; i++) {
          const theta = base + (360 / count) * i;
          const [x, y] = gatePoint(theta, radius * 1.08);
          if (!spawnDirected(context, spec, x, y, theta + 90 + tangent)) break;
        }
        break;
      }
      case 'eclipse.closure': {
        // Four declarations close from a generous crescent to a narrow slit,
        // then reset. The reset is the authored escape beat.
        const closeStep = volley % 4;
        const opening = Math.max(8, gap + 18 - closeStep * 10);
        emitWheel(opening, radius * 0.12, closeStep * 2);
        break;
      }
      case 'eclipse.occlusion': {
        const gateTheta = base + ((volley + 1) % gates) * (360 / gates);
        const [x, y] = gatePoint(gateTheta, radius * 0.86);
        fanFrom(
          context,
          spec,
          x,
          y,
          count,
          atan2Deg(context.targetY - y, context.targetX - x)
            + tangent * 0.5
            + (volley % 2 === 0 ? -swing : swing),
          spread,
        );
        break;
      }
    }

    // Saturation may truncate the body above, but phase grammar is time-owned.
    volley++;
    return true;
  };
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
    if (options?.form !== undefined) return createMoonGateFamily(options);
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
  /** Built-in Magistrate grammar. Omit for the public legacy shear. */
  form?: string;
  role?: string;
  period?: number;
  count?: number;
  spread?: number;
  swing?: number;
  arms?: number;
  step?: number;
  rotation?: number;
  gap?: number;
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

const VERDICT_SHEAR_ROLES = {
  arraignment: ['summons', 'docket', 'ruling'],
  pursuit: ['hooks', 'escrow', 'judgment'],
  colonnade: ['columns', 'hardening'],
  assize: ['docket', 'seal', 'columns', 'scissor'],
} as const;

/**
 * Magistrate's built-in family. Its emitters occupy two rails or a field-wide
 * row; unlike the legacy supporting patterns, no branch emits a radial object
 * from the Boss centre.
 */
function createVerdictShearFamily(
  options: Readonly<Partial<VerdictShearOptions>>,
): Pattern {
  const spec = requireSpec(options, 'verdict-shear');
  const form = options.form!;
  const role = assertFamilyRole('verdict-shear', form, options.role, VERDICT_SHEAR_ROLES);
  const period = whole(options.period, 68);
  const count = whole(options.count ?? options.arms, 5, 1);
  const columns = whole(options.columns ?? options.count, 9, 3);
  const gapWidth = Math.max(1, options.gapWidth ?? (
    options.gap !== undefined ? options.gap * 2 : 112
  ));
  const shear = options.shear ?? options.step ?? 16;
  const rotation = options.rotation ?? 0;
  const left = options.left ?? 18;
  const right = options.right ?? 462;
  const columnGap = Math.max(
    1,
    options.gap ?? (right - left) / columns,
  );
  const spread = options.spread ?? 36;
  const swing = options.swing ?? 12;
  const alternate = (options.alternate ?? 1) !== 0;
  const speed = options.speed;
  const duration = options.duration ?? 0;
  const formBias = form === 'arraignment' ? 0 : form === 'pursuit' ? 7 : form === 'colonnade' ? 13 : 21;
  let volley = 0;

  return (context) => {
    if (duration > 0 && context.age >= duration) return false;
    if (context.age % period !== 0) return true;

    // Movement contributes one quarter of the Boss displacement to the declared
    // appeal lane. It is visible, but bounded and never yanks the safe lane the
    // full distance of a relocation in one volley.
    const sourceOffset = bounded((context.x - 240) * 0.25, -42, 42);
    const appeal = bounded(context.targetX + sourceOffset, left, right);
    const railShift = bounded((context.x - 240) * 0.1, -18, 18);
    const leftRail = left + 24 + railShift;
    const rightRail = right - 24 + railShift;
    const reversed = alternate && volley % 2 === 1;

    const railFan = (
      fromLeft: boolean,
      bullets: number,
      fanSpread: number,
      bearingBias = 0,
    ): void => {
      const x = fromLeft ? leftRail : rightRail;
      const y = context.y + formBias + (fromLeft ? -6 : 6);
      fanFrom(
        context,
        spec,
        x,
        y,
        bullets,
        atan2Deg(context.targetY - y, appeal - x) + bearingBias,
        fanSpread,
        speed,
      );
    };

    const ruling = (doubleRow: boolean): void => {
      const rows = doubleRow ? 2 : 1;
      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < columns; i++) {
          const x = left + ((i + 0.5) / columns) * (right - left);
          if (Math.abs(x - appeal) < gapWidth / 2) continue;
          const inward = x < appeal ? -shear : shear;
          const rowReverse = doubleRow && row === 1 ? !reversed : reversed;
          if (!spawnDirected(
            context,
            spec,
            x,
            context.y + formBias + row * 14,
            90 + (rowReverse ? -inward : inward),
            speed,
          )) return;
        }
      }
    };

    const columnRuling = (assize: boolean): void => {
      // `rotation` is the authored turn per declaration and `gap` is the
      // field-space opening. Keeping them separate from `shear` makes a beam
      // card's rotation and safe lane independently tunable.
      const openingCentre = bounded(
        appeal + sinDeg(volley * rotation) * columnGap * 0.5,
        left,
        right,
      );
      const nearest = bounded(
        Math.floor(((openingCentre - left) / (right - left)) * columns),
        0,
        columns - 1,
      );
      for (let i = 0; i < columns; i++) {
        const x = left + ((i + 0.5) / columns) * (right - left);
        if (
          i === nearest
          || Math.abs(x - openingCentre) < columnGap / 2
        ) continue;
        const side = x < openingCentre ? -1 : 1;
        const lean = side * Math.min(8, Math.abs(shear));
        const declarationTurn = volley * rotation * (assize ? -1 : 1);
        const terrace = assize ? Math.abs(i - nearest) * 2 : 0;
        if (!spawnDirected(
          context,
          spec,
          x,
          context.y + formBias + terrace,
          90 + declarationTurn + (reversed ? -lean : lean),
          speed,
        )) break;
      }
    };

    switch (`${form}.${role}`) {
      case 'arraignment.summons':
        railFan(volley % 2 === 0, count, spread, reversed ? swing : -swing);
        break;
      case 'arraignment.docket': {
        for (let i = 0; i < count; i++) {
          const fromLeft = (i + volley) % 2 === 0;
          const x = fromLeft ? leftRail : rightRail;
          const y = context.y + formBias + (i - (count - 1) / 2) * 9;
          const targetX = appeal + (fromLeft ? 1 : -1) * (i - (count - 1) / 2) * 12;
          const theta = atan2Deg(context.targetY - y, targetX - x)
            + volley * (options.step ?? 0.5);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'arraignment.ruling':
        ruling(false);
        break;
      case 'pursuit.escrow': {
        // Escrow is a staggered two-ledger deposit, not the arraignment row
        // translated seven pixels downward. Adjacent scales interlock while
        // preserving the same declared appeal lane and bullet budget.
        for (let i = 0; i < columns; i++) {
          const x = left + ((i + 0.5) / columns) * (right - left);
          if (Math.abs(x - appeal) < gapWidth / 2) continue;
          const row = (i + volley) % 2 === 0 ? -1 : 1;
          const inward = x < appeal ? -shear : shear;
          if (!spawnDirected(
            context,
            spec,
            x,
            context.y + formBias + row * 8,
            90 + (reversed ? -inward : inward) + row * swing * 0.25,
            speed,
          )) break;
        }
        break;
      }
      case 'colonnade.hardening': {
        // The scales harden into a stepped pediment around the appeal rather
        // than repeating either flat ruling above.
        const nearest = bounded(
          Math.floor(((appeal - left) / (right - left)) * columns),
          0,
          columns - 1,
        );
        for (let i = 0; i < columns; i++) {
          const x = left + ((i + 0.5) / columns) * (right - left);
          if (Math.abs(x - appeal) < gapWidth / 2) continue;
          const inward = x < appeal ? -shear : shear;
          const tier = Math.abs(i - nearest);
          if (!spawnDirected(
            context,
            spec,
            x,
            context.y + formBias + tier * 4,
            90 + (reversed ? -inward : inward) + (tier % 2 === 0 ? -2 : 2),
            speed,
          )) break;
        }
        break;
      }
      case 'pursuit.hooks': {
        // `gap` is the full-width opening between the two hook targets. Keep
        // it inside a readable 160px corridor even when a guest pack supplies
        // an extreme value. `rotation` is the opposed curl applied at the two
        // rails; its polarity reverses with the ruling, but never exceeds 36°.
        const hookGap = bounded(Math.abs(options.gap ?? 40), 0, 160);
        const hookTurn = bounded(options.rotation ?? 0, -36, 36)
          * (reversed ? -1 : 1);
        for (let i = 0; i < count; i++) {
          const fromLeft = i % 2 === 0;
          const x = fromLeft ? leftRail : rightRail;
          const y = context.y + formBias + Math.floor(i / 2) * 6;
          const targetX = appeal + (fromLeft ? -hookGap / 2 : hookGap / 2);
          const hook = (i - (count - 1) / 2) * (spread / Math.max(1, count - 1));
          const theta = atan2Deg(context.targetY - y, targetX - x)
            + hook
            + (fromLeft ? hookTurn : -hookTurn);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'pursuit.judgment':
        railFan(volley % 2 !== 0, count, spread, reversed ? -swing : swing);
        break;
      case 'colonnade.columns':
        columnRuling(false);
        break;
      case 'assize.columns':
        columnRuling(true);
        break;
      case 'assize.docket': {
        for (let i = 0; i < count; i++) {
          const fromLeft = (i + volley) % 2 === 0;
          const x = fromLeft ? leftRail : rightRail;
          const y = context.y + formBias + (i % 2) * 12;
          const crossX = appeal + (fromLeft ? -1 : 1) * 18;
          const theta = atan2Deg(context.targetY - y, crossX - x)
            + (i - (count - 1) / 2) * (options.step ?? 12);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'assize.seal': {
        const sealGap = Math.max(0, options.gap ?? 36);
        const ranks = Math.max(1, Math.ceil(count / 2));
        const sealTurn = (reversed ? -1 : 1) * (options.rotation ?? shear);
        for (let i = 0; i < count; i++) {
          const fromLeft = i % 2 === 0;
          const x = fromLeft ? leftRail : rightRail;
          const rank = Math.floor(i / 2);
          const y = context.y + formBias + (
            ranks > 1 ? (rank - (ranks - 1) / 2) * (sealGap / (ranks - 1)) : 0
          );
          const theta = atan2Deg(context.targetY - y, appeal - x)
            + (fromLeft ? -sealTurn : sealTurn);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'assize.scissor':
        ruling(true);
        break;
    }

    // Rail side, moving opening and scissor polarity remain time-owned.
    volley++;
    return true;
  };
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
    if (options?.form !== undefined) return createVerdictShearFamily(options);
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
  /** Built-in Chancellor grammar. Omit for the public legacy trace. */
  form?: string;
  role?: string;
  period?: number;
  count?: number;
  spread?: number;
  swing?: number;
  arms?: number;
  step?: number;
  rotation?: number;
  gap?: number;
  speed?: number;
  /** Fixed ticks between the recorded crossing and its filed replay. */
  delay?: number;
  /** Half the tick separation between retained generations (`trail * 2`). */
  trail?: number;
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

interface ArchiveRecord {
  readonly source: TracePoint;
  readonly target: TracePoint;
}

const ARCHIVE_TRACE_ROLES = {
  appeal: ['trace', 'margins'],
  precedent: ['binding', 'chain'],
  wax: ['imprint', 'witness', 'service'],
  assay: ['rake', 'staves', 'trace', 'underline'],
  estoppel: ['bars', 'redaction'],
  sealed: ['overprint', 'trace', 'closure'],
} as const;

/**
 * Chancellor's built-in family retains both halves of an attack: where the
 * player crossed and where the moving archivist stood when she observed it.
 * Later forms read two and then three generations, so movement becomes visible
 * as a stack of displaced filing origins instead of a cosmetic actor drift.
 */
function createArchiveTraceFamily(
  options: Readonly<Partial<ArchiveTraceOptions>>,
): Pattern {
  const spec = requireSpec(options, 'archive-trace');
  const form = options.form!;
  const role = assertFamilyRole('archive-trace', form, options.role, ARCHIVE_TRACE_ROLES);
  const fallbackDelay = form === 'appeal' ? 48
    : form === 'precedent' ? 60
      : form === 'wax' ? 72
        : form === 'assay' ? 66
          : form === 'estoppel' ? 54
            : 42;
  const delay = Math.max(0, Math.floor(options.delay ?? fallbackDelay));
  const trail = whole(options.trail, Math.max(12, Math.floor(delay / 2)));
  const lookbacks = form === 'sealed'
    ? [delay, delay + trail * 2, delay + trail * 4]
    : form === 'precedent' || form === 'assay' || form === 'estoppel'
      ? [delay, delay + trail * 2]
      : [delay];
  const maxLookback = lookbacks[lookbacks.length - 1] ?? delay;
  const period = whole(options.period, 60);
  const folios = whole(options.folios ?? options.count ?? options.arms, 5, 1);
  const spacing = options.spacing ?? 20;
  const stagger = options.stagger ?? 4;
  const spread = options.spread ?? 36;
  const speed = options.speed;
  const duration = options.duration ?? 0;
  const history: (ArchiveRecord | undefined)[] = new Array(maxLookback + 1);
  let cursor = 0;
  let samples = 0;
  let volley = 0;

  const sampleAgo = (ticks: number): ArchiveRecord | undefined => (
    history[wrapped(cursor - 1 - ticks, history.length)]
  );

  return (context) => {
    history[cursor] = {
      source: { x: context.x, y: context.y },
      target: { x: context.targetX, y: context.targetY },
    };
    cursor = (cursor + 1) % history.length;
    samples++;

    if (duration > 0 && context.age >= duration) return false;
    if (context.age % period !== 0 || samples <= maxLookback) return true;

    const records: ArchiveRecord[] = [];
    for (const lookback of lookbacks) {
      const record = sampleAgo(lookback);
      if (record === undefined) return true;
      records.push(record);
    }
    const newest = records[0]!;
    const oldest = records[records.length - 1]!;

    const emitFolio = (
      record: ArchiveRecord,
      count: number,
      headingBias = 0,
      xBias = 0,
    ): void => {
      const middle = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        const offset = (i - middle) * spacing;
        const x = record.source.x + offset + xBias;
        const y = record.source.y + Math.abs(i - middle) * stagger;
        const theta = atan2Deg(record.target.y - y, record.target.x - x) + headingBias;
        if (!spawnDirected(context, spec, x, y, theta, speed)) break;
      }
    };

    switch (`${form}.${role}`) {
      case 'appeal.trace':
        emitFolio(newest, folios);
        break;
      case 'appeal.margins': {
        // The closest margin on either side stays `gap` pixels from the
        // archived spine. Bound that half-gap so margins cannot collapse into
        // an unreadable overlap or be authored wholly outside the play band.
        const marginGap = bounded(Math.abs(options.gap ?? spacing * 2), 4, 120);
        const middle = (folios - 1) / 2;
        for (let i = 0; i < folios; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const x = newest.source.x + side * (
            marginGap + Math.floor(i / 2) * spacing
          );
          const y = newest.source.y + (i - middle) * stagger;
          const theta = atan2Deg(newest.target.y - y, newest.target.x - x)
            + side * (options.rotation ?? 6);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'precedent.binding': {
        for (let i = 0; i < folios; i++) {
          const record = records[i % records.length]!;
          const next = records[(i + 1) % records.length]!;
          const offset = (i - (folios - 1) / 2) * spacing;
          const x = record.source.x + offset;
          const y = record.source.y + Math.abs(offset / Math.max(1, spacing)) * stagger;
          const theta = atan2Deg(next.target.y - y, next.target.x - x)
            + volley * (options.step ?? 1);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'precedent.chain': {
        const perRecord = Math.max(1, Math.ceil(folios / records.length));
        for (let i = 0; i < records.length; i++) {
          emitFolio(records[i]!, perRecord, i === 0 ? -4 : 4);
        }
        break;
      }
      case 'wax.imprint': {
        const imprintRadius = Math.max(18, options.gap ?? spacing * 2);
        for (let i = 0; i < folios; i++) {
          const theta = volley * (options.rotation ?? 7) + (360 / folios) * i;
          const x = newest.source.x + cosDeg(theta) * imprintRadius;
          const y = newest.source.y + sinDeg(theta) * imprintRadius;
          const heading = atan2Deg(newest.target.y - y, newest.target.x - x) + theta * 0.05;
          if (!spawnDirected(context, spec, x, y, heading, speed)) break;
        }
        break;
      }
      case 'wax.witness':
        emitFolio(newest, folios, volley % 2 === 0 ? -3 : 3);
        break;
      case 'wax.service':
        fanFrom(
          context,
          spec,
          newest.source.x,
          newest.source.y,
          folios,
          atan2Deg(
            newest.target.y - newest.source.y,
            newest.target.x - newest.source.x,
          ),
          spread,
          speed,
        );
        break;
      case 'assay.rake':
        // A rake alternates around its archived bearing. The bounded swing
        // keeps a single-beam assay readable while still giving consecutive
        // declarations visibly different cuts.
        fanFrom(
          context,
          spec,
          oldest.source.x,
          oldest.source.y,
          folios,
          atan2Deg(oldest.target.y - oldest.source.y, oldest.target.x - oldest.source.x)
            + (volley % 2 === 0 ? -1 : 1)
            * bounded(options.swing ?? 0, -36, 36),
          spread,
          speed,
        );
        break;
      case 'assay.staves': {
        // Staves are filed on opposed sides of the archived spine. `gap` is
        // the bounded distance to the closest stave; later pairs step outward
        // by `spacing`, and the odd extra stave changes side each declaration.
        const staveGap = bounded(Math.abs(options.gap ?? spacing * 2), 4, 120);
        const headingBias = (volley % 2 === 0 ? -1 : 1)
          * (options.rotation ?? 6);
        const middle = (folios - 1) / 2;
        for (let i = 0; i < folios; i++) {
          const fromLeft = (i + volley) % 2 === 0;
          const side = fromLeft ? -1 : 1;
          const x = oldest.source.x + side * (
            staveGap + Math.floor(i / 2) * spacing
          );
          const y = oldest.source.y + (i - middle) * stagger;
          const theta = atan2Deg(oldest.target.y - y, oldest.target.x - x)
            + headingBias;
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'assay.trace':
        emitFolio(newest, folios);
        break;
      case 'assay.underline': {
        const route = atan2Deg(
          newest.target.y - oldest.target.y,
          newest.target.x - oldest.target.x,
        );
        // The underline rocks across the retained route by a bounded authored
        // swing, alternating rather than accumulating an unbounded rotation.
        const underlineSwing = (volley % 2 === 0 ? -1 : 1)
          * bounded(options.swing ?? 0, -36, 36);
        fanFrom(
          context,
          spec,
          newest.source.x,
          newest.source.y + stagger * 2,
          folios,
          route + 90 + underlineSwing,
          spread,
          speed,
        );
        break;
      }
      case 'estoppel.bars': {
        const barGap = Math.max(0, options.gap ?? spacing * 2);
        const barTurn = options.rotation ?? 8;
        for (let i = 0; i < folios; i++) {
          const record = records[i % records.length]!;
          const side = i % 2 === 0 ? -1 : 1;
          const x = record.source.x + side * (barGap + Math.floor(i / 2) * spacing);
          const y = record.source.y + (i - (folios - 1) / 2) * stagger;
          const theta = atan2Deg(record.target.y - y, record.target.x - x)
            + side * barTurn;
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'estoppel.redaction': {
        const first = records[0]!;
        const second = records[1]!;
        const half = Math.max(1, Math.ceil(folios / 2));
        emitFolio(
          { source: first.source, target: second.target },
          half,
          -12,
        );
        emitFolio(
          { source: second.source, target: first.target },
          half,
          12,
        );
        break;
      }
      case 'sealed.overprint': {
        const record = records[volley % records.length]!;
        const rotation = volley * (options.step ?? options.rotation ?? 12);
        for (let i = 0; i < folios; i++) {
          const theta = rotation + (360 / folios) * i;
          const x = record.source.x + cosDeg(theta) * spacing;
          const y = record.source.y + sinDeg(theta) * spacing;
          const heading = atan2Deg(record.target.y - y, record.target.x - x);
          if (!spawnDirected(context, spec, x, y, heading, speed)) break;
        }
        break;
      }
      case 'sealed.trace': {
        const perRecord = Math.max(1, Math.ceil(folios / records.length));
        for (let i = 0; i < records.length; i++) {
          emitFolio(records[i]!, perRecord, (i - 1) * 7);
        }
        break;
      }
      case 'sealed.closure': {
        const closureGap = Math.max(0, options.gap ?? spacing * 3);
        const closureStep = Math.abs(options.rotation ?? 6);
        for (let i = 0; i < folios; i++) {
          const record = records[i % records.length]!;
          const side = i % 2 === 0 ? -1 : 1;
          const x = record.source.x + side * closureGap;
          const y = record.source.y + Math.floor(i / 2) * stagger;
          const theta = atan2Deg(record.target.y - y, record.target.x - x)
            + side * (24 - (volley % 3) * closureStep);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
    }

    volley++;
    return true;
  };
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
    if (options?.form !== undefined) return createArchiveTraceFamily(options);
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
  /** Built-in Regent grammar. Omit for the public legacy groove. */
  form?: string;
  role?: string;
  period?: number;
  count?: number;
  spread?: number;
  swing?: number;
  arms?: number;
  step?: number;
  rotation?: number;
  gap?: number;
  /** Ticks between the live player and the route returned as a wall opening. */
  delay?: number;
  /** Older sample used to retain the route's direction as lateral wall drift. */
  trail?: number;
  columns?: number;
  /** Initial zero-based portcullis opening before retained-route translation. */
  gapColumn?: number;
  gapWidth?: number;
  /** Columns the portcullis opening advances per declaration. */
  shift?: number;
  left?: number;
  right?: number;
  speed?: number;
  driftScale?: number;
  maxDrift?: number;
  duration?: number;
}

const MEMORY_GROOVE_ROLES = {
  session: ['pressure', 'groove'],
  corolla: ['inner', 'outer', 'groove'],
  portcullis: ['lattice', 'groove'],
  attainder: ['warrants', 'groove', 'edict'],
  statute: ['wheel', 'groove', 'inscribe'],
  'sine-die': ['unwind', 'groove', 'peel'],
} as const;

/**
 * Regent's built-in family records the Boss source beside the player's route.
 * The old source displacement presses a bounded offset into every returned
 * opening, so a moving Regent changes the law she lays down rather than merely
 * sliding behind a field-wide wall that ignores her.
 */
function createMemoryGrooveFamily(
  options: Readonly<Partial<MemoryGrooveOptions>>,
): Pattern {
  const spec = requireSpec(options, 'memory-groove');
  const form = options.form!;
  const role = assertFamilyRole('memory-groove', form, options.role, MEMORY_GROOVE_ROLES);
  const fallbackDelay = form === 'session' ? 40
    : form === 'corolla' ? 48
      : form === 'portcullis' ? 42
        : form === 'attainder' ? 48
          : form === 'statute' ? 54
            : 42;
  const delay = Math.max(0, Math.floor(options.delay ?? fallbackDelay));
  const trail = whole(options.trail, form === 'sine-die' ? 10 : 12);
  const generations = form === 'session' ? 1
    : form === 'statute' || form === 'sine-die' ? 3
      : 2;
  // Every visible generation needs one older crossing to preserve its route
  // direction, so N emitted generations retain N + 1 route samples.
  const routeLookbacks = Array.from(
    { length: generations + 1 },
    (_, index) => delay + index * trail,
  );
  const maxLookback = routeLookbacks[routeLookbacks.length - 1] ?? delay;
  const period = whole(options.period, 58);
  const count = whole(options.count ?? options.arms, 5, 1);
  const columns = whole(options.columns ?? options.count, 9, 3);
  const gapColumn = Math.floor(options.gapColumn ?? Math.floor(columns / 2));
  const shift = Math.floor(options.shift ?? 1);
  const gapWidth = Math.max(1, options.gapWidth ?? 92);
  const left = options.left ?? 18;
  const right = options.right ?? 462;
  const speed = options.speed;
  const driftScale = options.driftScale ?? 3;
  const maxDrift = Math.abs(options.maxDrift ?? 14);
  const spread = options.spread ?? 34;
  const swing = options.swing ?? 12;
  const rotation = options.rotation ?? options.step ?? 7;
  const duration = options.duration ?? 0;
  const contourBias = form === 'session' ? 0
    : form === 'corolla' ? 1
      : form === 'portcullis' ? 2
        : form === 'attainder' ? 3
          : form === 'statute' ? 4
            : 5;
  const history: (ArchiveRecord | undefined)[] = new Array(maxLookback + 1);
  let cursor = 0;
  let samples = 0;
  let volley = 0;

  const sampleAgo = (ticks: number): ArchiveRecord | undefined => (
    history[wrapped(cursor - 1 - ticks, history.length)]
  );

  return (context) => {
    history[cursor] = {
      source: { x: context.x, y: context.y },
      target: { x: context.targetX, y: context.targetY },
    };
    cursor = (cursor + 1) % history.length;
    samples++;

    if (duration > 0 && context.age >= duration) return false;
    if (context.age % period !== 0 || samples <= maxLookback) return true;

    const routeRecords: ArchiveRecord[] = [];
    for (const lookback of routeLookbacks) {
      const record = sampleAgo(lookback);
      if (record === undefined) return true;
      routeRecords.push(record);
    }
    const records = routeRecords.slice(0, generations);

    const pressedGap = (record: ArchiveRecord): number => {
      const sourcePress = (record.source.x - context.x) * 0.35
        + (context.x - 240) * 0.12;
      return bounded(
        record.target.x + bounded(sourcePress, -36, 36),
        left,
        right,
      );
    };

    const routeDrift = (index: number): number => {
      const current = records[index]!;
      const older = routeRecords[index + 1]!;
      const raw = ((current.target.x - older.target.x) / trail) * driftScale;
      return bounded(raw, -maxDrift, maxDrift);
    };

    const emitGroove = (): void => {
      const generation = form === 'sine-die'
        ? records.length - 1 - (volley % records.length)
        : volley % records.length;
      const record = records[generation]!;
      const gap = pressedGap(record);
      const drift = routeDrift(generation);
      const opening = form === 'sine-die'
        ? gapWidth + (volley % 3) * 10
        : gapWidth;
      for (let i = 0; i < columns; i++) {
        const x = left + ((i + 0.5) / columns) * (right - left);
        if (Math.abs(x - gap) < opening / 2) continue;
        if (!spawnDirected(
          context,
          spec,
          x,
          context.y + generation * 7 + contourBias * 3,
          90 + drift
            + (generation - (records.length - 1) / 2) * 3
            + (contourBias - 2) * 1.5,
          speed,
        )) break;
      }
    };

    switch (`${form}.${role}`) {
      case 'session.pressure': {
        const record = records[0]!;
        fanFrom(
          context,
          spec,
          record.source.x,
          record.source.y,
          count,
          atan2Deg(
            record.target.y - record.source.y,
            record.target.x - record.source.x,
          ) + (volley % 2 === 0 ? -swing : swing),
          spread,
          speed,
        );
        break;
      }
      case 'session.groove':
      case 'corolla.groove':
      case 'portcullis.groove':
      case 'attainder.groove':
      case 'statute.groove':
      case 'sine-die.groove':
        emitGroove();
        break;
      case 'corolla.inner':
      case 'corolla.outer': {
        const outer = role === 'outer';
        const record = records[outer ? records.length - 1 : 0]!;
        const centreX = context.x + bounded((record.source.x - context.x) * 0.4, -28, 28);
        const centreY = context.y + (outer ? 8 : -4);
        const atRadius = outer ? 94 : 58;
        const gapBearing = atan2Deg(record.target.y - centreY, pressedGap(record) - centreX);
        const direction = outer ? -1 : 1;
        for (let i = 0; i < count; i++) {
          const theta = gapBearing + direction * (
            volley * rotation + (360 / count) * i
          );
          if (Math.abs(signedAngleDelta(theta, gapBearing)) < (options.gap ?? 48) / 2) {
            continue;
          }
          const x = centreX + cosDeg(theta) * atRadius;
          const y = centreY + sinDeg(theta) * atRadius;
          if (!spawnDirected(context, spec, x, y, theta + direction * 10, speed)) break;
        }
        break;
      }
      case 'portcullis.lattice': {
        const record = records[volley % records.length]!;
        const gap = pressedGap(record);
        const routeColumn = bounded(
          Math.floor(((gap - left) / (right - left)) * columns),
          0,
          columns - 1,
        );
        // The authored gate migrates exactly like a portcullis ratchet, while
        // the retained player route translates that ratchet around the field.
        // Thus `gapColumn`/`shift` are live without discarding the family's
        // source-and-route coupling.
        const routeOffset = routeColumn - Math.floor(columns / 2);
        const opening = wrapped(gapColumn + volley * shift + routeOffset, columns);
        // For this role `gapWidth` is authored in columns, matching lane-wall.
        const openColumns = Math.min(columns - 1, whole(options.gapWidth, 2));
        for (let i = 0; i < columns; i++) {
          if (wrapped(i - opening, columns) < openColumns) continue;
          const x = left + ((i + 0.5) / columns) * (right - left);
          const cross = (i + volley) % 2 === 0 ? -6 : 6;
          if (!spawnDirected(
            context,
            spec,
            x,
            context.y + (volley % 2) * 12,
            90 + cross,
            speed,
          )) break;
        }
        break;
      }
      case 'attainder.warrants': {
        const record = records[volley % records.length]!;
        const arc = Math.max(36, spread);
        const warrantRadius = Math.max(12, options.gap ?? 46);
        const warrantRotation = options.rotation ?? 0;
        const start = -arc / 2;
        for (let i = 0; i < count; i++) {
          const offset = count > 1 ? start + (arc / (count - 1)) * i : 0;
          const sourceTheta = atan2Deg(
            record.target.y - record.source.y,
            record.target.x - record.source.x,
          ) + volley * warrantRotation + offset;
          const x = record.source.x + cosDeg(sourceTheta) * warrantRadius;
          const y = record.source.y + sinDeg(sourceTheta) * warrantRadius * 0.52;
          const theta = atan2Deg(record.target.y - y, record.target.x - x);
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'attainder.edict': {
        const record = records[records.length - 1]!;
        fanFrom(
          context,
          spec,
          record.source.x,
          record.source.y,
          count,
          atan2Deg(
            record.target.y - record.source.y,
            record.target.x - record.source.x,
          ),
          spread,
          speed,
        );
        break;
      }
      case 'statute.wheel': {
        const record = records[volley % records.length]!;
        const centreX = record.source.x;
        const centreY = record.source.y;
        const routeBearing = atan2Deg(
          record.target.y - centreY,
          pressedGap(record) - centreX,
        );
        const atRadius = 48 + (volley % records.length) * 12;
        for (let i = 0; i < count; i++) {
          const theta = routeBearing + volley * rotation + (360 / count) * i;
          if (Math.abs(signedAngleDelta(theta, routeBearing)) < (options.gap ?? 36) / 2) continue;
          const x = centreX + cosDeg(theta) * atRadius;
          const y = centreY + sinDeg(theta) * atRadius;
          if (!spawnDirected(context, spec, x, y, theta + routeDrift(volley % records.length), speed)) break;
        }
        break;
      }
      case 'statute.inscribe': {
        const record = records[volley % records.length]!;
        const route = atan2Deg(
          record.target.y - record.source.y,
          record.target.x - record.source.x,
        );
        for (let i = 0; i < count; i++) {
          const x = record.source.x + (i - (count - 1) / 2) * 8;
          const y = record.source.y + (volley % records.length) * 6;
          const theta = route + (i - (count - 1) / 2) * rotation;
          if (!spawnDirected(context, spec, x, y, theta, speed)) break;
        }
        break;
      }
      case 'sine-die.unwind': {
        const record = records[records.length - 1 - (volley % records.length)]!;
        const away = atan2Deg(
          record.source.y - record.target.y,
          record.source.x - record.target.x,
        );
        fanFrom(
          context,
          spec,
          record.source.x,
          record.source.y,
          count,
          away + volley * rotation,
          spread,
          speed,
        );
        break;
      }
      case 'sine-die.peel': {
        const record = records[records.length - 1 - (volley % records.length)]!;
        const gap = pressedGap(record);
        const peelGap = Math.max(1, options.gap ?? gapWidth);
        const peelRotation = options.rotation ?? 0;
        for (let i = 0; i < columns; i++) {
          const x = left + ((i + 0.5) / columns) * (right - left);
          if (Math.abs(x - gap) < peelGap / 2) continue;
          const outward = x < gap ? -maxDrift : maxDrift;
          const side = x < gap ? -1 : 1;
          if (!spawnDirected(
            context,
            spec,
            x,
            context.y + 18,
            270 + outward + side * volley * peelRotation,
            speed,
          )) break;
        }
        break;
      }
    }

    // Generation order and retained contour selection advance with time even if
    // a saturated pool accepted only the first few bodies.
    volley++;
    return true;
  };
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
    if (options?.form !== undefined) return createMemoryGrooveFamily(options);
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
