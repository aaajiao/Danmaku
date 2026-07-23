# Audio assets — specification and replacement guide

The counterpart to [`docs/assets.md`](./assets.md), for sound. The generic
fallback is **synthesised at runtime** from a handful of parameters; the formal
v4 pack is deterministically rendered offline and loaded as WAV. Both are
project-authored for the same reason the art is generated: upstream's audio is
Touhou Project derivative and cannot ship (CLAUDE.md, rule 9). This document is
what an author needs to replace one with a real sample, and the mix doctrine
behind the twenty-five sounds and thirteen tracks in the complete 38-file v4
audio set. A number is called measured below only when the current measurement
tool produced it.

Read §0 first if you are bringing in audio someone else made. §1–§3 are the
sound specification, §4 is music, §5 is the mix doctrine and its measured
numbers, §6 is verification.

For the active edition's artistic mapping and release gates, see the
authoritative [`v4 audio direction`](./v4-audio-direction.md). This document
describes generic machinery and the measured fallback; it is not a substitute
for v4's shipped pack assets.

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
   name in the registry. `SoundSpec` is all optional: `url`, `synth`, `volume`,
   `polyphony`, `throttleMs`. A sound with **no `url` is synthesised** from its
   authored `synth` floor (or the engine default); a sound **with a `url` is
   fetched and decoded**, falling back to that same authored synth if loading
   fails. `url` is still the entire release-sample swap — real audio is a
   `defineSound` call with a `url`, from a content file, and nothing in the
   engine changes.

2. **The cue.** A registered sound plays nothing on its own. Two channels feed
   it, and they are deliberately separate:
   - Gameplay first passes through v4's `v4EventSound(event)`, which can use
     event details to select a weapon tier, a tier-crossing cue or a named Boss
     entrance. If it delegates, `src/game/cues.ts`'s `EVENT_SOUNDS` maps the
     `RunEventType` to its generic reaction — `Run` raises `boss-defeated`,
     `EVENT_SOUNDS` says that is `explosion`, and `main.ts` plays it.
   - `SHELL_CUES` (same file) names the five `ui-*` sounds, which are shell/menu
     state, never a run event — `main.ts` reads a transient `.cue` field set by
     menu code, plus a pause-enter reconcile and a dialogue-advance watch (§3).
   A generic reaction belongs in `EVENT_SOUNDS`; an edition-specific reaction
   that depends on `tier` or `name` belongs in `v4EventSound`. A menu sound
   belongs in `SHELL_CUES` and the shell edge that sets `.cue`. In all cases,
   registration and reachability are separate failures —
   `reachability.test.ts` checks the composed resolver and both channels.

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

Twenty-five names are fixed by `SOUND_NAMES`. The first fifteen are the generic
gameplay/UI floor: six original gameplay reactions, four semantic boss/card/clear
cues, and the five-sound UI channel (§1, §3). The other ten complete the
four-tier weapon ladder, name its three actual tier crossings, and give the
remaining v4 bosses distinct identities that a single held-fire sound or universal
entrance bell would flatten.

`volume` is the mix gain applied on top of the synth's own output; **effective
peak** (`bufPeak × volume`) is the number that actually reaches the speaker and
is what §5's hierarchy (M8) is checked against. `band%` is the fraction of each
sound's energy sitting in the 1.5–3kHz band the BGM deliberately vacates (§5).
The following fifteen-row baseline was measured by `tools/measure-audio.ts`
against the real fallback synths, not estimated:

| Name | Fires on | dur (s) | buffer peak | volume | effective peak | band % |
|---|---|---|---|---|---|---|
| `death` | `player-death`, `failed` | 0.850 | 0.9314 | 0.80 | 0.7451 | 1.0% |
| `explosion` | `enemy-killed`, `boss-defeated`, `bomb` | 0.550 | 0.8612 | 0.55 | 0.4737 | 6.5% |
| `toll` | Sentinel entry; guest/unknown-boss entry fallback | 0.700 | 0.5666 | 0.60 | 0.3399 | 0.0% |
| `break` | `boss-break` (non-final spell with an active successor) | 0.220 | 0.3901 | 0.55 | 0.2146 | 51.5% |
| `declare` | `boss-phase` | 0.350 | 0.4253 | 0.50 | 0.2126 | 1.3% |
| `clear` | `cleared` | 0.250 | 0.3692 | 0.50 | 0.1846 | 0.0% |
| `hit` | `shot-hit`, `boss-hit` | 0.090 | 0.5321 | 0.35 | 0.1862 | 2.0% |
| `pickup` | `pickup`, `extend` | 0.160 | 0.4624 | 0.35 | 0.1618 | 1.8% |
| `shot` | every Tier-0 player shot | 0.070 | 0.3801 | 0.30 | 0.1140 | 2.2% |
| `graze` | grazing a bullet | 0.130 | 0.3120 | 0.22 | 0.0686 | 100.0% |
| `ui-confirm` | menu confirm, and the ending screen's page-turn | 0.060 | 0.2232 | 0.29 | 0.0647 | 100.0% |
| `ui-cancel` | cancel / back | 0.060 | 0.2128 | 0.27 | 0.0574 | 100.0% |
| `ui-pause` | pause entered | 0.070 | 0.1994 | 0.24 | 0.0479 | 0.0% |
| `ui-advance` | dialogue line advance | 0.040 | 0.1440 | 0.36 | 0.0518 | 100.0% |
| `ui-move` | menu selection change | 0.030 | 0.1291 | 0.42 | 0.0542 | 100.0% |

The ten edition-specific rows below are authored release targets from
`tools/v4-audio.ts`. Their effective targets are simple
`targetPeak × volume` calculations. They are **not** reported as decoded buffer
peaks or band measurements; those columns stay unpublished until the generated
files have been measured:

| Name | Fires on | authored dur (s) | target peak | volume | effective target |
|---|---|---:|---:|---:|---:|
| `shot-tier-1` | every Tier-1 player shot | 0.060 | 0.50 | 0.29 | 0.1450 |
| `shot-tier-2` | every Tier-2 player shot | 0.065 | 0.52 | 0.28 | 0.1456 |
| `shot-tier-3` | every Tier-3 player shot | 0.070 | 0.54 | 0.27 | 0.1458 |
| `power-up-1` | the transition from Tier 0 to Tier 1 | 0.180 | 0.38 | 0.48 | 0.1824 |
| `power-up-2` | the transition from Tier 1 to Tier 2 | 0.230 | 0.41 | 0.47 | 0.1927 |
| `power-up-3` | the transition from Tier 2 to Tier 3 | 0.290 | 0.44 | 0.46 | 0.2024 |
| `boss-enter-warden` | Warden entry | 0.480 | 0.52 | 0.60 | 0.3120 |
| `boss-enter-magistrate` | Magistrate entry | 0.700 | 0.54 | 0.59 | 0.3186 |
| `boss-enter-chancellor` | Chancellor entry | 0.760 | 0.56 | 0.58 | 0.3248 |
| `boss-enter-regent` | Regent entry | 0.900 | 0.60 | 0.57 | 0.3420 |

Read this table alongside the doctrine table in §5 rather than in isolation:
`graze` sits at **100%** in-band on purpose (it *is* the behavior-band tenant,
§5's Internet Void filter), and `break` at 51.5% is the other loud one — a card
broken is meant to read as sharp and present exactly where the BGM has gone
quiet. Menu navigation now uses that same empty band deliberately: unlike a
gameplay cue it fires while no curtain is being read, and putting its short
transient at 1.5–3kHz keeps it out of the menu theme's 300–1000Hz lead. It still
sits below `graze` by effective peak, but it no longer disappears under the
theme's average level.

Some sounds still serve several events by design, under the same "same kind of
event to an ear" reasoning as before: `explosion` covers a kill, the boss's own
death, and a bomb; `pickup` covers an item and an extend. `shot` is now
specifically Tier 0, while `shot-tier-1` through `shot-tier-3` encode stronger
weapons by pulse grammar and spectrum rather than by a loudness ladder.
Likewise `toll` is Sentinel's entrance and the compatibility fallback for a
guest or otherwise unmapped boss; Warden, Magistrate, Chancellor and Regent use
their named entrances. The extra names are therefore semantic distinctions the
player must hear, not decoration added to every event.

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
- **`synth`** (default engine/name preset): the deterministic procedural floor
  used when `url` is absent or cannot be decoded. Edition-specific cues should
  author it so a missing WAV preserves semantic identity rather than becoming
  the same generic beep.

## 3. Replacing a synth with a real sample

### The preferred route is a pack — no code edit at all

As with art, the higher-level swap needs no editing of `src/`: an
[asset pack](./packs.md) can carry sounds. A `pack.json` with a `sounds` object
keyed by the registered names — the twenty-five in `SOUND_NAMES`
(`src/packs/manifest.ts`) — drops a WAV per name into `packs/<name>/`. The legacy
value is a path string; the configured form is
`{ file, volume?, polyphony?, throttleMs? }`, so a replacement can carry the same
mix and repetition controls as `SoundSpec`:

```json
{
  "sounds": {
    "shot": "shot.wav",
    "graze": {
      "file": "graze.wav",
      "volume": 0.22,
      "polyphony": 3,
      "throttleMs": 45
    }
  }
}
```

The loader applies each through `overrideSound`: the file replaces the waveform,
explicit object fields replace their matching settings, and omitted fields keep
the registered sound's existing mix policy. An unknown sound name is **rejected
loudly** at load — `sounds."explsion"
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
every registered gameplay sound is reached through the composed
`v4EventSound(event) ?? EVENT_SOUNDS[event.type]` resolver, and every registered
UI sound is named by `SHELL_CUES` and actually reached by a scripted menu pilot,
in both directions — so run it after adding one.

### The UI channel has no `RunEventType` to hang from

The five `ui-*` sounds are shell state, not simulation state, so they cannot be
added to `EVENT_SOUNDS` the way a gameplay sound is: `main.ts` reads a
transient `cue?: string` field the menu base class sets at the semantic
move/confirm/cancel and clears at the top of every tick, plus two pure shell
reconciles — a pause-enter edge, and a `WeakMap<Run, number>` watching
`run.dialogue.index` for an advance. None of it introduces a new
`RunEventType`, so no replay trace moves. If another UI-shaped sound is ever
added, it joins `SHELL_CUES`, not `EVENT_SOUNDS`.

The title's first confirm is also the gesture that unlocks WebAudio. `Audio`
keeps a bounded queue only while that unlock is in flight and replays the cue
once the context resumes; a failed unlock drops it rather than leaking a stale
confirm into a later retry. The shell retries unlock from later non-zero input
until both audio buses report ready.

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

The generic music registry, composer and runtime live in `src/audio/music.ts`;
v4's thirteen authored fallback definitions live in `src/v4/audio/`. Together
they share the sound engine's whole doctrine — render-side, total (nothing throws into the loop),
synth-first (a track is a permanent floor, never a blocking dependency),
silent until a user gesture unlocks it. What it does **not** share is the sound
engine's clock (below), and since the audio-enrichment round it is not a single
6-second drone either: `MusicSynth` is a small additive composer, and thirteen
v4 tracks are authored against it — one cell of four scale degrees, run through a
different transformation per boss, plus one idle theme, four stage themes and
three shared come-down/finale tracks.

The release generator adds a second, equally load-bearing axis:
`architecture`. Root, mode and motif preserve the related campaign cell, while
the temporal/spectral grammar makes the spaces and bosses different pieces
rather than transpositions of one renderer. The stage path is
`open-signal` → `descending-corridor` → `accreted-record` → `closing-vault`;
the five-boss path is `sentinel-orbit` → `warden-latch` →
`magistrate-scan` → `chancellor-seal` → `regent-recapitulation`. These are
mono perceptual architectures — envelope, density, register, silence and
interference — not a claim that the playback engine is positional.

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
  leadOctave?: number;                  // octaves above the tonic the lead sits at; default 1
  beatsPerLoop?: number;                // the pulse grid; also the phrase's slot count
  voices?: ('bass' | 'lead' | 'pulse')[]; // ≤3, enforced
  motif?: number[];                     // scale-degree indices for the lead phrase
  detune?: number;                      // cents; 0 for 入神, nonzero for 出神
  stance?: 'absorption' | 'trance';     // 入神 / 出神
}
```

**`leadOctave` moved the melody into a band the ear actually parses.** The
lead used to sit at `rootHz * 2` unconditionally — 88–220 Hz for this game's
roots, a register the ear reads as bass motion, not melody, and it never
generated a `MusicSynth` field of its own because there was nothing to tune.
`leadOctave` names that multiplier explicitly, as a power of two: **default
1**, so `2^1 = 2` reproduces the historical value bit-for-bit and any spec
that omits the field — including every guest-pack track written before this
field existed — renders identically (`mix.test.ts` proves an omitted field and
an explicit `1` are the same buffer, and that `3` is a different one). Every
one of the thirteen v4 fallback tracks sets it to **3** explicitly, putting the lead
an octave higher again — base ~304–440 Hz, motif peaks near 550–784 Hz — which
is the register move described in §5's two-voids doctrine. The field is a
plain multiplier on `leadBaseHz`, so it composes with everything else
unchanged: `snapCycles` still rounds to a whole number of cycles at any
octave and `noteEnvelope` still zeros at slot edges, so the seam guarantee
(M6′) holds regardless of register.

Every melodic note is attack–decay gated to reach zero at its own slot
boundary. That single mechanism is doing two jobs at once, and it is the
composer's central idea: it is *why the loop seam is click-free* (every voice
lands on a whole cycle per buffer, and the melodic voices are silent exactly at
the seam) and it is *why the loop has structural rests* (做减法 — a gated note
that ends is a note that leaves silence behind it, not a sustained pad papering
over the gaps). The click-free mechanism and the empty-space mechanism are the
same line of code. The absorption (入神) attack is **0.03** — sharpened from an
earlier 0.06 so each note in a denser phrase articulates distinctly and cuts
under an SFX transient; trance (出神) keeps its wider **0.12**, the veiled
onset that opposition depends on.

### Phrases, not blips — the 16-slot motif

A track's `motif` used to be four scale-degree slots, most of them silent —
audible as isolated blips, not a phrase a listener could hold onto. Every
base track's `motif` is now (with one exception) a **16-slot** phrase: a
statement, an answer or rest, and often a restatement, gridded onto
`beatsPerLoop: 16`. `interdict` is the exception and stays an 8-slot phrase
(`beatsPerLoop: 8`) because its loop is deliberately the shortest in the game
(see below). `trackPhrase()` (`src/audio/music.ts`) reads a spec's
`beatsPerLoop`/`motif` the same way `compose()` does and reports how many of
those slots actually sound a note; it is the single source both
`mix.test.ts`'s density floor (M15′) and `tools/measure-audio.ts`'s printed
`slots` column read, so the two can never drift apart on what "sounds" means.
Every non-trance track sounds **at least half its slots** — a phrase, not a
blip — while still ending on trailing rests, so the wrap slot stays bass-only
(the seam guarantee, M6′) and a real breath exists in the lead lane (M7′).

### The motif journey — one cell, five transformations

The five boss themes on the normal difficulty ladder (`nemesis` →
`interdict` → `docket` → `sanction` → `interregnum`) are not five unrelated
themes; they are one four-note institutional cell (`CELL = [0, 2, 4, 3]`) put
through a different transformation per fight, and now each fight states that
cell, then answers or restates it, across a full 16-slot phrase — so a
listener who has heard the sentinel's theme not only recognises the shape
returning, altered, in the regent's, but hears enough of it each loop to hum
it:

| Track | Consumer | Loop s | leadOctave | Stance | Voices | Mode | Cell transform |
|---|---|---|---|---|---|---|---|
| `menu` | title screen, shell fallback | 16 | 3 | 入神 idle | bass, lead | minor | harmony present, cell absent — a rising-then-settling hook |
| `vigil` | stage-1 (expanse) | 16 | 3 | 入神 | bass, lead | minor | — (8-note beacon, stated then answered; not the boss cell) |
| `descent` | stage-2 (undertow) | 12 | 3 | 入神 | bass, lead, pulse | minor | — (3-note echo-with-a-hole over a quarter pulse; fastest loop) |
| `precedent` | stage-3 (stratum) | 16 | 3 | 入神 deepest | bass, lead, pulse | dorian | — (accreting ostinato, hook by insistence) |
| `ordinance` | stage-4 (vault) | 14 | 3 | 入神 claustral | bass, lead, pulse | minor | — (a figure that bites its own tail, never resolves) |
| `nemesis` | sentinel, s1 boss | 14 | 3 | 入神 driven | bass, lead, pulse | minor | cell **stated** plainly, twice, answered by rest — the identity anchor |
| `interdict` | warden, midboss | 8 | 3 | 入神 curt | bass, lead | minor | cell **truncated** to two notes (8-slot phrase); loudest raw track |
| `docket` | magistrate, s2 boss | 16 | 3 | 入神 procedural | bass, lead, pulse | minor | cell **inverted**, a descending answer to `nemesis` |
| `sanction` | chancellor, s3 boss | 16 | 3 | 入神 oppressive | bass, lead, pulse | phrygian | cell **darkened** (♭2) — inaudible at 76Hz, legible at 352 |
| `interregnum` | regent, s4 final | 16 | 3 | 入神 max, `volume 0.80` | bass, lead, pulse | minor | cell **made whole**, resolves to the tonic — densest, sits hottest |
| `zenith` | sentinel's Lunatic 4th card | 13 | 3 | **出神** | bass, lead | whole-tone | the `nemesis` cell, unmoored, floor removed |
| `fiat` | chancellor + regent Lunatic finales | 17 | 3 | **出神** | bass, lead | locrian | the `sanction`/`interregnum` cell, dissolving |
| `adjourn` | ending screen | 24 | 3 | **出神** come-down | bass, lead | minor | none — the only cadence in the game, the most legible melody of the set |

`interdict` is deliberately the shortest loop in the game (8s) because the
midboss fight it scores is itself short; a longer loop would never complete
inside the fight. `zenith` and `fiat` are 出神 tracks and do not aim for a clean
loop-to-fight ratio the way the 入神 tracks do — drift, not completion, is the
point on those two, and both keep `leadOctave 3` (the same register as their
入神 counterparts): the 出神 opposition is voiced in detune, mode and a sparse
envelope, not a register drop — a drop would read as "a different, lower
cell" rather than the same cell unmoored. `adjourn` is the one track in the
whole set that resolves: every other loop ends on a rest or a truncation by
design, and the ending theme's cadence is deliberately the sole exception,
because the game is over and there is nothing left to hold open.

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
stages/bosses to name, while a built-in name replaces that placeholder.

### The preferred route to a real track is a pack

As with sounds, the placeholder floor exists so nothing blocks on assets, and the
preferred way to ship a real track is a pack — no code edit. See `docs/packs.md`
§6.5a for the manifest shape, the loop-point walkthrough, and the volume doctrine.

## 5. The mix doctrine — three aaajiao filters, measured

This is the audio analogue of a background's "peak luminance near 0.1" —
numbers a designer can hold the mix to, not prose. Two unconnected buses: BGM
effective level is buffer × track `volume` × `MUSIC_LEVEL` (**0.55** — up from
an earlier 0.5, `main.ts`) — most tracks default to 0.7, `interregnum` is
authored to 0.80; SFX effective level is buffer × `volume` × **1.0** (the SFX
master is fixed, never ducked). All headroom has to come from what the synths
write, not from a fader, which is why §2's and this section's numbers are
buffer-level measurements. Everything below is from
`bun tools/measure-audio.ts` against the real synths — printed, not estimated,
and this is the locked, final set for the **BGM-audibility round**: the
melody moved register and the mix bounds carry floors as well as ceilings now.

### Two voids, not one — the recalibration

The original doctrine vacated a single band, 1.5–3kHz, for the player's own
behavior sounds and put the melody wherever was left — which turned out to be
sub-220Hz, a register the ear does not parse as melody at all. That was a
second, *accidental* empty space, and the tune was inaudible for living in it:
measurement on the pre-round mix found the lead was the **quietest** of the
three voices and the loop spent half its length silent by construction. The
user's verdict — *听不出来*, "I basically can't hear it" — was correct on both
counts, and they are independent failures: register (where the lead sits) and
density (how much of the loop it fills).

This round does not touch the 1.5–3kHz behavior band. It **names the second
void on purpose** and moves the melody into it: **300–1000Hz**, a register
the ear parses as melody, filled with a lead now authored as the loudest
voice (`LEAD_AMP 0.40 > BASS_AMP 0.24`, up from `0.26 < 0.34` before) over a
phrase dense enough to hold onto (§4's 16-slot motifs). The doctrine is not
weakened, only extended to a **second** void: two negative spaces, kept
spectrally disjoint — the behavior band stays SFX-only (M3′/M4′, still 0.00%
in-band for every track), and the melody now lives somewhere else the ear can
actually hear it. "Fill an empty space with what the mix was missing" is the
same move twice, aimed at two different silences.

**做减法 (subtraction).** `voices` on `MusicSynth` is still hard-capped at
three, and every melodic note still decays to zero at its own slot boundary
rather than sustaining — unchanged this round. What changed is where the
ceiling sits: `BGM_PEAK` moved **0.32 → 0.40** (still comfortably under
`explosion`'s 0.55), and every one of the thirteen tracks still renders at
exactly that clamp, **0.4000 buffer peak**. Raising the peak did not, as the
design estimated, push every track's *RMS* up with it: the lead-forward,
bass-recessed balance (`LEAD_AMP` up, `BASS_AMP` down) actually **lowered**
aggregate RMS, because the synth spends more of its budget on gated notes
that return to silence and less on a sustained low drone. Measured RMS now
spans **0.0760–0.0990** (`docket` lowest, `vigil` highest) — narrower and
lower than the pre-round **0.0891–0.1217**, even though the peak ceiling
rose. The semantic cue set follows the same subtraction: four weapon tiers
share one recognisable family but not one waveform, and five bosses share a
campaign vocabulary but not one entrance. Naming each distinction once is
more restrained than making every pickup or attack ornamental.

**Internet Void (behavior over content).** The BGM is still written to leave
the 1.5–3kHz band — where the player's own actions live — empty, and the
measured numbers still show a **vacated band with a tenant**: every track's
in-band energy is **0.00%** (M3′/M4′, unchanged, comfortably inside the
≤6–8% target), while `graze` sits at **100.0%** in-band and `break` at
**51.5%** — the two sounds that report the player's own play (a graze is a
decision; a broken card is a result of sustained damage) are still the
loudest tenants of the band the BGM left empty. That is the filter stated as
a measurement rather than a metaphor, and it is exactly as true after the
lead moved register as before — the lead moved to a *different* void, not
into this one.

The hole is spectral first, level second, and the level assertion (M10′)
changed shape this round: separation used to be measured against `graze`'s
effective peak (a ~4.1dB margin). With the lead now the loudest, most
present voice, the honest ceiling to hold is against the SFX event that fires
*continuously* under play — `shot`, not `graze` — asking only that the score
never outweighs the sound of the player's own weapon at the instant it fires:
the loudest track's effective RMS (`adjourn`, buffer RMS 0.0990 × volume 0.70
× 0.55 = **0.0381**) sits under `shot`'s effective peak (0.3801 × 0.30 =
**0.1140**) — a **~9.5dB** margin, comfortably clearing the 7dB floor
`mix.test.ts` M10′ asserts. The separation the mix actually relies on remains
*spectral* (below), and M10′ is the level backstop, not the mechanism.

**The lead-lane floors — M13′/M14′/M15′/M16′, the four numbers that flip the
contract.** These did not exist before this round; the old contract was
ceilings on a lump, proving the BGM was *quiet*, never that a tune was
*there*. All four are frozen from the real render, not the design's
estimate — every `[PIN]` in the design was re-measured and, where the render
disagreed with the estimate, the render won:

| # | Assertion | Floor | Measured | Binding track |
|---|---|---|---|---|
| M13′ | lead-band [300,1000]Hz RMS ≥ | **0.025** | 0.0285–0.0673 | `docket` 0.0285 |
| M14′ | lead-band RMS ÷ whole-buffer RMS ≥ | **0.34** | 0.375–0.681 | `docket` 0.375 |
| M15′ | sounded slots (non-trance) ≥ | **6/16** (0.375) | 0.50–0.875 | `menu` 8/16, `interdict` 4/8 (both 0.50) |
| M16′ | in-lane SNR over a shot train, period 6 ticks | loudest ≥6dB, every non-trance ≥3dB | loudest 11.0dB, min 3.6dB | loudest `adjourn`; min `docket` |

A single floor binds every track on M13′/M14′/M15′ — trance included — rather
than the two-tier (trance/non-trance) floors the design proposed. The design
assumed the sparser trance envelope would measure *lower*; measurement found
the opposite: trance's wider attack/decay (0.12 / 1.4, against absorption's
0.03 / 3) sustains each note longer, so trance lead-lane RMS and ratio came in
*above* the sparsest non-trance tracks (trance minimum leadRMS 0.0497, ratio
0.544 — both above `docket`'s 0.0285 / 0.375). One floor every track clears
is the more honest encoding of "every track is audible" than a lower bar for
tracks that, measured, needed no lower bar. M15′ (density) keeps trance
exempt — sparseness is 出神's whole architecture, and `zenith`/`fiat`/`adjourn`
sound 4–5 of 16 slots on purpose.

M16′ carries the round's one real course-correction. The design's 9dB
estimate assumed `shot`'s downward square sweep (`1050→420Hz`) would clear
the lead lane on its way down; measured, its fundamental's tail crossed
*into* [300,1000] (~90% of the shot's own energy landing there), leaving the
loudest track only marginally ahead of a realistic shot cadence. The fix was
spectral, not a level cut: `shot`'s sweep floor moved **420 → 640Hz**
(`src/audio/index.ts`), clearing the meat of the lane while the sound stays
an audible downward "pew" and its effective peak barely moves (0.1137 →
0.1140, so the SFX hierarchy below is unaffected). That one change lifted
every track's in-lane margin by roughly the shot's own in-lane RMS drop
(0.0162 → 0.0132, ~1.8dB), and M16′'s floors are frozen against the render
*after* that fix, not the design's pre-fix estimate. The deeper fallback the
design also specified — cutting `shot.volume` 0.30 → 0.20, spending the
"behavior stays on top of its own event" asset — was **not** needed and was
not taken.

**A-weighted-ish RMS** (`tools/measure-audio.ts`'s `A-RMS` column, weighting
energy toward 300–3000Hz the way the ear itself weights loudness) is the
sharpest single proof the register move matters more than the raw level move:
`0.0169–0.0418` across the thirteen tracks — a track re-weighted for how it is
actually heard reads far louder, proportionally, than its raw RMS lift,
because the energy that moved did not just get louder, it moved from ~100Hz
(where the ear discounts it heavily) to ~500Hz (near-flat). It is published,
not gated — a proxy for the ear check in §6, not a bound `mix.test.ts` holds.

**入神 / 出神 (absorption / trance) — not to be confused.** Ten tracks are 入神:
pulse-gridded, equal-tempered, `detune: 0`, each ending its loop on a rest or a
deliberate incompletion (interdict truncates, docket/sanction/interregnum
transform without ever settling until the fourth). Three are 出神: `zenith`,
`fiat`, `adjourn` — pulse voice dropped, envelopes widened, pitch detuned off
the grid, but **not** dropped in register: all three keep `leadOctave 3`, the
same lead register as their 入神 counterparts, so the opposition a listener
hears is detune + mode + a sparser envelope, not "the melody got lower" —
that would read as a different, lesser cell rather than the same cell
unmoored. These are opposite stances, not a spectrum: 入神 is the factory
craftsman's focused hand, the pulse a player threads bullets against; 出神 is
drift, the floor removed. `zenith` and `fiat` measure loop-to-fight ratios near
1× on purpose — 入神 tracks are sized so the loop completes roughly twice or
more inside their fight (nemesis 14s/28s, interdict 8s/14s, docket 16s/50s,
sanction 16s/46s, interregnum 16s/62s), because completion is part of the
absorption; 出神 tracks are not, because drift has no completion to size
against.

**The loop seam.** By construction, every voice is snapped to a whole number of
cycles per buffer, so the seam should read as silent. It measures
**0.0010–0.0019** across the thirteen tracks (tighter than the pre-round
0.0014–0.0023, despite the higher register meaning more cycles per buffer),
not exactly zero — the one voice that is a whole-cycle bass drone (not a gated
melodic note) still crosses the seam continuously, so its endpoint is a small,
deliberate, inaudible-in-practice jump, not a click. Every melodic voice is
exactly zero at the seam regardless of `leadOctave`, which is the part the
design actually depends on and the part `leadOctave` was built not to disturb;
well under the ≤0.02 click threshold established by the retired pre-v4
clearing-pack fixture.

### Pass 2, held: the lead harmonic stack (designed, not shipped)

Concept A's tone-quality lever — replacing the lead's single sine with a
3-partial harmonic stack (`AMPS = [1.0, 0.45, 0.20]` over whole-cycle
partials, guarded to break before any partial enters 1500Hz so the behavior
band stays untouched) — is fully specified in `music.ts` at the lead sample
line, as a comment, and **deliberately not built** in this round. The
sequencing is 做减法: this round already changes two things at once
(register, via `leadOctave`, and density, via the 16-slot motifs); shipping a
third — timbre — in the same pass would make an ear-reject impossible to
isolate to one lever. If the ear check (§6) reports the tone thin, beepy, or
chiptune-like *after* register and density are heard, the harmonic stack is
the next lever, gated on exactly that verdict and no other. It is
seam-safe and deterministic by construction (whole-cycle partials, no RNG),
so shipping it later is a one-line swap, not a redesign.

**The SFX hierarchy.** The measured fifteen-cue fallback baseline (§2) falls in
the order the game's own threat model implies: `death` (0.7451) >
`explosion` (0.4737) > `toll` (0.3399) > `break` (0.2146) ≈ `declare`
(0.2126) > `hit` (0.1862) > `clear` (0.1846) > `pickup` (0.1618) > `shot`
(0.1140) > `graze` (0.0686), with all five `ui-*` sounds sitting under the rest
at 0.0479–0.0647. The new authored targets keep boss entries in the `toll`
neighbourhood (0.3120–0.3420), tier crossings between pickup/hit and
break/declare (0.1824–0.2024), and the three added held-fire tiers nearly equal
(0.1450–0.1458; the formal Tier-0 release cue measures 0.1500). Those ten
figures are specification products, not decoded
measurements; the measurement tool and listening pass must confirm them before
they become frozen baselines. The navigation revision raises and moves those
transients without crossing `graze`, so the existing M8′ baseline remains
measured rather than assumed.
Losing a life
is louder than anything else in the game; grazing a bullet — an event that
fires dozens of times a second — is the quietest gameplay sound, and every
menu click sits under even that, because a menu click is never the thing the
player is supposed to be listening for. M9a adds the missing positive menu
claim: `ui-move`, `ui-confirm` and `ui-cancel` each clear the menu theme's
effective RMS by at least 3dB. M9b keeps more than half of each navigation
cue's energy in the 1.5–3kHz band the theme vacates.

## 6. Verify

```
bun run typecheck
bun test                 # mix.test.ts holds the M1′–M16′ bounds above; reachability holds both cue channels both ways
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
audible on menu navigation, pause, and pre-boss dialogue. The same pass must
also identify the four stage architectures, distinguish `toll` plus the four
named boss entrances without a picture, hear all four held-fire tiers at
near-equal loudness, and hear exactly one `power-up-*` cue at each real tier
crossing.
