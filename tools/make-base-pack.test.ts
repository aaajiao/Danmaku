/**
 * Drift guard for the generated base pack.
 *
 * `src/packs/base-pack.json` is committed, and `tools/make-base-pack.ts` is the
 * source of truth it is generated from — the design commentary lives in the
 * generator, the JSON is machinery. If someone edits the JSON by hand, or edits
 * the generator without regenerating, the two diverge and the commentary stops
 * describing the shipped pack. This regenerates in memory and byte-diffs.
 *
 * A failure means exactly one action: run `bun tools/make-base-pack.ts` and
 * commit the result (having first confirmed the change was intended — the replay
 * traces in `src/base-content.golden.test.ts` prove whether it moves gameplay).
 */

import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import { BASE_PACK_PATH, buildBasePackJson } from './make-base-pack';

test('the committed base-pack.json is byte-identical to the generator output', () => {
  const committed = readFileSync(BASE_PACK_PATH, 'utf8');
  const generated = buildBasePackJson();
  // Compare lengths first so a size mismatch reports as a number, not a wall of
  // diff, then the exact-equality assertion pins the content.
  expect(generated.length).toBe(committed.length);
  expect(generated).toBe(committed);
});
