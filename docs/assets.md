# Image assets — specification and generation guide

This is the brief for producing art for this game, whether by hand or with an
image model. It is a spec, not a mood board: the numbers are load-bearing, and
the engine will render nonsense if they are wrong.

Read [`CLAUDE.md`](../CLAUDE.md) rule 9 first. Upstream's art is Touhou Project
derivative and cannot ship. **Everything here must be original work.** That is
the constraint, but it is also the opportunity — upstream's own sheets were
mostly empty, and we are not obliged to repeat their shape.

---

## 1. The three principles

### 1.1 Bullets are white. Colour comes from the engine.

Upstream baked every bullet colour into its own cell: ten enemy bullet types
were ten separately-coloured 16×16 cells scattered across `bullet.png`. Its
shader *had* a per-vertex colour channel and never used it as a tint — the RGB
components were multiplied by a single shared scalar, so it could only darken,
never recolour.

We tint per instance. One white shape serves every colour in the game:

```ts
{ sprite: 'orb.medium', r: 0.45, g: 0.75, b: 1 }   // ice blue
{ sprite: 'orb.medium', r: 1, g: 0.4, b: 0.35 }    // ember red
```

**Consequence for the artist:** draw bullets, glows, sparks and most effects in
**white on transparent**, and shape them with *luminance and alpha only*. A
bullet drawn blue can never be made red; a bullet drawn white can be made any
colour, and a designer can retune a whole pattern's palette without asking for
new art.

Reserve real colour for art that is genuinely one thing: character portraits,
backgrounds, UI illustration.

**And the colour that does survive is display-referred.** `loadTexture` sets
`colorSpace = NoColorSpace` (`src/render/atlas.ts:166`), and so does every
generated texture (`src/render/procedural.ts:304`). Nothing decodes sRGB to
linear on sample and nothing re-encodes on output. The byte in the PNG is the
byte the shader multiplies by the tint.

The reasoning is in the header of `src/render/atlas.ts`, and it is worth reading
before anyone proposes fixing it: `SpriteBatch` writes a raw `ShaderMaterial`,
and three.js only applies output encoding to materials carrying its own
colorspace chunk. Tagging textures `SRGBColorSpace` therefore decoded them and
never encoded them back — measured before the fix, **128 in the source became 55
on screen, and 96 became 30**.

What that means for whoever is handing over files:

- Author and export in plain 8-bit sRGB. What the editor shows on a normal
  display is what lands in the framebuffer.
- Do not compensate. There is no gamma step to pre-correct for, and a file
  brightened "for a linear pipeline" will arrive too bright.
- Embedded ICC profiles are outside the engine's control — the browser's PNG
  decoder resolves them before three.js sees any pixels. Strip them and keep the
  file in sRGB, so that decode is a no-op rather than a conversion.
- Tints in content mean the colour someone wants to see. `{ r: 0.45, g: 0.75,
  b: 1 }` is that colour, not its linear equivalent, and grey art at 0.5 under a
  tint of 0.5 lands at 0.25 on screen with no transfer function in between.

### 1.2 Every cell is padded, because nothing insets the UVs

`Atlas.uv` (`src/render/atlas.ts:111`) converts a pixel rect straight to
normalized coordinates and applies **no half-texel inset**. The rightmost column
of fragments on a quad therefore interpolates to exactly `x/width + w/width`,
which is the boundary between one cell and the next — the first texel of the
neighbour, not the last texel of your own. Padding inside the cell is the only
thing standing between that and a stripe of the wrong sprite along every seam.
Upstream had no inset either; we inherited the arrangement, not the excuse.

The two filters in this pipeline disagree about how badly it bites:

- `loadTexture` sets `NearestFilter` on both min and mag
  (`src/render/atlas.ts:162-163`). A dropped-in PNG is sampled hard, so damage
  is confined to the boundary fragments themselves.
- `createBulletAtlas` overrides to `LinearFilter`
  (`src/render/procedural.ts:301-302`), because generated art is smooth rather
  than pixel art. Linear sampling reaches across the seam by design, so a 1px
  margin is not a margin.

Both paths set `generateMipmaps = false` (`src/render/atlas.ts:164`,
`src/render/procedural.ts:303`), which removes the usual worst offender: there
is no mip chain averaging whole neighbourhoods of cells together at small sizes.

**Keep at least 2px of fully transparent margin inside every cell.** A 32×32
cell should contain art no larger than 28×28, centred.

28 is not a round number someone liked. It is the largest shape whose *painted*
footprint still clears two pixels: a boundary at a fractional coordinate gives
partial coverage to the pixel outside it, so a 27px-wide path paints 28 pixels
and a 29px one paints 30. Measured on a canvas, 29 is the first extent that
loses a pixel of margin. If you are exporting a bitmap rather than describing a
shape, **measure the alpha bounding box** — it is what the sampler sees, and it
is up to a pixel wider than the geometry you drew.

The rule is enforced. `CELL_ART` declares each cell's painted extent next to its
draw call, and `src/render/procedural.test.ts` holds every one of them against
`MAX_CELL_EXTENT` — so the generated sheet is now the reference implementation
this section always claimed it was.

It was not one until recently, and the way it failed is the reason to read the
rest of this section rather than skim it. Two cells broke it:

- `glow.large` was `orb(r 15)` — 30px in a 32px cell, 1px of margin. Mild, and
  it never bled visibly, because a radial gradient's outermost stop is
  `rgba(255,255,255,0)`. Now `orb(r 14)`.
- `halo` was `ring(15, 2)`, and **`ring` paints past its radius**. It strokes
  twice on the same circle at `radius - thickness/2`, the second with
  `lineWidth = thickness * 2` (`src/render/procedural.ts:85-97`), so the outer
  edge lands at `radius + thickness/2` = 16: a **32px extent with zero margin**,
  sitting exactly on the cell boundary. Now `ring(13, 2)`, which paints to 14.

`halo` was the worse case and read as the safer one. The 0.3-alpha outer stroke
is not a reason it was harmless — it is the ink that was *on* the seam. This
sheet is sampled `LinearFilter` (`src/render/procedural.ts:301-302`), which
reaches across seams by design, and `needle` sits in the next cell.

Two lessons for anyone drawing replacement art:

1. **The number in the call is not the extent.** Half a stroke width of paint
   appeared outside `ring`'s stated radius, and nothing at the call site showed
   it. A quadratic blade is the same trap in the other direction — it paints
   *half* its control width. Measure the bitmap, do not trust the parameter.
2. **Prose cannot check prose.** This document asserted 2px of padding; the
   generator asserted nothing; the extents quoted in §3.1 were computed by hand
   in a third place. Three statements, no contradiction detectable between them,
   and the sheet was wrong for the life of the project. That is why the extents
   now live in code.

Draw to 28. `halo` is what the rule is for, not an exception to it.

### 1.3 Rotating art points **right** (+x, east)

Anything with `orientToHeading: true` — needles, blades, shards, lasers — is
rotated by the shader to match its heading, and heading `0°` is **+x**.

Draw those shapes **pointing right**, along the positive x axis.

> This differs from upstream, which drew them pointing **up** and compensated
> with a `+90°` offset baked into `Element.getDirectionTheta`. Removing the
> offset removes a permanent source of confusion; the cost is that art ported
> from upstream needs a 90° rotation.

Non-rotating art — orbs, rings, motes — is symmetric enough not to care, and
should stay visually upright.

---

## 2. Coordinate space and canvas

| Property | Value |
|---|---|
| Play field | **480 × 640** px — 3:4 portrait, the traditional STG frame |
| Full frame | same 480 × 640: the field **is** the screen; the HUD composites over its edges, there is no sidebar |
| Origin | top-left, **y increases downward** |
| Units | 1 world unit = 1 pixel |
| Depth | disabled; order is explicit via layers |

The logical frame is fixed; `main.ts` scales it to the viewport (integer steps
above 1×) and the renderer already multiplies the backing store by
`devicePixelRatio`, so art drawn at logical size stays crisp at any window size.

Art is authored at **final display size**. There is no global scale factor.
A 32px bullet occupies 32 of the field's 480 pixels — about 6.7% of its width.

Per-draw scaling is a different thing and it exists. `SpriteStyle.width` and
`height` default to the region's own size (`src/render/sprite-batch.ts:31-32`,
`:242-243`) and callers override them freely: the boss draws a 32px cell at 56px
(the base pack's `sentinel`, `tools/make-base-pack.ts:514-515`), the turret at
40px (the base pack's `turret`, `tools/make-base-pack.ts:268-269`), the
ship's 64px art at 40px (`src/main.ts:367-369`), and particles anywhere from
1.6× to 0.05×. So "final display size" means the size to design *for*, not the
only size a cell will ever be drawn at. The practical consequence is at the top
of section 3.5: detail that only reads at one size is wasted.

---

## 3. Sheet specifications

### 3.1 Bullet sheet — `bullets.png`

The name is a historical accident and it will mislead you. **This sheet is not
just bullets.** Every `SpriteBatch` in the game except the player's own is built
on it (`src/main.ts:102-119`): enemies wear `orb.large`, `ring` and `halo`
(the base pack's `grunt`/`weaver`/`turret`, `tools/make-base-pack.ts`), the boss
wears `halo` (the base pack's `sentinel`, `tools/make-base-pack.ts:512`), items
wear `shard`, `star`, `mote`, `petal` and `ring`
(`src/sim/item.ts:407-451`), particles draw `glow.medium`, `spark`, `needle`,
`star`, `glow.small` and `glow.large` (`src/sim/effects.ts:251-323`), and the
player's shots draw `glow.small` and `scale` (`src/content/shots.ts:85`,
`:222`). All sixteen cells are in use by something. Sixteen 32×32 cells carry
essentially the whole visual vocabulary of the game — the player ship is the
only art outside them — which is why these cells deserve far more attention than
a 256 × 64 PNG suggests.

The engine generates the sheet at runtime today — `createBulletAtlas`,
`src/render/procedural.ts:286-311` — and that generator **is** the reference
implementation: the grid, the cell order and every shape are defined there.
Replacing it with a PNG is not a one-line swap, because `createBulletAtlas` is
synchronous, names its own cells and chooses its own filter, and `loadAtlas`
does none of those three things. Section 5 is the actual procedure.

| Property | Value |
|---|---|
| Image size | **256 × 64** |
| Cell size | **32 × 32** |
| Grid | **8 columns × 2 rows** = 16 cells |
| Colour | white / greyscale on transparent |
| Padding | ≥ 2px transparent inside each cell |
| Format | PNG, RGBA, 8-bit |

Cells in row-major order, indices as `BULLET_CELLS` declares them
(`src/render/procedural.ts:39-56`). `flipY` is `false` on every texture
(`src/render/atlas.ts:165`, `src/render/procedural.ts:305`) and `Atlas.cell`
counts rows downward from the origin (`src/render/atlas.ts:88-93`), so **cell 0
is the top-left of the PNG** — the sheet is laid out exactly as it looks in an
image editor.

Names are the contract — content references `'orb.medium'`, never index 1 — so
re-packing the sheet cannot silently repoint a bullet at the wrong art.

The **Painted** and **Margin** columns are the alpha bounding box measured off
the real sheet by `bun run test:assets`, which prints all sixteen rows and is
where these were copied from. They are deliberately *not* the arguments in the
`Painted as` column, and the two disagree in both directions:

- `needle` is called with a length of 28 and paints **26** — its tips taper to
  nothing, so the last texel at each end never accumulates enough coverage to
  register. `star` loses 2px the same way, at five points.
- `kunai` is geometrically 4.5 tall and paints **6** — a blunt edge landing at a
  fractional coordinate spills coverage into the pixel it overlaps.
- `ring` is geometrically 27 and paints **28**, for the same reason.

Two painters also do not paint what their arguments read like at all: `ring`
strokes past its radius (§1.2), and `blade` is a quadratic Bézier whose control
points sit at `±wide/2`, so its apex reaches only half of that — geometric
height is `wide/2`, not `wide` (`src/render/procedural.ts:99-107`).

**Reproduce the painted numbers, not the arguments.** `CELL_ART`
(`src/render/procedural.ts:249-271`) declares the geometry, which is what the
padding rule is checked against; only the bitmap knows the rest.

These are a starting point rather than a requirement. What a replacement must
preserve is the **relative** ordering, so `orb.small` still reads as the cheap
workhorse and `orb.large` still reads as a threat.

| # | Name | Painted as | Painted | Margin | Must point +x |
|---|---|---|---|---|---|
| 0 | `orb.small` | `orb(r 5)`, the workhorse shot | 10×10 | 11px | no |
| 1 | `orb.medium` | `orb(r 8)` | 16×16 | 8px | no |
| 2 | `orb.large` | `orb(r 13)`, heavy round shot | 26×26 | 3px | no |
| 3 | `ring` | `ring(r 12, thickness 3)`, reads through dense fire | 28×28 | 2px | no |
| 4 | `kunai` | `blade(26, 9)`, leaf-shaped | 26×6 | 3px | **yes** |
| 5 | `scale` | `shard(20, 12)`, short diamond | 20×12 | 6px | **yes** |
| 6 | `star` | `star(r 13, 5 points)` | 24×24 | 3px | no |
| 7 | `shard` | `shard(26, 7)`, long thin diamond | 26×8 | 3px | **yes** |
| 8 | `glow.small` | `orb(r 7, core 0.15)`, halo with no hard core | 14×14 | 9px | no |
| 9 | `glow.medium` | `orb(r 11, core 0.12)` | 22×22 | 5px | no |
| 10 | `glow.large` | `orb(r 14, core 0.10)` | 28×28 | 2px | no |
| 11 | `halo` | `ring(r 13, thickness 2)`, thin hollow ring | 28×28 | 2px — see §1.2 | no |
| 12 | `needle` | `blade(28, 5)`, long slim blade | 26×4 | 3px | **yes** |
| 13 | `petal` | `petal(r 11)`, asymmetric leaf | 22×8 | 5px | **yes** |
| 14 | `spark` | `star(r 11, 4 points)` | 22×22 | 5px | no |
| 15 | `mote` | `orb(r 3)`, dust for trails | 6×6 | 13px | no |

The last column is stricter than it looks. It does not mean "something sets
`orientToHeading` on this cell today" — `kunai`, `scale`, `needle` and
`glow.small` are the only four with a caller that does (the base pack's enemy and
boss cards in `tools/make-base-pack.ts`, `src/content/shots.ts:154`/`:222`,
`src/sim/option.ts:276`, and the BEAM shot at `src/content/shots.ts:308-316`). It
means the shape is elongated
or asymmetric and so has a direction at all, and rule 7 says that direction is
east. `shard` and `petal` have no rotating caller yet and must still be drawn
pointing right, because the first content that rotates them will not think to
check.

There is a second rotator besides `orientToHeading`, and it is easy to miss:
`EffectSystem.emit` writes `p.angle` from every particle's travel direction
unconditionally (`src/sim/effects.ts:168`). Radially symmetric cells cannot tell,
which is why it costs nothing — but the `graze` effect is `needle`
(`src/sim/effects.ts:275`) and depends on it entirely. The `pickup` effect also
spins `star` at 0.12 rad/tick (`src/sim/effects.ts:295`), so that cell has to
read the same at every angle rather than only upright.

**Readability is the whole job.** A danmaku screen holds hundreds of
simultaneous bullets over a moving background, and the player must parse
them instantly. Two demands that pull against each other:

- **A hard, high-contrast core** so position is unambiguous. The lethal hitbox
  is far smaller than the sprite, and the player reads the *centre*, not
  the silhouette.
- **A soft outer falloff** so a dense curtain does not turn into a solid mass.

The procedural generator resolves this with one four-stop radial gradient
(`src/render/procedural.ts:73-77`): alpha 1.0 at the centre, 0.95 at
`coreRatio`, 0.35 at 82% of the radius, 0 at the edge. Match that energy
distribution even where the shape differs.

`coreRatio` is the whole difference between a bullet and a halo. It defaults to
**0.45** for the solid shots — `orb.small`, `orb.medium`, `orb.large`, `mote` —
and drops to **0.15, 0.12 and 0.10** for `glow.small`, `glow.medium` and
`glow.large` respectively (`src/render/procedural.ts:258-263`). A glow cell has
almost no plateau at all: it starts falling off immediately, which is what stops
six overlapping explosion particles from compositing into a white disc.

### 3.2 Player ship — `ship.png`, one region per character

The only art in the game that is not a bullet cell. `createShipAtlas`
(`src/render/procedural.ts`) builds a 64×64 texture with **named regions and no
grid**, `atlas.define('ship', { x: 0, y: 0, w: 64, h: 64 })`.

**One region is not enough — the roster is four ships.** `scout`, `lance`,
`hound` and `spire` each name their art through `CharacterSpec.sprite`
(`src/game/run.ts`), and today all four name `'ship'` because that is the only
region the placeholder paints. A real art set gives each ship its own region and
repoints its `sprite` string; the shell already reads the field, so no code
changes. Register the regions the way the bullet grid names its cells — a
`defineShip`-style helper, or `atlas.define('scout', …)` per ship — and give this
section a row per character. Until then, one silhouette stands in for all four.

| Property | Value | Verified at |
|---|---|---|
| Image size | **64 × 64** per region | `src/render/procedural.ts` (`createShipAtlas`) |
| Drawn at | **40 × 40** (each ship's `width`/`height`, default 40) | `src/main.ts` (player draw) |
| Orientation | **pointing up (−y)** — the ship does not rotate | `src/render/procedural.ts` (`createShipAtlas`) |
| Colour | white/greyscale, tinted for damage flash | `src/main.ts` (player draw) |

Note the 40-from-64: the sheet is authored at 1.6× its drawn size, the one place
in the game where art is not at final display size. Detail below about 1.6px in
the source will not survive to the screen.

The damage flash drives `g` and `b` to 0.5 and alpha to 0.35 on alternating
4-tick blocks (`src/main.ts:343`, `:352-354`), so it reads as red only if the art is
neutral. A ship drawn blue would flash grey.

Must include a **visually distinct centre point** marking the hitbox. This is
not a debug affordance — showing the hitbox is standard genre practice and a
real readability feature, because the ship sprite is many times larger than the
2.5px lethal radius (`src/game/run.ts:1196-1197`). The placeholder marks it with a
3px-radius disc two pixels below centre (`src/render/procedural.ts:380-383`),
which at the 40/64 draw scale lands as roughly 1.9px on screen against that
2.5px radius — close enough to be honest, and worth keeping close.

If you want animation frames later, extend to a `32 × 48` grid: row 0 idle
(8 frames), row 1 banking left (4), row 2 banking right (4). That is the shape
upstream used and it works; it just does not exist yet, and nothing in the
engine advances a frame index, so it is a code change before it is an art
request.

### 3.3 Enemies — no sheet, and they are on screen regardless

There is no `enemies.png` and no `createEnemyAtlas`. The status is not "not yet
implemented" — enemies are drawn, right now, from the **bullet atlas**:
`batches.enemies` is constructed on it (`src/main.ts:103`), `grunt` is a tinted
`orb.large`, `weaver` a `ring`, `turret` a `halo` (the base pack's
`grunt`/`weaver`/`turret`, `tools/make-base-pack.ts`), and the boss `sentinel` is
a `halo` drawn at 56×56 out of a 32px cell (`tools/make-base-pack.ts:511-516`).
`width` and `height` default to the cell size and are overridden per enemy — the
turret is 40×40 (`tools/make-base-pack.ts:268-269`).

Two consequences an artist should know before touching this. Enemies scale a
32px cell up by as much as 1.75×, so the bullet sheet's cells are already being
asked to hold up at boss size. And enemies inherit the tint discipline
completely: every enemy on screen is white art multiplied by a `tint`
(the base pack's per-enemy `tint`, `tools/make-base-pack.ts`), so the first enemy sheet is not
competing against a blank screen but against silhouettes that already read at
speed.

When a real sheet arrives:

| Property | Value |
|---|---|
| Cell size | **48 × 48** (upstream used 32×32; we have the fill rate) |
| Grid | 8 columns × N rows, one row per enemy type |
| Animation | 4 frames per row, advancing every 5 ticks |
| Orientation | facing down (toward the player) |

Nothing in the engine reads that table yet. `EnemySpec` carries a `sprite` name
and no frame count at all (`src/sim/enemy.ts:46-48`), so the animation row is a
proposal, not a contract — it needs code in `src/sim/enemy.ts` before art can
use it. Upstream's `enemy.png` was 512×512 and used **three of its 256 cells**.
Do not reserve space speculatively; add rows as enemy types are actually
authored.

### 3.4 Backgrounds — there is no image, and there is not going to be one

**Backgrounds are fragment shaders.** There is no `bg-*.png`, no tiling texture
and no plan for either. A background is a full-screen quad at `Layer.Background`
running a shader registered with `defineBackground`
(`src/render/background.ts:149`), one scene per file under
`src/render/backgrounds/`, reaching the game only because that directory's index
imports it. Four exist: `drift`, `expanse`, `surge`, `undertow`.

The reason is in the header of `src/render/background.ts`: upstream's background
was a textured plane scrolled by a counter, which gives you exactly one
background, and the only way to get a second is to edit the drawer. What this
project wants from a background — noise fields, a receding plane, a shaft seen
from inside — has nothing in common between scenes except that it fills the
screen and advances with the clock. So the clock, the quad and the cross-fade
are all the engine owns.

A scene defines one entry point,

```glsl
vec3 background(vec2 uv)
```

where `uv` is 0..1 across the field with **y increasing downward**, matching the
space content is authored in. It is compiled against five standard uniforms —
`uTick`, `uScroll`, `uRes`, `uIntensity` and `uAlpha`
(`src/render/background.ts:227-231`) — and may declare its own, though `uAlpha` is
the cross-fade's and a scene has no business reading it. `uTick` advances in `step()` and nowhere else; there is
no `performance.now` in that file and there must never be one, because a
background on a wall clock makes a replay look different on a 144Hz display
(CLAUDE.md, rule 1).

#### What an artist actually contributes here

Not a file. Three things, all of which reach the screen:

**A palette, as `vec3` constants.** Every scene is a handful of `const vec3`
values and a mix between them, and swapping those constants changes the whole
scene without touching a line of maths. They reach the framebuffer unmanaged,
exactly as sprite tints do (section 1.1) — the number is the colour. The shipped
ones, so a proposal has something to sit next to:

| Scene | Constants | Values (`src/render/backgrounds/`) |
|---|---|---|
| `drift` | deep → lift | `(0.015, 0.022, 0.050)` → `(0.045, 0.075, 0.130)` (`drift.ts:36-37`) |
| `expanse` | haze / sky top / sky lift / ground deep / ground lift | `(0.014, 0.020, 0.044)`, `(0.004, 0.006, 0.014)`, `(0.020, 0.030, 0.055)`, `(0.016, 0.024, 0.050)`, `(0.055, 0.090, 0.155)` (`expanse.ts:82-86`) |
| `surge` | base / glow | `(0.030, 0.010, 0.028)` → `(0.130, 0.028, 0.075)` (`surge.ts:40-41`) |
| `undertow` | haze / wall deep / wall lift | `(0.018, 0.010, 0.030)`, `(0.026, 0.014, 0.044)`, `(0.100, 0.048, 0.150)` (`undertow.ts:86-88`) |

Read the magnitudes before proposing anything. The brightest constant in the
game is `0.155`, and it is a *lift* term multiplied by a fraction before it is
added, so it never lands at 0.155 on screen. This is not a stylistic preference
about moodiness; see the constraint below.

There is also a hard ceiling above these numbers. Bloom is on in the shipped game
— `PostProcessing` defaults to disabled (`src/render/post.ts:210`) and `src/main.ts:139`
passes `{ enabled: true }` — with a threshold of `0.95`
(`src/render/post.ts:171-173`), chosen to catch bullet cores
and nothing else. A background that approached it would bloom, and the bloom
pass would then be lifting the darkest, busiest part of the frame — see the
manual check at `src/render/post.ts:77`: if the whole screen has lifted off
black, the threshold is too low, and a bright background is one way to make it
so without touching the threshold at all.

**Reference imagery and a spatial description.** "A shaft seen from inside,
falling forward, six flutes" is a brief a shader can be written from. A rendered
painting is not, and cannot be loaded.

**A judgement on whether a scene is finished.** That one needs eyes on the real
thing, running, with bullets on top of it.

#### The two constraints a scene has to satisfy

Both are gameplay constraints wearing art clothing, and both are already written
down in the code.

**Peak luminance near 0.1.** The play field has to stay readable on top of the
background at all times. `src/render/background.ts:59-61` states it, and
`expanse` records its own measurement in its header: that shader peaks around
**0.09**. If you find yourself losing a bullet against a background, the shader
is too bright — the sprite is not the thing to change.

**No detail at a bullet's spatial frequency.** The shared value-noise helper
runs **three octaves, not four**, and the comment says exactly why: the fourth
lands at a spatial frequency close to a bullet's, and a background that looks
like sparse bullets is a gameplay bug (`src/render/background.ts:185-186`).

The two perspective scenes carry a sharper version of the same problem, which is
the closest thing here to the old tiling advice. A projection that runs to
infinity samples noise faster than the pixel grid can carry it — adjacent pixels
near the horizon land arbitrarily far apart in world space — and what that
aliases into looks exactly like sparse bullets. Both `expanse` and `undertow`
therefore decay their **structured** terms faster than their brightness, so
what survives near the vanishing point is a smooth gradient with nothing left to
alias. Any new scene with a perspective divide in it needs the same treatment.

Broad forms, low contrast, no thin lines — the conclusion the old tiling
specification reached was right. The mechanism was just not a texture.

### 3.5 Effects — no sheet of their own; they wear bullet cells

Upstream's entire VFX vocabulary was **white rings and white discs at varying
alpha**, drawn into an offscreen canvas at runtime. None of it came from an
image file, which means its art direction could not reach its own effects layer
at all.

Ours is different in the way that matters: effects are particles, and every
particle draws a **cell from the bullet sheet**. The six shipped effects are
declared at `src/sim/effects.ts:251-323`:

| Effect | Cell | Tint | Blending |
|---|---|---|---|
| `explosion` | `glow.medium` | `(1, 0.72, 0.38)` | additive |
| `hit` | `spark` | `(1, 0.95, 0.8)` | additive |
| `graze` | `needle` | `(0.55, 0.8, 1)` | additive |
| `pickup` | `star` | `(1, 0.88, 0.45)` | additive |
| `muzzle` | `glow.small` | `(0.8, 0.9, 1)` | additive |
| `death.big` | `glow.large` | `(1, 0.55, 0.3)` | additive |

So the old claim — that effects are out of an artist's reach — is wrong.
**Redrawing `glow.medium` redraws every explosion in the game.** The effects
layer is downstream of the same sixteen cells as everything else, which is one
more reason those cells are worth more attention than their size suggests.

What is genuinely closed off is *adding* a sprite. `defineSprite` types its
`sprite` argument as `BulletCell` (`src/sim/effects.ts:243-249`), so a particle
naming art that is not on the sheet fails the build rather than drawing the
wrong shape at runtime. A new effect shape means a new cell, in the grid, named
in `BULLET_CELLS` — not a loose PNG.

Two properties of the particle system that constrain what those cells can be:

- **Everything additive.** All six blend additively, so the art is being added
  to whatever is under it. Anything that relies on occluding the background will
  not read; luminance is the only channel doing work.
- **Everything scales, and the quad size is hardcoded.** A particle is drawn at
  `32 * p.scale` on both axes (`src/main.ts:332-333`) — the cell size is assumed,
  not read from the atlas. `death.big` runs from 1.6× down to 0.3× across its
  life (`src/sim/effects.ts:319`), so `glow.large` is drawn anywhere between
  51px and 10px. Detail that only exists at one size is wasted at both ends.

### 3.6 Dialogue portraits — `portrait.png`, one per speaker, exactly 96×96

The face drawn beside a boss's pre-fight dialogue line. It is not on any sheet and
not tied to a grid — each portrait is its own square image, named and drawn on the
2D overlay canvas beside the dialogue box, never batched into the field.

| Property | Value | Verified at |
|---|---|---|
| Image size | **exactly 96 × 96** | `PORTRAIT_SIZE`, `src/render/portrait.ts` |
| Namespace | a **portrait name**, what a `DialogueLine.speaker` names | `src/render/portrait.ts` |
| Colour | may be **full colour** — unlike bullets and the ship, a portrait is not tinted white | `src/render/portrait.ts` |
| Fallback | a procedural tinted silhouette carrying the name, for any speaker with no image | `portraitImage`, `src/render/portrait.ts` |

Three things set it apart from the white-and-tinted sheets above:

- **96×96 is exact, not a ceiling.** The shell composites the portrait at a fixed
  size, so a wrong one does not scale cleanly — the loader enforces the exact
  square with the ship-sheet's `!==` idiom, not the HUD icon's tolerant `≤`. A
  portrait that is not 96×96 is rejected, naming the measured size.
- **Colour is yours.** A portrait is one of the few places real hue belongs (§1),
  because it is drawn as itself, never multiplied by an engine tint. Paint a face,
  not a white silhouette.
- **It never blocks a boss on art.** A speaker with no registered portrait draws a
  procedural silhouette — a dark tinted panel with the name — so dialogue is
  authored and playable before any face exists. The image only replaces that
  placeholder. In the source path a portrait is registered with `definePortrait`
  (`docs/extending.md` §12); in a pack it is the `portraits` section, dimension-
  checked at load (`docs/packs.md` §5.5).

The drawn box is a readability judgement — legible against the field, obeying the
negative-space budget while the player still flies — so it is checked by eye in
`bun run dev`, not asserted by a pixel test.

---

## 4. Generating art with an image model

Image models do not natively produce sprite sheets on a grid. Fighting that
wastes time. The reliable process:

1. **Generate each cell individually**, square, one shape centred on a
   transparent or pure-black background.
2. **Ask for the shape, not the game.** "A glowing white teardrop, centred,
   soft radial falloff, pure black background, no text" beats any prompt that
   mentions bullet hell — genre words summon busy screenshots.
3. **Specify white explicitly** for anything that will be tinted. Models drift
   toward colour unless told not to.
4. **Composite programmatically.** Never ask the model to lay out the grid.
   Downscale each cell to 28×28, centre it in a 32×32 cell, and write the sheet
   with a script.
5. **Convert luminance to alpha** for anything generated on black:
   `alpha = luminance`, `rgb = white`. This is what makes additive blending and
   tinting behave.

Useful prompt skeleton for a tintable bullet cell:

```
a single <shape>, centred, pure white on solid black,
soft radial glow falling off to black at the edges,
no text, no border, no background detail, symmetrical, high contrast core
```

Then, per cell:

```
shape = "sphere" | "four-pointed star" | "thin elongated blade pointing right"
      | "hollow ring" | "teardrop pointing right" | "diamond"
```

**Verify before committing**, in this order — each catches something the next
cannot:

- Grid alignment: overlay a 32px lattice and confirm every shape sits inside its
  cell with ≥2px clear margin.
- Tinting: render the same cell at three different tints; if any looks muddy,
  the source was not neutral white.
- Density: put 500 of them on screen at once. This is where art that looked
  beautiful in isolation turns into unreadable soup. `bun run test:density`
  does this against real patterns; section 5 says how to read it.

---

## 5. Replacing the procedural sheet with real art

This is the section the rest of the file exists for. It is written as a
procedure because the obvious one-line version does not work, and each step
below is a place it stops working.

### 5.0 The preferred route is a pack — no code edit at all

Before the source-level swap below, know that there is a higher-level one that
needs **no editing of `src/` at all**: drop an [asset pack](./packs.md) into
`packs/`. A pack is a folder with a `pack.json` manifest naming a `bullets.png`
(and optionally a ship, HUD icons and sounds); the loader fetches it, runs the
same dimension, margin and whiteness checks this section describes — in the
browser, against your real pixels — and reports every failure by name. It layers
over the placeholders, needs only a page refresh under `bun run dev`, and is the
right choice for shipping a reskin. **`packs/example/` is a complete worked
example of everything in section 3.**

The rest of this section is the **low-level seam beneath that**: the
`BULLET_SHEET` constant in `main.ts` and the `bulletAtlas(url)` function a pack's
loader itself calls. Read it when you are wiring a sheet into the engine directly
— building the pack loader, bundling a single fixed sheet, or debugging the seam
— rather than authoring a drop-in pack. Everything about the *art* (§1–§4) is
identical either way; only the delivery differs.

### 5.1 Author the file

256 × 64, eight columns by two rows of 32px, RGBA. Cell order is exactly
`BULLET_CELLS` (`src/render/procedural.ts:39-56`), cell 0 top-left. Everything
in section 3.1 applies.

### 5.2 Get the file into the bundle

Create `src/assets/` and drop the PNG in, then import it:

```ts
import BULLETS_URL from './assets/bullets.png';
```

`src/assets.d.ts` already declares `*.png`, `*.wav` and `*.ogg`, so this
type-checks with no `@ts-expect-error`. The bundler resolves the import, copies
the file into `dist/` under a hashed name and rewrites the specifier to the
emitted URL — verified through `bun run build`, which lists the PNG as an asset.

**Do not use `new URL('./bullets.png', import.meta.url)`.** It is the form the
root CLAUDE.md used to prefer, and it does not work under Bun's dev server:
`import.meta.url` stays the source file's own `file://` path in the client
bundle, so the URL resolves to a local path the browser refuses to fetch. Nor
can you fetch by repository path — an HTML-entry dev server answers every unknown
route with the entry document, so `/assets/bullets.png` returns 200 with the page
HTML and the PNG decoder fails on markup. Both failures are recorded at
`test/visual/asset-loading.ts`, and CLAUDE.md's "Stay bundler-agnostic" note now
records the import form instead.

### 5.3 Change the one line in `src/main.ts`

`main.ts` has a single `BULLET_SHEET` constant, and it is the whole integration
point:

```ts
const BULLET_SHEET: string | undefined = undefined;
```

becomes

```ts
import BULLETS_URL from './assets/bullets.png';
const BULLET_SHEET: string | undefined = BULLETS_URL;
```

That is the entire swap. `bulletAtlas(url)` (`src/render/procedural.ts`) does the
rest: it loads the sheet, checks its dimensions against the grid and **throws
naming both figures if they disagree** — a wrong-sized sheet otherwise repoints
every cell at a crop of the wrong shape and the game silently runs — then calls
`defineGrid` so the cell names, their order and the grid are identical to the
generated set. Pass `undefined` and it generates the placeholder as before.

This used to be three hand-edits — reorder `main.ts`'s module top level for the
`await`, remember `defineGrid`, re-decide the texture filter — and this document
walked all three. The seam exists now, so it does not. Two things still worth
knowing:

- **Everything downstream is genuinely untouched, as long as the names hold.**
  Content references cells by name, so no pattern, enemy, item or effect changes
  — *provided every name in `BULLET_CELLS` still exists*. A real drop that renames
  or removes a cell is the one edit that breaks this, and it breaks it in two
  consumers loudly (`CELL_ART` and `effects.ts` fail the build) and in five
  others silently (enemy, boss, item, option and bullet-style `sprite` strings
  throw at draw time). `src/render/sprites.test.ts` is the guard that turns the
  silent five into a build failure — run it after touching `BULLET_CELLS`.
- **The filter.** A loaded sheet is drawn with `NearestFilter`
  (`src/render/atlas.ts`, `loadTexture`); the generated sheet used `LinearFilter`.
  Art designed to be soft will arrive harder-edged. If that is wrong for your art,
  set `magFilter`/`minFilter` on the texture after loading — and re-read §1.2,
  because `LINEAR` is what makes the 2px margin non-negotiable rather than merely
  advisable.

For the ship — non-grid art — see §3.2: each character names its region through
`CharacterSpec.sprite`, and the ship atlas names regions explicitly rather than
on a grid.

Audio replaces the same way, through a different door: a sound is swapped by
giving its `defineSound` call a `url`, no shell edit at all. That path, and why
it fails *silently* where art fails loudly, is [`docs/audio.md`](./audio.md).

### 5.4 Verify, in this order

Five commands, and they answer different questions. Running only the last is how
art gets blamed for an engine bug.

```
bun run typecheck     # tsc --noEmit
bun test
bun run test:assets   # → http://localhost:3007/test/visual/asset-loading.html
bun run test:density  # → http://localhost:3008/test/visual/density.html
bun run dev
bun run build         # and confirm the PNG is emitted into dist/
```

**`bun run build` is not optional, and it is the step this list used to omit.**
Every other command runs against the dev server; the shipped game runs against
the production bundle, and the two resolve asset imports differently. `bun run
build` must list your PNG among its emitted assets — if it does not, the import
did not resolve and the built game will 404 the sheet while the dev server
serves it fine. This was verified once end to end by wiring the committed
`grid-8x2.png` fixture through the seam: the build emits it and the running game
draws every bullet from it. Do the same with your own file before shipping.

**`bun run test:assets` proves the pipeline, not your art.** It loads
`test/fixtures/grid-8x2.png` — sixteen flat, maximally distinct colours on the
same 8×2 grid — draws every named cell through a real `SpriteBatch`, and reads
the framebuffer back to answer "did you draw the cell I asked for". It then
re-runs the same measurement with every cell shifted one place along and
requires all sixteen to be rejected, so a PASS means something. It also covers
the decode paths a hand-made PNG can fall into: non-power-of-two dimensions, a
file with no alpha channel at all (upstream's `rumia.png` defect), a sheet whose
dimensions do not divide evenly by the cell size, and a 1×1 image. Run it after
any change to `Atlas`, `loadTexture` or the grid. A UV error found here would
otherwise present as your art looking wrong.

**`bun run test:density` is the one that judges the art.** It drives a real
`BulletSystem` through real `content/patterns.ts` emitters to a target
population and renders a still frame at each density using the bullet specs the
shipped game actually fires. The performance half is automated; the readability
half is not, and does not pretend to be — it puts the frame on screen and leaves
the verdict to whoever is looking. This is the "500 on screen" check that both
this file and CLAUDE.md have always asked for.

**`bun run dev` is still required.** Every rendering bug this project has found
— reversed winding, an inert `renderOrder`, a spatial-hash collision — was
invisible to the type checker and silent in the console. Confirm the field
actually draws, that bullets read against the background, and that the sheet is
not a grid of transparent squares.

---

## 6. Checklist

Before adding any sheet:

- [ ] Original work — not derived from Touhou or any other existing game
- [ ] Anything that will be tinted is white/greyscale, shaped by luminance and alpha
- [ ] ≥2px transparent padding inside every cell — 28×28 of art in a 32×32 cell
- [ ] Elongated or asymmetric shapes point **right** (+x), whether or not
      anything rotates them today
- [ ] Radially symmetric shapes read correctly at any angle, not only upright
- [ ] RGBA, 8-bit PNG, alpha channel actually present, sRGB, no embedded profile
- [ ] Cell order matches `BULLET_CELLS`, and `defineGrid` is called on the atlas
- [ ] `bun run test:assets` green — the loading path addresses cells correctly
- [ ] Tested at real density with `bun run test:density`, not in isolation
- [ ] Looked at in `bun run dev`, with bullets over a real background

The density one is the one people skip, and it is the one that decides whether
the game is playable.

Backgrounds are not on this list because they are not files. See section 3.4.

---

## 7. What upstream's art set teaches

Upstream is **not in this repository** — not in the tree, not in the history, and
`.gitignore` has an entry for `toho-like-js/` so a local clone can never be
committed by accident. Clone it separately if you want to look. What its art set
teaches is recorded here so nobody has to:

- **It was mostly empty.** `enemy.png` used 3 of 256 cells; `bullet.png` 11 of
  256; each 1024×512 boss sheet used 6 of 32. Roughly 8MB of PNG delivering a
  few hundred KB of actual art.
- **Ten of its 42 files were never drawn**, several loaded anyway — the loader
  waited on files that reached no drawer.
- **`rumia.png` shipped without an alpha channel** (PNG colour type 2 where
  every other sheet was type 6), so that boss rendered on an opaque box.
- **One boss silently wore another's portrait** — a fallback in
  `SpellCardFactory._getImage` handed Mokou's art to Daiyousei.
- **Its loader had no error handling**: one 404 hung the loading screen forever.

The generalisable lesson is that an art pipeline with no manifest and no
validation degrades quietly. Naming cells and checking them at load time costs
very little and prevents all five of the above.
