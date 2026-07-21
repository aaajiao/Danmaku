/**
 * THE PLAYER-SIDE PORT GATE — captured BEFORE the four built-in characters and
 * their weapons move into the bundled base pack.
 *
 * decisions-round2.md §D ("The player side joins the base pack") ports
 * scout/lance/hound/spire, their shots, options and bombs out of engine
 * TypeScript and into `base-pack.json`, through the same machinery as the
 * campaign port before it. §D demands the same gate discipline decisions-basepack
 * used for that port: a registry snapshot of every moved registration, captured
 * BEFORE the move against the CURRENT engine-defined specs, committed, and
 * reproduced byte-identically AFTER injection — any delta (a speed off by one
 * ULP, a dropped offset, a reordered tier) is a failed port, not a passed one.
 *
 * The thirteen registrations pinned here are the player-side counterpart to the
 * campaign gate's thirteen (`registry.golden.json`): four `CharacterSpec`s, the
 * four `ShotType`s they fire, the three `OptionSpec`s they fly, and the two
 * `BombSpec`s they deploy. They are read from the engine modules that define
 * them today — importing those modules is what registers them, as engine TS.
 * The Port stage flips those imports to `./packs/bundled` and asserts this same
 * committed snapshot still reproduces byte-for-byte.
 *
 * The committed fixture IS the oracle: a run finds it and asserts against it.
 * When it is absent — a first capture, or a fresh checkout that never committed
 * it — the run writes it AND FAILS, because a missing oracle is an error, never
 * a silent self-heal. Without that failure a checkout missing the fixture would
 * regenerate it from the CURRENT code and compare text against itself, passing
 * vacuously and masking the exact divergence this gate exists to catch. So
 * `bun test` is stable across runs once the fixture is committed, and loud until
 * it is.
 *
 * Like its predecessor, this snapshot retires only in a later, soaked change —
 * never inside the port commit — so it stays here, marked, as the gate the port
 * is measured against. After it retires, structural drift is the generator drift
 * test's problem and behavioural drift is `base-content.golden.test.ts`'s.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// The Port has landed: the four characters and their weapons no longer register
// as engine-TS side effects — they live in the bundled base pack, injected when
// `./packs/bundled` is evaluated. So this file imports the pack for its
// registrations and the engine modules only for their `get*` accessors (still
// the machinery half). The committed snapshot below — captured BEFORE the move,
// against the engine-TS specs — is asserted byte-for-byte against the injected
// specs, which is the whole point of the gate: injection reproduced the specs
// exactly, or it did not.
import './packs/bundled';
import { getCharacter } from './game/run';
import { getShot } from './content/shots';
import { getOptionSpec } from './sim/option';
import { getBombSpec } from './sim/bomb';

/** Where the committed gate fixtures live. */
const FIXTURE_DIR = new URL('./base-content.gate/', import.meta.url);

// Captured by name, never from `characterNames()`/`shotNames()`/`optionNames()`/
// `bombNames()`: those registries are process-global and other test files
// register their own fixtures into them, so the whole listing is not the ported
// set. The port scope is exactly these thirteen, and that is what is pinned.
const CHARACTER_NAMES = ['scout', 'lance', 'hound', 'spire'] as const;
const SHOT_NAMES = ['spread', 'needle', 'homing', 'laser'] as const;
const OPTION_NAMES = ['standard', 'seeker', 'picket'] as const;
const BOMB_NAMES = ['spread', 'lance'] as const;

/* ------------------------------------------------------------------ */
/* Canonical serialization                                            */
/* ------------------------------------------------------------------ */

/**
 * Object keys sorted, arrays left in place, numbers required finite, functions
 * refused.
 *
 * Sorting keys makes the fixture independent of authoring order, so a spec whose
 * fields are reordered still snapshots identically — the gate is about *values*.
 * Arrays are ordered data (a tier ladder, an offset list, a slot layout) and are
 * never sorted: a reordered array IS a change the gate must catch.
 *
 * A non-finite number is refused rather than serialized: `JSON.stringify` turns
 * `NaN`/`Infinity` into `null` silently, which would let a corrupt spec pass as
 * a clean fixture. A function value is refused outright — decisions-round2 §D
 * requires the ported specs be pure data a pack can carry, so a function in one
 * is a blocker for the Port stage, not something to serialize around.
 */
function canonical(value: unknown, path: string): unknown {
  if (typeof value === 'function') {
    throw new Error(
      `base-player gate: function value at ${path} — a spec the pack must carry ` +
        `cannot hold code (decisions-round2 §D). This is a blocker for the Port ` +
        `stage, not a serialization detail.`,
    );
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`base-player gate: non-finite number ${value} at ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, i) => canonical(entry, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const field = (value as Record<string, unknown>)[key];
      if (field === undefined) continue; // absent and explicit-undefined snapshot alike
      out[key] = canonical(field, `${path}.${key}`);
    }
    return out;
  }
  return value; // string | boolean | null
}

function canonicalJson(value: unknown, path: string): string {
  return JSON.stringify(canonical(value, path), null, 2) + '\n';
}

/**
 * Read the committed fixture, returning `wrote: false`; or, when it is absent,
 * write it and return `wrote: true`. The caller ASSERTS `wrote === false`, so a
 * bootstrap — a first capture, or a fresh checkout that never committed the
 * fixture — is a loud failure rather than a vacuous pass against self-produced
 * text. The write still happens so a genuine first capture leaves the file
 * behind; it is the run that wrote it that fails.
 */
function committedText(name: string, produce: () => string): { committed: string; wrote: boolean } {
  const url = new URL(name, FIXTURE_DIR);
  if (existsSync(url)) {
    return { committed: readFileSync(url, 'utf8'), wrote: false };
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const text = produce();
  writeFileSync(url, text);
  return { committed: text, wrote: true };
}

/* ------------------------------------------------------------------ */
/* Registry snapshot                                                  */
/* ------------------------------------------------------------------ */

describe('PLAYER-SIDE PORT GATE: character/shot/option/bomb snapshot (decisions-round2 §D)', () => {
  const snapshot = {
    characters: Object.fromEntries(CHARACTER_NAMES.map((n) => [n, getCharacter(n)])),
    shots: Object.fromEntries(SHOT_NAMES.map((n) => [n, getShot(n)])),
    options: Object.fromEntries(OPTION_NAMES.map((n) => [n, getOptionSpec(n)])),
    bombs: Object.fromEntries(BOMB_NAMES.map((n) => [n, getBombSpec(n)])),
  };

  test('every ported registration is present', () => {
    for (const n of CHARACTER_NAMES) expect(() => getCharacter(n)).not.toThrow();
    for (const n of SHOT_NAMES) expect(() => getShot(n)).not.toThrow();
    for (const n of OPTION_NAMES) expect(() => getOptionSpec(n)).not.toThrow();
    for (const n of BOMB_NAMES) expect(() => getBombSpec(n)).not.toThrow();
    expect(CHARACTER_NAMES.length + SHOT_NAMES.length + OPTION_NAMES.length + BOMB_NAMES.length).toBe(13);
  });

  test('no spec field is a function, and no number is non-finite', () => {
    // `canonical` throws on either. Running it is the assertion; a thrown blocker
    // here is decisions-round2 §D's "STOP and report", surfaced as a test failure.
    expect(() => canonicalJson(snapshot, 'snapshot')).not.toThrow();
  });

  test('the live registrations reproduce the committed snapshot byte-for-byte', () => {
    const current = canonicalJson(snapshot, 'snapshot');
    const { committed, wrote } = committedText('player-registry.golden.json', () => current);
    // A bootstrapped oracle fails: a fresh checkout missing this fixture would
    // otherwise compare `current` against text just written from `current` and
    // pass vacuously, masking a real port divergence.
    expect(wrote).toBe(false);
    expect(current).toBe(committed);
  });
});
