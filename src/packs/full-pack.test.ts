/**
 * Full-surface pack acceptance without a shipped sample directory.
 *
 * Product packs may come and go; validator and injector coverage must not make
 * `bun test` depend on one of them. The raw in-memory fixture exercises every
 * format-1 resource and content section, first through `validateManifest`, then
 * through the real registries via `injectPack`.
 */

import { describe, expect, test } from 'bun:test';
import '../packs/bundled';
import '../sim/item';
import '../render/backgrounds';
import { backgroundNames } from '../render/background';
import { laserSkinNames } from '../render/laser-skin';
import { portraitNames } from '../render/portrait';
import { BULLET_CELLS, MISSILE_STRIP_CELLS, SHIP_CELLS } from '../render/procedural';
import { getEnemySpec, hasEnemy } from '../sim/enemy';
import { getStage, hasStage } from '../content/stage';
import { getBossSpec, hasBoss } from '../sim/boss';
import { activePhaseIndices } from '../sim/difficulty';
import { hasItem } from '../sim/item';
import { shotNames } from '../content/shots';
import { optionNames } from '../sim/option';
import { bombNames } from '../sim/bomb';
import { effectNames } from '../sim/effects';
import { characterNames } from '../game/run';
import { validateManifest, type PackManifest } from './manifest';
import { injectPack } from './inject';
import {
  FULL_PACK_NAME,
  fullPackFixture,
  fullPackQualified as q,
} from './full-pack.fixture';

const CTX = {
  sprites: [...BULLET_CELLS],
  shipSprites: [...SHIP_CELLS],
  laserSprites: laserSkinNames(),
  missileSprites: [...MISSILE_STRIP_CELLS],
  scenes: backgroundNames(),
  portraits: portraitNames(),
};

function acceptedManifest(): PackManifest {
  const result = validateManifest(fullPackFixture(), FULL_PACK_NAME);
  if ('errors' in result) {
    throw new Error(`full pack fixture failed validation:\n${result.errors.join('\n')}`);
  }
  return result.manifest;
}

describe('the in-memory full pack fixture', () => {
  test('validates clean against the real manifest validator', () => {
    expect(acceptedManifest().name).toBe(FULL_PACK_NAME);
  });

  test('carries original-art metadata and every resource surface', () => {
    const manifest = acceptedManifest();
    expect(manifest.license).toBe('CC0-1.0');
    expect(manifest.assets).toEqual({
      bullets: 'bullets.png',
      ship: 'ship.png',
      filter: 'nearest',
    });
    expect(manifest.sounds).toEqual({ shot: 'shot.wav', pickup: 'pickup.wav' });
    expect(manifest.hud).toEqual({ life: 'life.png', bomb: 'bomb.png' });
    expect(manifest.portraits).toEqual({ keeper: 'portrait.png' });
    expect(manifest.music?.pulse).toEqual({
      file: 'pulse.wav',
      loopStart: 0.5,
      loopEnd: 2,
      volume: 0.5,
    });
  });

  test('declares every implemented content capability and section', () => {
    const manifest = acceptedManifest();
    expect(manifest.requires).toEqual([
      'content.enemies',
      'content.stages',
      'content.bosses',
      'content.shots',
      'content.characters',
      'content.options',
      'content.bombs',
      'content.effects',
      'content.items',
    ]);
    const content = manifest.content ?? {};
    expect(Object.keys(content.enemies ?? {}).sort()).toEqual(['drone', 'emitter']);
    expect(Object.keys(content.stages ?? {}).sort()).toEqual(['finale', 'trial']);
    expect(Object.keys(content.bosses ?? {})).toEqual(['keeper']);
    expect(Object.keys(content.shots ?? {})).toEqual(['lance']);
    expect(Object.keys(content.characters ?? {})).toEqual(['voyager']);
    expect(Object.keys(content.options ?? {})).toEqual(['orbit']);
    expect(Object.keys(content.bombs ?? {})).toEqual(['flare']);
    expect(Object.keys(content.effects ?? {})).toEqual(['spark']);
    expect(Object.keys(content.items ?? {})).toEqual(['token']);
  });

  test('keeps presentation names in content for the injector to qualify', () => {
    const manifest = acceptedManifest();
    expect(manifest.content?.stages?.trial?.music).toBe('pulse');
    expect(manifest.content?.bosses?.keeper?.dialogue?.[0]?.speaker).toBe('keeper');
  });
});

describe('the full fixture survives semantic injection', () => {
  test('qualifies its portrait, track and next-stage references', () => {
    injectPack(acceptedManifest(), CTX);
    expect(getBossSpec(q('keeper')).dialogue?.[0]?.speaker).toBe(q('keeper'));
    expect(getBossSpec(q('keeper')).dialogue?.[1]?.speaker).toBe('player');
    expect(getStage(q('trial')).music).toBe(q('pulse'));
    expect(getStage(q('trial')).next).toBe(q('finale'));
  });

  test('registers every content surface under qualified names', () => {
    const result = injectPack(acceptedManifest(), CTX);
    expect(result.campaigns).toEqual([{ label: q('trial'), stage: q('trial') }]);
    expect(result.characters).toEqual([q('voyager')]);
    expect(hasEnemy(q('emitter'))).toBe(true);
    expect(hasEnemy(q('drone'))).toBe(true);
    expect(hasStage(q('trial'))).toBe(true);
    expect(hasStage(q('finale'))).toBe(true);
    expect(hasBoss(q('keeper'))).toBe(true);
    expect(hasItem(q('token'))).toBe(true);
    expect(shotNames()).toContain(q('lance'));
    expect(optionNames()).toContain(q('orbit'));
    expect(bombNames()).toContain(q('flare'));
    expect(effectNames()).toContain(q('spark'));
    expect(characterNames()).toContain(q('voyager'));
  });

  test('retains difficulty-aware enemy and boss content', () => {
    injectPack(acceptedManifest(), CTX);
    expect(getEnemySpec(q('emitter')).patterns?.some((p) => p.difficulty !== undefined)).toBe(true);
    const phases = getBossSpec(q('keeper')).phases;
    expect(activePhaseIndices(phases, 'normal')).toEqual([0, 1]);
    expect(activePhaseIndices(phases, 'lunatic')).toEqual([0, 1, 2]);
  });
});
