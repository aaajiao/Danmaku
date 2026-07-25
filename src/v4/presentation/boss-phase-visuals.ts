/**
 * V4's presentation-only contract for the four main Boss fights.
 *
 * Every phase owns one projectile anchor and one declaration strip. All main
 * Boss attack slots use that Boss's exclusive spatial family; exactly one slot
 * carries `options.anchor: 1`, and its projectile name is the phase anchor.
 * Render/tooling resolves the two strings into pixels and fixed-tick animation.
 * None of these values participate in movement, collision, damage or RNG.
 */

export type BossPhaseBoss = 'sentinel' | 'magistrate' | 'chancellor' | 'regent';

export interface VisualSequence {
  readonly frameW: number;
  readonly frameH: number;
  readonly frames: number;
  readonly ticksPerFrame: number;
}

export interface BossPhaseVisual {
  readonly boss: BossPhaseBoss;
  /** Index in the BossSpec's authored `phases` array, including gated phases. */
  readonly phaseIndex: number;
  /** Stable presentation id; it is not player-facing spell-card copy. */
  readonly id: string;
  /** Bullet/laser skin carried by this phase's marked family-role anchor. */
  readonly projectile: string;
  /** Once-strip played when this exact phase begins. */
  readonly castStrip: `boss.cast.${BossPhaseBoss}.${string}`;
  /** Native bullet-strip geometry and fixed-tick cadence. */
  readonly bulletSequence: VisualSequence;
  /** Native/fallback declaration-strip geometry and fixed-tick cadence. */
  readonly castSequence: VisualSequence;
}

export const V4_BOSS_PHASE_VISUALS = [
  {
    boss: 'sentinel',
    phaseIndex: 0,
    id: 'approach',
    projectile: 'scale.shard',
    castStrip: 'boss.cast.sentinel.approach',
    bulletSequence: { frameW: 32, frameH: 32, frames: 8, ticksPerFrame: 3 },
    castSequence: { frameW: 128, frameH: 128, frames: 10, ticksPerFrame: 3 },
  },
  {
    boss: 'sentinel',
    phaseIndex: 1,
    id: 'tidal-corolla',
    projectile: 'petal.corolla',
    castStrip: 'boss.cast.sentinel.tidal-corolla',
    bulletSequence: { frameW: 32, frameH: 32, frames: 10, ticksPerFrame: 3 },
    castSequence: { frameW: 128, frameH: 128, frames: 12, ticksPerFrame: 2 },
  },
  {
    boss: 'sentinel',
    phaseIndex: 2,
    id: 'vigil-unbroken',
    projectile: 'petal.vigil',
    castStrip: 'boss.cast.sentinel.vigil-unbroken',
    bulletSequence: { frameW: 32, frameH: 32, frames: 12, ticksPerFrame: 2 },
    castSequence: { frameW: 128, frameH: 128, frames: 14, ticksPerFrame: 2 },
  },
  {
    boss: 'sentinel',
    phaseIndex: 3,
    id: 'total-eclipse',
    projectile: 'petal.eclipse',
    castStrip: 'boss.cast.sentinel.total-eclipse',
    bulletSequence: { frameW: 32, frameH: 32, frames: 14, ticksPerFrame: 2 },
    castSequence: { frameW: 128, frameH: 128, frames: 16, ticksPerFrame: 1 },
  },

  {
    boss: 'magistrate',
    phaseIndex: 0,
    id: 'arraignment',
    projectile: 'orb.small.arraignment',
    castStrip: 'boss.cast.magistrate.arraignment',
    bulletSequence: { frameW: 34, frameH: 32, frames: 6, ticksPerFrame: 4 },
    castSequence: { frameW: 144, frameH: 96, frames: 9, ticksPerFrame: 3 },
  },
  {
    boss: 'magistrate',
    phaseIndex: 1,
    id: 'writ-of-pursuit',
    projectile: 'scale.escrow',
    castStrip: 'boss.cast.magistrate.writ-of-pursuit',
    bulletSequence: { frameW: 34, frameH: 32, frames: 8, ticksPerFrame: 3 },
    castSequence: { frameW: 144, frameH: 96, frames: 11, ticksPerFrame: 2 },
  },
  {
    boss: 'magistrate',
    phaseIndex: 2,
    id: 'colonnade',
    projectile: 'scale.assize',
    castStrip: 'boss.cast.magistrate.colonnade',
    bulletSequence: { frameW: 34, frameH: 32, frames: 10, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 96, frames: 13, ticksPerFrame: 2 },
  },
  {
    boss: 'magistrate',
    phaseIndex: 3,
    id: 'assize',
    projectile: 'kunai.assize',
    castStrip: 'boss.cast.magistrate.assize',
    bulletSequence: { frameW: 34, frameH: 32, frames: 12, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 96, frames: 15, ticksPerFrame: 1 },
  },

  {
    boss: 'chancellor',
    phaseIndex: 0,
    id: 'appeal',
    projectile: 'orb.small.brief',
    castStrip: 'boss.cast.chancellor.appeal',
    bulletSequence: { frameW: 36, frameH: 34, frames: 10, ticksPerFrame: 5 },
    castSequence: { frameW: 144, frameH: 128, frames: 10, ticksPerFrame: 3 },
  },
  {
    boss: 'chancellor',
    phaseIndex: 1,
    id: 'binding-precedent',
    projectile: 'orb.small.precedent',
    castStrip: 'boss.cast.chancellor.binding-precedent',
    bulletSequence: { frameW: 36, frameH: 34, frames: 12, ticksPerFrame: 4 },
    castSequence: { frameW: 144, frameH: 128, frames: 12, ticksPerFrame: 3 },
  },
  {
    boss: 'chancellor',
    phaseIndex: 2,
    id: 'wax-and-witness',
    projectile: 'orb.small.wax',
    castStrip: 'boss.cast.chancellor.wax-and-witness',
    bulletSequence: { frameW: 36, frameH: 34, frames: 14, ticksPerFrame: 3 },
    castSequence: { frameW: 144, frameH: 128, frames: 14, ticksPerFrame: 2 },
  },
  {
    boss: 'chancellor',
    phaseIndex: 3,
    id: 'sweeping-assay',
    projectile: 'orb.small.assay-trace',
    castStrip: 'boss.cast.chancellor.sweeping-assay',
    bulletSequence: { frameW: 36, frameH: 34, frames: 16, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 128, frames: 16, ticksPerFrame: 2 },
  },
  {
    boss: 'chancellor',
    phaseIndex: 4,
    id: 'estoppel',
    projectile: 'orb.small.estoppel',
    castStrip: 'boss.cast.chancellor.estoppel',
    bulletSequence: { frameW: 36, frameH: 34, frames: 18, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 128, frames: 18, ticksPerFrame: 1 },
  },
  {
    boss: 'chancellor',
    phaseIndex: 5,
    id: 'sealed',
    projectile: 'orb.small.sealed',
    castStrip: 'boss.cast.chancellor.sealed',
    bulletSequence: { frameW: 36, frameH: 34, frames: 20, ticksPerFrame: 1 },
    castSequence: { frameW: 144, frameH: 128, frames: 20, ticksPerFrame: 1 },
  },

  {
    boss: 'regent',
    phaseIndex: 0,
    id: 'session',
    projectile: 'orb.small.session',
    castStrip: 'boss.cast.regent.session',
    bulletSequence: { frameW: 34, frameH: 36, frames: 12, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 144, frames: 11, ticksPerFrame: 3 },
  },
  {
    boss: 'regent',
    phaseIndex: 1,
    id: 'corolla-regnant',
    projectile: 'orb.small.corolla-regnant',
    castStrip: 'boss.cast.regent.corolla-regnant',
    bulletSequence: { frameW: 34, frameH: 36, frames: 14, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 144, frames: 13, ticksPerFrame: 2 },
  },
  {
    boss: 'regent',
    phaseIndex: 2,
    id: 'portcullis',
    projectile: 'orb.medium.lattice',
    castStrip: 'boss.cast.regent.portcullis',
    bulletSequence: { frameW: 34, frameH: 36, frames: 16, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 144, frames: 15, ticksPerFrame: 2 },
  },
  {
    boss: 'regent',
    phaseIndex: 3,
    id: 'attainder',
    projectile: 'orb.small.attainder',
    castStrip: 'boss.cast.regent.attainder',
    bulletSequence: { frameW: 34, frameH: 36, frames: 18, ticksPerFrame: 2 },
    castSequence: { frameW: 144, frameH: 144, frames: 17, ticksPerFrame: 2 },
  },
  {
    boss: 'regent',
    phaseIndex: 4,
    id: 'statute',
    projectile: 'orb.small.statute',
    castStrip: 'boss.cast.regent.statute',
    bulletSequence: { frameW: 34, frameH: 36, frames: 20, ticksPerFrame: 1 },
    castSequence: { frameW: 144, frameH: 144, frames: 19, ticksPerFrame: 1 },
  },
  {
    boss: 'regent',
    phaseIndex: 5,
    id: 'sine-die',
    projectile: 'orb.small.sine-die',
    castStrip: 'boss.cast.regent.sine-die',
    bulletSequence: { frameW: 34, frameH: 36, frames: 22, ticksPerFrame: 1 },
    castSequence: { frameW: 144, frameH: 144, frames: 21, ticksPerFrame: 1 },
  },
] as const satisfies readonly BossPhaseVisual[];

export type BossPhaseId = typeof V4_BOSS_PHASE_VISUALS[number]['id'];
export type BossPhaseProjectile = typeof V4_BOSS_PHASE_VISUALS[number]['projectile'];
export type BossPhaseCastStrip = typeof V4_BOSS_PHASE_VISUALS[number]['castStrip'];

/** Loud lookup for runtime/tooling consumers; every shipped Boss phase is listed. */
export function bossPhaseVisual(
  boss: BossPhaseBoss,
  phaseIndex: number,
): typeof V4_BOSS_PHASE_VISUALS[number] {
  const visual = V4_BOSS_PHASE_VISUALS.find(
    (candidate) => candidate.boss === boss && candidate.phaseIndex === phaseIndex,
  );
  if (visual === undefined) {
    throw new Error(`no v4 Boss phase visual for "${boss}" phase ${phaseIndex}`);
  }
  return visual;
}
