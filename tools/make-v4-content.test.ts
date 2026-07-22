/**
 * Drift guard for the generated v4 campaign.
 *
 * `src/v4/content/campaign.json` is committed, and `tools/make-v4-content.ts` is the
 * source of truth it is generated from — the design commentary lives in the
 * generator, the JSON is machinery. If someone edits the JSON by hand, or edits
 * the generator without regenerating, the two diverge and the commentary stops
 * describing the shipped pack. This regenerates in memory and byte-diffs.
 *
 * A failure means exactly one action: run `bun tools/make-v4-content.ts` and
 * commit the result (having first confirmed the change was intended — the replay
 * traces in `src/base-content.golden.test.ts` prove whether it moves gameplay).
 */

import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import {
  V4_CONTENT_FINGERPRINT_PATH,
  V4_CONTENT_PATH,
  buildV4ContentFingerprint,
  buildV4ContentJson,
} from './make-v4-content';

test('the committed v4 campaign is byte-identical to the generator output', () => {
  const committed = readFileSync(V4_CONTENT_PATH, 'utf8');
  const generated = buildV4ContentJson();
  // Compare lengths first so a size mismatch reports as a number, not a wall of
  // diff, then the exact-equality assertion pins the content.
  expect(generated.length).toBe(committed.length);
  expect(generated).toBe(committed);
});

test('the committed v4 campaign fingerprint is byte-identical to the generator output', () => {
  // The fingerprint is derived from the JSON bytes, so this drifting means one of
  // two things: the JSON changed without regenerating the hash (the whole failure
  // this catches), or the fingerprint module was hand-edited. Either is fixed by
  // one action — `bun tools/make-v4-content.ts` — same as the JSON above.
  const committed = readFileSync(V4_CONTENT_FINGERPRINT_PATH, 'utf8');
  const generated = buildV4ContentFingerprint();
  expect(generated.length).toBe(committed.length);
  expect(generated).toBe(committed);
});

test('every stage fields a mid-stage bomb carrier — a wave enemy whose spoils drop a bomb', () => {
  // The drop economy (decisions §B) restores bombs through play: each stage names
  // one trash type whose spoils include `bomb`, chosen so the stage hands back 2-4
  // mid-stage bombs on every tier. This is a data property nothing else pins — a
  // wave set can be re-authored to drop the carrier and the game still boots, still
  // clears, and every other test stays green while the economy silently regresses to
  // boss-only bombs. This asserts the invariant over the shipped pack directly, so
  // that regression fails the build. It counts only wave enemies, not the boss: the
  // point is bombs *before* the boss door, which a boss drop cannot supply.
  const pack = JSON.parse(readFileSync(V4_CONTENT_PATH, 'utf8'));
  const enemies: Record<string, { spoils?: [string, number][] }> = pack.content.enemies;
  const dropsBomb = (name: string): boolean =>
    (enemies[name]?.spoils ?? []).some(([kind]) => kind === 'bomb');

  const stages: Record<string, { waves: { enemy: string }[] }> = pack.content.stages;
  for (const stage of Object.values(stages)) {
    const carriers = [...new Set(stage.waves.map((w) => w.enemy))].filter(dropsBomb);
    expect(carriers.length).toBeGreaterThanOrEqual(1);
  }
});
