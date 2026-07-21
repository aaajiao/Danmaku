# Audio assets — specification and replacement guide

The counterpart to [`docs/assets.md`](./assets.md), for sound. Everything the
game plays is **synthesised at runtime** from a handful of parameters, for the
same reason the art is generated: upstream's audio is Touhou Project derivative
and cannot ship (CLAUDE.md, rule 9), so the placeholders are original by
construction and licence-clean. This document is what an author needs to replace
one with a real sample, and what the mix doctrine behind the fifteen sounds and
thirteen tracks actually measures.

Read §0 first if you are bringing in audio someone else made. §1–§3 are the
sound specification, §4 is music, §5 is the mix doctrine and its measured
numbers, §6 is verification.

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

2. **The cue.** A registered sound plays nothing on its own. Two channels feed
   it, and they are deliberately separate:
   - `src/game/cues.ts`'s `EVENT_SOUNDS` maps each `RunEventType` the
     simulation raises to a sound name — `Run` raises `boss-defeated`,
     `EVENT_SOUNDS` says that is `explosion`, `main.ts` calls
     `audio.play('explosion')`. This is **gameplay** sound; a run event fires it.
   - `SHELL_CUES` (same file) names the five `ui-*` sounds, which are shell/menu
     state, never a run event — `main.ts` reads a transient `.cue` field set by
     menu code, plus a pause-enter reconcile and a dialogue-advance watch (§3).
   Adding a sound that should fire on an event means editing `EVENT_SOUNDS`;
   adding a menu sound means naming it in `SHELL_CUES` and wiring the shell edge
   that sets `.cue`. Either way, registering a sound and cuing it are two
   different failures — `reachability.test.ts` catches both, for both channels.

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

Fifteen, all synthesised, all in `src/audio/index.ts`. Six are the original
gameplay-reaction set; nine were added in the audio-enrichment round — four
replace generic `explosion`/`pickup` cues on the boss ladder and stage clear
with sounds shaped for that specific moment, five are the UI channel (§1, §3).

`volume` is the mix gain applied on top of the synth's own output; **effective
peak** (`bufPeak × volume`) is the number that actually reaches the speaker and
is what §5's hierarchy (M8) is checked against. `band%` is the fraction of each
sound's energy sitting in the 1.5–3kHz band the BGM deliberately vacates (§5) —
all measured by `tools/measure-audio.ts` against the real synths, not estimated:

| Name | Fires on | dur (s) | buffer peak | volume | effective peak | band % |
|---|---|---|---|---|---|---|
| `death` | `player-death`, `failed` | 0.850 | 0.9314 | 0.80 | 0.7451 | 1.0% |
| `explosion` | `enemy-killed`, `boss-defeated`, `bomb` | 0.550 | 0.8612 | 0.55 | 0.4737 | 6.5% |
| `toll` | `boss-entered` | 0.700 | 0.5666 | 0.60 | 0.3399 | 0.0% |
| `break` | `boss-cleared` | 0.220 | 0.3901 | 0.55 | 0.2146 | 51.5% |
| `declare` | `boss-phase` | 0.350 | 0.4253 | 0.50 | 0.2126 | 1.3% |
| `clear` | `cleared` | 0.250 | 0.3692 | 0.50 | 0.1846 | 0.0% |
| `hit` | `shot-hit`, `boss-hit` | 0.090 | 0.5321 | 0.35 | 0.1862 | 2.0% |
| `pickup` | `pickup`, `extend` | 0.160 | 0.4624 | 0.35 | 0.1618 | 1.8% |
| `shot` | every player shot | 0.070 | 0.3790 | 0.30 | 0.1137 | 2.2% |
| `graze` | grazing a bullet | 0.130 | 0.3120 | 0.22 | 0.0686 | 100.0% |
| `ui-confirm` | menu confirm, and the ending screen's page-turn | 0.060 | 0.2238 | 0.18 | 0.0403 | 0.0% |
| `ui-cancel` | cancel / back | 0.060 | 0.2139 | 0.16 | 0.0342 | 0.0% |
| `ui-pause` | pause entered | 0.070 | 0.1994 | 0.15 | 0.0299 | 0.0% |
| `ui-advance` | dialogue line advance | 0.040 | 0.1377 | 0.12 | 0.0165 | 0.0% |
| `ui-move` | menu selection change | 0.030 | 0.1300 | 0.12 | 0.0156 | 0.0% |

Read this table alongside the doctrine table in §5 rather than in isolation:
`graze` sits at **100%** in-band on purpose (it *is* the behavior-band tenant,
§5's Internet Void filter), and `break` at 51.5% is the other loud one — a card
broken is meant to read as sharp and present exactly where the BGM has gone
quiet. Everything below the boss ladder decays toward zero band energy because
those are either sub-band bells (`toll`) or UI clicks with no spectral room to
spare.

One sound still serves several events by design, the same "same kind of event
to an ear" reasoning as before: `explosion` covers a kill, the boss's own death,
and a bomb; `pickup` covers an item and an extend. That restraint (做减法) is
why the table is fifteen rows and not twenty — the boss ladder and stage clear
earned their own cues because a bell announcing a fight, a stab declaring a
card, a shatter breaking one, and a resolving chime clearing a stage are four
different *kinds* of moment a generic explosion or pickup chirp was flattening
into one, not four new events wanting decoration.

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
keyed by the registered names — the fifteen in `SOUND_NAMES`
(`src/packs/manifest.ts`) — drops a WAV per name into `packs/<name>/`, and the
loader re-registers each through the same `defineSound` `url` branch shown
below. An unknown sound name is **rejected loudly** at load — `sounds."explsion"
is not a sound this game plays — valid names: …` — which closes the one gap the
source-level route leaves open (a mistyped name registering a new, un-cued
sound; see below). The authoring constraints in "Authoring constraints" apply to
a packed WAV unchanged. This is the right choice for shipping replacement
sound; the source-level call below is the seam the pack loader itself uses.

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
every registered gameplay sound is named by an `EVENT_SOUNDS` row and every
registered UI sound is named by `SHELL_CUES` and actually reached by a scripted
menu pilot, in both directions — so run it after adding one.

### The UI channel has no `RunEventType` to hang from

The five `ui-*` sounds are shell state, not simulation state, so they cannot be
added to `EVENT_SOUNDS` the way a gameplay sound is: `main.ts` reads a
transient `cue?: string` field the menu base class sets at the semantic
move/confirm/cancel and clears at the top of every tick, plus two pure shell
reconciles — a pause-enter edge, and a `WeakMap<Run, number>` watching
`run.dialogue.index` for an advance. None of it introduces a new
`RunEventType`, so no replay trace moves. If you add a sixteenth UI-shaped
sound, it joins `SHELL_CUES`, not `EVENT_SOUNDS`.

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

Art fails *loudly*: a missing sheet throws, a wrong size now throws by name (§5
of `docs/assets.md`). Audio does the opposite by design, because `play` runs
inside the render loop and must never take a frame down. `Audio.#load` swallows
every error — a 404, an undecodable file, a refused context — and leaves that
one sound silent (`src/audio/index.ts`, `#load`). A `url` that is wrong produces
no console error and no crash; the game simply never plays that cue, and the
placeholder does not come back to cover it. So verify a replaced sound by
*hearing it*, in `bun run dev`, not by the absence of an error.

One more: replacing a sound **after** the audio context has unlocked keeps the
old buffer. `Audio` caches decoded buffers by name (`#buffers`) and never
invalidates, so a `defineSound` at module load is fine — the cache is empty until
the first input — but re-registering at runtime does nothing audible until a
reload.

## 4. Music

Music is the sibling of the sound engine, in `src/audio/music.ts`, and shares
its whole doctrine — render-side, total (nothing throws into the loop),
synth-first (a track is a permanent floor, never a blocking dependency),
silent until a user gesture unlocks it. What it does **not** share is the sound
engine's clock (below), and since the audio-enrichment round it is not a single
6-second drone either: `MusicSynth` is a small additive composer, and thirteen
tracks are authored against it — one cell of four scale degrees, run through a
different transformation per boss, plus one idle theme, four stage themes and
three shared come-down/finale tracks.

- **A stage, boss or spell card names a track, exactly as it names a scene.**
  `StageSpec.music`, `BossSpec.music` and `SpellCard.music` are strings (`Run.music`
  is a getter mirroring `Run.scene` line for line: the live **card's** theme if it
  declares one, else the **boss's** if one is alive and declares one, else the
  **stage's**, else undefined). The shell reconciles `run.music` against what is
  playing each tick and cross-fades on a change, the same idempotent
  reconcile-not-react as backgrounds. A fight enters **boss-level** — one theme
  across its cards — but a single card overrides it for its own duration, exactly
  as `SpellCard.background` overrides the scene; a Lunatic-only fourth card
  names its own track (`zenith`, `sentinel`'s), so the theme can turn on the
  card the pattern turns on.
- **It runs on the audio clock, not `uTick` — deliberately, the opposite of a
  background.** A background must advance on `uTick` because a wall-clock scene
  desyncs *visually* from a replay while every test stays green. Music carries no
  such claim: a track restarting when a stage begins is the genre's own behaviour,
  and nothing about what plays or when it loops feeds back into the simulation.
  Someone will want to "fix" it onto `uTick` to match backgrounds; that is the
  wrong fix, and the module header says so at length.
- **It sits under the SFX.** Its own `AudioContext`, separate from the sound
  engine's, is what lets the shell duck it on pause without touching a voice, and
  its master ceiling is set well below the sound table so the theme never competes
  with the readability of play — the audio face of the negative-space rule §5
  measures.

### The composition engine — additive, three voices, one cell

`MusicSynth` sums a handful of gated sine/square terms into one whole-cycle
loop, deterministically: the only source of per-track variation is a hash of
the track's *name*, never RNG (not `sim`, not `fx`, never `Math.random`), so the
same name renders the same buffer bit-for-bit every boot (`mix.test.ts` M11).
Every field on the interface answers to one of the three aaajiao filters named
in §5, and the module header states this directly rather than leaving it to
infer:

```ts
interface MusicSynth {
  root?: number;                        // Hz
  mode?: number[];                      // semitone offsets: minor, dorian, phrygian, whole-tone, locrian
  loopSeconds?: number;                 // 8–24
  beatsPerLoop?: number;                // the pulse grid
  voices?: ('bass' | 'lead' | 'pulse')[]; // ≤3, enforced
  motif?: number[];                     // scale-degree indices for the lead phrase
  detune?: number;                      // cents; 0 for 入神, nonzero for 出神
  stance?: 'absorption' | 'trance';     // 入神 / 出神
}
```

Every melodic note is attack–decay gated to reach zero at its own slot
boundary. That single mechanism is doing two jobs at once, and it is the
composer's central idea: it is *why the loop seam is click-free* (every voice
lands on a whole cycle per buffer, and the melodic voices are silent exactly at
the seam) and it is *why the loop has structural rests* (做减法 — a gated note
that ends is a note that leaves silence behind it, not a sustained pad papering
over the gaps). The click-free mechanism and the empty-space mechanism are the
same line of code.

### The motif journey — one cell, five transformations

The four boss themes on the normal difficulty ladder (`nemesis` →
`interdict` → `docket` → `sanction` → `interregnum`) are not five unrelated
themes; they are one four-note institutional cell (`motif`) put through a
different transformation per fight, so a listener who has heard the sentinel's
theme recognises the shape returning, altered, in the regent's:

| Track | Consumer | Loop s | Stance | Voices | Mode | Cell transform |
|---|---|---|---|---|---|---|
| `menu` | title screen, shell fallback | 20 | 入神 idle | bass, lead | minor | harmony present, cell absent |
| `vigil` | stage-1 (expanse) | 20 | 入神 | bass, lead | minor | — (beacon motif, not the boss cell) |
| `descent` | stage-2 (undertow) | 16 | 入神 | bass, lead, pulse | minor | — (falling echo, not the boss cell) |
| `precedent` | stage-3 (stratum) | 20 | 入神 deepest | bass, mid, pulse | dorian | — (accreting ostinato) |
| `ordinance` | stage-4 (vault) | 18 | 入神 claustral | bass, lead, pulse | minor | — (circular, never resolves) |
| `nemesis` | sentinel, s1 boss | 16 | 入神 driven | bass, lead, pulse | minor | cell **stated** plainly |
| `interdict` | warden, midboss | 8 | 入神 curt | bass, lead | minor | cell **truncated** to two notes, ends on a rest |
| `docket` | magistrate, s2 boss | 18 | 入神 procedural | bass, lead, pulse | minor | cell **inverted**, item by item |
| `sanction` | chancellor, s3 boss | 18 | 入神 oppressive | bass, lead, pulse | phrygian | cell **darkened** (♭2) |
| `interregnum` | regent, s4 final | 20 | 入神 max | bass, lead, pulse | minor | cell **made whole**, resolves to the tonic |
| `zenith` | sentinel's Lunatic 4th card | 13 | **出神** | bass, lead | whole-tone | the `nemesis` cell, unmoored, floor removed |
| `fiat` | chancellor + regent Lunatic finales | 17 | **出神** | bass, lead | locrian | the `sanction`/`interregnum` cell, dissolving |
| `adjourn` | ending screen | 24 | **出神** come-down | bass, lead | minor | none — the only cadence in the game |

`interdict` is deliberately the shortest loop in the game (8s) because the
midboss fight it scores is itself short; a longer loop would never complete
inside the fight. `zenith` and `fiat` are 出神 tracks and do not aim for a clean
loop-to-fight ratio the way the 入神 tracks do — drift, not completion, is the
point on those two. `adjourn` is the one track in the whole set that resolves:
every other loop ends on a rest or a truncation by design, and the ending
theme's cadence is deliberately the sole exception, because the game is over
and there is nothing left to hold open.

### Registration and loop points

`defineMusic(name, spec)` registers a track; like `defineSound` a duplicate name
**overwrites** (the replacement seam). `MusicSpec` is `{ url?, loopStart?,
loopEnd?, volume?, synth? }`: with no `url` the track is the additive composer
above, seeded from the name (reproducible, so it can be taste-tuned); with a
`url` the file loads instead. Playback runs from 0 so any intro plays once, then
`[loopStart, loopEnd)` repeats forever (`loopStart` defaults to 0, `loopEnd` to
the track's end). The loop points are clamped to the decoded duration at play
time, so an out-of-range pair loops the whole track rather than throwing.

A **pack** adds or replaces tracks through its top-level `music` section
(`docs/packs.md` §6.5a): a new name registers namespaced for the pack's own
stages/bosses to name, a built-in name replaces that placeholder — exactly the
`descent` swap `packs/clearing` demonstrates.

### The preferred route to a real track is a pack

As with sounds, the placeholder floor exists so nothing blocks on assets, and the
preferred way to ship a real track is a pack — no code edit. See `docs/packs.md`
§6.5a for the manifest shape, the loop-point walkthrough, and the volume doctrine.

## 5. The mix doctrine — three aaajiao filters, measured

This is the audio analogue of a background's "peak luminance near 0.1" —
numbers a designer can hold the mix to, not prose. Two unconnected buses:
BGM effective level is buffer × 0.7 × 0.5 = **×0.35**; SFX effective level is
buffer × `volume` × **1.0** (the SFX master is fixed, never ducked). All
headroom has to come from what the synths write, not from a fader, which is
why §2's and this section's numbers are buffer-level measurements. Everything
below is from `bun tools/measure-audio.ts` against the real synths — printed,
not estimated, and this is the locked, final set.

**做减法 (subtraction).** `voices` on `MusicSynth` is hard-capped at three, and
every melodic note decays to zero at its own slot boundary rather than
sustaining. The measured effect: every one of the thirteen tracks renders at
**0.3200 buffer peak** — the ceiling `BGM_PEAK` clamps every track to, tuned
down from an earlier 0.46 after seven tracks (`interdict` 0.169, `vigil`
0.164, `menu` 0.155, `adjourn` 0.158, `descent` 0.152, `fiat` 0.151, `zenith`
0.150) blew past a ≤0.14 RMS bound at that level — and every track's *RMS*
still lands in **0.0891–0.1217**, spread across three fewer voices than a pad
synth would need for the same harmonic motion. The boss ladder is four cues
doing the work six events used to share unevenly (§2), the opposite direction
of subtraction: naming a moment precisely, once, rather than reusing a generic
explosion for a fourth unrelated thing.

**Internet Void (behavior over content).** The BGM is written to leave the
1.5–3kHz band — where the player's own actions live — empty, and the measured
numbers show a **vacated band with a tenant**: every track's in-band energy is
**0.00%** at these settings (M3/M4, comfortably inside the ≤6–8% target), while
`graze` sits at **100.0%** in-band and `break` at **51.5%** — the two sounds
that report the player's own play (a graze is a decision; a broken card is a
result of sustained damage) are the loudest tenants of the band the BGM left
empty. That is the filter stated as a measurement rather than a metaphor: the
mix has a hole shaped exactly like the player's behavior, and the player's
behavior is what fills it. The BGM is negative space; the behavior sounds are
the lead instrument the mix is missing.

The hole is spectral first, level second. The two buses are BGM effective =
buffer × 0.7 × 0.5 = **×0.35** and SFX effective = buffer × `volume` × 1.0, so
the loudest track's effective RMS (`interdict` 0.1217 × 0.35 = **0.0426**) sits
under `graze`'s effective peak (0.3120 × 0.22 = **0.0686**) — a **~4.1dB** level
separation, not the order of magnitude a naive reading of the ×0.35 bus might
suggest. That modest level margin is deliberate: the separation the mix relies
on is the *spectral* one above (the BGM leaves the band empty; the cues own it),
and `mix.test.ts` M10 asserts the measured level floor rather than an estimate.

**入神 / 出神 (absorption / trance) — not to be confused.** Ten tracks are 入神:
pulse-gridded, equal-tempered, `detune: 0`, each ending its loop on a rest or a
deliberate incompletion (interdict truncates, docket/sanction/interregnum
transform without ever settling until the fourth). Three are 出神: `zenith`,
`fiat`, `adjourn` — pulse voice dropped, envelopes widened, pitch detuned off
the grid. These are opposite stances, not a spectrum: 入神 is the factory
craftsman's focused hand, the pulse a player threads bullets against; 出神 is
drift, the floor removed. `zenith` and `fiat` measure loop-to-fight ratios near
1× on purpose — 入神 tracks are sized so the loop completes 1.75–3.1× inside
their fight (nemesis 16s/28s, interdict 8s/14s, docket 18s/50s, sanction
18s/46s, interregnum 20s/62s), because completion is part of the absorption;
出神 tracks are not, because drift has no completion to size against.

**The loop seam.** By construction, every voice is snapped to a whole number of
cycles per buffer, so the seam should read as silent. It measures
**0.0014–0.0023** across the thirteen tracks, not exactly zero — the one voice
that is a whole-cycle bass drone (not a gated melodic note) still crosses the
seam continuously, so its endpoint is a small, deliberate, inaudible-in-practice
jump, not a click. Every melodic voice is exactly zero at the seam, which is
the part the design actually depends on; well under the ≤0.02 click threshold
proven against the existing clearing-pack technique.

**The SFX hierarchy.** Effective peaks (§2) fall in the order the game's own
threat model implies: `death` (0.7451) > `explosion` (0.4737) > `toll`
(0.3399) > `break` (0.2146) ≈ `declare` (0.2126) > `hit` (0.1862) > `clear`
(0.1846) > `pickup` (0.1618) > `shot` (0.1137) > `graze` (0.0686), with all
five `ui-*` sounds sitting under the rest at 0.0165–0.0403. Losing a life is
louder than anything else in the game;
grazing a bullet — an event that fires dozens of times a second — is the
quietest gameplay sound, and every menu click sits under even that, because a
menu click is never the thing the player is supposed to be listening for.

## 6. Verify

```
bun run typecheck
bun test                 # mix.test.ts holds the M1–M12 bounds above; reachability holds both cue channels both ways
bun run dev              # and LISTEN — the only check that catches a silent 404
bun run build             # confirm every audio file (if any real assets are packed) is emitted into dist/
```

There is no `test:audio` page. Readability under load is a visual question a
canvas can answer; whether a track's *character* is right is not something an
assertion can judge, and whether a replaced file *loaded* is only observable by
ear, since the failure path is silent by contract. The automated half proves
the wiring and the mix bounds — every sound is cued on one of the two channels,
every cue resolves, every track renders inside its measured bounds, nothing
raises into the loop — and the rest, same as a background, is a listen:
title screen (`menu`) → a stage flight per theme (`vigil`, `descent`,
`precedent`, `ordinance`) → the boss-cell journey (`nemesis` → `interdict` →
`docket` → `sanction` → `interregnum`) → a Lunatic card for the 出神 pair
(`zenith` on sentinel's fourth card, `fiat` on the chancellor/regent finales)
→ clearing the campaign for `adjourn`'s cadence. The five `ui-*` cues are
audible on menu navigation, pause, and pre-boss dialogue.
