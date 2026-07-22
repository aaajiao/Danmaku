/**
 * v4 — 余白御寮 — built-in actor art.
 *
 * People and the default v4 projectile/feedback pack are project-owned art, but
 * they deliberately stay on separate texture families: one actor texture for
 * the five playable women, one for the sixteen enemy roles, and one for the five
 * bosses. A purchaser-local BulletPack remains an explicit compatibility reskin.
 * Keeping actors out of the 8k-projectile batch also keeps normal-blend,
 * baked-colour character art independent of bullet filtering and capacity.
 *
 * The visual source of truth is docs/v4-art-direction.md.  None of these frame
 * choices feed the simulation: names, ages, phase indices and replayed input
 * only select pixels after the fixed tick has already happened (CLAUDE.md rule
 * 1).  The textures use the existing y-down, flipY=false Atlas convention; a
 * second Y inversion would turn every strip upside down.
 */

import PLAYER_URL from '../assets/v4/actors-player-v4.png';
import ENEMIES_URL from '../assets/v4/actors-enemies-v4.png';
import BOSSES_URL from '../assets/v4/actors-bosses-v4.png';
import { loadAtlas, type Atlas } from './atlas';

export interface V4ActorSpec {
  readonly strip: string;
  /** Square display box in logical 480×640 pixels. */
  readonly size: number;
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
  sentinel: { strip: 'actor.boss.sentinel', size: 88 },
  warden: { strip: 'actor.boss.warden', size: 88 },
  magistrate: { strip: 'actor.boss.magistrate', size: 95 },
  chancellor: { strip: 'actor.boss.chancellor', size: 96 },
  regent: { strip: 'actor.boss.regent', size: 110 },
};

const PLAYER_ORDER = ['scout', 'lance', 'hound', 'spire', 'maw'] as const;
const ENEMY_ORDER = [
  'grunt',
  'weaver',
  'turret',
  'drifter',
  'lash',
  'hunter',
  'censer',
  'bastion',
  'clerk',
  'stele',
  'summons',
  'ray',
  'assessor',
  'usher',
  'marshal',
  'notary',
] as const;
const BOSS_ORDER = ['sentinel', 'warden', 'magistrate', 'chancellor', 'regent'] as const;

export interface V4ActorAtlases {
  readonly players: Atlas;
  readonly enemies: Atlas;
  readonly bosses: Atlas;
}

/** Load and describe the three engine-owned v4 actor sheets. */
export async function loadV4ActorAtlases(): Promise<V4ActorAtlases> {
  const [players, enemies, bosses] = await Promise.all([
    loadAtlas(PLAYER_URL),
    loadAtlas(ENEMIES_URL),
    loadAtlas(BOSSES_URL),
  ]);

  for (let i = 0; i < PLAYER_ORDER.length; i++) {
    const name = PLAYER_ORDER[i]!;
    players.defineStrip(V4_PLAYER_ACTORS[name]!.strip, {
      x: 0,
      y: i * 128,
      frameW: 128,
      frameH: 128,
      frames: 5,
      ticksPerFrame: 1,
      mode: 'once',
      color: 'baked',
    });
  }

  for (let i = 0; i < ENEMY_ORDER.length; i++) {
    const name = ENEMY_ORDER[i]!;
    enemies.defineStrip(V4_ENEMY_ACTORS[name]!.strip, {
      x: (i % 2) * 512,
      y: Math.floor(i / 2) * 128,
      frameW: 128,
      frameH: 128,
      frames: 4,
      ticksPerFrame: 8,
      mode: 'loop',
      color: 'baked',
    });
  }

  for (let i = 0; i < BOSS_ORDER.length; i++) {
    const name = BOSS_ORDER[i]!;
    bosses.defineStrip(V4_BOSS_ACTORS[name]!.strip, {
      x: 0,
      y: i * 192,
      frameW: 192,
      frameH: 192,
      frames: 5,
      ticksPerFrame: 12,
      mode: 'loop',
      color: 'baked',
    });
  }

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

/** Only the two breathing frames loop until the simulation exposes fire cues. */
export function v4EnemyIdleFrame(age: number): number {
  return Math.floor(Math.max(0, age) / 8) % 2;
}

/**
 * A boss rests in frame 0 and reveals one of four gestures per phase.
 *
 * The gesture appears for the phase opening and then alternates slowly with
 * rest.  It visualises an existing phase index; it never schedules a pattern.
 */
export function v4BossPoseFrame(
  entering: boolean,
  phaseIndex: number,
  phaseTicks: number,
): number {
  if (entering) return 0;
  const gesture = 1 + Math.abs(phaseIndex % 4);
  if (phaseTicks < 12) return gesture;
  return Math.floor((phaseTicks - 12) / 24) % 2 === 0 ? 0 : gesture;
}
