/**
 * Player weapons — the registry only.
 *
 * A character's shot table lives on its `PlayerConfig` as a `levels` ladder; a
 * registry lets a weapon be named, compared and reused rather than written
 * inline at one ship's call site. That was the argument for lifting the weapons
 * out of `run.ts` into content, and the same argument runs one hop further: the
 * four starter weapons (spread/needle/homing/laser) now live in the bundled base
 * pack (`tools/make-base-pack.ts` → `base-pack.json`) and register through the
 * inject pipeline, the player-side half of decisions-round2 §D. This file keeps
 * the machinery only — the type, the registry and its accessors.
 *
 * Tiers are indexed exactly as `OptionSpec.levels` is: `levels[n]` is the
 * weapon at power tier `n`, and `Player.#shot` clamps the index, so a table
 * shorter than the power ceiling keeps its strongest entry rather than
 * disarming the ship. Tier 0 is the bare weapon — unlike options, it is never
 * empty, because a ship that cannot shoot until its first pickup has no way to
 * earn one.
 *
 * Pure content: no renderer, no `dt`. Speeds are px/tick and `period` is a tick
 * count (CLAUDE.md, rule 1), and headings are degrees in the y-down space the
 * motion DSL uses — 270 is up, toward the enemy.
 */

import type { ShotSpec } from '../sim/player';

export interface ShotType {
  name: string;
  /** By power tier, like OptionSpec.levels. */
  levels: readonly ShotSpec[];
  description?: string;
}

const registry = new Map<string, ShotType>();

export function defineShot(name: string, type: ShotType): void {
  if (registry.has(name)) {
    throw new Error(`shot "${name}" is already defined`);
  }
  // The key and the field are two places to write the same string, so they are
  // two places to write different ones. Content is referenced by name
  // everywhere; a type whose own `name` disagreed with its key would report the
  // wrong weapon in every diagnostic that reads it back.
  if (type.name !== name) {
    throw new Error(`shot "${name}" declares the name "${type.name}"`);
  }
  registry.set(name, type);
}

export function getShot(name: string): ShotType {
  const type = registry.get(name);
  if (!type) throw new Error(`unknown shot "${name}"`);
  return type;
}

/** Registration order. */
export function shotNames(): readonly string[] {
  return [...registry.keys()];
}
