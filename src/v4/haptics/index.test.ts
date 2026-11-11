/**
 * The v4 bomb cues are joined to the bombs they describe, not merely defined.
 *
 * Imported through the edition root (`../index`), exactly as the browser does,
 * so the bombs these cues are measured against are the ones the real campaign
 * injects — not a fixture that happens to share their names. The central
 * claim is the coupling: a cue's length IS its bomb's `duration`. Retune a
 * bomb in `tools/make-v4-content.ts` without its cue, and this file fails.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import '../index';

import campaign from '../content/campaign.json';
import { EVENT_HAPTICS, SHELL_HAPTICS } from '../../game/haptic-cues';
import { characterNames, getCharacter, type RunEvent, type RunEventType } from '../../game/run';
import { getHaptic, hapticNames, type HapticSegment } from '../../haptics';
import { HapticMixer } from '../../haptics/mixer';
import { getBombSpec } from '../../sim/bomb';
import { V4_BOMB_HAPTICS, V4_EVENT_HAPTIC_NAMES, v4EventHaptic } from './index';

/** The v4 campaign's own roster, read from its data rather than the registry. */
const V4_CHARACTERS = campaign.content.characters as Readonly<Record<string, { bomb: string }>>;
const V4_BOMBS = Object.keys(campaign.content.bombs);

function bombEvent(name: string | undefined): RunEvent {
  return name === undefined ? { type: 'bomb', x: 0, y: 0 } : { type: 'bomb', x: 0, y: 0, name };
}

function cueOf(name: string) {
  const cue = getHaptic(name);
  if (cue === undefined) throw new Error(`cue ${name} is not registered`);
  return cue;
}

/** Expand an authored table row into the segments the registry should hold. */
function seg(strong: number, weak: number, ticks: number): HapticSegment {
  return { strong, weak, ticks };
}

/**
 * The brief's table, typed out again independently of the module, so a slip
 * in either is caught by the other rather than copied into both.
 */
const AUTHORED: Readonly<Record<string, readonly HapticSegment[]>> = {
  'bomb.scout-tide': [
    seg(0.65, 0.5, 6),
    seg(0.3, 0.2, 14),
    seg(0.45, 0.3, 20),
    seg(0.35, 0.2, 20),
    seg(0.2, 0.1, 15),
    seg(0.08, 0.04, 15),
  ],
  'bomb.lance-pierce': [seg(1.0, 1.0, 5), seg(0.3, 0.85, 25), seg(0.15, 0.5, 20), seg(0, 0.2, 10)],
  'bomb.hound-pack': [
    [0.85, 0.5],
    [0.75, 0.45],
    [0.65, 0.4],
    [0.55, 0.33],
    [0.45, 0.27],
    [0.35, 0.2],
  ].flatMap(([strong, weak]) => [seg(strong!, weak!, 6), seg(0, 0, 6)]),
  'bomb.spire-field': [
    seg(0.7, 0.6, 6),
    seg(0.15, 0.3, 24),
    ...[1, 2, 3, 4].flatMap(() => [seg(0.12, 0.28, 9), seg(0.2, 0.36, 9)]),
    seg(0.08, 0.15, 18),
  ],
  'bomb.maw-devour': [
    seg(1.0, 0.9, 8),
    seg(0.5, 0.3, 5),
    seg(0.9, 0.6, 6),
    seg(0.3, 0.2, 6),
    seg(0.7, 0.4, 6),
    seg(0.2, 0.1, 14),
  ],
};

describe('v4 bomb haptics', () => {
  test('registers exactly the authored envelopes', () => {
    expect<string[]>([...V4_EVENT_HAPTIC_NAMES].sort()).toEqual(Object.keys(AUTHORED).sort());
    for (const name of V4_EVENT_HAPTIC_NAMES) {
      const authored = AUTHORED[name];
      expect(authored).toBeDefined();
      expect({ name, segments: cueOf(name).segments }).toEqual({ name, segments: authored! });
      expect(cueOf(name).throttleTicks).toBe(0);
    }
  });

  test("each cue's total length equals its bomb's duration", () => {
    // The central coupling. Measured from the bomb the real campaign injected.
    for (const [bomb, cue] of Object.entries(V4_BOMB_HAPTICS)) {
      expect(`${cue}: ${cueOf(cue).ticks}`).toBe(`${cue}: ${getBombSpec(bomb).duration}`);
    }
  });

  test('a played cue occupies the mixer for exactly its bomb, then is silent', () => {
    // The same coupling through the real mixer: felt on the first tick of the
    // blast, a live voice for `duration` steps, silent ever after. (Felt and
    // live differ: `hound-pack` ends on an authored gap, so its last felt tick
    // is six before its end — the gap is part of the envelope.)
    for (const [bomb, cue] of Object.entries(V4_BOMB_HAPTICS)) {
      const mixer = new HapticMixer();
      expect(mixer.play(cue)).toBe(true);
      const duration = getBombSpec(bomb).duration;
      let steps = 0;
      let first = 0;
      while (mixer.active || steps === 0) {
        const level = mixer.step();
        if (steps === 0) first = level.strong;
        steps++;
        if (steps > 1000) break;
      }
      let after = 0;
      for (let tick = 0; tick < 30; tick++) {
        const level = mixer.step();
        after = Math.max(after, level.strong, level.weak);
      }
      expect(`${cue}: steps=${steps} first>0=${first > 0} after=${after}`).toBe(
        `${cue}: steps=${duration} first>0=true after=0`,
      );
    }
  });

  test('the strong motor only runs while the bomb covers the player', () => {
    // The cap rule's licence for these cues (src/haptics/index.ts): they may
    // use the strong motor freely only because the player cannot be hit for
    // the whole of it.
    for (const [bomb, cue] of Object.entries(V4_BOMB_HAPTICS)) {
      const spec = getBombSpec(bomb);
      expect(`${cue}: ${cueOf(cue).ticks <= spec.invulnTicks}`).toBe(`${cue}: true`);
    }
  });

  test('every v4 character’s bomb has a cue, and every cue belongs to a v4 bomb', () => {
    const roster = Object.entries(V4_CHARACTERS);
    expect(roster.length).toBe(5);
    for (const [character, spec] of roster) {
      // The registry agrees with the campaign data: this is the ship flown.
      expect(characterNames()).toContain(character);
      expect(getCharacter(character).bomb).toBe(spec.bomb);
      expect(`${character} → ${spec.bomb}: ${Object.hasOwn(V4_BOMB_HAPTICS, spec.bomb)}`).toBe(
        `${character} → ${spec.bomb}: true`,
      );
    }
    // No stale row: the table names exactly the campaign's bombs.
    expect(Object.keys(V4_BOMB_HAPTICS).sort()).toEqual([...V4_BOMBS].sort());
  });

  test('every bomb.* cue opens on the strong motor within 3–8 ticks', () => {
    // Scanned off the live registry, so a later bomb.* cue is held to it too.
    const bombCues = hapticNames().filter((n) => n.startsWith('bomb.'));
    expect(bombCues.sort()).toEqual([...V4_EVENT_HAPTIC_NAMES].sort());
    for (const name of bombCues) {
      const first = cueOf(name).segments[0];
      expect(first).toBeDefined();
      expect(first!.strong).toBeGreaterThanOrEqual(0.6);
      expect(first!.ticks).toBeGreaterThanOrEqual(3);
      expect(first!.ticks).toBeLessThanOrEqual(8);

      // And through the mixer: the first three ticks the player feels.
      const mixer = new HapticMixer();
      mixer.play(name);
      for (let tick = 0; tick < 3; tick++) {
        expect(mixer.step().strong).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  test('replaces no generic cue', () => {
    const generic = new Set<string>([
      ...Object.values(EVENT_HAPTICS).filter((n): n is string => n !== null),
      ...SHELL_HAPTICS,
    ]);
    for (const name of V4_EVENT_HAPTIC_NAMES) expect(generic.has(name)).toBe(false);
    // The floor `bomb` is still the floor's 40-tick envelope, for guest packs.
    expect(cueOf('bomb').ticks).toBe(40);
  });

  test('the tables are frozen', () => {
    expect(Object.isFrozen(V4_BOMB_HAPTICS)).toBe(true);
    expect(Object.isFrozen(V4_EVENT_HAPTIC_NAMES)).toBe(true);
  });
});

describe('v4EventHaptic', () => {
  test('resolves each v4 bomb to its own cue', () => {
    for (const [bomb, cue] of Object.entries(V4_BOMB_HAPTICS)) {
      expect(v4EventHaptic(bombEvent(bomb))).toBe(cue);
    }
  });

  test('returns undefined for every non-bomb event, even one naming a v4 bomb', () => {
    const types = Object.keys(EVENT_HAPTICS) as RunEventType[];
    expect(types).toContain('bomb');
    for (const type of types.filter((t) => t !== 'bomb')) {
      expect(v4EventHaptic({ type, x: 0, y: 0 })).toBeUndefined();
      expect(v4EventHaptic({ type, x: 0, y: 0, name: 'scout-tide' })).toBeUndefined();
    }
  });

  test('returns undefined for a bomb it does not own', () => {
    for (const name of [
      undefined,
      '',
      'spread',
      'example/ember',
      'bomb.scout-tide',
      'SCOUT-TIDE',
      // Prototype keys must not resolve through `Object.prototype`.
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ]) {
      expect(v4EventHaptic(bombEvent(name))).toBeUndefined();
    }
  });

  test('the shell resolution falls back to the generic floor for a guest bomb', () => {
    // main.ts: `v4EventHaptic(event) ?? EVENT_HAPTICS[event.type]`.
    const resolve = (e: RunEvent) => v4EventHaptic(e) ?? EVENT_HAPTICS[e.type];
    expect(resolve(bombEvent('example/ember'))).toBe('bomb');
    expect(resolve(bombEvent(undefined))).toBe('bomb');
    expect(resolve(bombEvent('maw-devour'))).toBe('bomb.maw-devour');
    expect(resolve({ type: 'graze', x: 0, y: 0 })).toBe('graze');
    for (const name of V4_EVENT_HAPTIC_NAMES) expect(getHaptic(name)).toBeDefined();
  });
});

describe('v4 haptics module', () => {
  test('imports only the generic registry and a run type', () => {
    // Presentation, like src/haptics: no renderer, no RNG, no clock, no device.
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gm)].map((m) => m[0]);
    expect(imports).toEqual([
      "import { defineHaptic, type HapticSegment, type HapticSpec } from '../../haptics';",
      "import type { RunEvent } from '../../game/run';",
    ]);
    // The RNG streams need an import, which the list above already rules out.
    for (const banned of ['Math.random', 'performance.now', 'Date.now', 'navigator']) {
      expect(`${banned}: ${source.includes(banned)}`).toBe(`${banned}: false`);
    }
  });
});
