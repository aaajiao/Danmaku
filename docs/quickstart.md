# Quickstart — a guest pack playing in the browser today

For an author who has never read the engine and wants a pack on the title screen
by the end of one sitting. It does **not** repeat the format — [`docs/packs.md`](./packs.md)
is the specification and every field and error lives there — it walks the shortest
real path from an empty folder to two campaigns you can select and clear, and
links out at each depth boundary.

The worked example is **`packs/clearing`**, a committed pack in this repo: two
campaigns, three bosses, a character built from base rows, and — this is its whole
thesis — **almost no art.** It paints no bullet sheet, no ship, no HUD icons, and
ships no sound files; every one of those falls through to the procedural floor
(`src/render/procedural.ts`, `src/audio/`). It carries exactly three presentation
files, and you will see below why it cannot carry fewer. `packs/example` is the
*other* reference — the one that paints everything — and the two together bracket
the range: copy `example` when you want to see art take effect, read `clearing`
when you want to see how little a content pack is obliged to carry.

Every command below was run while writing this; where a command prints something
you need to recognise, its **real output is quoted**. Every `manifest.ts` error
string quoted here is copied verbatim from the source — those strings are a tested
compatibility contract (`docs/packs.md` §6), so if the text you see differs from
the text here, trust what the engine printed, not this page.

---

## 1. What you'll build

`clearing` — a **clearing house**, the settlement sibling to the base game's
magistrates and wardens, named in nouns of procedure. It ships:

- **two campaigns** (two title rows) — `Manifest` (`intake` → `manifest-floor`), a
  teaching ramp, and `Demurrage` (`demurrage`), a dense single stage;
- **three bosses** — `assay` (a midboss wave), `escrow` (Manifest's end boss),
  `lien` (Demurrage's end boss);
- **five enemies, four item kinds** (all of `power`/`score`/`life`/`bomb`);
- **one character**, `consignee`, that fires the base game's own weapon;
- **one replaced music track and two dialogue portraits** — the only painted or
  recorded files in the pack.

The path is: an empty folder that already boots, then content added a section at a
time, validated at every step, ending on `bun run build` with the pack staged into
`dist/`.

---

## 2. The empty folder already boots

Make the folder and give it the smallest manifest that validates:

```
mkdir packs/clearing
```

```json
{
  "format": 1,
  "name": "clearing",
  "version": "1.0.0",
  "author": "you",
  "license": "CC0-1.0"
}
```

**A minimal manifest is five fields, not two.** `format` and `name` are the
obvious ones; `version`, `author` and `license` are each independently required,
and `license` is required because CLAUDE.md rule 9 makes provenance mandatory —
this repository is scarred by upstream art that shipped with none. Drop the last
three and the validator hands back three errors, one per field. Run against the
real validator (`validateManifest`), a two-field manifest returns:

```
pack "clearing": pack.json: missing required field "version" — a string, e.g. "1.0.0"
pack "clearing": pack.json: missing required field "author" — name the author (provenance; CLAUDE.md rule 9)
pack "clearing": pack.json: missing required field "license" — state the provenance of this art (everything shipped must be original; CLAUDE.md rule 9)
```

The five-field manifest above validates clean — no `assets`, no `sounds`, no
`content`, nothing else. Now start the dev server and look at it:

```
bun run dev
```

`bun run dev` runs `tools/serve.ts`, which serves the `packs/` tree and
synthesizes `/packs/index.json` by scanning for directories that contain a
`pack.json` — so the folder you just made is discovered on the next reload, with
no config edit (`docs/packs.md` §3). Open the game with **`?pack=clearing`** in the
URL to narrow to this one pack, and a **boot-report overlay** appears over the
field. `?pack=` forces the overlay on even when nothing failed, precisely so you
can confirm a clean pack took effect; its body reads:

```
(no pack resources active — running on placeholders)
```

That line is the never-blocked floor, proven before a single asset exists: a pack
that carries nothing still loads, warns nothing, and the game runs entirely on
procedural placeholders. Press any key to dismiss the overlay; the full report
stays in the console (`docs/packs.md` §8).

> If you served the game with bare `bun ./index.html` instead of `bun run dev`,
> `/packs/index.json` returns the HTML entry document, the loader detects the
> non-JSON response and prints `packs unavailable under this server — run bun run dev`,
> and the game runs on placeholders. That is the old-server case handled softly,
> not an error.

---

## 3. Copy the reference, or grow from empty

Two honest routes from here, and `clearing` took the second:

- **Copy `packs/example`** (`rm -r packs/clearing` first if you built §2's
  folder — copying onto an existing directory nests `example/` inside it — then
  `cp -r packs/example packs/clearing` and rename the folder's `name` field to
  `clearing`) if you want a working pack of every kind in front of you to edit
  down. The **`name` field must equal the directory name** or the pack is
  rejected before anything loads.
- **Grow from the empty folder** if your pack is content-first, because `example`
  paints everything and you would spend the first hour deleting art. `clearing` is
  generated whole by `tools/make-clearing-pack.ts` — a script that authors
  `pack.json`, round-trips it through the real `validateManifest` **before writing
  it to disk**, and re-parses its own `descent.wav` and portraits before trusting
  them. That is the pattern to copy: a generator that cannot commit a pack its own
  engine would reject. Run it and it reports its self-check:

```
bun tools/make-clearing-pack.ts
```
```
pack.json: validates clean against src/packs/manifest.ts
```

There is **no `package.json` wiring to add** for a generator to be discovered — a
pack is picked up by the dev server and the build purely by sitting in `packs/`. A
`make:clearing-pack` script exists only as a convenience alias; the generator runs
the same bare `bun tools/make-clearing-pack.ts` with or without it.

---

## 4. Content-first: carry only what the floor cannot give you

The floor gives you bullets, the ship, the HUD, every particle effect, every
scene, and all fifteen sounds — procedurally, forever. So a content pack's austerity
question is: *what genuinely cannot be procedural?* For `clearing`, only three
files:

- `music/descent.wav` — one track (§10);
- `portraits/escrow.png`, `portraits/lien.png` — two faces (§9), and you will see
  in §9 why these are not optional.

Everything else — bullet cells named by string (`kunai`, `orb.small`, `needle`,
`scale`, `halo`, …), the `hit`/`explosion`/`death.big` effects, the `stratum`/
`surge`/`undertow` scenes — is referenced by name and resolved to a built-in. If
you *do* want to paint a sheet later, that is the `docs/assets.md` path and it
slots in without touching content; the floor is a starting point, not a ceiling.

---

## 5. Declare only what you ship — the covering invariant

Content is opt-in through `requires`, and the rule is exact in both directions:
**declare a capability for every `content` section you ship, and ship a section
for every capability you declare.** `clearing` uses five of the nine:

```json
"requires": [
  "content.enemies",
  "content.stages",
  "content.bosses",
  "content.characters",
  "content.items"
]
```

No `content.shots`/`.options`/`.bombs` (the character reuses base rows — §8), no
`content.effects` (only built-in effects fire). Break the invariant in either
direction and the pack is rejected. Declare a capability with no section:

```
pack "clearing": pack.json: requires lists "content.enemies" but there is no content.enemies section — add the section or drop the capability
```

Ship a section with no capability and you get the mirror message
(`content.<section> is present but "<cap>" is not in requires …`). The reason is
forward-compatibility: an older engine that does not implement a capability must
refuse on `requires` *before* it ever parses `content`, so a section it could not
load can never reach it unannounced (`docs/packs.md` §9.1). **Do not write
`requires: []`** — omit it entirely for a reskin-only pack.

---

## 6. Two campaigns — entries, chaining, and the boss lesson

A stage becomes a **title row** by carrying `entry: true`. `clearing` has two, so
the title screen shows `START`, then a row per entry (labels are qualified —
`clearing/intake`, `clearing/demurrage`). Non-entry stages are reached by another
stage's `next`; a stage that is neither an entry nor any stage's `next` is dead
content and the injector refuses it:

```
pack "clearing": stage "manifest-floor" is neither an entry nor any stage's next — dead content (registration is not reachability)
```

That refusal runs at injection, before `reachability.test.ts` ever would — it is
the pack-level enforcement of CLAUDE.md's "registration is not reachability."

**The boss lesson, which the base game's stage-3 got wrong once:** a stage's
top-level `boss` field is the **end boss, re-sent at wave exhaustion**; a `boss` on
a *wave* (`{ at, boss }`) is a **midboss slot for a different boss**. Mixing them
up sends the wrong fight or none. `clearing`'s Manifest chain shows both at once:

```
intake          entry: true   next: manifest-floor   boss: null      background: stratum
  a trash-only teaching ramp; advances at wave exhaustion (no top-level boss).

manifest-floor  entry: false  next: null             boss: escrow    background: surge
  waves: … then { at: 560, boss: "assay" } …
  the { at, boss } wave sends the PACK boss `assay` as a midboss mid-schedule;
  the top-level `boss: escrow` re-sends `escrow` as the END boss at exhaustion.

demurrage       entry: true   next: null             boss: lien      background: undertow
  dense from wave 1; `lien` re-sends as the end boss.
```

`background` names a **built-in** scene by string — shaders are engine code a pack
never carries (`docs/packs.md` §9.3). Timings are ticks (60 = 1s). The full stage
and wave grammar is `docs/extending.md` §6.

---

## 7. Bosses sized in seconds

A boss is a `BossSpec` as JSON with one substitution: a spell card declares
**`hpSeconds`** — seconds of health a competent player needs to drain — where the
engine's `SpellCard` carries raw `hp`. The injector computes `hp =
phaseHp(hpSeconds)` and defaults the clock to `phaseClock(hp)`, both off
`REFERENCE_DPS`, the same measured damage rate `balance.test.ts` re-derives. You
author in the unit a designer thinks in, and the boss re-sizes automatically if
the damage model moves. `hpSeconds` is **capped at 180** — past that is almost
always a ticks-for-seconds units error:

```
pack "clearing": boss "…" phase "…": hpSeconds … exceeds the ceiling of 180 — hpSeconds is SECONDS of intended drain, not ticks
```

These seconds are **estimates until measured.** `clearing`'s were re-tuned against
the base bosses' family (base midboss `warden` = 14s; longest base boss `regent` =
80s) so no phase runs long and none exceeds the base's own sub-90s envelope: `assay`
8/10s, `escrow` 16/18–22/24s, `lien` 18/20/22/24s. Confirm every phase drains
inside its own clock flying the pack character, and re-tune — the `phaseClock`
coupling is the point.

**The disjoint difficulty slot** is the new technique to learn here. A phase with
no `difficulties` is active on every tier; two consecutively-listed phases with
**complementary gates** form one slot that fills to exactly one card per tier.
`escrow`'s four phases:

```
Hold                    (all tiers)
Clearance "Provisional"  difficulties: ["easy","normal"]
Clearance "Final"        difficulties: ["hard","lunatic"]
Settlement              (all tiers)
```

Every tier sees exactly **three** cards — `[Hold, Provisional, Settlement]` on
easy/normal, `[Hold, Final, Settlement]` on hard/lunatic. `lien` adds the classic
other direction: a lunatic-only `Penalty "Interest"` fourth card, so lunatic
fights four and every other tier three. The engine enforces a floor — **every tier
must keep at least one phase** — so a card gated off every tier but one cannot
leave a boss unfought elsewhere:

```
pack "clearing": boss "…" has no phase on difficulty "easy" — every tier must keep at least one
```

A spell card may also override its scene and track for its own duration —
`escrow`'s `Settlement` sets `background: "undertow"` and `music: "fiat"` (both
built-ins, costing no carried file). Boss fields are `docs/extending.md` §5.

---

## 8. A character from base rows

`consignee` is a full character on the SELECT screen that carries **no weapon of
its own.** It names the base game's rows by string:

```json
"consignee": {
  "label": "CONSIGNEE", "sprite": "ship",
  "shot": "spread", "options": "standard", "bomb": "spread",
  "player": { "x": 240, "y": 568, "speed": 3.6, "focusSpeed": 1.5, "radius": 2.5,
              "grazeRadius": 20, "lives": 3, "bombs": 3, "invulnTicks": 90 }
}
```

`spread`/`standard`/`spread` are `scout`'s rows. Every name resolution runs
**pack-first, then built-in** (`docs/packs.md` §9.3): a name the pack itself does
not define falls through to the engine, so a bare `spread` finds the base shot.
That is why the `requires` list in §5 carries no `content.shots`/`.options`/
`.bombs` — the pack ships none.

Two consequences worth stating. First, because `consignee`'s `player` block is
`scout`'s verbatim, its DPS is identical, so `balance.test.ts` — which derives
`REFERENCE_DPS` from the *base* pack only and never imports on-disk packs — is
untouched by construction. Second, a **pack character is content**: flying
`consignee` on any campaign records `packsData` and a mismatch refuses on replay,
exactly like the campaigns do (§10).

---

## 9. Dialogue, and why a speaking boss carries a face

A boss carries a pre-fight `dialogue` — an array of `{ speaker, text }` lines. The
*text* is content the simulation runs (advancing a line is a Shot tap that delays
the fight, reproduced from the input log). The *portrait* named by each `speaker`
is presentation. `escrow` also varies its exchange per character with
`dialogueFor`, keyed to the **built-in** `scout` — flying `scout` through Manifest
hears a three-line variant, everyone else hears the two-line default. `dialogueFor`
keys resolve against characters built-in ∪ this pack's own (`docs/packs.md` §9.2).

**Here the design's convenient assumption breaks, and the truth is worth the
correction.** A speaker naming a portrait the engine cannot resolve — neither a
built-in nor one this pack carries — is **refused at injection**, even though the
renderer *could* fall back to a procedural silhouette:

```
pack "clearing": boss "escrow" dialogue line 0 names unknown portrait "escrow" — known portraits: …
```

The injector treats a dangling speaker as a typo, not an intent. The built-in
portraits are the base boss names (`sentinel`, `warden`, …) and `player` — all
procedural silhouettes registered by name. So a boss that speaks under one of
those names needs no file, but a boss that speaks **under its own new name must
carry a portrait**, because `definePortrait` refuses duplicates and there is no
built-in `escrow` to fall back to. That is why `clearing` carries
`portraits/escrow.png` and `portraits/lien.png` — its two speaking bosses — and
`assay`, a silent gate, carries none. The silhouette floor is real, but it is the
floor for *registered* names; a brand-new speaker registers by carrying its 96×96
face. Portraits are still presentation — they warn, never refuse, on replay.

---

## 10. The reskins, and the replay split

`clearing`'s presentation is three files, and they teach both halves of the
replay contract from one pack:

- **`music/descent.wav`** replaces the **built-in** track name `descent` in place
  (last-wins reskin, resolved pack-first) and plays as `lien`'s boss music. A pack
  track is `{ file, loopStart?, loopEnd?, volume? }`; author it mono with a
  seamless loop exactly as `docs/audio.md` describes, and the loader checks
  `loopEnd ≤` the decoded duration in the browser.
- **the two portraits** (§9).

All three are reskins — presentation. That splits the replay policy cleanly:

- **Content refuses.** A run touching pack content — flying `consignee`, or playing
  either campaign — records `packsData`; replayed under different content it
  **refuses**, like a mismatched base character or stage.
- **Reskins warn.** The pack's presentation identity records in the warn-only
  `packs` field; a skin mismatch **warns** and plays on. Because `descent` is a
  built-in name this pack replaces, *any* run made with the pack installed — even a
  pure base run — carries that warn-only identity, and that alone never refuses.

Concretely: a base run recorded *without* the pack and replayed *with* it warns
(presentation differs) and plays; a `clearing` campaign or `consignee` run replayed
*without* the pack refuses (content differs). State this split in your pack's
`README.md`, as `packs/clearing/README.md` does. The base game's eight replay
traces stay byte-identical: all pack content registers under `clearing/…`
qualification, and a second `packs/` folder is invisible to `bun test`.

---

## 11. Load it, play it, build it

```
bun run dev
```

Open `?pack=clearing`, read the boot-report overlay (now listing the registered
content, not "no pack resources active"), dismiss it, and clear **both** campaigns
from the title screen. The loader's fetch/decode path — the WAV through
`OfflineAudioContext`, the portraits through `Image`, the boot overlay — runs only
in a real browser; `bun test` exercises the validator and injector directly and
never touches it, so this is the step you must do by eye. Density is a by-eye call
too: no automated gate covers pack stages, so judge that a single bullet stays
findable in the pack's densest wave — `demurrage`'s opening — against the base
stage-4 curtain (`clearing` measures 505 concurrent bullets at lunatic against
stage-4's 587; comfortably inside the envelope).

Then the three gates that must be green before a pack is done:

```
bun run typecheck     # clean
bun test              # 1741 pass, 0 fail — a second packs/ folder is invisible to it
bun run build         # copy-packs stages packs/clearing into dist/packs/
```

`bun run build` appends `tools/copy-packs.ts`, which copies the whole `packs/` tree
into `dist/` and precomputes `index.json` (a static host cannot synthesize it per
request). No new test file is needed or wanted: nothing in `bun test` enumerates
`packs/`, and the only two on-disk pack tests name `packs/example` by literal path,
so `packs/clearing` cannot collide with them.

---

## 12. Deeper

- [`docs/packs.md`](./packs.md) — the full pack format: every field, every error
  string verbatim, both validation layers, the boot report, and the reserved
  format-2 surface.
- [`docs/extending.md`](./extending.md) — the engine specs a pack's JSON *is*,
  field for field: `EnemySpec` (§4), `BossSpec`/`SpellCard` (§5), `StageSpec` (§6),
  shots/options/bombs/characters (§7), `ItemSpec` (§8), `ParticleSpec` (§9).
- [`docs/assets.md`](./assets.md) — when you add art: the bullet sheet's pixel
  doctrine, the ship's hitbox marker, the 2px margin, why bullets are white.
- [`docs/audio.md`](./audio.md) — sounds and music: mono, fade to zero, normalise
  then set volume, and how a loop is authored.
