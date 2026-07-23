/**
 * v4 fallback score.
 *
 * The release edition ships rendered audio through `packs/v4`; these compact
 * deterministic synth definitions are its always-audible floor. They live in
 * the edition composition root—not the generic WebAudio engine—because track
 * identity, motif and stance belong to v4's authored world.
 *
 * See `docs/v4-audio-direction.md`. Pack replacement goes through
 * `replaceMusic`, so a missing or undecodable release file falls back to the
 * matching definition below rather than silence.
 */

import { defineMusic } from '../../audio/music';

/** The title/menu score identity owned by this edition. */
export const MENU_MUSIC = 'menu';

/** Exact release/fallback track inventory, shared with pack-generation tests. */
export const V4_MUSIC_NAMES = [
  MENU_MUSIC,
  'vigil',
  'descent',
  'precedent',
  'ordinance',
  'nemesis',
  'interdict',
  'docket',
  'sanction',
  'interregnum',
  'zenith',
  'fiat',
  'adjourn',
] as const;

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const WHOLE_TONE = [0, 2, 4, 6, 8, 10];
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];

/** A rest slot inside a motif. */
const R = Number.NaN;

/**
 * One institutional cell and its transformations: plain, inverted, darkened
 * and made whole. Identity stays in the cell; character belongs to the track.
 */
const CELL = [0, 2, 4, 3];
const CELL_INVERTED = [0, -2, -4, -3];
const CELL_DARKENED = [0, 1, 4, 3];
const CELL_WHOLE = [0, 2, 4, 3, 4, 2, 0];

// Menu — 入神 at rest: a restrained hook with enough structural silence for UI.
defineMusic(MENU_MUSIC, {
  synth: {
    mode: MINOR,
    loopSeconds: 16,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead'],
    motif: [4, R, 2, 4, R, R, 7, 4, 2, R, 0, 2, R, R, R, R],
  },
});

// Four stages progressively close the available space.
defineMusic('vigil', {
  synth: {
    root: 45,
    mode: MINOR,
    loopSeconds: 16,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead'],
    motif: [0, 4, 2, 4, 7, 4, 2, 0, R, R, 4, 2, 4, R, R, R],
  },
});

defineMusic('descent', {
  synth: {
    root: 46,
    mode: MINOR,
    loopSeconds: 12,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead', 'pulse'],
    motif: [0, 3, R, 2, 0, 3, 5, 3, R, R, 2, 0, 3, R, R, R],
  },
});

defineMusic('precedent', {
  synth: {
    root: 44,
    mode: DORIAN,
    loopSeconds: 16,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead', 'pulse'],
    motif: [0, 2, 3, 2, 0, 2, 3, 5, 0, 2, 3, 2, R, R, R, R],
  },
});

defineMusic('ordinance', {
  synth: {
    root: 41,
    mode: MINOR,
    loopSeconds: 14,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead', 'pulse'],
    motif: [0, 4, 5, 4, 2, 4, 0, 4, 5, 4, 2, R, R, R, R, R],
  },
});

// Boss journey — the same cell under progressively stronger institutional filters.
defineMusic('nemesis', {
  synth: {
    mode: MINOR,
    loopSeconds: 14,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead', 'pulse'],
    motif: [...CELL, ...CELL, R, R, 4, 3, R, R, R, R],
  },
});

defineMusic('interdict', {
  synth: {
    mode: MINOR,
    loopSeconds: 8,
    beatsPerLoop: 8,
    leadOctave: 3,
    voices: ['bass', 'lead'],
    motif: [0, 2, R, R, 0, 2, R, R],
  },
});

defineMusic('docket', {
  synth: {
    mode: MINOR,
    loopSeconds: 16,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead', 'pulse'],
    motif: [...CELL_INVERTED, ...CELL_INVERTED, R, -4, -3, R, R, R, R, R],
  },
});

defineMusic('sanction', {
  synth: {
    mode: PHRYGIAN,
    loopSeconds: 16,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead', 'pulse'],
    motif: [...CELL_DARKENED, ...CELL_DARKENED, 0, 1, R, R, R, R, R, R],
  },
});

defineMusic('interregnum', {
  volume: 0.8,
  synth: {
    mode: MINOR,
    loopSeconds: 16,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead', 'pulse'],
    motif: [...CELL_WHOLE, R, ...CELL_WHOLE, R],
  },
});

// 出神 cards remove the pulse floor and unmoor the cell.
defineMusic('zenith', {
  synth: {
    // Pinned to the root historically derived from `nemesis`'s stable name.
    root: 47,
    mode: WHOLE_TONE,
    loopSeconds: 13,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead'],
    motif: [0, R, 2, R, R, 4, R, 3, R, R, R, R, R, R, R, R],
    detune: -30,
    stance: 'trance',
  },
});

defineMusic('fiat', {
  synth: {
    root: 55,
    mode: LOCRIAN,
    loopSeconds: 17,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead'],
    motif: [0, 2, R, 3, R, 2, R, 0, R, R, R, R, R, R, R, R],
    detune: -18,
    stance: 'trance',
  },
});

// Ending — the only full cadence, descending beneath the authority band.
defineMusic('adjourn', {
  synth: {
    root: 38,
    mode: MINOR,
    loopSeconds: 24,
    beatsPerLoop: 16,
    leadOctave: 3,
    voices: ['bass', 'lead'],
    motif: [4, R, 3, R, 2, R, 1, R, 0, R, R, R, R, R, R, R],
    detune: -8,
    stance: 'trance',
  },
});
