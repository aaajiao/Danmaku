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

import { defineSound, type SoundSpec } from '../../audio';
import { defineMusic } from '../../audio/music';
import type { RunEvent } from '../../game/run';

/**
 * v4-only gameplay cues. The base names remain generic fallbacks, while these
 * carry the edition's weapon ladder and four boss identities.
 */
export const V4_EVENT_SOUND_NAMES = [
  'shot-tier-1',
  'shot-tier-2',
  'shot-tier-3',
  'power-up-1',
  'power-up-2',
  'power-up-3',
  'boss-enter-warden',
  'boss-enter-magistrate',
  'boss-enter-chancellor',
  'boss-enter-regent',
] as const;

type V4EventSoundName = (typeof V4_EVENT_SOUND_NAMES)[number];

/**
 * Authored fallback identities for the release WAVs.
 *
 * These three shot gains are calibrated against the generic Tier-0 synth, so
 * all four fallback tiers stay at effectively one loudness while pitch/noise
 * carry the tier. Power crossings rise farther at each rung. Boss entries use
 * four different sweep directions and noise weights, so a missing pack cannot
 * collapse them back onto the generic engine beep.
 */
const V4_EVENT_SOUND_SPECS: Readonly<Record<V4EventSoundName, SoundSpec>> = {
  'shot-tier-1': {
    volume: 0.29,
    polyphony: 4,
    throttleMs: 35,
    synth: {
      duration: 0.06,
      from: 1260,
      to: 760,
      decay: 10,
      attack: 0.0025,
      square: true,
      peak: 0.605,
    },
  },
  'shot-tier-2': {
    volume: 0.28,
    polyphony: 4,
    throttleMs: 35,
    synth: {
      duration: 0.065,
      from: 1540,
      to: 860,
      noise: 0.05,
      decay: 10,
      attack: 0.0025,
      square: true,
      peak: 0.627,
    },
  },
  'shot-tier-3': {
    volume: 0.27,
    polyphony: 4,
    throttleMs: 35,
    synth: {
      duration: 0.07,
      from: 1900,
      to: 980,
      noise: 0.1,
      decay: 10,
      attack: 0.0025,
      square: true,
      peak: 0.616,
    },
  },
  'power-up-1': {
    volume: 0.48,
    polyphony: 1,
    throttleMs: 80,
    synth: {
      duration: 0.18,
      from: 480,
      to: 960,
      decay: 4.2,
      attack: 0.003,
      square: true,
      peak: 0.413,
    },
  },
  'power-up-2': {
    volume: 0.47,
    polyphony: 1,
    throttleMs: 80,
    synth: {
      duration: 0.23,
      from: 440,
      to: 1320,
      noise: 0.03,
      decay: 3.8,
      attack: 0.003,
      square: true,
      peak: 0.446,
    },
  },
  'power-up-3': {
    volume: 0.46,
    polyphony: 1,
    throttleMs: 80,
    synth: {
      duration: 0.29,
      from: 360,
      to: 1800,
      noise: 0.06,
      decay: 3.4,
      attack: 0.003,
      square: true,
      peak: 0.469,
    },
  },
  'boss-enter-warden': {
    volume: 0.6,
    polyphony: 1,
    throttleMs: 120,
    synth: {
      duration: 0.48,
      from: 420,
      to: 105,
      noise: 0.08,
      decay: 5,
      attack: 0.003,
      square: true,
      peak: 0.55,
    },
  },
  'boss-enter-magistrate': {
    volume: 0.59,
    polyphony: 1,
    throttleMs: 120,
    synth: {
      duration: 0.7,
      from: 280,
      to: 2240,
      noise: 0.16,
      decay: 3.2,
      attack: 0.004,
      peak: 0.56,
    },
  },
  'boss-enter-chancellor': {
    volume: 0.58,
    polyphony: 1,
    throttleMs: 120,
    synth: {
      duration: 0.76,
      from: 1480,
      to: 185,
      noise: 0.32,
      decay: 2.8,
      attack: 0.004,
      square: true,
      peak: 0.57,
    },
  },
  'boss-enter-regent': {
    volume: 0.57,
    polyphony: 1,
    throttleMs: 140,
    synth: {
      duration: 0.9,
      from: 82,
      to: 920,
      noise: 0.55,
      decay: 2.2,
      attack: 0.005,
      square: true,
      peak: 0.58,
    },
  },
};

for (const name of V4_EVENT_SOUND_NAMES) defineSound(name, V4_EVENT_SOUND_SPECS[name]);

const SHOT_TIER_SOUNDS = [
  'shot',
  'shot-tier-1',
  'shot-tier-2',
  'shot-tier-3',
] as const;

const POWER_TIER_SOUNDS = [
  undefined,
  'power-up-1',
  'power-up-2',
  'power-up-3',
] as const;

const BOSS_ENTRY_SOUNDS: Readonly<Record<string, V4EventSoundName>> = {
  warden: 'boss-enter-warden',
  magistrate: 'boss-enter-magistrate',
  chancellor: 'boss-enter-chancellor',
  regent: 'boss-enter-regent',
};

function eventTier(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? Math.floor(value) : undefined;
}

/**
 * Resolve the event details v4 owns. Returning `undefined` delegates to the
 * generic event table in the shell.
 */
export function v4EventSound(event: RunEvent): string | undefined {
  if (event.type === 'shot') {
    const tier = eventTier(event.tier) ?? 0;
    const index = Math.min(Math.max(tier, 0), SHOT_TIER_SOUNDS.length - 1);
    return SHOT_TIER_SOUNDS[index];
  }

  if (event.type === 'pickup') {
    const tier = eventTier(event.tier);
    if (tier === undefined || tier < 1) return undefined;
    return POWER_TIER_SOUNDS[Math.min(tier, POWER_TIER_SOUNDS.length - 1)];
  }

  if (event.type === 'boss-entered') {
    return event.name === undefined ? 'toll' : (BOSS_ENTRY_SOUNDS[event.name] ?? 'toll');
  }

  return undefined;
}

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
