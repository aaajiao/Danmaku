# Audio assets — specification and replacement guide

The counterpart to [`docs/assets.md`](./assets.md), for sound. Everything the
game plays is **synthesised at runtime** from a handful of parameters, for the
same reason the art is generated: upstream's audio is Touhou Project derivative
and cannot ship (CLAUDE.md, rule 9), so the placeholders are original by
construction and licence-clean. This document is what an author needs to replace
one with a real sample.

Read §0 first if you are bringing in audio someone else made. The rest is the
specification and the swap.

## 0. Provenance — the same rule as art, restated for sound

Rule 9 is enforced against the past and silent about the future: `NOTICE`
argues that nothing unlicensed is *in* the repository, and the moment a
third-party `.wav` lands that argument needs amending. Before adding any sound
you did not synthesise or record yourself:

- It must carry a licence that permits redistribution under this project's
  terms. A clip of unknown origin is the upstream situation again — reject it.
- Record where it came from: author, date, licence, and the tool if it was
  generated. A generated sound is not exempt; §4's "make it with a model" advice
  for art applies here too, and says nothing about the rights that produces.
- Amend `NOTICE` in the same commit as the first third-party asset, so its
  completeness claim stays true.

This is policy, not code, and no test can hold it. It is first because it gates
acceptance: a beautiful sample with no provenance cannot ship.

## 1. How a sound reaches the speaker

Three layers, and the seam for real art is in the middle one.

1. **Registration.** `defineSound(name, spec)` (`src/audio/index.ts`) puts a
   name in the registry. `SoundSpec` is all optional: `url`, `volume`,
   `polyphony`, `throttleMs`. A sound with **no `url` is synthesised**; a sound
   **with a `url` is fetched and decoded**. That single field is the entire swap
   — real audio is a `defineSound` call with a `url`, from a content file, and
   nothing in the engine changes.

2. **The cue.** A registered sound plays nothing on its own. `src/game/cues.ts`
   maps each `RunEventType` the simulation raises to a sound name, and the shell
   plays it — `Run` raises `boss-defeated`, `EVENT_SOUNDS` says that is an
   `explosion`, `main.ts` calls `audio.play('explosion')`. Adding a sound that
   should fire on an event means editing that table too; adding one that
   *replaces* an existing cue means only the `url`.

3. **Playback.** `Audio` (`src/audio/index.ts`) owns a WebAudio graph, built
   lazily on the first input because browsers refuse one outside a user gesture.
   Everything it does is total: `play` on an unknown name is a no-op, a refused
   context leaves the game silent rather than stopped, and nothing it does may
   throw into the game loop.

### Audio touches no simulation state

`Audio` reads nothing the sim owns and writes nothing it reads. Its only source
of randomness is the `fx` stream (`src/core/random.ts`), never `sim` — waveform
noise is cosmetic, and drawing it from `sim` would weld sound design to replay
determinism, the exact mistake CLAUDE.md rule 2 exists to prevent. Its throttle
clock is `performance.now()`, the wall clock, not the sim tick. So audio can
never desynchronise a replay, and a replay recorded on a silent machine is the
same run as one recorded with sound.

## 2. The registered sounds

Six, all synthesised, all in `src/audio/index.ts`. `peak` is the synth's own
output amplitude (0–1); `volume` is the mix gain applied on top. **They are
separate stages**, and this matters for replacement: a real WAV carries its own
amplitude, so a normalised sample is governed by `volume` alone — `peak` is a
synthesis parameter and does nothing for a loaded file.

| Name | Fires on (via `cues.ts`) | Synth length | `volume` | `polyphony` | `throttleMs` |
|---|---|---|---|---|---|
| `shot` | every player shot | 0.07 s | 0.30 | 4 | 40 |
| `hit` | `shot-hit`, `boss-hit` | 0.09 s | 0.35 | 6 | 20 |
| `explosion` | kills, boss enter/clear/defeat, bomb | 0.55 s | 0.55 | 4 | 45 |
| `graze` | grazing a bullet | 0.13 s | 0.22 | 3 | 60 |
| `pickup` | pickups, extends, boss-phase, cleared | 0.16 s | 0.35 | 4 | 25 |
| `death` | `player-death`, `failed` | 0.85 s | 0.80 | 1 | 250 |

One sound serves several events on purpose: five events cue `explosion` and four
cue `pickup`. A bomb and a boss dying are the same *kind* of event to an ear, and
sixteen distinct samples where six carry the game is a cost with no return. When
a real sample wants its own voice, register it and repoint the row — two lines.

### What each `SoundSpec` field does to a loaded sample

- **`volume`** (0–1, default 1): mix gain. The one dial that governs a normalised
  WAV. Clamped; NaN falls back.
- **`polyphony`** (default 8): how many copies may sound at once. A seventh
  overlapping `shot` is dropped. Floored at 1 — a zero-voice sound can never
  play, which is read as a typo and refused rather than registered mute.
- **`throttleMs`** (default 0): ignore repeat plays inside this window. `graze`
  arrives in bursts of dozens a tick; without a throttle it is a wall of noise.
  Tuned against the event that fires it, so a replacement of different length may
  want a different value.
- **`url`** (default absent): present means "load this file instead of
  synthesising". This is the swap.

## 3. Replacing a synth with a real sample

### The preferred route is a pack — no code edit at all

As with art, the higher-level swap needs no editing of `src/`: an
[asset pack](./packs.md) can carry sounds. A `pack.json` with a `sounds` object
keyed by the registered names — `shot`, `hit`, `explosion`, `graze`, `pickup`,
`death` — drops a WAV per name into `packs/<name>/`, and the loader re-registers
each through the same `defineSound` `url` branch shown below. An unknown sound
name is **rejected loudly** at load — `sounds."explsion" is not a sound this game
plays — valid names: …` — which closes the one gap the source-level route leaves
open (a mistyped name registering a new, un-cued sound; see below). The authoring
constraints in "Authoring constraints" apply to a packed WAV unchanged. This is
the right choice for shipping replacement sound; the source-level call below is
the seam the pack loader itself uses.

```ts
import ROAR_URL from '../assets/boss-roar.ogg';
import { defineSound } from '../audio';

defineSound('explosion', { url: ROAR_URL, volume: 0.6, polyphony: 4, throttleMs: 45 });
```

`defineSound` **overwrites** rather than throwing on a duplicate name — that is
deliberate, and it is how a content file replaces a placeholder without editing
the engine. The cost is that a typo does not fail: `defineSound('exploson', …)`
registers a *new* sound nobody cues instead of replacing `explosion`, and the
placeholder plays on. `reachability.test.ts` catches exactly this — it asserts
every registered sound is named by a cue and every cue names a registered sound
— so run it after adding one.

### Authoring constraints

- **Import through the bundler**, `import URL from '../assets/x.ogg'`, typed by
  `src/assets.d.ts`. Not `new URL(..., import.meta.url)` — see `docs/assets.md`
  §5.2 for why that 404s. `.wav` and `.ogg` are declared; `dist/` gets a hashed
  copy on `bun run build`.
- **Mono.** The game is not positional; a stereo file wastes bytes and decodes
  to twice the buffer for no effect.
- **Start and end at exactly zero amplitude.** The synth fades in over ~2 ms and
  out over 6 (`attack`, `RELEASE` in `src/audio/index.ts`) precisely because a
  waveform that starts or ends mid-cycle *clicks*, and a click on a cue that
  fires 60 times a second is the loudest, ugliest thing in the mix. A trimmed
  sample with a hard edge will do this. Add the fades in your editor.
- **Keep it near the synth's length.** Length interacts with `polyphony` and
  `throttleMs`: a `shot` stretched to half a second with polyphony 4 keeps four
  half-second copies alive and smears into a drone. Retune the throttle if you
  change the length.
- **Normalise, then set `volume`.** `peak` no longer applies, so a hot sample is
  loud until `volume` says otherwise.

### It fails silently — this is the trap

Art fails *loudly*: a missing sheet throws, a wrong size now throws by name (§5).
Audio does the opposite by design, because `play` runs inside the render loop and
must never take a frame down. `Audio.#load` swallows every error — a 404, an
undecodable file, a refused context — and leaves that one sound silent
(`src/audio/index.ts`, `#load`). A `url` that is wrong produces no console error
and no crash; the game simply never plays that cue, and the placeholder does not
come back to cover it. So verify a replaced sound by *hearing it*, in `bun run
dev`, not by the absence of an error.

One more: replacing a sound **after** the audio context has unlocked keeps the
old buffer. `Audio` caches decoded buffers by name (`#buffers`) and never
invalidates, so a `defineSound` at module load is fine — the cache is empty until
the first input — but re-registering at runtime does nothing audible until a
reload.

## 4. Verify

```
bun run typecheck
bun test                 # reachability holds the cue table both ways
bun run dev              # and LISTEN — the only check that catches a silent 404
bun run build            # confirm the audio file is emitted into dist/
```

There is no `test:audio` page. Readability under load is a visual question a
canvas can answer; whether a sound is *right* is not something an assertion can
judge, and whether it *loaded* is only observable by ear, since the failure path
is silent by contract. The automated half proves the wiring — every sound is
cued, every cue resolves, nothing raises into the loop — and the rest is a
listen.
