/**
 * The manifest module is the pack author's compatibility contract, and its error
 * strings are that contract's text. Every rejection path is asserted verbatim
 * here: a reworded error is a breaking change, and this file is where that break
 * shows up. It also proves the module's purity structurally — it reads its own
 * source and fails if a value from `render`, `sim`, `content` or `game` was ever
 * imported, because that is the property that lets the whole thing run headless.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  editDistance,
  hashPack,
  packsMetaString,
  parseIndex,
  SOUND_NAMES,
  SUPPORTED_FORMATS,
  validateManifest,
  type PackManifest,
} from './manifest';

/** A minimal manifest that passes every check, for folder "candy". */
function valid(): Record<string, unknown> {
  return {
    format: 1,
    name: 'candy',
    version: '1.0.0',
    author: 'Someone',
    license: 'CC0-1.0',
  };
}

/** The errors array from a rejection, or fail loudly if it unexpectedly passed. */
function errorsOf(raw: unknown, folder = 'candy'): string[] {
  const result = validateManifest(raw, folder);
  if ('manifest' in result) {
    throw new Error(`expected rejection, got a valid manifest: ${JSON.stringify(result.manifest)}`);
  }
  return result.errors;
}

describe('a valid manifest round-trips', () => {
  test('the minimal manifest is accepted and returned unchanged', () => {
    const raw = valid();
    const result = validateManifest(raw, 'candy');
    expect('manifest' in result).toBe(true);
    if ('manifest' in result) expect(result.manifest).toEqual(raw as unknown as PackManifest);
  });

  test('every v1 field exercised is accepted', () => {
    const raw = {
      format: 1,
      name: 'candy',
      version: '2.3.4',
      author: 'Someone',
      license: 'CC0-1.0',
      description: 'a bright candy skin',
      assets: { bullets: 'bullets.png', ship: 'ship.png', filter: 'linear' },
      sounds: { shot: 'shot.wav', death: 'death.wav' },
      hud: { life: 'life.png', bomb: 'bomb.png' },
      requires: [],
    };
    const result = validateManifest(raw, 'candy');
    expect(result).toEqual({ manifest: raw as unknown as PackManifest });
  });

  test('SUPPORTED_FORMATS is a list containing 1', () => {
    expect(SUPPORTED_FORMATS).toEqual([1]);
  });
});

describe('format', () => {
  test('missing', () => {
    const raw = valid();
    delete raw.format;
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: missing required field "format" — expected 1 (this engine supports formats: 1)',
    );
  });

  test('wrong type', () => {
    expect(errorsOf({ ...valid(), format: '1' })).toContain(
      'pack "candy": pack.json: field "format" must be a number — this engine supports formats: 1',
    );
  });

  test('unsupported value', () => {
    expect(errorsOf({ ...valid(), format: 2 })).toContain(
      'pack "candy": pack.json: format 2 is not supported — this engine supports formats: 1',
    );
  });
});

describe('name', () => {
  test('missing', () => {
    const raw = valid();
    delete raw.name;
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: missing required field "name" — it must equal the directory name "candy" and match [a-z0-9-]{1,32}',
    );
  });

  test('wrong type', () => {
    expect(errorsOf({ ...valid(), name: 7 })).toContain(
      'pack "candy": pack.json: field "name" must be a string',
    );
  });

  test('does not equal the folder', () => {
    expect(errorsOf({ ...valid(), name: 'Candy' })).toContain(
      'pack "candy": pack.json: name "Candy" must equal the directory name "candy" and match [a-z0-9-]{1,32}',
    );
  });

  test('fails the character pattern even when it equals a bad folder', () => {
    expect(errorsOf({ ...valid(), name: 'Candy_Land' }, 'Candy_Land')).toContain(
      'pack "Candy_Land": pack.json: name "Candy_Land" must equal the directory name "Candy_Land" and match [a-z0-9-]{1,32}',
    );
  });
});

describe('version, author, license', () => {
  test('version missing', () => {
    const raw = valid();
    delete raw.version;
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: missing required field "version" — a string, e.g. "1.0.0"',
    );
  });

  test('author missing', () => {
    const raw = valid();
    delete raw.author;
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: missing required field "author" — name the author (provenance; CLAUDE.md rule 9)',
    );
  });

  test('license missing names rule 9', () => {
    const raw = valid();
    delete raw.license;
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: missing required field "license" — state the provenance of this art (everything shipped must be original; CLAUDE.md rule 9)',
    );
  });

  test('license wrong type', () => {
    expect(errorsOf({ ...valid(), license: 42 })).toContain(
      'pack "candy": pack.json: field "license" must be a string',
    );
  });
});

describe('description and requires', () => {
  test('description wrong type', () => {
    expect(errorsOf({ ...valid(), description: 5 })).toContain(
      'pack "candy": pack.json: field "description" must be a string',
    );
  });

  test('requires wrong type', () => {
    expect(errorsOf({ ...valid(), requires: 'netplay' })).toContain(
      'pack "candy": pack.json: requires must be an array of strings',
    );
  });

  test('requires with a non-string entry', () => {
    expect(errorsOf({ ...valid(), requires: [1] })).toContain(
      'pack "candy": pack.json: requires must be an array of strings',
    );
  });

  test('non-empty requires is refused, naming the capability', () => {
    expect(errorsOf({ ...valid(), requires: ['netplay'] })).toContain(
      'pack "candy": pack.json: requires lists capabilities format 1 does not implement: netplay — format 1 implements none; see docs/packs.md §Future',
    );
  });

  test('empty requires is allowed', () => {
    const result = validateManifest({ ...valid(), requires: [] }, 'candy');
    expect('manifest' in result).toBe(true);
  });
});

describe('unknown and reserved top-level fields', () => {
  test('a typo suggests the near key', () => {
    expect(errorsOf({ ...valid(), assts: {} })).toContain(
      'pack "candy": pack.json: unknown field "assts" — did you mean "assets"?',
    );
  });

  test('an unrecognisable key lists the valid fields', () => {
    expect(errorsOf({ ...valid(), wibble: 1 })).toContain(
      'pack "candy": pack.json: unknown field "wibble" — valid fields here: format, name, version, author, license, description, assets, sounds, hud, requires',
    );
  });

  for (const reserved of ['content', 'music', 'difficulty', 'dialog', 'backgrounds']) {
    test(`reserved section "${reserved}" gets a dedicated rejection`, () => {
      expect(errorsOf({ ...valid(), [reserved]: {} })).toContain(
        `pack "candy": pack.json: ${reserved} is a pack-format-2 section and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future`,
      );
    });
  }
});

describe('assets', () => {
  test('not an object', () => {
    expect(errorsOf({ ...valid(), assets: [] })).toContain(
      'pack "candy": pack.json: assets must be a JSON object',
    );
  });

  test('bullets wrong type', () => {
    expect(errorsOf({ ...valid(), assets: { bullets: 3 } })).toContain(
      'pack "candy": pack.json: assets.bullets must be a string (a path to a PNG)',
    );
  });

  test('ship wrong type', () => {
    expect(errorsOf({ ...valid(), assets: { ship: 3 } })).toContain(
      'pack "candy": pack.json: assets.ship must be a string (a path to a PNG)',
    );
  });

  test('filter not in the enum', () => {
    expect(errorsOf({ ...valid(), assets: { filter: 'smooth' } })).toContain(
      'pack "candy": pack.json: assets.filter must be "nearest" or "linear"',
    );
  });

  test('the bulets typo is caught with a did-you-mean', () => {
    expect(errorsOf({ ...valid(), assets: { bulets: 'x.png' } })).toContain(
      'pack "candy": pack.json: unknown field "bulets" — did you mean "bullets"?',
    );
  });
});

describe('sounds', () => {
  test('not an object', () => {
    expect(errorsOf({ ...valid(), sounds: 'boom' })).toContain(
      'pack "candy": pack.json: sounds must be a JSON object',
    );
  });

  test('an unknown sound name lists every valid name', () => {
    expect(errorsOf({ ...valid(), sounds: { explsion: 'x.wav' } })).toContain(
      'pack "candy": pack.json: sounds."explsion" is not a sound this game plays — valid names: shot, hit, explosion, graze, pickup, death',
    );
  });

  test('a valid sound with a wrong-typed value', () => {
    expect(errorsOf({ ...valid(), sounds: { graze: 9 } })).toContain(
      'pack "candy": pack.json: sounds.graze must be a string (a path to a WAV)',
    );
  });

  test('all six registered names are accepted', () => {
    const sounds: Record<string, string> = {};
    for (const name of SOUND_NAMES) sounds[name] = `${name}.wav`;
    const result = validateManifest({ ...valid(), sounds }, 'candy');
    expect('manifest' in result).toBe(true);
  });
});

describe('hud', () => {
  test('not an object', () => {
    expect(errorsOf({ ...valid(), hud: 1 })).toContain(
      'pack "candy": pack.json: hud must be a JSON object',
    );
  });

  test('life wrong type', () => {
    expect(errorsOf({ ...valid(), hud: { life: 2 } })).toContain(
      'pack "candy": pack.json: hud.life must be a string (a path to a PNG)',
    );
  });

  test('bomb wrong type', () => {
    expect(errorsOf({ ...valid(), hud: { bomb: 2 } })).toContain(
      'pack "candy": pack.json: hud.bomb must be a string (a path to a PNG)',
    );
  });

  test('a reserved hud resource is refused by name', () => {
    expect(errorsOf({ ...valid(), hud: { digits: 'd.png' } })).toContain(
      'pack "candy": pack.json: hud.digits is a pack-format-2 resource and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future',
    );
  });

  test('an unknown hud key suggests the near key', () => {
    expect(errorsOf({ ...valid(), hud: { lifes: 'x.png' } })).toContain(
      'pack "candy": pack.json: unknown field "lifes" — did you mean "life"?',
    );
  });
});

describe('the manifest root', () => {
  test('a non-object is refused outright', () => {
    expect(validateManifest(null, 'candy')).toEqual({
      errors: ['pack "candy": pack.json: the manifest root must be a JSON object'],
    });
    expect(validateManifest([], 'candy')).toEqual({
      errors: ['pack "candy": pack.json: the manifest root must be a JSON object'],
    });
    expect(validateManifest('{}', 'candy')).toEqual({
      errors: ['pack "candy": pack.json: the manifest root must be a JSON object'],
    });
  });
});

describe('errors are collected, not reported first-only', () => {
  test('three independent problems yield three errors', () => {
    const raw = { format: 2, version: '1', author: 'x', license: 'y', wibble: 1 };
    // format unsupported, name missing, unknown field — at least three.
    const errors = errorsOf(raw);
    expect(errors).toContain(
      'pack "candy": pack.json: format 2 is not supported — this engine supports formats: 1',
    );
    expect(errors).toContain(
      'pack "candy": pack.json: missing required field "name" — it must equal the directory name "candy" and match [a-z0-9-]{1,32}',
    );
    expect(errors).toContain(
      'pack "candy": pack.json: unknown field "wibble" — valid fields here: format, name, version, author, license, description, assets, sounds, hud, requires',
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('editDistance', () => {
  test('identical strings', () => {
    expect(editDistance('bullets', 'bullets')).toBe(0);
  });

  test('one insertion', () => {
    expect(editDistance('bulets', 'bullets')).toBe(1);
  });

  test('a substitution and an insertion', () => {
    expect(editDistance('explsion', 'explosion')).toBe(1);
  });

  test('empty against non-empty', () => {
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('parseIndex', () => {
  test('a well-formed array of names', () => {
    expect(parseIndex(['crimson', 'example'])).toEqual(['crimson', 'example']);
  });

  test('the empty array', () => {
    expect(parseIndex([])).toEqual([]);
  });

  test('not an array', () => {
    expect(parseIndex({ packs: [] })).toEqual({
      error: 'packs/index.json must be a JSON array of pack directory names',
    });
  });

  test('an array with a non-string entry names the index', () => {
    expect(parseIndex(['ok', 3])).toEqual({
      error: 'packs/index.json[1] must be a string',
    });
  });
});

describe('hashPack', () => {
  const manifest = new Uint8Array([1, 2, 3, 4]);
  const fileA = new Uint8Array([10, 11, 12]);
  const fileB = new Uint8Array([20, 21]);

  test('is a 12-character hex string', async () => {
    const hash = await hashPack(manifest, [fileA, fileB]);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  test('is deterministic — same bytes, same hash', async () => {
    const first = await hashPack(manifest, [fileA, fileB]);
    const second = await hashPack(
      new Uint8Array([1, 2, 3, 4]),
      [new Uint8Array([10, 11, 12]), new Uint8Array([20, 21])],
    );
    expect(first).toBe(second);
  });

  test('order matters — reordering the files changes the hash', async () => {
    const forward = await hashPack(manifest, [fileA, fileB]);
    const reversed = await hashPack(manifest, [fileB, fileA]);
    expect(forward).not.toBe(reversed);
  });

  test('the manifest bytes participate', async () => {
    const withManifest = await hashPack(manifest, [fileA]);
    const withoutManifest = await hashPack(new Uint8Array([9, 9, 9, 9]), [fileA]);
    expect(withManifest).not.toBe(withoutManifest);
  });
});

describe('packsMetaString', () => {
  test('no packs is the empty string', () => {
    expect(packsMetaString([])).toBe('');
  });

  test('one pack', () => {
    expect(packsMetaString([{ name: 'crimson', hash: 'abc123def456' }])).toBe(
      'crimson@abc123def456',
    );
  });

  test('several packs join in order', () => {
    expect(
      packsMetaString([
        { name: 'crimson', hash: 'aaa111' },
        { name: 'example', hash: 'bbb222' },
      ]),
    ).toBe('crimson@aaa111,example@bbb222');
  });
});

describe('the module is pure', () => {
  // Structural proof, in the spirit of determinism.test.ts: the boundary holds
  // only as long as nothing here imports a value from the render/sim/content/game
  // trees. A type-only import would be fine, but this module has none at all.
  test('imports no value from render, sim, content or game', () => {
    const source = readFileSync(new URL('./manifest.ts', import.meta.url), 'utf8');
    const specifiers: string[] = [];
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      specifiers.push(match[1] as string);
    }
    for (const match of source.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
      specifiers.push(match[1] as string);
    }
    const crossings = specifiers.filter((s) => /(^|\/)(render|sim|content|game)(\/|$)/.test(s));
    expect(crossings).toEqual([]);
  });
});
