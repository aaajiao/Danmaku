/**
 * `packs/example/` is the pack a real author copies first, so this is the test
 * that keeps it from drifting out of compliance with the rules it is meant to
 * demonstrate. Everything here reads the committed files straight off disk —
 * the same bytes `bun run dev` and `tools/copy-packs.ts` would serve — and
 * runs them through the real `validateManifest` and the real `parsePng`
 * (`tools/png.ts`), never a second hand-maintained idea of either.
 *
 * `bun test` has no canvas and no fetch, so this stops at what bytes-on-disk
 * can prove: the manifest validates, every file it names exists, and PNG
 * dimensions match the spec. The pixel-level checks — cell margins,
 * whiteness, the hitbox marker — already ran once when
 * `tools/make-example-pack.ts` generated these files (see that script's
 * `verifyBullets`/`verifyShip`) and run again for real in the browser loader;
 * this file's job is only to notice if the checked-in bytes and the manifest
 * that describes them ever fall out of step.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../content'; // built-in patterns, behaviours, enemies, bosses, stages
import '../sim/item'; // built-in items (power, score, …); content imports it type-only
import '../render/backgrounds'; // registers the scenes the injector resolves against
import { backgroundNames } from '../render/background';
import { BULLET_CELLS } from '../render/procedural';
import { hasEnemy } from '../sim/enemy';
import { hasStage } from '../content/stage';
import { validateManifest, type PackManifest } from './manifest';
import { injectPack } from './inject';
import { parsePng } from '../../tools/png';

const DIR = join(import.meta.dir, '..', '..', 'packs', 'example');
const FOLDER_NAME = 'example';

function readManifest(): unknown {
  return JSON.parse(readFileSync(join(DIR, 'pack.json'), 'utf8'));
}

/**
 * The real name sets the browser loader would hand the injector: every atlas
 * cell the sheet defines, plus the ship region, and every registered scene.
 * Imported the way any pack-tree module may (this tree is browser-side and its
 * boundary permits `render`), so the injection this test proves is the one that
 * runs for real rather than a hand-kept copy of the valid names.
 */
const CTX = { sprites: [...BULLET_CELLS, 'ship'], scenes: backgroundNames() };

/** Validate the committed manifest and hand back the accepted `PackManifest`. */
function acceptedManifest(): PackManifest {
  const result = validateManifest(readManifest(), FOLDER_NAME);
  if ('errors' in result) {
    throw new Error(`packs/example/pack.json failed validation:\n${result.errors.join('\n')}`);
  }
  return result.manifest;
}

describe('packs/example — the reference pack', () => {
  test('pack.json validates clean against the real validator', () => {
    const result = validateManifest(readManifest(), FOLDER_NAME);
    if ('errors' in result) {
      throw new Error(`packs/example/pack.json failed validation:\n${result.errors.join('\n')}`);
    }
    expect('manifest' in result).toBe(true);
  });

  test('name equals the directory name', () => {
    const manifest = readManifest() as { name?: unknown };
    expect(manifest.name).toBe(FOLDER_NAME);
  });

  test('license is present (CLAUDE.md rule 9)', () => {
    const manifest = readManifest() as { license?: unknown };
    expect(typeof manifest.license).toBe('string');
    expect((manifest.license as string).length).toBeGreaterThan(0);
  });

  test('every file the manifest declares actually exists', () => {
    const manifest = readManifest() as {
      assets?: { bullets?: string; ship?: string };
      sounds?: Record<string, string>;
      hud?: { life?: string; bomb?: string };
    };

    const declared: string[] = [
      manifest.assets?.bullets,
      manifest.assets?.ship,
      manifest.hud?.life,
      manifest.hud?.bomb,
      ...Object.values(manifest.sounds ?? {}),
    ].filter((p): p is string => typeof p === 'string');

    // The manifest is meant to exercise every v1 resource field — a pack this
    // test is supposed to keep honest that declared none would pass the loop
    // below vacuously and prove nothing.
    expect(declared.length).toBeGreaterThan(0);

    for (const relPath of declared) {
      expect(existsSync(join(DIR, relPath))).toBe(true);
    }
  });

  test('README.md exists — the annotation pack.json cannot carry', () => {
    expect(existsSync(join(DIR, 'README.md'))).toBe(true);
  });

  describe('PNG dimensions match the spec, read through an independent parser', () => {
    test('bullets.png is 256×64 (8×2 cells of 32×32)', () => {
      const png = parsePng(new Uint8Array(readFileSync(join(DIR, 'bullets.png'))));
      expect(png.width).toBe(256);
      expect(png.height).toBe(64);
    });

    test('ship.png is 64×64', () => {
      const png = parsePng(new Uint8Array(readFileSync(join(DIR, 'ship.png'))));
      expect(png.width).toBe(64);
      expect(png.height).toBe(64);
    });

    test.each(['life.png', 'bomb.png'])('%s is at most 16×16', (name) => {
      const png = parsePng(new Uint8Array(readFileSync(join(DIR, name))));
      expect(png.width).toBeLessThanOrEqual(16);
      expect(png.height).toBeLessThanOrEqual(16);
    });
  });
});

/**
 * The format-2 half: the committed manifest carries a real `content` section,
 * and it survives the *second* validation layer too — `manifest.ts` checked its
 * shape above; here `inject.ts` resolves every name it writes against the real
 * registries and registers it. Shape passing does not imply the names resolve,
 * so this is a distinct claim, and it is the one that would catch a typo'd
 * built-in reference (`snetinel`, `expanase`) that shape validation cannot see.
 *
 * Injection is idempotent per pack name, so this and `example-play.test.ts` both
 * injecting `example` in one `bun test` process is a no-op the second time, not
 * a duplicate-definition throw — which is why neither needs `resetInjectedForTest`.
 */
describe('packs/example — format-2 content', () => {
  test('the manifest carries requires + content, both validated as shape', () => {
    const manifest = acceptedManifest();
    expect(manifest.requires).toEqual(['content.enemies', 'content.stages']);
    expect(Object.keys(manifest.content?.enemies ?? {}).sort()).toEqual(['drone', 'ember']);
    expect(Object.keys(manifest.content?.stages ?? {}).sort()).toEqual(['ashfall', 'gauntlet']);
  });

  test('inject resolves every name and registers under qualified names', () => {
    const result = injectPack(acceptedManifest(), CTX);

    // Only the entry stage becomes a campaign row, labelled by its qualified name.
    expect(result.campaigns).toEqual([{ label: 'example/gauntlet', stage: 'example/gauntlet' }]);

    // Every pack entry lands namespaced; the built-ins it references are untouched.
    expect(hasEnemy('example/ember')).toBe(true);
    expect(hasEnemy('example/drone')).toBe(true);
    expect(hasStage('example/gauntlet')).toBe(true);
    expect(hasStage('example/ashfall')).toBe(true);
  });
});
