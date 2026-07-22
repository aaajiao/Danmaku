/** Pure, fixed-tick presentation layout for boss distress and local recoil. */

export interface BossFeedbackFacts {
  readonly hpFraction: number;
  readonly phaseTicks: number;
  readonly impactKind?: 'light' | 'heavy';
  readonly impactFraction?: number;
  readonly direction8?: number;
}

export interface BossFeedbackLayout {
  readonly distress: number;
  readonly bodyScale: number;
  readonly crackAlpha: number;
  readonly crackFrame: number;
  readonly materialFrame: number;
  readonly heartAlpha: number;
  readonly heartScale: number;
  readonly heartFrame: number;
  readonly recoilX: number;
  readonly recoilY: number;
}

const THIRD = 1 / 3;
const DIR8 = [
  [1, 0], [0.707, 0.707], [0, 1], [-0.707, 0.707],
  [-1, 0], [-0.707, -0.707], [0, -1], [0.707, -0.707],
] as const;

export function bossDistress(hpFraction: number): number {
  const hp = hpFraction < 0 ? 0 : hpFraction > 1 ? 1 : hpFraction;
  const distress = (THIRD - hp) / THIRD;
  return distress < 0 ? 0 : distress > 1 ? 1 : distress;
}

export function bossFeedbackLayout(facts: BossFeedbackFacts): BossFeedbackLayout {
  const distress = bossDistress(facts.hpFraction);
  // A slow 48-tick double pulse. It is intentionally low-frequency and reads
  // only the replayed phase tick: no wall clock and no random stream.
  const beat = ((Math.max(0, facts.phaseTicks) % 48) + 48) % 48;
  const first = beat < 5 ? 1 - beat / 5 : 0;
  const secondAge = beat - 9;
  const second = secondAge >= 0 && secondAge < 4
    ? 0.68 * (1 - secondAge / 4)
    : 0;
  const pulse = Math.max(first, second);
  const impact = facts.impactKind === 'heavy' ? (facts.impactFraction ?? 0) : 0;
  // BossSystem stores a quantized octant, and this pure render seam repeats the
  // guard so direct preview/test callers cannot turn a fractional key into an
  // undefined vector.
  const rawDirection8 = facts.direction8 ?? 0;
  const direction8 = Number.isFinite(rawDirection8) ? Math.round(rawDirection8) : 0;
  const direction = DIR8[((direction8 % 8) + 8) % 8]!;

  return {
    distress,
    bodyScale: 1 - distress * 0.1,
    crackAlpha: distress * 0.82,
    crackFrame: Math.min(3, Math.floor(distress * 4)),
    materialFrame: Math.floor(Math.max(0, facts.phaseTicks) / 2) % 8,
    heartAlpha: distress * (0.28 + pulse * 0.5),
    heartScale: 0.82 + distress * 0.12 + pulse * 0.16,
    heartFrame: Math.min(7, Math.floor((1 - pulse) * 7)),
    // Continue along the incoming force vector: a player shot travelling up
    // pushes the rendered body upward, away from the player below it.
    recoilX: direction[0] * 4 * impact,
    recoilY: direction[1] * 4 * impact,
  };
}
