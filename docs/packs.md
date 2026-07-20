# Asset packs — the drop-in format

A **pack** is a folder of art, sound and — with a `content` section — game data
that extends the game without editing a line of engine code. Drop `packs/my-pack/`
next to the others, refresh, and the bullets, ship, HUD icons and sounds it
declares take over, and any enemies and stages it carries become a campaign you
can select from the title screen.

A pack has two halves that behave differently, and the difference is the spine of
this document:

- A **reskin** replaces presentation only — bullet sheet, ship, HUD icons,
  sounds. The same patterns fire, the same bosses appear, the same replay plays
  back; a replay recorded under one skin plays under any other, so a skin
  mismatch **warns**, never refuses.
- **Content** (`content.enemies`, `content.stages`, gated by `requires`) adds
  enemies and stages as data. That changes what the game *does* — different
  bullets in the air — so a replay recorded under a content pack **refuses** to
  play under different content. Patterns, behaviours, bosses, characters, items,
  backgrounds and effects stay engine code the content joins by name; a pack
  carries the *data* that arranges them, never the code.

This document is written for a pack author who has never read the engine. It
covers the folder layout, how a pack activates, every manifest field, every
error the two validators can hand back (the messages are exact and tested — they
will not be reworded under you), the pixel rules a sheet has to obey, the content
shapes and their name-resolution rules, how multiple packs layer, and what
belongs to a future format that does not exist yet.

If you have read [`docs/assets.md`](./assets.md) and [`docs/audio.md`](./audio.md),
a pack is the packaged, drop-in version of the same swap those documents describe
at the source level. You do not need them to write a pack; you need them if you
want to understand *why* a bullet must be white or a sound must fade to zero.

---

## 1. What a pack is, and is not

A pack **can** replace, as a reskin:

- the **bullet sheet** — all sixteen 32×32 cells the whole game draws from
  (bullets, enemies, the boss, items and particle effects all wear these cells;
  see `docs/assets.md` §3.1);
- the **player ship** sprite;
- any of the six **sounds** the game plays;
- the **♥ life** and **★ bomb** HUD icons.

A pack **can also**, with a `content` section (§9), add game data:

- **enemies** — a full `EnemySpec` as JSON: hitbox, motion, timeline, the
  patterns it fires, what it drops;
- **stages** — waves of those enemies (and built-in ones), chained into a
  selectable campaign, ending on a built-in boss.

A pack **cannot** change the *code* that data drives: no new patterns, no new
motion behaviours, no new bosses, no new characters, no new items, no new
backgrounds, no difficulty curves, no music, no dialogue. Those are engine code,
reserved or registered under a string name — see §9 for what content reaches and
§10 for what stays reserved. The dividing line is simple and permanent:

> **Skins and arrangements are pack data. Everything that generates motion or
> effect is engine code, joined to a pack only by name.** A bullet's *picture*
> comes from a pack, and so does the *arrangement* of an enemy — which pattern it
> fires, where a wave puts it — but the *pattern* itself, the three.js/shader
> *effect* that flares when a bullet dies, the *behaviour* that steers it and the
> *boss* a stage sends are all code, registered in the engine by a string name
> (the same arrangement as `definePattern` / `defineBehaviour` / `defineBoss` /
> `defineBackground`). A pack paints and it arranges; it never scripts.

Because presentation is optional and always degrades to a placeholder, the game
is **never blocked on it**. The procedural placeholders
(`src/render/procedural.ts`, `src/audio/`) are the permanent floor. A missing
pack, a broken pack, a pack whose sheet is the wrong size — each degrades to
"that one resource stays procedural" and the run continues. A pack whose
*content* fails validation is rejected whole and simply contributes no campaign
row (§9), so a failed content pack cannot leave a half-registered enemy in the
game either. This is CLAUDE.md rule 9 in operation: everything shipped is
original by construction, and nothing you drop in can leave the game unable to
draw.

---

## 2. The folder tree

A pack is a directory under `packs/` containing a `pack.json` manifest and the
files it names:

```
packs/
  example/                 the reference pack, committed to the repo
    pack.json              the manifest — the only required file
    bullets.png            256×64, 8×2 cells of 32×32
    ship.png               64×64, one sprite
    life.png               ≤16×16 HUD icon, replaces ♥
    bomb.png               ≤16×16 HUD icon, replaces ★
    shot.wav               a replaced sound
    pickup.wav             another replaced sound
    README.md              annotation (ignored by the loader)
  my-pack/
    pack.json
    …
```

Only `pack.json` is required. Every asset field in it is optional: a pack that
declares only `assets.bullets` replaces the bullet sheet and leaves everything
else procedural. The **directory name is the pack's identity** — `pack.json`'s
`name` field must equal it — so renaming the folder renames the pack, and a
mismatch is rejected before anything loads (§6).

`packs/example/` is a complete, working pack that exercises every v1 field and
obeys every rule the loader checks. **Copy it, rename the folder and its `name`,
and start replacing files.** Its `README.md` annotates every field and every art
decision; this document is the specification, that pack is the reference
implementation of it.

---

## 3. Activation — drop in, refresh

### 3.1 In development

`bun run dev` runs `tools/serve.ts`, a Bun server that does two things the bare
`bun ./index.html` cannot:

- serves the `packs/` tree as static files under `/packs/…`, and
- synthesizes `/packs/index.json` per request — the list of directory names
  under `packs/` that contain a `pack.json`.

So the whole activation story is: **drop a folder into `packs/`, refresh the
page.** The server rescans the directory on every request for the index, so a
pack added while the server is running is seen on the next reload. No build step,
no config edit, no restart.

### 3.2 In a production build

`bun run build` appends `tools/copy-packs.ts`, which copies the `packs/` tree
into `dist/packs/` and writes the same `index.json` alongside it — precomputed,
because a static host cannot synthesize it per request. The built output is then
plain static files that any host serves directly, with no wrapper. If `packs/`
is absent, the copy step logs `copy-packs: no packs/ directory — nothing to
stage.` and the build still succeeds.

### 3.3 Under the bare server, packs are simply unavailable

If the game is served by `bun ./index.html` (no wrapper), a request for
`/packs/index.json` returns the HTML entry document, not JSON. The loader detects
that its response will not parse as JSON, prints one line —

```
packs unavailable under this server — run bun run dev
```

— and runs the game on placeholders. This is not an error state; it is the
old-server case handled softly. Nothing is lost except the packs, and the fix is
in the message.

---

## 4. The manifest — `pack.json`

### 4.1 A complete worked example

This is `packs/example/pack.json`, which declares every v1 field a pack commonly
uses:

```json
{
  "format": 1,
  "name": "example",
  "version": "1.0.0",
  "author": "Danmaku project",
  "license": "CC0-1.0",
  "description": "The reference pack: every v1 field, and art that follows every rule the loader checks. Copy this directory, rename it, and swap the files.",
  "assets": {
    "bullets": "bullets.png",
    "ship": "ship.png",
    "filter": "nearest"
  },
  "sounds": {
    "shot": "shot.wav",
    "pickup": "pickup.wav"
  },
  "hud": {
    "life": "life.png",
    "bomb": "bomb.png"
  }
}
```

### 4.2 Field reference

The types below are exactly what `src/packs/manifest.ts` validates.

| Field | Required | Type | Meaning |
|---|---|---|---|
| `format` | **yes** | number | The manifest format. This engine implements format `1`; `SUPPORTED_FORMATS` is a list, so a future format 2 will not orphan a v1 pack, but a v1 pack always declares `1`. |
| `name` | **yes** | string | Must equal the directory name and match `[a-z0-9-]{1,32}`. This is what keeps a renamed folder from silently claiming another pack's identity. |
| `version` | **yes** | string | Free-form, e.g. `"1.0.0"`. Yours to bump. |
| `author` | **yes** | string | Who made the art. Provenance, not decoration — see `license`. |
| `license` | **yes** | string | **Provenance is mandatory.** CLAUDE.md rule 9: everything shipped needs a declared licence, because upstream's Touhou-derivative art shipped with none. A pack with no `license` is rejected. |
| `description` | no | string | A sentence, shown wherever the boot report lists loaded packs. |
| `assets` | no | object | `bullets?`, `ship?`, `filter?` — see §5.1–5.2. |
| `sounds` | no | object | One entry per replaced sound, keyed by the sound's registered name — see §5.3. |
| `hud` | no | object | `life?`, `bomb?` icon PNGs — see §5.4. |
| `requires` | no | string[] | Engine capabilities the pack needs. This engine implements `content.enemies` and `content.stages`; anything else is refused, naming what it does not implement and what it does. A `content` section and its covering `requires` entry are one contract — see §9. Omit it entirely for a reskin-only pack (do not write `[]`). |
| `content` | no | object | Format-2 game data: `enemies?`, `stages?`. Present only alongside the matching `requires` entries — see §9. |

**Unknown fields are errors, not warnings.** A misspelled `assets.bulets` or a
stray top-level key is rejected with a "did you mean" suggestion. This is
deliberate: the silent-typo failure — where a mistyped key is ignored and the
placeholder plays on with no complaint — is the exact failure class this
repository is scarred by (see `docs/audio.md` §3, where a mistyped `defineSound`
name does exactly that). A pack manifest refuses to fail quietly.

Paths in the manifest are **relative to the pack folder**. `"bullets.png"` means
`packs/<name>/bullets.png`. Subfolders work (`"art/bullets.png"`), and the dev
server guards against paths escaping the tree.

---

## 5. The resources, in detail

### 5.1 `assets.bullets` — the bullet sheet

A 256×64 PNG, eight columns by two rows of 32×32 cells, RGBA. The cell order,
names and roles are in `docs/assets.md` §3.1 — this one sheet carries essentially
the whole visual vocabulary of the game, not just the player's bullets. Three
rules the loader enforces on it in the browser (it has a canvas; `bun test` does
not, so these checks live in `loader.ts`, not `manifest.ts`):

- **Dimensions must be exactly 256×64** (`BULLET_COLUMNS`×`BULLET_ROWS` cells of
  `BULLET_GRID`, `src/render/procedural.ts`). A wrong-sized sheet would repoint
  every cell at a crop of the wrong shape, so it is rejected naming both sizes.
- **Every cell's painted alpha must stay within 28px** (`MAX_CELL_EXTENT`,
  `src/render/procedural.ts:176`). This is the 2px-margin rule of §7.2, measured
  off the real pixels — not the geometry you drew, the *paint*.
- **Bullet cells must be white** — mean saturation ≤ 0.15. Colour is the
  engine's per-instance tint, so a coloured sheet is a mistake the tint would
  then double. See §7.1.

### 5.2 `assets.ship` — the player sprite

A 64×64 PNG, one sprite, pointing **up** (−y); the ship does not rotate. Only its
dimensions are machine-checked (64×64). The hitbox marker a ship should carry — a
small bright disc marking the lethal centre, far smaller than the silhouette — is
a readability property no single-pixel test measures reliably, so it is **judged
by eye** on the visual pages and in `bun run dev`, not asserted with a fabricated
threshold. Draw it anyway; §7.3 says how.

`assets.filter` — `"nearest"` (default) or `"linear"` — sets texture sampling for
**both** sheets. Hard-edged pixel art wants `"nearest"`; smooth, gradient-shaded
art wants `"linear"`. The default matches `loadTexture`'s own behaviour.

### 5.3 `sounds.<name>` — a replaced sound

One entry per sound you replace, keyed by the sound's **registered name**. The
six names the game plays are:

```
shot   hit   explosion   graze   pickup   death
```

(`SOUND_NAMES` in `src/packs/manifest.ts`; what each fires on is in
`docs/audio.md` §2.) An unknown name is rejected and lists all six. A pack need
not replace every sound — the example replaces only `shot` and `pickup`;
everything else keeps its synthesised placeholder. Files are fed through
`defineSound`'s `url` branch, so `docs/audio.md` §3's authoring constraints
(mono, fade to zero at both ends, normalise then set volume) apply to a packed
WAV exactly as to a source-level one.

### 5.4 `hud.life` / `hud.bomb` — the HUD icons

Small PNGs (≤ 16×16) drawn in place of the ♥ and ★ glyphs. **Position, size,
alpha and tint stay engine-owned** — the same structural move as
white-bullets-with-engine-tint. The pack supplies **shape only**: a solid white,
hard-edged mark with no background and no assumption about how large it lands or
what sits behind it (`drawHud` draws it at a fixed 10px, 0.85 alpha, to the left
of the number — `src/main.ts:517`). Larger than 16×16 is rejected. See §7.4.

---

## 6. Every error the loader can return

The messages below are **golden** — asserted verbatim in
`src/packs/manifest.test.ts`, and rewording one is a breaking change (an author's
tooling may match on them). Every manifest error is prefixed with

```
pack "<folder>": pack.json:
```

so you always know which pack and which file. Validation is **all-or-nothing per
pack** and collects *every* error, not just the first — a hand-editing author
wants the whole list, and the pack is rejected as a unit while every other pack
and the placeholders carry on.

### 6.1 Structural

| Condition | Message (after the `pack "<folder>": pack.json: ` prefix) |
|---|---|
| Root is not a JSON object | `the manifest root must be a JSON object` |
| `format` missing | `missing required field "format" — expected 1 (this engine supports formats: 1)` |
| `format` not a number | `field "format" must be a number — this engine supports formats: 1` |
| `format` unsupported (e.g. `2`) | `format 2 is not supported — this engine supports formats: 1` |
| `name` missing | `missing required field "name" — it must equal the directory name "<folder>" and match [a-z0-9-]{1,32}` |
| `name` not a string | `field "name" must be a string` |
| `name` ≠ folder, or bad pattern | `name "<value>" must equal the directory name "<folder>" and match [a-z0-9-]{1,32}` |
| `version` missing | `missing required field "version" — a string, e.g. "1.0.0"` |
| `version` not a string | `field "version" must be a string` |
| `author` missing | `missing required field "author" — name the author (provenance; CLAUDE.md rule 9)` |
| `author` not a string | `field "author" must be a string` |
| `license` missing | `missing required field "license" — state the provenance of this art (everything shipped must be original; CLAUDE.md rule 9)` |
| `license` not a string | `field "license" must be a string` |
| `description` not a string | `field "description" must be a string` |

### 6.2 `requires` (capabilities)

| Condition | Message |
|---|---|
| Not an array of strings | `requires must be an array of strings` |
| Any entry the engine does not implement | `requires lists capabilities this engine does not implement: <a, b> — implemented: content.enemies, content.stages; see docs/packs.md §Future` |

The two implemented capabilities, `content.enemies` and `content.stages`, are
**accepted** — and each demands its matching `content` section (§9). Everything
else in `requires` is refused, naming both the offending capabilities and the
implemented set.

### 6.3 `assets`

| Condition | Message |
|---|---|
| `assets` not an object | `assets must be a JSON object` |
| `assets.bullets` not a string | `assets.bullets must be a string (a path to a PNG)` |
| `assets.ship` not a string | `assets.ship must be a string (a path to a PNG)` |
| `assets.filter` not `"nearest"`/`"linear"` | `assets.filter must be "nearest" or "linear"` |
| Unknown key under `assets` | `unknown field "<key>" — did you mean "<nearest>"?` (or, if nothing is within edit distance 2, `unknown field "<key>" — valid fields here: bullets, ship, filter`) |

### 6.4 `sounds`

| Condition | Message |
|---|---|
| `sounds` not an object | `sounds must be a JSON object` |
| Unknown sound name | `sounds."<key>" is not a sound this game plays — valid names: shot, hit, explosion, graze, pickup, death` |
| A sound value not a string | `sounds.<key> must be a string (a path to a WAV)` |

### 6.5 `hud`

| Condition | Message |
|---|---|
| `hud` not an object | `hud must be a JSON object` |
| `hud.life` not a string | `hud.life must be a string (a path to a PNG)` |
| `hud.bomb` not a string | `hud.bomb must be a string (a path to a PNG)` |
| Reserved hud name (`digits`, `font`, `bossBar`, `frame`) | `hud.<key> is a pack-format-2 resource and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future` |
| Any other unknown key under `hud` | `unknown field "<key>" — did you mean "<nearest>"?` (or `… valid fields here: life, bomb`) |

### 6.6 Unknown and reserved top-level fields

| Condition | Message |
|---|---|
| Reserved future section (`music`, `difficulty`, `dialog`, `backgrounds`) | `<key> is a pack-format-2 section and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future` |
| Any other unknown top-level key | `unknown field "<key>" — did you mean "<nearest>"?` (or `… valid fields here: format, name, version, author, license, description, assets, sounds, hud, requires, content`) |

`content` is no longer refused here — it is an implemented top-level section
(§9), and its own errors are in §9.4. The valid-fields list now ends in
`content`.

### 6.7 Asset-loading errors (in the browser loader)

These are not golden strings — only `manifest.ts`'s text is — but they follow the
same `pack "<folder>": <path>: …` shape and name the measured value, and the
thresholds are stated as constants in `src/packs/loader.ts` so the number the
doctrine quotes and the number enforced are the same. A machine-check failure
rejects the pack whole and names it in the boot report.

- Bullet sheet wrong size:
  `pack "<name>": <path>: sheet is <w>×<h>, expected 256×64 (8×2 cells of 32×32)`
- A cell paints past the margin:
  `pack "<name>": <path>: cell "<cell>" paints <x>×<y>px, over the 28px limit — a cell must clear 2px of margin or it bleeds across the seam`
- A cell is not white:
  `pack "<name>": <path>: cell "<cell>" has mean saturation <n>, over 0.15 — bullets are white and colour is the engine's tint`
- Ship sheet wrong size:
  `pack "<name>": <path>: ship sheet is <w>×<h>, expected 64×64`
- HUD icon too large:
  `pack "<name>": <path>: hud icon is <w>×<h>, over the 16×16 limit — it stands in for a glyph, so it is drawn small`
- A named file could not be fetched or decoded:
  `could not be fetched (HTTP <status>)` / `could not be decoded as an image`
  (the `pack.json` manifest is the one exception: a missing manifest reports
  `pack "<name>": pack.json: could not be fetched` without the status, and is
  nearly unreachable because the server only lists directories that contain one)

### 6.8 `packs/index.json` errors

`parseIndex` (`src/packs/manifest.ts`) rejects a malformed index:

- `packs/index.json must be a JSON array of pack directory names`
- `packs/index.json[<i>] must be a string`

The loader unwraps the server's `{"packs": [...]}` envelope before this runs, so
`parseIndex` sees the bare array.

---

## 7. The pixel doctrine — actionable rules

Four rules the art has to obey. They are the same rules `docs/assets.md` derives
at length; here they are the short, do-this-not-that form, and the loader
enforces the first three mechanically.

### 7.1 Bullets are white; colour is the engine's

Paint every bullet cell **pure white** — `(255, 255, 255)` — shaped by *luminance
and alpha only*, no hue. The renderer multiplies that white by a per-instance
tint chosen by whatever pattern fires the bullet, so one white shape serves every
colour in the game. Paint a bullet blue and it can only ever be shades of that
blue; paint it white and a designer retunes a whole pattern's palette with no new
art. The loader measures mean saturation per cell and rejects anything over 0.15.
Greys and antialiased white edges measure ~0 and are fine.

### 7.2 Every cell keeps a 2px margin — and you must measure it

The sheet is 8×2 cells of 32×32, and `Atlas.uv` applies **no half-texel inset**:
the outermost fragment of a quad interpolates to the boundary with the next cell,
which is the neighbour's first texel. Padding inside the cell is the only thing
between that and a stripe of the wrong sprite along every seam — worse under
`"linear"` filtering, which reaches across the seam by design.

So **draw no larger than 28×28 inside a 32×32 cell**, and if you export a bitmap
rather than describe a shape mathematically, **measure the painted alpha bounding
box** — do not trust the number in your shape's parameters. A stroke's paint
reaches past its nominal radius; a taper lands short of its control point. Both
have broken this exact rule in this project before (`docs/assets.md` §1.2 tells
the story cell by cell). The loader re-measures every cell and rejects any that
exceeds 28px in either axis.

Elongated or asymmetric cells (`kunai`, `scale`, `shard`, `needle`, `petal`) must
**point right** (+x, east): rotating art turns to match its heading, and heading
0° is east (CLAUDE.md rule 7). Draw blades pointing right, never up.

### 7.3 The ship marks its hitbox

The lethal hitbox is far smaller than the ship sprite — a few pixels against a
sprite many times that — and showing where it actually is is a genre-standard
readability feature, not a debug leftover. Since colour cannot separate the
marker from the body (§7.1 keeps the whole sheet white), use **alpha contrast**:
paint the body a little under full opacity and the marker at full. The example
ship uses 205/255 for the body and 255 for the marker — a small gap, so the
marker reads as "slightly brighter", not as a hole. This one is judged by eye,
not machine-checked (§5.2).

### 7.4 HUD icons are shapes, not compositions

`life.png` and `bomb.png` carry **shape only** — a solid white, hard-edged mark,
no background, no assumption about final size or what sits behind them. Position,
size, alpha and tint stay engine-owned (the same split as white bullets). Draw
the smallest legible mark and let the engine decide how dim, how big, and where.
Keep them ≤ 16×16.

---

## 8. Multiple packs, layering, and the boot report

All discovered packs load, in the order `index.json` lists them (the dev server
sorts directory names). Layering is **per resource, last wins**: if two packs
both supply `assets.bullets`, the later one's sheet is used and the override is
logged. A pack that supplies only sounds and a pack that supplies only a ship
compose cleanly — each wins the slots it declares.

`?pack=<name>` in the URL narrows to a single pack, ignoring the rest. This is
how you check one pack in isolation.

Every boot prints a **boot report** to the console — which pack won each slot,
what overrode what, what failed, and the replay-meta hash. It looks like:

```
packs: boot report
  assets.bullets: example  (/packs/example/bullets.png)
  assets.ship: example  (/packs/example/ship.png)
  assets.filter: example  (nearest)
  sounds.shot: example  (/packs/example/shot.wav)
  sounds.pickup: example  (/packs/example/pickup.wav)
  hud.life: example  (/packs/example/life.png)
  hud.bomb: example  (/packs/example/bomb.png)
  content.enemies: example (2 registered)
  content.stages: example (gauntlet → ashfall)
  meta: example@2e42786213c2
```

The two `content.*` lines are printed for a content pack (§9) so a developer can
see the *data* registered, not just the reskin: one `content.enemies` line with
the count, and one `content.stages` line per entry campaign showing its `next`
chain in bare names. They are informational, not golden. A reskin-only pack
prints neither. When no pack supplies anything, the body reads `(no pack
resources active — running on placeholders)`. An override adds a line like
`override: assets.bullets ← "crimson" (overrode "example")`. A failed pack is
skipped whole and named:

```
  FAILED crimson:
    - pack "crimson": bullets.png: cell "halo" paints 30×30px, over the 28px limit — …
```

The report is **always** logged. It is additionally **surfaced on screen** (a
non-interactive overlay over the field) in exactly the two cases where a
developer is looking and the field alone cannot tell them whether a pack took
effect: when `?pack=` is present, or when any pack failed. The overlay
dismisses itself on the first keypress — read it, press a key, play; the
console keeps the full text.

---

## 9. Content packs — enemies and stages as data

A pack that declares `requires` and carries a `content` object adds **enemies**
and **stages** to the game as data. The format number stays `1`; the capability
gate is what turns content on, so a pack manifest is forward-compatible by
construction (§9.1). Content is validated in **two layers** — shape, then
semantics — and either can reject the pack whole (§9.4). A pack that clears both
registers its enemies and stages under namespaced names and contributes one
**campaign row** to the title menu per entry stage (§9.5), and its identity is
pinned into any replay it records with a strict check (§9.6).

`packs/example/` is the reference: two enemies (`ember`, exercising motion,
timeline, patterns, spoils and tint; `drone`, the minimal three-field form) and a
two-stage campaign (`gauntlet` chaining into `ashfall`, which sends the built-in
`sentinel` boss). Copy it. Everything below is drawn from it.

### 9.1 The gate: `requires` and the covering invariant

Content is opt-in through `requires`. This engine implements two capabilities —
`content.enemies` and `content.stages` — and a pack must **declare the capability
for every content section it ships, and ship the section for every capability it
declares.** That agreement is the *covering invariant*, and it is exact on
purpose: an older engine that does not implement these capabilities refuses on
`requires` **before it ever parses `content`**, so a section it could not load can
never reach it unannounced.

```json
"requires": ["content.enemies", "content.stages"],
"content": {
  "enemies": { "…": "…" },
  "stages":  { "…": "…" }
}
```

A capability without its section, or a section without its capability, is an
error (§9.4). A `requires` entry naming anything else — `netplay`,
`content.bosses` — is refused, because those capabilities are not implemented
(§6.2, §10).

### 9.2 The shapes

The content JSON **is** the engine's own spec object — there is no translation
layer. A `content.enemies.<name>` is an `EnemySpec`
(`src/sim/enemy.ts`, and §4 of [`docs/extending.md`](./extending.md)) written as
JSON; a `content.stages.<name>` is a `StageSpec` (`src/content/stage.ts`, and §6
there) minus its `name` (the key is the name) plus two fields the JSON form adds:
`entry` and a nullable `next`. So the authoring guide for enemies and stages is
`docs/extending.md`; this section covers only what the pack form adds on top.

**An enemy** — the full form and the minimal one, both from the example:

```json
"enemies": {
  "ember": {
    "sprite": "star",
    "hp": 30,
    "radius": 12,
    "tint": { "r": 1, "g": 0.7, "b": 0.3 },
    "motion": { "r": 2.6, "theta": 90 },
    "timeline": [
      { "count": 0,   "motion": { "r": 2.6, "theta": 90 } },
      { "count": 50,  "motion": { "r": 1.6, "theta": 0, "w": 2 } },
      { "count": 110, "motion": { "r": 3, "theta": 270 } }
    ],
    "patterns": [
      { "pattern": "aimed-fan", "options": { "spec": { "…": "a BulletSpec" }, "count": 3, "spread": 28, "period": 55 }, "startAt": 20 },
      { "pattern": "spiral",    "options": { "spec": { "…": "a BulletSpec" }, "arms": 2, "step": 13, "period": 8 }, "startAt": 30, "stopAt": 110 }
    ],
    "spoils": [ ["power", 2], ["score", 1] ],
    "scoreValue": 300,
    "onHit": "hit",
    "onDeath": "explosion"
  },
  "drone": { "sprite": "shard", "hp": 8, "radius": 8, "motion": { "r": 1.5, "theta": 90 } }
}
```

`sprite`, `hp` and `radius` are required; everything else is optional and matches
`EnemySpec` field-for-field. `spoils` is the `[name, count]` list `EnemySpec`
carries, written as JSON arrays. A pattern slot's `spec` is a `BulletSpec` inline
— its `sprite` is an atlas cell name, its numbers are the same pixels-per-tick the
rest of the engine uses.

**A stage** — an entry and a terminal, from the example:

```json
"stages": {
  "gauntlet": {
    "entry": true,
    "seed": 7,
    "background": "expanse",
    "outro": 120,
    "next": "ashfall",
    "waves": [
      { "at": 0,   "enemy": "drone", "x": 120, "y": -20, "count": 4, "interval": 25 },
      { "at": 200, "enemy": "grunt", "x": 240, "y": -20, "count": 3, "interval": 30 },
      { "at": 360, "enemy": "ember", "x": 160, "y": -30 }
    ]
  },
  "ashfall": {
    "seed": 11,
    "background": "undertow",
    "outro": 120,
    "next": null,
    "waves": [
      { "at": 0,   "enemy": "drone", "x": 90, "y": -20, "count": 6, "interval": 18, "stepX": 60 },
      { "at": 240, "boss": "sentinel" }
    ]
  }
}
```

A wave is **one of two shapes**, told apart structurally: an **enemy wave** names
`enemy` (with `x`, `y`, and optional `count`, `interval`, `stepX`, `stepY`), a
**boss wave** names `boss` (with optional `x`, `y`). Naming both, or neither, is
an error (§9.4). A boss wave is how a **midboss** arrives mid-stage — reaching one
holds the schedule until the fight ends, exactly as a built-in `BossWave` does
(§6 of `docs/extending.md`). Two fields are specific to the pack form:

- **`entry: true`** marks a campaign start — the stage becomes a row on the title
  menu. At least one stage must be an entry, and a stage that is neither an entry
  nor reachable by some pack stage's `next` is dead content (§9.3).
- **`next`** chains stages. A string names the next stage; `null` states "this is
  the last stage" explicitly, where a built-in `StageSpec` leaves the field
  `undefined`.

### 9.3 Name resolution: pack-first, then built-in

Every name a pack writes resolves **pack-first, then built-in**:

- A pack's **own** enemies and stages are written **bare** in its JSON. The
  injector qualifies them to `<packname>/<entry>` at registration —
  `example/ember`, `example/gauntlet` — so a pack may reuse a built-in name
  without collision, and a bare reference inside the pack resolves to the pack's
  entry first.
- **Built-ins** are referenced bare: a built-in enemy in a wave (`grunt`), a
  built-in boss (`sentinel`), a built-in background (`expanse`), a registered
  pattern (`aimed-fan`), a motion behaviour, an item name in `spoils`. These
  resolve straight to the engine registries.
- **Bosses and backgrounds are built-in only.** `content.bosses` is reserved
  (§10) and a background is a fragment shader (engine code), so a pack stage may
  *select* a registered boss or scene by name but never ship one.
- **Cross-pack references are not supported.** A name that is neither the pack's
  own nor a built-in is an error; one pack cannot reach into another's content.

Two **reachability** rules — the project's "registration is not reachability" law
(CLAUDE.md), applied to pack data so dead content fails the pack rather than
shipping unreachable:

- A pack stage must be an **entry** or the `next` of some **pack** stage. (A
  built-in `next` leaves the pack; it does not reach back in.) A stage that is
  neither is rejected.
- A pack enemy must be **spawned by some wave** of some pack stage. An enemy
  nothing fires is rejected — which also closes a gap the built-in path leaves
  open, where a `defineEnemy` with a typo'd pattern name that no wave ever spawns
  can register silently (§4 of `docs/extending.md`); here every pack enemy is
  both name-checked and reached.

### 9.4 The two validators, and their golden strings

Content passes through two validators, split along the line `bun test` can reach.
Both emit **golden** strings — asserted verbatim (`manifest.test.ts`,
`inject.test.ts`), so rewording one is a breaking change.

**Layer 1 — shape (`src/packs/manifest.ts`, pure, headless).** Fields, types,
did-you-mean on unknown keys, and the covering invariant. It imports no registry,
so it cannot know whether a *name* resolves — only that the shape is right. Every
message carries the `pack "<folder>": pack.json: ` prefix.

| Condition | Message (after the prefix) |
|---|---|
| A declared capability has no section | `requires lists "content.stages" but there is no content.stages section — add the section or drop the capability` |
| A section has no declared capability | `content.enemies is present but "content.enemies" is not in requires — an engine that lacks the capability must refuse on requires before parsing content` |
| `content` not an object | `content must be a JSON object` |
| A reserved `content.*` section | `content.bosses is a pack-format-2 section this engine does not implement — it implements content.enemies, content.stages only; see docs/packs.md §Future` |
| Unknown key directly under `content` | `content: unknown field "<key>" — did you mean "<nearest>"?` (or `content: unknown field "<key>" — valid fields here: enemies, stages`) |
| `content.enemies` not an object | `content.enemies must be a JSON object` |
| Enemy missing `sprite` | `content.enemies."ember" is missing required field "sprite" — an atlas cell name` |
| Enemy `hp` mistyped | `content.enemies."ember".hp must be a number` |
| Unknown field on an enemy | `content.enemies."ember": unknown field "spirte" — did you mean "sprite"?` |
| Pattern slot missing `pattern` | `content.enemies."ember".patterns[0] is missing required field "pattern" — a registered pattern name` |
| Unknown field on a pattern slot | `content.enemies."ember".patterns[0]: unknown field "strtAt" — did you mean "startAt"?` |
| A `spoils` entry is not a pair | `content.enemies."ember".spoils[0] must be a [name, count] pair — a string and a number` |
| `content.stages` not an object | `content.stages must be a JSON object` |
| Stage missing `waves` | `content.stages."gauntlet" is missing required field "waves" — an array of waves` |
| Stage `entry` mistyped | `content.stages."gauntlet".entry must be a boolean` |
| Stage `next` not string/null | `content.stages."gauntlet".next must be a string or null` |
| Unknown field on a stage | `content.stages."gauntlet": unknown field "entyr" — did you mean "entry"?` |
| Wave missing `at` | `content.stages."gauntlet".waves[0] is missing required field "at" — a whole tick count` |
| Wave names neither | `content.stages."gauntlet".waves[0] must name an "enemy" or a "boss"` |
| Wave names both | `content.stages."gauntlet".waves[0] names both "enemy" and "boss" — a wave is one or the other` |
| Unknown field on a wave | `content.stages."gauntlet".waves[0]: unknown field "zzz" — valid fields here: at, enemy, boss, x, y, count, interval, stepX, stepY` |

**Layer 2 — semantics (`src/packs/inject.ts`).** It imports `sim` and `content`
(that direction is legal; the forbidden one is `sim`/`content`/`game` → `packs`),
resolves every name against the real registries, enforces the reachability rules,
and only then registers. It must **not** import `render`, so the sets of valid
sprite and background names are **passed in** by the caller (the loader hands it
`BULLET_CELLS` and `backgroundNames()`; a test hands the same). Every message
carries the `pack "<name>": ` prefix.

| Condition | Message (after the prefix) |
|---|---|
| Unknown sprite | `enemy "ember" uses unknown sprite "orb.huge" — known sprites: halo, orb.large, ring, shard, ship` |
| Unknown pattern | `enemy "ember" uses unknown pattern "sprial" — no such pattern is registered` |
| Unknown motion behaviour | `enemy "ember" uses unknown motion behaviour "homng" — no such behaviour is registered` |
| Unknown spoils item | `enemy "ember" drops unknown item "powr" — no such item is registered` |
| Wave enemy unresolved | `stage "gauntlet" wave 1 references unknown enemy "gremlin" — no such enemy in this pack or built in` |
| Wave boss unresolved | `stage "gauntlet" wave 1 references unknown boss "sentinl" — pack stages may name a built-in boss only; no built-in boss "sentinl" exists` |
| Stage `boss` unresolved | `stage "gauntlet" names unknown boss "overlord" — pack stages may name a built-in boss only; no built-in boss "overlord" exists` |
| Stage `background` unresolved | `stage "gauntlet" is set in unknown background "nebula" — known backgrounds: expanse, undertow` |
| Stage `next` unresolved | `stage "gauntlet" chains next into unknown stage "stage-99" — no such stage in this pack or built in` |
| Wave `at` not whole | `stage "gauntlet" wave 0: "at" must be a whole tick count, got 12.5` |
| Wave `count` not positive whole | `stage "gauntlet" wave 0: "count" must be a positive whole number, got 0` |
| Wave `interval` not whole | `stage "gauntlet" wave 0: "interval" must be a whole tick count, got -1` |
| Stage `outro` not whole | `stage "gauntlet": outro must be a whole tick count, got 1.5` |
| Stages present, no entry | `has content.stages but no entry stage — mark a campaign start with "entry": true` |
| Unreachable stage | `stage "orphan" is neither an entry nor any stage's next — dead content (registration is not reachability)` |
| Unspawned enemy | `enemy "ghost" is spawned by no wave of any pack stage — dead content (registration is not reachability)` |

Note **which messages list the known set and which do not.** Sprite and
background names come from the caller, so those two messages *list* the known
values (`known sprites: …`, `known backgrounds: …`). Pattern, behaviour, item,
boss, enemy and stage names come from process-global registries that other test
files register fixtures into — so listing their contents would not be a stable
golden. Those messages name the bad value and say it did not resolve, and stop.

Semantic validation is **atomic**: every problem is collected first, and if there
is one the pack registers **nothing** and the injector throws with the whole
list. That is what makes "a failed content pack has no campaign row" structural
rather than a convention — nothing half-registers.

### 9.5 What makes it reachable

Registration alone does not put a stage in front of a player; a wire does, and it
is the same shape as everything else in the game reaching content by name:

- **Boot order.** `main.ts` imports `./content` (built-ins register on module
  eval), then `await loadPacks()` (which injects each content pack into the same
  registries), then constructs the state machine. Module-eval-before-top-level-
  await guarantees every built-in a pack might reference already exists when the
  pack is injected.
- **Campaign rows.** The loader returns one campaign per `entry: true` stage,
  labelled with the qualified stage name. `main.ts` puts them on `GameContext` as
  **plain data** — `src/game` imports nothing from `src/packs`, the same boundary
  §12 describes — and the title menu grows one row per campaign under `START`.
  Selecting a row arms the run to start on that qualified stage; `START` is
  today's built-in game, unchanged. Zero content packs means the title menu is
  byte-for-byte what it was.
- **The boot report** prints a `content.enemies: <pack> (<n> registered)` line
  and a `content.stages: <pack> (<chain>)` line per entry campaign (§8), so a
  developer sees the data took effect, not just the reskin.
- **A test proves it, it is not a claim.** `src/packs/example-play.test.ts`
  injects the real example pack and drives the **real** `StateMachine` through
  title → the campaign row → character select → playing, asserting the pack stage
  runs, its enemies spawn under qualified names, the `next` chain reaches
  `ashfall`, and the built-in `sentinel` arrives. This is the format-2 acceptance
  test, in the spirit of `reachability.test.ts` — which itself exempts namespaced
  names (any containing `/`) from its built-in scan, because pack content is
  reachable only through its own campaign.

### 9.6 Replay: content is strict

A reskin cannot change the simulation, so a skin mismatch on replay **warns**
(§11 below, `RunConfig.packs`). **Content can** — different enemies fire different
bullets — so a replay recorded under a content pack records `RunConfig.packsData`
(`name@hash` of the pack whose campaign it entered) and **refuses** to play back
under different content, exactly as it refuses a mismatched character, stage or
boss. A built-in run records `''` even with content packs loaded, because injected
enemies a built-in stage never references cannot affect it.

> The one-sentence why: **pack content changes what the game does, so a replay
> under different content is a different run and must be rejected, not warned** —
> the same reason presentation, which changes only how it looks, is only warned.

---

## 10. Future formats — nothing here exists yet

> Nothing in this section exists. It is written down so v1 manifests cannot paint
> us into a corner: every name below is **reserved and refused today**, with a
> dedicated message, so an author who writes one learns precisely what is fiction
> instead of getting a generic "unknown field", and a future format 2 can claim
> these names without colliding with anything a v1 pack was allowed to use.

`content.enemies` and `content.stages` are **not** in this list — they are
implemented, and §9 is their reference. What remains reserved is everything a
pack still cannot ship. Each reserved name and the exact rejection the engine
emits **now**:

| Reserved name | What a future format might do with it | Rejection today |
|---|---|---|
| `music` (top-level) | background music tracks | `music is a pack-format-2 section and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future` |
| `difficulty` (top-level) | tuning curves as data | `difficulty is a pack-format-2 section …` |
| `dialog` (top-level) | cutscene/portrait scripts | `dialog is a pack-format-2 section …` |
| `backgrounds` (top-level) | scene selection | `backgrounds is a pack-format-2 section …` |
| `content.bosses`, `content.characters`, `content.items` | bosses, ships, pickups as data | `content.bosses is a pack-format-2 section this engine does not implement — it implements content.enemies, content.stages only; see docs/packs.md §Future` |
| `content.music`, `content.difficulty`, `content.dialog`, `content.backgrounds` | the top-level names, nested under content | `content.music is a pack-format-2 section this engine does not implement — it implements content.enemies, content.stages only; see docs/packs.md §Future` |
| `hud.digits`, `hud.font` | number/font glyph sheets | `hud.digits is a pack-format-2 resource and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future` |
| `hud.bossBar`, `hud.frame` | boss-bar skin, screen frame | `hud.bossBar is a pack-format-2 resource …` |

Two reserved names deserve a word on *why* they stay code and not data, because
it is the same reason and it is load-bearing:

- **`backgrounds` stay shaders.** A background is a fragment shader in
  `src/render/backgrounds/`, registered by name with `defineBackground`, and a
  stage names it as a string (`StageSpec.background`). There is no background
  image and no plan for one — see `docs/assets.md` §3.4 and CLAUDE.md's
  "Backgrounds are scenes". A pack could at most *select* a registered scene; it
  can never *ship* one — which is exactly what a pack stage's `background: "expanse"`
  does today (§9.3).
- **`content.bosses` and the rest stay code joined by name.** This is the
  dual-track line from §1, and it is what §9 already lives by: a pack *arranges*
  registered code — it names the `sentinel` boss a stage sends, the `aimed-fan`
  pattern an enemy fires, the `homing` behaviour that steers a bullet — but it
  never *ships* the boss, the pattern, the behaviour or the effect. Definitions
  are code; invocations are data. `content.enemies` and `content.stages` are data
  because an enemy and a stage are arrangements of code that already exists; a
  boss's spell-card script or a new pattern is that code, and stays reserved.

---

## 11. Replay compatibility

A replay records the identity of the packs loaded when it was captured, on two
keys with two policies:

- **`RunConfig.packs`** (`src/game/run.ts`) — the **presentation** identity: a
  comma-joined string of `name@sha256[0..12]` for every loaded pack (`''` when
  none). Because a reskin never touches the simulation, a mismatch on playback
  **warns** — in the boot report and the console — it never **refuses**. A replay
  captured with one bullet skin plays back identically with another or with none.
  The warning exists so a viewer knows the run *looked* different from how it was
  recorded — nothing more.
- **`RunConfig.packsData`** — the **content** identity: `name@hash` of the pack
  whose campaign this run entered (`''` for a built-in campaign, even with content
  packs loaded). Because content changes what the game *does*, a mismatch here
  **refuses**, exactly as a mismatched character, stage or boss does (§9.6). This
  is the strict path the v1 spec reserved and format 2 made real.

The hash is a SHA-256 over the manifest bytes followed by each loaded file's
bytes, in a fixed canonical order, so it is stable regardless of how an author
ordered their JSON keys.

---

## 12. Where the code lives

Three modules, split along the line `bun test` can reach:

- **`src/packs/manifest.ts`** — pure: shape validation, the covering invariant,
  index parsing, hashing. Imports nothing from `render`, `sim`, `content` or
  `game`; pack identity crosses those boundaries as a plain string. Every golden
  *shape* error string lives here and is proved headlessly in `manifest.test.ts`.
- **`src/packs/inject.ts`** — semantics: it takes a manifest whose shape
  `manifest.ts` accepted, resolves every content name against the real
  registries, enforces the reachability rules, and registers the enemies and
  stages under qualified names. It imports `sim` and `content` (the legal
  direction) but **not** `render` — the sprite and scene name sets are passed in,
  which keeps it provable in `bun test` with no GL context. Every golden
  *semantic* error string lives here and is proved in `inject.test.ts`.
- **`src/packs/loader.ts`** — browser-side: fetch, decode, measure pixels, build
  the URL set, and call `inject.ts` for each content pack. The one pack module
  allowed to import `render` (it reads the sheet geometry the checks measure
  against, and hands `inject` the render name sets). Runs at boot in `main.ts`
  **before** atlas construction and before the audio graph unlocks, so its
  results are in place before anything reads them. Total by construction — it
  cannot throw into boot.

`src/sim`, `src/content` and `src/game` **must not import `src/packs` at all** —
values *or* types — and `src/architecture.test.ts` enforces it with a self-test
proving it can fail. Pack identity reaches the run as plain strings
(`RunConfig.packs`, `RunConfig.packsData`) and nothing in the simulation learns
what a pack is.

---

## 13. Verify

A pack is data, not code, so the source-tree gates (`bun run typecheck`,
`bun test`) prove the *engine* still holds — they do not open your PNG. What
proves a pack is the loader, at boot, in a browser:

```
bun run dev            # then load http://localhost:3000/?pack=<name>
```

Read the on-screen boot report (`?pack=` always surfaces it): every slot your
pack declares should name your pack, the `meta:` line should show its hash, and
the field should draw your art — bullets in your shapes, your ship, your HUD
icons — not the placeholders. Any rejected resource is named there with the
measured value that failed it (§6.7).

If your pack carries **content** (§9), the report also prints its
`content.enemies` and `content.stages` lines, and the **title menu grows a row**
per entry campaign under `START`: select it and the run should start on your
stage, spawn your enemies, and chain through `next` to your boss. A content pack
that fails semantic validation is named in the report's `FAILED` block with the
`inject.ts` problem list (§9.4) and contributes no row. Unlike the pixel checks,
content is fully covered headlessly — `bun test` runs the shape validator, the
injector against the real registries, and the acceptance playthrough
(`src/packs/example-play.test.ts`), so a content bug fails the source gate, not
only the browser.

```
bun run build          # confirm dist/packs/<name>/ is staged and index.json lists it
```

The build's `copy-packs` step must stage your folder into `dist/packs/` and add
its name to `dist/packs/index.json`; that is what makes the pack work on a static
host with no dev wrapper.

There is no automated oracle for whether a sheet is *readable* under a full
curtain, or whether a sound is *right* — those are the judgement calls
`docs/assets.md` §5.4 and `docs/audio.md` §4 describe, made by eye and by ear on
the running game. The machine checks catch the wrong size, the coloured cell, the
bleeding margin and the oversized icon; they do not catch ugly.
