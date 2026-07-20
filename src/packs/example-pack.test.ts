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
import { validateManifest } from './manifest';
import { parsePng } from '../../tools/png';

const DIR = join(import.meta.dir, '..', '..', 'packs', 'example');
const FOLDER_NAME = 'example';

function readManifest(): unknown {
  return JSON.parse(readFileSync(join(DIR, 'pack.json'), 'utf8'));
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
