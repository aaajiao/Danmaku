# Asset packs — the drop-in reskin format

A **pack** is a folder of art and sound that replaces the game's generated
placeholders without editing a line of engine code. Drop `packs/my-pack/` next
to the others, refresh, and the bullets, ship, HUD icons and sounds it declares
take over. Nothing else changes: the same patterns fire, the same bosses appear,
the same replay plays back — a pack is **presentation only**.

This document is written for a pack author who has never read the engine. It
covers the folder layout, how a pack activates, every manifest field, every
error the loader can hand back (the messages are exact and tested — they will
not be reworded under you), the pixel rules a sheet has to obey, how multiple
packs layer, and what belongs to a future format that does not exist yet.

If you have read [`docs/assets.md`](./assets.md) and [`docs/audio.md`](./audio.md),
a pack is the packaged, drop-in version of the same swap those documents describe
at the source level. You do not need them to write a pack; you need them if you
want to understand *why* a bullet must be white or a sound must fade to zero.

---

## 1. What a pack is, and is not

A pack **can** replace:

- the **bullet sheet** — all sixteen 32×32 cells the whole game draws from
  (bullets, enemies, the boss, items and particle effects all wear these cells;
  see `docs/assets.md` §3.1);
- the **player ship** sprite;
- any of the six **sounds** the game plays;
- the **♥ life** and **★ bomb** HUD icons.

A pack **cannot** (in format 1) change anything that would alter what the game
*does*: no patterns, no enemy behaviour, no difficulty, no backgrounds, no music,
no dialogue. Those are engine code, not pack data — see §9. The dividing line is
simple and permanent:

> **Sprite skins are pack data. Everything that generates motion or effect is
> engine code, joined to a pack only by name.** A bullet's *picture* comes from
> a pack; the *pattern* that fires it, the three.js/shader *effect* that flares
> when it dies, and the *behaviour* that steers it are all code, registered in
> the engine by a string name (the same arrangement as `definePattern` /
> `defineBehaviour` / `defineBackground`). A pack paints; it never scripts.

Because a pack is presentation only, the game is **never blocked on it**. The
procedural placeholders (`src/render/procedural.ts`, `src/audio/`) are the
permanent floor. A missing pack, a broken pack, a pack whose sheet is the wrong
size — each degrades to "that one resource stays procedural" and the run
continues. This is CLAUDE.md rule 9 in operation: everything shipped is original
by construction, and nothing you drop in can leave the game unable to draw.

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
| `requires` | no | string[] | Engine capabilities the pack needs. Format 1 implements **none**, so any non-empty `requires` is refused, naming the capability. Omit it (do not write `[]` to make a point). |

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
| Non-empty (any entry) | `requires lists capabilities format 1 does not implement: <a, b> — format 1 implements none; see docs/packs.md §Future` |

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
| Reserved future section (`content`, `music`, `difficulty`, `dialog`, `backgrounds`) | `<key> is a pack-format-2 section and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future` |
| Any other unknown top-level key | `unknown field "<key>" — did you mean "<nearest>"?` (or `… valid fields here: format, name, version, author, license, description, assets, sounds, hud, requires`) |

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
  meta: example@2e42786213c2
```

When no pack supplies anything, the body reads `(no pack resources active —
running on placeholders)`. An override adds a line like
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

## 9. Future formats — nothing here exists yet

> Nothing in this section exists. It is written down so v1 manifests cannot paint
> us into a corner: every name below is **reserved and refused today**, with a
> dedicated message, so an author who writes one learns precisely what is fiction
> instead of getting a generic "unknown field", and a future format 2 can claim
> these names without colliding with anything a v1 pack was allowed to use.

Each reserved name and the exact rejection the engine emits **now**:

| Reserved name | What a future format might do with it | Rejection today |
|---|---|---|
| `content` (top-level) | ship patterns, enemies, bosses as data | `content is a pack-format-2 section and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future` |
| `music` (top-level) | background music tracks | `music is a pack-format-2 section …` |
| `difficulty` (top-level) | tuning curves as data | `difficulty is a pack-format-2 section …` |
| `dialog` (top-level) | cutscene/portrait scripts | `dialog is a pack-format-2 section …` |
| `backgrounds` (top-level) | scene selection | `backgrounds is a pack-format-2 section …` |
| `hud.digits`, `hud.font` | number/font glyph sheets | `hud.digits is a pack-format-2 resource and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future` |
| `hud.bossBar`, `hud.frame` | boss-bar skin, screen frame | `hud.bossBar is a pack-format-2 resource …` |

Two of these deserve a word on *why* they are code and not data, because it is
the same reason and it is load-bearing:

- **`backgrounds` stay shaders.** A background is a fragment shader in
  `src/render/backgrounds/`, registered by name with `defineBackground`, and a
  stage names it as a string (`StageSpec.background`). There is no background
  image and no plan for one — see `docs/assets.md` §3.4 and CLAUDE.md's
  "Backgrounds are scenes". A pack could at most *select* a registered scene; it
  can never *ship* one.
- **`content` — patterns, behaviours, effects — is code joined by name.** This is
  the dual-track line from §1: a danmaku visual *effect* is three.js/shader code
  registered by name, exactly as a *pattern* or a *behaviour* is; a pack supplies
  the sprite *skin* those effects and patterns draw with, never the effect or
  pattern itself. Definitions are code; invocations are data. A format 2 that
  adds `content` will still register the code and let a pack name it — it will not
  let a pack *be* it.

---

## 10. Replay compatibility

A replay records the identity of the packs loaded when it was captured:
`RunConfig.packs` (`src/game/run.ts`) is a comma-joined string of
`name@sha256[0..12]` for each loaded pack (`''` when none), recorded into replay
meta by `finishRecording`. The hash is a SHA-256 over the manifest bytes followed
by each loaded file's bytes, in a fixed canonical order, so it is stable
regardless of how an author ordered their JSON keys.

Because v1 packs are **presentation only**, a mismatch on playback **warns** — in
the boot report and the console — it never **refuses**. A replay captured with
one bullet skin plays back identically with another or with none, because the
skin never touched the simulation. (The strict-refusal path is reserved for a
future `packsData` key, if data packs ever exist: those would change what the
game does, and presentation cannot.) The warning exists so a viewer knows the
run *looked* different from how it was recorded — nothing more.

---

## 11. Where the code lives

Two modules, split along the line `bun test` can reach:

- **`src/packs/manifest.ts`** — pure: validation, index parsing, hashing. Imports
  nothing from `render`, `sim`, `content` or `game`; pack identity crosses those
  boundaries as a plain string. Every golden error string lives here and is
  proved headlessly in `manifest.test.ts`.
- **`src/packs/loader.ts`** — browser-side: fetch, decode, measure pixels, build
  the URL set. The one pack module allowed to import `render` (it reads the sheet
  geometry the checks measure against). Runs at boot in `main.ts` **before** atlas
  construction and before the audio graph unlocks, so its results are in place
  before anything reads them. Total by construction — it cannot throw into boot.

`src/sim`, `src/content` and `src/game` **must not import `src/packs` at all** —
values *or* types — and `src/architecture.test.ts` enforces it with a self-test
proving it can fail. Pack identity reaches the run as a plain string
(`RunConfig.packs`) and nothing in the simulation learns what a pack is.

---

## 12. Verify

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
