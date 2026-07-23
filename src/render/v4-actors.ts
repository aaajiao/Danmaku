/**
 * v4 — 余白御寮 — actor semantics and pack-backed actor art.
 *
 * People and the default v4 projectile/feedback pack are project-owned art. The
 * v4 pack supplies one actor texture for the five playable women, one for the
 * sixteen enemy roles, and one for the five bosses; another pack may omit any
 * family and let the ordinary ship/bullet presentation remain the floor.
 * Keeping actors out of the 8k-projectile batch also keeps normal-blend,
 * baked-colour character art independent of bullet filtering and capacity.
 *
 * The visual source of truth is docs/v4-art-direction.md.  None of these frame
 * choices feed the simulation: names, ages, phase indices and replayed input
 * only select pixels after the fixed tick has already happened (CLAUDE.md rule
 * 1).  The textures use the existing y-down, flipY=false Atlas convention; a
 * second Y inversion would turn every strip upside down.
 */

import { loadAtlas, type Atlas } from './atlas';

export interface V4ActorSpec {
  readonly strip: string;
  /** Square display box in logical 480×640 pixels. */
  readonly size: number;
  /** Optional v4-only final-death identity strip on the shared FX atlas. */
  readonly deathStrip?: string;
}

export const V4_PLAYER_ACTORS: Readonly<Record<string, V4ActorSpec>> = {
  scout: { strip: 'actor.player.scout', size: 52 },
  lance: { strip: 'actor.player.lance', size: 52 },
  hound: { strip: 'actor.player.hound', size: 54 },
  spire: { strip: 'actor.player.spire', size: 54 },
  maw: { strip: 'actor.player.maw', size: 54 },
};

export const V4_ENEMY_ACTORS: Readonly<Record<string, V4ActorSpec>> = {
  grunt: { strip: 'actor.enemy.grunt', size: 42 },
  weaver: { strip: 'actor.enemy.weaver', size: 48 },
  turret: { strip: 'actor.enemy.turret', size: 54 },
  drifter: { strip: 'actor.enemy.drifter', size: 44 },
  lash: { strip: 'actor.enemy.lash', size: 48 },
  hunter: { strip: 'actor.enemy.hunter', size: 48 },
  censer: { strip: 'actor.enemy.censer', size: 54 },
  bastion: { strip: 'actor.enemy.bastion', size: 58 },
  clerk: { strip: 'actor.enemy.clerk', size: 47 },
  stele: { strip: 'actor.enemy.stele', size: 54 },
  summons: { strip: 'actor.enemy.summons', size: 46 },
  ray: { strip: 'actor.enemy.ray', size: 52 },
  assessor: { strip: 'actor.enemy.assessor', size: 52 },
  usher: { strip: 'actor.enemy.usher', size: 46 },
  marshal: { strip: 'actor.enemy.marshal', size: 58 },
  notary: { strip: 'actor.enemy.notary', size: 54 },
};

export const V4_BOSS_ACTORS: Readonly<Record<string, V4ActorSpec>> = {
  sentinel: { strip: 'actor.boss.sentinel', size: 88, deathStrip: 'boss.death.sentinel' },
  warden: { strip: 'actor.boss.warden', size: 88, deathStrip: 'boss.death.warden' },
  magistrate: { strip: 'actor.boss.magistrate', size: 95, deathStrip: 'boss.death.magistrate' },
  chancellor: { strip: 'actor.boss.chancellor', size: 96, deathStrip: 'boss.death.chancellor' },
  regent: { strip: 'actor.boss.regent', size: 110, deathStrip: 'boss.death.regent' },
};

export interface ActorStripInput {
  readonly x: number;
  readonly y: number;
  readonly frameW: number;
  readonly frameH: number;
  readonly frames?: number;
  readonly stride?: number;
  readonly ticksPerFrame?: number;
  readonly mode?: 'loop' | 'once';
  readonly color?: 'tinted' | 'baked';
  readonly contentW?: number;
  readonly contentH?: number;
}

export interface ActorSheetInput {
  readonly url: string;
  readonly strips: Readonly<Record<string, ActorStripInput>>;
}

export interface V4ActorAtlasInputs {
  readonly players?: ActorSheetInput;
  readonly enemies?: ActorSheetInput;
  readonly bosses?: ActorSheetInput;
}

export interface V4ActorAtlases {
  readonly players?: Atlas;
  readonly enemies?: Atlas;
  readonly bosses?: Atlas;
}

async function loadActorAtlas(input: ActorSheetInput | undefined): Promise<Atlas | undefined> {
  if (input === undefined) return undefined;
  const atlas = await loadAtlas(input.url);
  for (const [name, strip] of Object.entries(input.strips)) {
    atlas.defineStrip(name, {
      x: strip.x,
      y: strip.y,
      frameW: strip.frameW,
      frameH: strip.frameH,
      frames: strip.frames ?? 1,
      stride: strip.stride,
      ticksPerFrame: strip.ticksPerFrame ?? 1,
      mode: strip.mode ?? 'once',
      color: strip.color,
      contentW: strip.contentW,
      contentH: strip.contentH,
    });
  }
  return atlas;
}

/** Load only the actor texture families supplied by the selected pack. */
export async function loadV4ActorAtlases(
  inputs: V4ActorAtlasInputs | undefined,
): Promise<V4ActorAtlases> {
  const [players, enemies, bosses] = await Promise.all([
    loadActorAtlas(inputs?.players),
    loadActorAtlas(inputs?.enemies),
    loadActorAtlas(inputs?.bosses),
  ]);
  return { players, enemies, bosses };
}

/**
 * Five authored poses are banking states, not a blinking loop.
 *
 * A new direction first takes the gentle pose, then settles into the hard
 * bank.  Neutral is always frame 2. `heldTicks` is derived from the replayed
 * button mask by Player, so the same replay selects the same frame at a tick.
 */
export function v4PlayerBankFrame(intent: -1 | 0 | 1, heldTicks: number): number {
  if (intent === 0) return 2;
  if (intent < 0) return heldTicks <= 3 ? 1 : 0;
  return heldTicks <= 3 ? 3 : 4;
}

/** The two breathing frames used whenever no recent attack needs staging. */
export function v4EnemyIdleFrame(age: number): number {
  return Math.floor(Math.max(0, age) / 8) % 2;
}

/**
 * Map an enemy's actual successful volley onto its authored attack strip.
 *
 * Frames 2/3 are attack/recover. `ticksSinceFire` is simulation-owned and only
 * advances after a volley really entered the bullet pool, so a saturated pool
 * cannot fabricate an attack pose. The pose never feeds back into simulation.
 */
export function v4EnemyPoseFrame(age: number, ticksSinceFire: number | undefined): number {
  if (ticksSinceFire === undefined || ticksSinceFire > 7) return v4EnemyIdleFrame(age);
  return ticksSinceFire <= 3 ? 2 : 3;
}

export interface V4BossPoseFacts {
  readonly entering: boolean;
  readonly phaseTicks: number;
  readonly ticksSinceFire: number | undefined;
  readonly phaseHpFraction: number;
  readonly phaseTimeFraction: number;
  readonly impactKind?: 'light' | 'heavy';
  readonly impactFraction?: number;
}

/**
 * Select the five authored boss poses by meaning, never by phase-number modulo.
 *
 * The opening is a short prepare punctuation, a successful volley drives
 * cast/expand, and the final health/time eighth drives close. Every input is an
 * existing fixed-tick simulation fact and this function schedules no gameplay.
 */
export function v4BossPoseFrame(
  facts: V4BossPoseFacts,
): number {
  if (facts.entering) return 0;
  if (facts.impactKind === 'heavy' && (facts.impactFraction ?? 0) > 0) return 4;
  if (facts.phaseTicks < 4) return 1;
  if (facts.ticksSinceFire !== undefined && facts.ticksSinceFire <= 3) return 2;
  if (facts.phaseHpFraction <= 0.125 || facts.phaseTimeFraction <= 0.125) return 4;
  if (facts.ticksSinceFire !== undefined && facts.ticksSinceFire <= 11) return 3;
  return 0;
}
