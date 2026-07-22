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
  IMPLEMENTED_CAPABILITIES,
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
      music: { theme: { file: 'theme.wav', loopStart: 1.5, loopEnd: 12, volume: 0.5 } },
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

  test('an unimplemented capability is refused, naming what IS implemented', () => {
    expect(errorsOf({ ...valid(), requires: ['netplay'] })).toContain(
      'pack "candy": pack.json: requires lists capabilities this engine does not implement: netplay — implemented: content.enemies, content.stages, content.bosses, content.shots, content.characters, content.options, content.bombs, content.effects, content.items; see docs/packs.md §Future',
    );
  });

  test('only the unimplemented entries are named, not the implemented ones', () => {
    // content.enemies is implemented and paired with a section below; netplay is not.
    const raw = {
      ...valid(),
      requires: ['content.enemies', 'netplay'],
      content: { enemies: { ember: { sprite: 'ship', hp: 10, radius: 6 } } },
    };
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: requires lists capabilities this engine does not implement: netplay — implemented: content.enemies, content.stages, content.bosses, content.shots, content.characters, content.options, content.bombs, content.effects, content.items; see docs/packs.md §Future',
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
      'pack "candy": pack.json: unknown field "wibble" — valid fields here: format, name, version, author, license, description, assets, sounds, hud, music, portraits, requires, content',
    );
  });

  for (const reserved of ['backgrounds']) {
    test(`reserved section "${reserved}" gets a dedicated rejection`, () => {
      expect(errorsOf({ ...valid(), [reserved]: {} })).toContain(
        `pack "candy": pack.json: ${reserved} is a pack-format-2 section and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future`,
      );
    });
  }

  test('dialog is no longer a reserved top-level section — boss dialogue is content, portraits are a section', () => {
    // `dialog` left the reserved list when the feature landed: pre-boss dialogue
    // rides inside `content.bosses.<name>.dialogue` and the images live in the
    // top-level `portraits` section, so there is no `dialog` section at all. A
    // stray top-level `dialog` therefore reads as an ordinary unknown field.
    expect(errorsOf({ ...valid(), dialog: {} })).toContain(
      'pack "candy": pack.json: unknown field "dialog" — valid fields here: format, name, version, author, license, description, assets, sounds, hud, music, portraits, requires, content',
    );
  });

  test('difficulty is no longer a reserved top-level section — it is a per-pattern override', () => {
    // Difficulty retired from the reserved list the same way music did: it is not
    // a section at all but an override inside pattern slots and spell cards, so a
    // stray top-level `difficulty` reads as an ordinary unknown field.
    expect(errorsOf({ ...valid(), difficulty: {} })).toContain(
      'pack "candy": pack.json: unknown field "difficulty" — valid fields here: format, name, version, author, license, description, assets, sounds, hud, music, portraits, requires, content',
    );
  });
});

describe('music', () => {
  test('not an object', () => {
    expect(errorsOf({ ...valid(), music: [] })).toContain(
      'pack "candy": pack.json: music must be a JSON object',
    );
  });

  test('a track that is not an object', () => {
    expect(errorsOf({ ...valid(), music: { theme: 'theme.wav' } })).toContain(
      'pack "candy": pack.json: music."theme" must be a JSON object',
    );
  });

  test('a track missing its file', () => {
    expect(errorsOf({ ...valid(), music: { theme: { loopStart: 1 } } })).toContain(
      'pack "candy": pack.json: music."theme" is missing required field "file" — a path to an audio file',
    );
  });

  test('file wrong type', () => {
    expect(errorsOf({ ...valid(), music: { theme: { file: 3 } } })).toContain(
      'pack "candy": pack.json: music."theme".file must be a string (a path to an audio file)',
    );
  });

  test('loopStart wrong type', () => {
    expect(errorsOf({ ...valid(), music: { theme: { file: 'a.wav', loopStart: '1' } } })).toContain(
      'pack "candy": pack.json: music."theme".loopStart must be a number (seconds)',
    );
  });

  test('a negative loop point', () => {
    expect(errorsOf({ ...valid(), music: { theme: { file: 'a.wav', loopEnd: -2 } } })).toContain(
      'pack "candy": pack.json: music."theme".loopEnd must not be negative, got -2',
    );
  });

  test('loopStart must be less than loopEnd', () => {
    expect(errorsOf({ ...valid(), music: { theme: { file: 'a.wav', loopStart: 8, loopEnd: 4 } } })).toContain(
      'pack "candy": pack.json: music."theme": loopStart 8 must be less than loopEnd 4',
    );
  });

  test('equal loop points are also rejected (an empty loop)', () => {
    expect(errorsOf({ ...valid(), music: { theme: { file: 'a.wav', loopStart: 4, loopEnd: 4 } } })).toContain(
      'pack "candy": pack.json: music."theme": loopStart 4 must be less than loopEnd 4',
    );
  });

  test('volume wrong type', () => {
    expect(errorsOf({ ...valid(), music: { theme: { file: 'a.wav', volume: 'loud' } } })).toContain(
      'pack "candy": pack.json: music."theme".volume must be a number',
    );
  });

  test('an unknown track field suggests the near key', () => {
    expect(errorsOf({ ...valid(), music: { theme: { file: 'a.wav', loopStrt: 1 } } })).toContain(
      'pack "candy": pack.json: music."theme": unknown field "loopStrt" — did you mean "loopStart"?',
    );
  });

  test('a valid music section round-trips', () => {
    const result = validateManifest(
      { ...valid(), music: { ashen: { file: 'ashen.wav', loopStart: 0.6, loopEnd: 4.2 } } },
      'candy',
    );
    expect('manifest' in result).toBe(true);
  });
});

describe('portraits', () => {
  test('not an object', () => {
    expect(errorsOf({ ...valid(), portraits: [] })).toContain(
      'pack "candy": pack.json: portraits must be a JSON object',
    );
  });

  test('a portrait path that is not a string', () => {
    expect(errorsOf({ ...valid(), portraits: { pyre: 3 } })).toContain(
      'pack "candy": pack.json: portraits."pyre" must be a string (a path to a PNG)',
    );
  });

  test('a valid portraits section round-trips (names are open-ended)', () => {
    const result = validateManifest(
      { ...valid(), portraits: { pyre: 'pyre.png', warlord: 'warlord.png' } },
      'candy',
    );
    expect('manifest' in result).toBe(true);
  });
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

/** True when a manifest passes validation (no errors) — for the accept cases. */
function accepts(raw: unknown): boolean {
  return 'manifest' in validateManifest(raw, 'candy');
}

describe('assets: native strip object forms (additive, zero breakage)', () => {
  test('the legacy string forms are still valid', () => {
    expect(accepts({ ...valid(), assets: { bullets: 'b.png', ship: 's.png' } })).toBe(true);
  });

  test('a number (neither string nor object) still fires the verbatim strings', () => {
    // The compatibility-contract branch, kept exactly for the neither case.
    expect(errorsOf({ ...valid(), assets: { bullets: 3 } })).toContain(
      'pack "candy": pack.json: assets.bullets must be a string (a path to a PNG)',
    );
    expect(errorsOf({ ...valid(), assets: { ship: 3 } })).toContain(
      'pack "candy": pack.json: assets.ship must be a string (a path to a PNG)',
    );
  });

  describe('bullets object form', () => {
    const sheet = (strips: Record<string, unknown>) => ({
      ...valid(),
      assets: { bullets: { sheet: 'b.png', strips } },
    });

    test('a minimal native strip is valid — x:0/y:0 are legal (the sheet origin)', () => {
      expect(accepts(sheet({ 'orb.small': { x: 0, y: 0, frameW: 8, frameH: 8 } }))).toBe(true);
    });

    test('an animated baked variant is valid', () => {
      expect(
        accepts(
          sheet({
            'msh.green': { x: 0, y: 0, frameW: 13, frameH: 13, frames: 4, mode: 'once', color: 'baked' },
          }),
        ),
      ).toBe(true);
    });

    test('frameW:0 is rejected — a size is a positive integer', () => {
      expect(errorsOf(sheet({ foo: { x: 0, y: 0, frameW: 0, frameH: 8 } }))).toContain(
        'pack "candy": pack.json: assets.bullets.strips."foo".frameW must be a positive integer',
      );
    });

    test('frames:0 is rejected — a count is a positive integer', () => {
      expect(errorsOf(sheet({ foo: { x: 0, y: 0, frameW: 8, frameH: 8, frames: 0 } }))).toContain(
        'pack "candy": pack.json: assets.bullets.strips."foo".frames must be a positive integer',
      );
    });

    test('a negative x offset is rejected — an offset is non-negative', () => {
      expect(errorsOf(sheet({ foo: { x: -1, y: 0, frameW: 8, frameH: 8 } }))).toContain(
        'pack "candy": pack.json: assets.bullets.strips."foo".x must be a non-negative integer',
      );
    });

    test('stride < frameW is rejected', () => {
      expect(errorsOf(sheet({ foo: { x: 0, y: 0, frameW: 8, frameH: 8, stride: 6 } }))).toContain(
        'pack "candy": pack.json: assets.bullets.strips."foo".stride 6 must be at least frameW 8',
      );
    });

    test('a bad mode and a bad color are named', () => {
      const errs = errorsOf(sheet({ foo: { x: 0, y: 0, frameW: 8, frameH: 8, mode: 'wobble', color: 'purple' } }));
      expect(errs).toContain('pack "candy": pack.json: assets.bullets.strips."foo".mode must be "loop" or "once"');
      expect(errs).toContain('pack "candy": pack.json: assets.bullets.strips."foo".color must be "tinted" or "baked"');
    });

    test('a non-string sheet, a non-object strips map, and a stray field are caught', () => {
      expect(errorsOf({ ...valid(), assets: { bullets: { sheet: 3, strips: {} } } })).toContain(
        'pack "candy": pack.json: assets.bullets.sheet must be a string (a path to the shared PNG)',
      );
      expect(errorsOf({ ...valid(), assets: { bullets: { sheet: 'b.png', strips: 'x' } } })).toContain(
        'pack "candy": pack.json: assets.bullets.strips must be a JSON object of name → strip',
      );
      expect(errorsOf(sheet({ foo: 3 }))).toContain(
        'pack "candy": pack.json: assets.bullets.strips."foo" must be a JSON object',
      );
    });
  });

  describe('ship object form', () => {
    const ship = (over: Record<string, unknown>) => ({
      ...valid(),
      assets: { ship: { src: 's.png', frameW: 40, frameH: 40, ...over } },
    });

    test('a native ship strip bank is valid', () => {
      expect(accepts(ship({ frames: 5, mode: 'once', color: 'baked' }))).toBe(true);
    });

    test('a missing src fires the family string', () => {
      expect(errorsOf({ ...valid(), assets: { ship: { frameW: 40, frameH: 40 } } })).toContain(
        'pack "candy": pack.json: assets.ship.src must be a string (a path to a PNG)',
      );
    });

    test('frameW:0, stride < frameW, and a bad mode are named', () => {
      expect(errorsOf(ship({ frameW: 0 }))).toContain(
        'pack "candy": pack.json: assets.ship.frameW must be a positive integer',
      );
      expect(errorsOf(ship({ stride: 10 }))).toContain(
        'pack "candy": pack.json: assets.ship.stride 10 must be at least frameW 40',
      );
      expect(errorsOf(ship({ mode: 'wobble' }))).toContain(
        'pack "candy": pack.json: assets.ship.mode must be "loop" or "once"',
      );
    });
  });

  describe('effects (animation strips)', () => {
    const fx = (strips: Record<string, unknown>) => ({ ...valid(), assets: { effects: strips } });

    test('a valid effect strip passes, tinted or baked', () => {
      expect(
        accepts(
          fx({
            blast: { src: 'blast.png', frames: 8, frameW: 64, frameH: 64, mode: 'once' },
            fire: { src: 'fire.png', frames: 6, frameW: 48, frameH: 48, mode: 'loop', color: 'baked' },
          }),
        ),
      ).toBe(true);
    });

    test('mode must be "loop" or "once" (a golden string)', () => {
      expect(errorsOf(fx({ blast: { src: 'b.png', frames: 8, frameW: 64, frameH: 64, mode: 'hold' } }))).toContain(
        'pack "candy": pack.json: assets.effects.blast.mode must be "loop" or "once"',
      );
    });

    test('frames must be a positive integer (a golden string)', () => {
      expect(errorsOf(fx({ blast: { src: 'b.png', frames: 0, frameW: 64, frameH: 64, mode: 'once' } }))).toContain(
        'pack "candy": pack.json: assets.effects.blast.frames must be a positive integer',
      );
    });

    test('a missing src and a non-object strip are caught', () => {
      expect(errorsOf(fx({ blast: { frames: 8, frameW: 64, frameH: 64, mode: 'once' } }))).toContain(
        'pack "candy": pack.json: assets.effects.blast.src must be a string (a path to a PNG)',
      );
      expect(errorsOf(fx({ blast: 3 }))).toContain(
        'pack "candy": pack.json: assets.effects.blast must be a JSON object',
      );
    });

    test('effects itself must be an object', () => {
      expect(errorsOf({ ...valid(), assets: { effects: 'x' } })).toContain(
        'pack "candy": pack.json: assets.effects must be a JSON object',
      );
    });
  });

  describe('lasers (per-file strips, the effects twin)', () => {
    const lz = (strips: Record<string, unknown>) => ({ ...valid(), assets: { lasers: strips } });

    test('a valid laser strip passes, baked', () => {
      expect(
        accepts(lz({ 'beam.warm': { src: 'warm.png', frames: 3, frameW: 20, frameH: 6, mode: 'loop', color: 'baked' } })),
      ).toBe(true);
    });

    test('a missing src, a non-object strip, and a non-object section are caught', () => {
      expect(errorsOf(lz({ 'beam.warm': { frames: 3, frameW: 20, frameH: 6, mode: 'loop' } }))).toContain(
        'pack "candy": pack.json: assets.lasers.beam.warm.src must be a string (a path to a PNG)',
      );
      expect(errorsOf(lz({ 'beam.warm': 3 }))).toContain(
        'pack "candy": pack.json: assets.lasers.beam.warm must be a JSON object',
      );
      expect(errorsOf({ ...valid(), assets: { lasers: 'x' } })).toContain(
        'pack "candy": pack.json: assets.lasers must be a JSON object',
      );
    });
  });

  describe('missiles (per-file body strips, the lasers twin)', () => {
    const ms = (strips: Record<string, unknown>) => ({ ...valid(), assets: { missiles: strips } });

    test('a valid missile body strip passes, baked', () => {
      expect(
        accepts(ms({ 'missile.0': { src: 'm0.png', frames: 5, frameW: 27, frameH: 15, mode: 'loop', color: 'baked' } })),
      ).toBe(true);
    });

    test('mode must be "loop" or "once" (a golden string)', () => {
      expect(errorsOf(ms({ 'missile.0': { src: 'm0.png', frames: 5, frameW: 27, frameH: 15, mode: 'hold' } }))).toContain(
        'pack "candy": pack.json: assets.missiles.missile.0.mode must be "loop" or "once"',
      );
    });

    test('frames must be a positive integer (a golden string)', () => {
      expect(errorsOf(ms({ 'missile.0': { src: 'm0.png', frames: 0, frameW: 27, frameH: 15, mode: 'loop' } }))).toContain(
        'pack "candy": pack.json: assets.missiles.missile.0.frames must be a positive integer',
      );
    });

    test('a missing src and a non-object strip are caught', () => {
      expect(errorsOf(ms({ 'missile.0': { frames: 5, frameW: 27, frameH: 15, mode: 'loop' } }))).toContain(
        'pack "candy": pack.json: assets.missiles.missile.0.src must be a string (a path to a PNG)',
      );
      expect(errorsOf(ms({ 'missile.0': 3 }))).toContain(
        'pack "candy": pack.json: assets.missiles.missile.0 must be a JSON object',
      );
    });

    test('missiles itself must be an object', () => {
      expect(errorsOf({ ...valid(), assets: { missiles: 'x' } })).toContain(
        'pack "candy": pack.json: assets.missiles must be a JSON object',
      );
    });
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
      'pack "candy": pack.json: sounds."explsion" is not a sound this game plays — valid names: shot, hit, explosion, graze, pickup, death, toll, declare, break, clear, ui-move, ui-confirm, ui-cancel, ui-pause, ui-advance',
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

describe('content — format-2 sections', () => {
  /** A manifest whose content round-trips: requires covers both sections, shapes valid. */
  function withContent(): Record<string, unknown> {
    return {
      ...valid(),
      requires: ['content.enemies', 'content.stages'],
      content: {
        enemies: {
          ember: {
            sprite: 'ship',
            hp: 10,
            radius: 6,
            motion: { r: 2 },
            timeline: [{ count: 0 }],
            patterns: [{ pattern: 'ring', options: {}, startAt: 0 }],
            spoils: [['power', 2]],
            scoreValue: 100,
            onHit: 'hit',
            onDeath: 'explosion',
          },
        },
        stages: {
          gauntlet: {
            entry: true,
            seed: 7,
            background: 'expanse',
            boss: 'sentinel',
            next: null,
            waves: [
              { at: 0, enemy: 'ember', x: 100, y: -20, count: 3, interval: 20 },
              { at: 200, boss: 'warden' },
            ],
          },
        },
      },
    };
  }

  test('a full content manifest round-trips (shape only — names are the injector\'s)', () => {
    const raw = withContent();
    const result = validateManifest(raw, 'candy');
    expect(result).toEqual({ manifest: raw as unknown as PackManifest });
  });

  describe('the covering invariant', () => {
    test('a section present but not declared in requires', () => {
      const raw = withContent();
      (raw as { requires: string[] }).requires = ['content.stages'];
      expect(errorsOf(raw)).toContain(
        'pack "candy": pack.json: content.enemies is present but "content.enemies" is not in requires — an engine that lacks the capability must refuse on requires before parsing content',
      );
    });

    test('a capability declared with no matching section', () => {
      const raw = {
        ...valid(),
        requires: ['content.enemies', 'content.stages'],
        content: { enemies: { ember: { sprite: 'ship', hp: 1, radius: 1 } } },
      };
      expect(errorsOf(raw)).toContain(
        'pack "candy": pack.json: requires lists "content.stages" but there is no content.stages section — add the section or drop the capability',
      );
    });

    test('content with no requires at all is refused per present section', () => {
      const raw = {
        ...valid(),
        content: { enemies: { ember: { sprite: 'ship', hp: 1, radius: 1 } } },
      };
      expect(errorsOf(raw)).toContain(
        'pack "candy": pack.json: content.enemies is present but "content.enemies" is not in requires — an engine that lacks the capability must refuse on requires before parsing content',
      );
    });
  });

  test('content is not an object', () => {
    expect(errorsOf({ ...valid(), content: [] })).toContain(
      'pack "candy": pack.json: content must be a JSON object',
    );
  });

  test('a still-reserved content section (backgrounds) is refused by name', () => {
    const raw = { ...valid(), content: { backgrounds: {} } };
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: content.backgrounds is a pack-format-2 section this engine does not implement — it implements content.enemies, content.stages, content.bosses, content.shots, content.characters, content.options, content.bombs, content.effects, content.items only; see docs/packs.md §Future',
    );
  });

  test('content.dialog is no longer reserved — dialogue rides on content.bosses, not its own section', () => {
    // `dialog` left the reserved content list when boss dialogue became real: it
    // is a field on `content.bosses.<name>` (`dialogue`), never a `content` section
    // of its own, so a stray `content.dialog` reads as an ordinary unknown field.
    const raw = { ...valid(), content: { dialog: {} } };
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: content: unknown field "dialog" — valid fields here: enemies, stages, bosses, shots, characters, options, bombs, effects, items',
    );
  });

  test('content.difficulty is no longer reserved — difficulty lives inside the content shapes, not as a section', () => {
    // Difficulty left the reserved content list: it is not a `content` section at
    // all but a per-pattern override (`difficulty` on a pattern slot) and a card
    // gate (`difficulties` on a spell card). A stray `content.difficulty`
    // therefore reads as an ordinary unknown field, pointing at the real sections.
    const raw = { ...valid(), content: { difficulty: {} } };
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: content: unknown field "difficulty" — valid fields here: enemies, stages, bosses, shots, characters, options, bombs, effects, items',
    );
  });

  test('content.music is no longer reserved — music is a top-level section, so it is a plain unknown field', () => {
    // Music left the reserved content list: it is not a `content` section at all.
    // A misplaced `content.music` therefore reads as an ordinary unknown field,
    // pointing the author at the real (top-level) home rather than at §Future.
    const raw = { ...valid(), content: { music: {} } };
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: content: unknown field "music" — valid fields here: enemies, stages, bosses, shots, characters, options, bombs, effects, items',
    );
  });

  test('an unknown content section suggests the near key', () => {
    const raw = { ...valid(), content: { enemys: {} } };
    expect(errorsOf(raw)).toContain(
      'pack "candy": pack.json: content: unknown field "enemys" — did you mean "enemies"?',
    );
  });

  describe('enemies', () => {
    function enemy(spec: Record<string, unknown>): Record<string, unknown> {
      return {
        ...valid(),
        requires: ['content.enemies'],
        content: { enemies: { ember: spec } },
      };
    }

    test('content.enemies must be an object', () => {
      const raw = { ...valid(), requires: ['content.enemies'], content: { enemies: [] } };
      expect(errorsOf(raw)).toContain(
        'pack "candy": pack.json: content.enemies must be a JSON object',
      );
    });

    test('a missing required field names it and the expected shape', () => {
      expect(errorsOf(enemy({ hp: 1, radius: 1 }))).toContain(
        'pack "candy": pack.json: content.enemies."ember" is missing required field "sprite" — an atlas cell name',
      );
    });

    test('a wrong-typed required field', () => {
      expect(errorsOf(enemy({ sprite: 'ship', hp: '10', radius: 1 }))).toContain(
        'pack "candy": pack.json: content.enemies."ember".hp must be a number',
      );
    });

    test('an unknown enemy field suggests the near key', () => {
      expect(errorsOf(enemy({ sprite: 'ship', hp: 1, radius: 1, spirte: 'x' }))).toContain(
        'pack "candy": pack.json: content.enemies."ember": unknown field "spirte" — did you mean "sprite"?',
      );
    });

    test('a pattern slot missing its name', () => {
      expect(
        errorsOf(enemy({ sprite: 'ship', hp: 1, radius: 1, patterns: [{ startAt: 0 }] })),
      ).toContain(
        'pack "candy": pack.json: content.enemies."ember".patterns[0] is missing required field "pattern" — a registered pattern name',
      );
    });

    test('a pattern slot with an unknown field', () => {
      expect(
        errorsOf(
          enemy({ sprite: 'ship', hp: 1, radius: 1, patterns: [{ pattern: 'ring', strtAt: 0 }] }),
        ),
      ).toContain(
        'pack "candy": pack.json: content.enemies."ember".patterns[0]: unknown field "strtAt" — did you mean "startAt"?',
      );
    });

    test('a malformed spoils pair', () => {
      expect(
        errorsOf(enemy({ sprite: 'ship', hp: 1, radius: 1, spoils: [['power']] })),
      ).toContain(
        'pack "candy": pack.json: content.enemies."ember".spoils[0] must be a [name, count] pair — a string and a number',
      );
    });

    test('a valid per-tier difficulty block on a pattern round-trips', () => {
      const raw = enemy({
        sprite: 'ship',
        hp: 1,
        radius: 1,
        patterns: [
          {
            pattern: 'ring',
            options: { count: 12 },
            difficulty: { easy: { count: 8 }, lunatic: { count: 20, period: 6 } },
          },
        ],
      });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('a pattern difficulty that is not an object', () => {
      expect(
        errorsOf(enemy({ sprite: 'ship', hp: 1, radius: 1, patterns: [{ pattern: 'ring', difficulty: [] }] })),
      ).toContain(
        'pack "candy": pack.json: content.enemies."ember".patterns[0].difficulty must be a JSON object',
      );
    });

    test('a pattern difficulty naming an unknown tier suggests the near tier', () => {
      expect(
        errorsOf(enemy({ sprite: 'ship', hp: 1, radius: 1, patterns: [{ pattern: 'ring', difficulty: { lunatik: { count: 3 } } }] })),
      ).toContain(
        'pack "candy": pack.json: content.enemies."ember".patterns[0].difficulty: "lunatik" is not a difficulty tier — did you mean "lunatic"?',
      );
    });

    test('an unrecognisable tier lists the valid tiers', () => {
      expect(
        errorsOf(enemy({ sprite: 'ship', hp: 1, radius: 1, patterns: [{ pattern: 'ring', difficulty: { brutal: { count: 3 } } }] })),
      ).toContain(
        'pack "candy": pack.json: content.enemies."ember".patterns[0].difficulty: "brutal" is not a difficulty tier — valid tiers: easy, normal, hard, lunatic',
      );
    });

    test('a tier override that is not an object', () => {
      expect(
        errorsOf(enemy({ sprite: 'ship', hp: 1, radius: 1, patterns: [{ pattern: 'ring', difficulty: { hard: 5 } }] })),
      ).toContain(
        'pack "candy": pack.json: content.enemies."ember".patterns[0].difficulty.hard must be a JSON object of option overrides',
      );
    });
  });

  describe('stages', () => {
    function stage(spec: Record<string, unknown>): Record<string, unknown> {
      return {
        ...valid(),
        requires: ['content.stages'],
        content: { stages: { gauntlet: spec } },
      };
    }

    test('content.stages must be an object', () => {
      const raw = { ...valid(), requires: ['content.stages'], content: { stages: 7 } };
      expect(errorsOf(raw)).toContain(
        'pack "candy": pack.json: content.stages must be a JSON object',
      );
    });

    test('a stage missing waves', () => {
      expect(errorsOf(stage({ entry: true }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet" is missing required field "waves" — an array of waves',
      );
    });

    test('entry must be a boolean', () => {
      expect(errorsOf(stage({ entry: 'yes', waves: [] }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet".entry must be a boolean',
      );
    });

    test('next must be a string or null', () => {
      expect(errorsOf(stage({ waves: [], next: 3 }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet".next must be a string or null',
      );
    });

    test('an unknown stage field suggests the near key', () => {
      expect(errorsOf(stage({ waves: [], entyr: true }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet": unknown field "entyr" — did you mean "entry"?',
      );
    });

    test('a wave missing "at"', () => {
      expect(errorsOf(stage({ waves: [{ enemy: 'ember' }] }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet".waves[0] is missing required field "at" — a whole tick count',
      );
    });

    test('a wave naming neither enemy nor boss', () => {
      expect(errorsOf(stage({ waves: [{ at: 0 }] }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet".waves[0] must name an "enemy" or a "boss"',
      );
    });

    test('a wave naming both enemy and boss', () => {
      expect(errorsOf(stage({ waves: [{ at: 0, enemy: 'ember', boss: 'sentinel' }] }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet".waves[0] names both "enemy" and "boss" — a wave is one or the other',
      );
    });

    test('a wave with an unknown field lists the valid fields', () => {
      expect(errorsOf(stage({ waves: [{ at: 0, enemy: 'ember', zzz: 1 }] }))).toContain(
        'pack "candy": pack.json: content.stages."gauntlet".waves[0]: unknown field "zzz" — valid fields here: at, enemy, boss, x, y, count, interval, stepX, stepY',
      );
    });
  });

  describe('bosses', () => {
    function boss(spec: Record<string, unknown>): Record<string, unknown> {
      return {
        ...valid(),
        requires: ['content.bosses'],
        content: { bosses: { warlord: spec } },
      };
    }

    /** A shape-valid boss to layer overrides onto (names are the injector's to resolve). */
    function base(): Record<string, unknown> {
      return {
        sprite: 'orb.large',
        radius: 16,
        phases: [{ name: 'opening', hpSeconds: 10, patterns: [{ pattern: 'ring' }] }],
      };
    }

    test('a full boss round-trips (shape only — names are the injector\'s)', () => {
      const raw = {
        ...valid(),
        requires: ['content.bosses'],
        content: {
          bosses: {
            warlord: {
              sprite: 'orb.large',
              radius: 16,
              width: 32,
              height: 32,
              tint: { r: 1, g: 0.5 },
              entry: { x: 100, y: 60, ticks: 90 },
              onDeath: 'explosion',
              spoils: [['power', 3]],
              phases: [
                { name: 'move', hpSeconds: 8, isSpell: false, patterns: [{ pattern: 'ring' }] },
                {
                  name: 'spell',
                  hpSeconds: 15,
                  timeLimit: 1800,
                  isSpell: true,
                  bonus: 50000,
                  background: 'undertow',
                  motion: { r: 1 },
                  timeline: [{ count: 0 }],
                  patterns: [{ pattern: 'ring', options: {}, startAt: 0 }],
                },
              ],
            },
          },
        },
      };
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('content.bosses must be an object', () => {
      const raw = { ...valid(), requires: ['content.bosses'], content: { bosses: [] } };
      expect(errorsOf(raw)).toContain(
        'pack "candy": pack.json: content.bosses must be a JSON object',
      );
    });

    test('a missing required field names it and the expected shape', () => {
      const spec = base();
      delete spec.sprite;
      expect(errorsOf(boss(spec))).toContain(
        'pack "candy": pack.json: content.bosses."warlord" is missing required field "sprite" — an atlas cell name',
      );
    });

    test('a boss missing phases', () => {
      const spec = base();
      delete spec.phases;
      expect(errorsOf(boss(spec))).toContain(
        'pack "candy": pack.json: content.bosses."warlord" is missing required field "phases" — an array of spell cards',
      );
    });

    test('an unknown boss field suggests the near key', () => {
      expect(errorsOf(boss({ ...base(), sprait: 'x' }))).toContain(
        'pack "candy": pack.json: content.bosses."warlord": unknown field "sprait" — did you mean "sprite"?',
      );
    });

    test('a malformed entry names its missing field', () => {
      expect(errorsOf(boss({ ...base(), entry: { x: 100, y: 60 } }))).toContain(
        'pack "candy": pack.json: content.bosses."warlord".entry is missing required field "ticks" — a whole tick count',
      );
    });

    test('a phase missing hpSeconds', () => {
      expect(
        errorsOf(boss({ ...base(), phases: [{ name: 'opening', patterns: [{ pattern: 'ring' }] }] })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0] is missing required field "hpSeconds" — seconds of health a competent player needs',
      );
    });

    test('a phase missing patterns', () => {
      expect(
        errorsOf(boss({ ...base(), phases: [{ name: 'opening', hpSeconds: 10 }] })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0] is missing required field "patterns" — an array of pattern slots',
      );
    });

    test('an unknown phase field suggests the near key', () => {
      expect(
        errorsOf(boss({
          ...base(),
          phases: [{ name: 'opening', hpSeconds: 10, patterns: [{ pattern: 'ring' }], hpSecnods: 9 }],
        })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0]: unknown field "hpSecnods" — did you mean "hpSeconds"?',
      );
    });

    test('a phase pattern slot missing its name', () => {
      expect(
        errorsOf(boss({ ...base(), phases: [{ name: 'opening', hpSeconds: 10, patterns: [{ startAt: 0 }] }] })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0].patterns[0] is missing required field "pattern" — a registered pattern name',
      );
    });

    test('a malformed boss spoils pair', () => {
      expect(errorsOf(boss({ ...base(), spoils: [['power']] }))).toContain(
        'pack "candy": pack.json: content.bosses."warlord".spoils[0] must be a [name, count] pair — a string and a number',
      );
    });

    test('a tier-gated card and a per-tier phase pattern round-trip', () => {
      const raw = boss({
        ...base(),
        phases: [
          { name: 'move', hpSeconds: 8, patterns: [{ pattern: 'ring' }] },
          {
            name: 'eclipse',
            hpSeconds: 12,
            difficulties: ['lunatic'],
            patterns: [{ pattern: 'ring', options: { count: 18 }, difficulty: { hard: { count: 24 } } }],
          },
        ],
      });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('a card naming its own music round-trips (resolution is the injector\'s)', () => {
      const raw = boss({
        ...base(),
        phases: [{ name: 'eclipse', hpSeconds: 12, music: 'zenith', patterns: [{ pattern: 'ring' }] }],
      });
      expect('manifest' in validateManifest(raw, 'candy')).toBe(true);
    });

    test('a card music that is not a string', () => {
      expect(
        errorsOf(boss({ ...base(), phases: [{ name: 'eclipse', hpSeconds: 12, music: 7, patterns: [{ pattern: 'ring' }] }] })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0].music must be a string',
      );
    });

    test('a difficulties gate that is not an array', () => {
      expect(
        errorsOf(boss({ ...base(), phases: [{ name: 'opening', hpSeconds: 10, difficulties: 'lunatic', patterns: [{ pattern: 'ring' }] }] })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0].difficulties must be an array of difficulty tiers',
      );
    });

    test('a difficulties gate naming an unknown tier suggests the near tier', () => {
      expect(
        errorsOf(boss({ ...base(), phases: [{ name: 'opening', hpSeconds: 10, difficulties: ['lunatik'], patterns: [{ pattern: 'ring' }] }] })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0].difficulties[0] "lunatik" is not a difficulty tier — did you mean "lunatic"?',
      );
    });

    test('a phase pattern difficulty block validates like an enemy pattern\'s', () => {
      expect(
        errorsOf(boss({ ...base(), phases: [{ name: 'opening', hpSeconds: 10, patterns: [{ pattern: 'ring', difficulty: { nromal: {} } }] }] })),
      ).toContain(
        'pack "candy": pack.json: content.bosses."warlord".phases[0].patterns[0].difficulty: "nromal" is not a difficulty tier — did you mean "normal"?',
      );
    });

    describe('dialogue', () => {
      test('a boss with a valid dialogue round-trips (speaker resolution is the injector\'s)', () => {
        const raw = boss({
          ...base(),
          dialogue: [
            { speaker: 'warlord', text: 'You should not have come.' },
            { speaker: 'player', text: 'And yet.' },
          ],
        });
        expect('manifest' in validateManifest(raw, 'candy')).toBe(true);
      });

      test('dialogue must be an array', () => {
        expect(errorsOf(boss({ ...base(), dialogue: {} }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogue must be an array of {speaker, text} lines',
        );
      });

      test('a dialogue line that is not an object', () => {
        expect(errorsOf(boss({ ...base(), dialogue: ['hello'] }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogue[0] must be a JSON object',
        );
      });

      test('a line missing its speaker', () => {
        expect(errorsOf(boss({ ...base(), dialogue: [{ text: 'hi' }] }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogue[0] is missing required field "speaker" — a portrait name',
        );
      });

      test('a line missing its text', () => {
        expect(errorsOf(boss({ ...base(), dialogue: [{ speaker: 'warlord' }] }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogue[0] is missing required field "text" — the line spoken',
        );
      });

      test('a non-string speaker', () => {
        expect(errorsOf(boss({ ...base(), dialogue: [{ speaker: 3, text: 'hi' }] }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogue[0].speaker must be a string',
        );
      });

      test('an unknown line field suggests the near key', () => {
        expect(errorsOf(boss({ ...base(), dialogue: [{ speaker: 'warlord', text: 'hi', txet: 'x' }] }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogue[0]: unknown field "txet" — did you mean "text"?',
        );
      });
    });

    describe('dialogueFor', () => {
      test('a boss with per-character variants round-trips (key + speaker resolution is the injector\'s)', () => {
        const raw = boss({
          ...base(),
          dialogueFor: {
            raider: [
              { speaker: 'warlord', text: 'A raider.' },
              { speaker: 'player', text: 'And yet.' },
            ],
          },
        });
        expect('manifest' in validateManifest(raw, 'candy')).toBe(true);
      });

      test('dialogueFor must be an object', () => {
        expect(errorsOf(boss({ ...base(), dialogueFor: [] }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogueFor must be a JSON object mapping a character name to its lines',
        );
      });

      test("a variant's lines validate exactly as dialogue's — the key is named in the path", () => {
        expect(errorsOf(boss({ ...base(), dialogueFor: { raider: [{ text: 'hi' }] } }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogueFor."raider"[0] is missing required field "speaker" — a portrait name',
        );
      });

      test('a variant that is not an array', () => {
        expect(errorsOf(boss({ ...base(), dialogueFor: { raider: {} } }))).toContain(
          'pack "candy": pack.json: content.bosses."warlord".dialogueFor."raider" must be an array of {speaker, text} lines',
        );
      });
    });
  });
});

describe('content — the new data-tier sections', () => {
  /** Wrap one section's entries in a manifest whose `requires` covers it. */
  function withSection(section: string, entries: Record<string, unknown>): Record<string, unknown> {
    return { ...valid(), requires: [`content.${section}`], content: { [section]: entries } };
  }

  describe('shots', () => {
    const base = { levels: [{ spec: { style: { sprite: 'glow' } }, offsets: [], period: 5 }] };

    test('a full shot round-trips (shape only)', () => {
      const raw = withSection('shots', { spread: { ...base, description: 'wide' } });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('a shot missing levels', () => {
      expect(errorsOf(withSection('shots', { spread: { description: 'x' } }))).toContain(
        'pack "candy": pack.json: content.shots."spread" is missing required field "levels" — an array of power tiers',
      );
    });

    test('a level missing its period', () => {
      expect(
        errorsOf(withSection('shots', { spread: { levels: [{ spec: {}, offsets: [] }] } })),
      ).toContain(
        'pack "candy": pack.json: content.shots."spread".levels[0] is missing required field "period" — ticks between volleys',
      );
    });

    test('an unknown shot field suggests the near key', () => {
      expect(errorsOf(withSection('shots', { spread: { ...base, levles: [] } }))).toContain(
        'pack "candy": pack.json: content.shots."spread": unknown field "levles" — did you mean "levels"?',
      );
    });
  });

  describe('options', () => {
    const base = { sprite: 'opt', shot: { style: { sprite: 'glow' } }, period: 6, levels: [[]] };

    test('a full option set round-trips (shape only)', () => {
      const raw = withSection('options', {
        seeker: { ...base, followSpeed: 1.4, tint: { r: 1 } },
      });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('missing shot', () => {
      const spec = { ...base } as Record<string, unknown>;
      delete spec.shot;
      expect(errorsOf(withSection('options', { seeker: spec }))).toContain(
        'pack "candy": pack.json: content.options."seeker" is missing required field "shot" — a bullet spec',
      );
    });

    test('an unknown option field suggests the near key', () => {
      expect(errorsOf(withSection('options', { seeker: { ...base, sprit: 'x' } }))).toContain(
        'pack "candy": pack.json: content.options."seeker": unknown field "sprit" — did you mean "sprite"?',
      );
    });
  });

  describe('bombs', () => {
    const base = { duration: 120, invulnTicks: 150, damagePerTick: 3 };

    test('a full bomb round-trips (shape only)', () => {
      const raw = withSection('bombs', {
        nova: { ...base, radius: 200, convertBullets: true, effect: 'boom' },
      });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('missing damagePerTick', () => {
      expect(errorsOf(withSection('bombs', { nova: { duration: 1, invulnTicks: 1 } }))).toContain(
        'pack "candy": pack.json: content.bombs."nova" is missing required field "damagePerTick" — damage per tick in range',
      );
    });

    test('an unknown bomb field suggests the near key', () => {
      expect(errorsOf(withSection('bombs', { nova: { ...base, effekt: 'x' } }))).toContain(
        'pack "candy": pack.json: content.bombs."nova": unknown field "effekt" — did you mean "effect"?',
      );
    });
  });

  describe('effects', () => {
    const base = { sprite: 'spark', count: 8, speed: { min: 1, max: 3 }, life: 30 };

    test('a full effect round-trips (shape only), amounts scalar or range', () => {
      const raw = withSection('effects', {
        boom: { ...base, spread: 360, scale: { from: 1, to: 0 }, alpha: { from: 1, to: 0 }, tint: { r: 1 }, additive: true },
      });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('missing count', () => {
      expect(errorsOf(withSection('effects', { boom: { sprite: 'spark', speed: 1, life: 1 } }))).toContain(
        'pack "candy": pack.json: content.effects."boom" is missing required field "count" — particles per emit',
      );
    });

    test('a malformed amount is refused with the range hint', () => {
      expect(errorsOf(withSection('effects', { boom: { ...base, count: 'lots' } }))).toContain(
        'pack "candy": pack.json: content.effects."boom".count must be a number or a {min, max} range',
      );
    });

    test('an unknown effect field suggests the near key', () => {
      expect(errorsOf(withSection('effects', { boom: { ...base, directon: 90 } }))).toContain(
        'pack "candy": pack.json: content.effects."boom": unknown field "directon" — did you mean "direction"?',
      );
    });
  });

  describe('items', () => {
    const base = { sprite: 'gem', radius: 12, value: 1, kind: 'power' };

    test('a full item round-trips (shape only)', () => {
      const raw = withSection('items', {
        shard: { ...base, motion: { r: 1 }, tint: { g: 1 }, magnetSpeed: 6 },
      });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('missing kind', () => {
      expect(errorsOf(withSection('items', { shard: { sprite: 'gem', radius: 1, value: 1 } }))).toContain(
        'pack "candy": pack.json: content.items."shard" is missing required field "kind" — one of power, score, life, bomb',
      );
    });

    test('an unknown kind is refused as a game rule, not pack data', () => {
      expect(errorsOf(withSection('items', { shard: { ...base, kind: 'shield' } }))).toContain(
        'pack "candy": pack.json: content.items."shard".kind "shield" is not a kind this game has — a new kind is a new game rule, not pack data; valid kinds: power, score, life, bomb',
      );
    });

    test('an unknown item field suggests the near key', () => {
      expect(errorsOf(withSection('items', { shard: { ...base, magntSpeed: 6 } }))).toContain(
        'pack "candy": pack.json: content.items."shard": unknown field "magntSpeed" — did you mean "magnetSpeed"?',
      );
    });
  });

  describe('characters', () => {
    function player(): Record<string, unknown> {
      return {
        x: 240, y: 560, speed: 3.6, focusSpeed: 1.5, radius: 2.5,
        grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90,
      };
    }
    function base(): Record<string, unknown> {
      return {
        label: 'RAIDER', shot: 'spread', options: 'standard', bomb: 'nova',
        sprite: 'ship', blurb: 'a pack ship', player: player(),
      };
    }

    test('a full character round-trips (shape only — names are the injector\'s)', () => {
      const raw = withSection('characters', { raider: { ...base(), width: 40, height: 40 } });
      expect(validateManifest(raw, 'candy')).toEqual({ manifest: raw as unknown as PackManifest });
    });

    test('a character declares its shot by name, not an inline table', () => {
      const spec = base();
      delete spec.shot;
      expect(errorsOf(withSection('characters', { raider: spec }))).toContain(
        'pack "candy": pack.json: content.characters."raider" is missing required field "shot" — a registered shot name',
      );
    });

    test('a character missing its player stats', () => {
      const spec = base();
      delete spec.player;
      expect(errorsOf(withSection('characters', { raider: spec }))).toContain(
        'pack "candy": pack.json: content.characters."raider" is missing required field "player" — the ship\'s stats',
      );
    });

    test('a player missing a stat names it', () => {
      const p = player();
      delete p.speed;
      expect(errorsOf(withSection('characters', { raider: { ...base(), player: p } }))).toContain(
        'pack "candy": pack.json: content.characters."raider".player is missing required field "speed" — px/tick, unfocused',
      );
    });

    test('an unknown character field suggests the near key', () => {
      expect(errorsOf(withSection('characters', { raider: { ...base(), lable: 'X' } }))).toContain(
        'pack "candy": pack.json: content.characters."raider": unknown field "lable" — did you mean "label"?',
      );
    });
  });
});

describe('IMPLEMENTED_CAPABILITIES', () => {
  test('names every implemented content section, in dependency order', () => {
    expect(IMPLEMENTED_CAPABILITIES).toEqual([
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
      'pack "candy": pack.json: unknown field "wibble" — valid fields here: format, name, version, author, license, description, assets, sounds, hud, music, portraits, requires, content',
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
