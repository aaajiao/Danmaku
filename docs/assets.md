# Image assets — specification and generation guide

This is the brief for producing art for this game, whether by hand or with an
image model. It is a spec, not a mood board: the numbers are load-bearing, and
the engine will render nonsense if they are wrong.

Read [`CLAUDE.md`](../CLAUDE.md) rule 9 first. Upstream's art is Touhou Project
derivative and cannot ship. **Everything here must be original work.** That is
the constraint, but it is also the opportunity — upstream's own sheets were
mostly empty, and we are not obliged to repeat their shape.

`packs/v4/` is the shipped **data-only art pack**: manifests and pixels, with no
patterns, motion behaviours, campaign logic, or GLSL. The executable v4 edition
is composed under `src/v4/`: patterns in `src/v4/gameplay/patterns.ts`,
behaviours in `src/v4/gameplay/behaviours.ts`, authored shaders in
`src/v4/backgrounds/`, and the generated campaign in
`src/v4/content/campaign.json`. That campaign is produced by
`tools/make-v4-content.ts` and validated/injected by
`src/v4/content/index.ts`; it is not an image-pack asset or a file to hand-edit.

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

**White + tint is the *floor's* mode, not a law every sheet obeys.** The
procedural placeholder and every *shared* bullet cell are white-and-tinted,
because the base campaign colour-codes a curtain by tinting one cell many hues
(e.g. `orb.small` appears at pink, orange and more). A loaded pack may instead
ship native strips (see §1.4): its **floor-cell** strips stay `tinted` (native
size and animation, still tint-coded), and it may **bake** colour into the pixels
of a *named variant* strip declared `color: 'baked'`, which its own content names
tint-free. Baked colour lives only in a named variant — **never** on a shared
floor cell, which would mud or collapse the hues content tints onto it. On a
baked sprite the per-instance tint is a *modulation* (identity-white by default;
a sub-1 channel tones or fades, the boss hit-flash's >1 lifts toward the clamp
and BRIGHTENS), not the colour source. See `docs/packs.md` and the Rendering
doctrine in CLAUDE.md.

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

### 1.4 Animation strips — the native art format

Horizontal animation strips are the engine's native art format, and a static
image is the degenerate case. Four points are law:

1. **A strip is horizontal frames, frame 0 leftmost.** Frame width = row-width ÷
   N. The filename suffix `_stripN` names N; a static image is `_strip1` (or no
   suffix = one frame). One vocabulary, no second format — the `Atlas` stores
   every entry as a `Strip`, and a plain cell is `frames: 1` (`src/render/atlas.ts`).

2. **Per-frame padding is the seam law, per frame.** Each frame's painted extent
   (both axes) clears `frameW − 2·PAD` / `frameH − 2·PAD`, PAD = 2 — the
   generalization of `MAX_CELL_EXTENT` (§1.2), now evaluated at every frame
   boundary. Additionally `x + (frames − 1)·stride + frameW ≤ sheetWidth`,
   `y + frameH ≤ sheetHeight`, and `stride ≥ frameW`. The procedural fx floor's per-frame boxes
   are asserted against this in `src/render/procedural.test.ts` (`FX_STRIPS`).
   The sole role-based exception is a registered laser **body**: its +x extent
   must fill `frameW` so a stretch reaches muzzle/tip and repeated tiles butt
   without a gap; its cross axis still clears PAD. Laser caps and pack-new laser
   names receive no exemption.

3. **The art declares playback:** frame count, frame size, `ticksPerFrame`,
   `mode` (`loop`/`once`), `color` (`tinted`/`baked`) and orientation. Frames
   advance on a **run-relative tick clock** — an entity's own `.age`, reproduced
   bit-for-bit by a replay — never a wall clock and never `loop.count`
   (`src/render/strip.ts`). Directional strips point +x (§1.3); radial strips
   (explosions) have no orientation.

4. **`color: 'tinted'` obeys the white+tint saturation gate; `color: 'baked'` is
   exempt** — the deliberate, documented divergence for coloured explosions and
   fire (§1.1). A baked strip still passes the dimension and inter-frame seam
   gates; only the saturation gate is skipped.

**A native sprite's visible body should stay proportional to its spec `radius`.**
The hitbox is spec data read by the sim every tick (`BulletSpec.radius`, etc.);
the strip's `frameW/frameH` never feed it — the sim cannot read a sprite size
(`sim/` may not import `render/`). So a 6px baked orb and a 32px floor orb with
the same `radius` collide identically, which is what makes a native reskin
replay-safe. Keeping the visible body near the radius is a readability courtesy,
not a gate.

The round-one procedural fx floor (`FX_STRIPS` in `src/render/procedural.ts`)
paints three strips, all `tinted`, per-frame painted footprint under the
`frameW − 4` budget:

| Strip | frame | frames × ticks | mode | painted ≤ | look |
|---|---|---|---|---|---|
| `burst` | 64×64 | 8 × 3 | once | 60 | enemy-death flash — orb core, expanding ring |
| `burst.big` | 96×96 | 12 × 3 | once | 92 | boss/player death — core + two rings |
| `pulse` | 32×32 | 6 × 4 | loop | 28 | pickup glow, core ratio breathing 0.2→0.6→0.2 |

The measured per-frame numbers ship in `test:assets`; the sheet is
`FX_SHEET_W`×`FX_SHEET_H` (derived from the table, never hand-set).

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
(the v4 campaign's `sentinel`, `tools/make-v4-content.ts`), the turret at
40px (the v4 campaign's `turret`, `tools/make-v4-content.ts`), the
ship's 64px art at 40px (`src/main.ts:484-486`), and particles anywhere from
1.6× to 0.05×. So "final display size" means the size to design *for*, not the
only size a cell will ever be drawn at. The practical consequence is at the top
of section 3.5: detail that only reads at one size is wasted.

---

## 3. Sheet specifications

### 3.1 Bullet sheet — `bullets.png`

The name is a historical accident and it will mislead you. **This sheet is not
just bullets.** Every `SpriteBatch` in the game except the player's own is built
on it (`src/main.ts:172-192`): enemies wear `orb.large`, `ring` and `halo`
(the v4 campaign's `grunt`/`weaver`/`turret`, `tools/make-v4-content.ts`), the boss
wears `halo` (the v4 campaign's `sentinel`, `tools/make-v4-content.ts`), items
wear `shard`, `star`, `mote`, `petal` and `ring`
(`src/sim/item.ts:407-451`), particles draw `glow.medium`, `spark`, `needle`,
`star`, `glow.small` and `glow.large` (`src/sim/effects.ts:251-323`), and the
player's shots draw `glow.small` and `scale` (the base pack's shot skins,
`src/v4/content/campaign.json`; `src/content/shots.ts` is now registration-only).
All sixteen cells are in use by something. Sixteen 32×32 cells carry
essentially the whole visual vocabulary of the game — the player ship is the
only art outside them — which is why these cells deserve far more attention than
a 256 × 64 PNG suggests.

The 256×64 grid is the **floor and the legacy-string contract** — unchanged. A
pack may instead ship the self-describing object form (`assets.bullets: { sheet,
strips }`) and give each of the sixteen floor names a native `tinted` strip at
native size and animation (§1.4), plus its own `baked` named variants. That is
one shared sheet, one texture, one batch — the hot path stays a single
`strip(name)` lookup. The format and its loader gates are in `docs/packs.md`;
`assets.ship` gains the same object form (§3.2), a native strip bank drawn at
frame 0 this round.

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
`glow.small` are the only four with a caller that does (the base pack's enemy,
boss and player shot cards in `src/v4/content/campaign.json`, generated from
`tools/make-v4-content.ts`). It
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

### 3.2 Player presentation — pack actor sheet plus `ship.png` floor

> **Scope: procedural fallback / low-level pack floor only.** The current v4
> runtime loads its compiled five-player actor atlas from
> `packs/v4/actors/players.png`; this subsection
> documents the fallback `ship` region and legacy asset seam, not the default
> character presentation. The authoritative v4 actor atlas dimensions and
> runtime sizes are in [`v4-art-direction.md` §9](./v4-art-direction.md#9-图集与动画技术规格).

In the procedural floor this is the only art that is not a bullet cell. `createShipAtlas`
(`src/render/procedural.ts`) builds a 64×64 texture with **named regions and no
grid**, `atlas.define('ship', { x: 0, y: 0, w: 64, h: 64 })`.

**One region is not enough — the roster is five ships.** `scout`, `lance`,
`hound`, `spire` and `maw` each name their art through `CharacterSpec.sprite`
(`src/game/run.ts`), and all five name `'ship'` because that is the only
region the placeholder paints. A generic replacement gives each ship its own region and
repoints its `sprite` string; the shell already reads the field, so no code
changes. Register the regions the way the bullet grid names its cells — a
`defineShip`-style helper, or `atlas.define('scout', …)` per ship — and give this
section a row per character. Without v4's actor layer or an active replacement,
one fallback silhouette stands in for all five.

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
4-tick blocks (`src/main.ts:487-489`, `blink` at `:478`), so it reads as red only if the art is
neutral. A ship drawn blue would flash grey.

Must include a **visually distinct centre point** marking the hitbox. This is
not a debug affordance — showing the hitbox is standard genre practice and a
real readability feature, because the ship sprite is many times larger than the
2.5px lethal radius (each character's `radius`, `src/v4/content/campaign.json`; read
as `player.radius` at `src/game/run.ts:1021`). The placeholder marks it with a
3px-radius disc two pixels below centre (`src/render/procedural.ts:392-395`),
which at the 40/64 draw scale lands as roughly 1.9px on screen against that
2.5px radius — close enough to be honest, and worth keeping close.

The old proposed `32 × 48` idle/banking grid is not the live contract. A native
`assets.ship` strip may declare the explicit five-way banking order, while
`assets.actors.players` carries named, explicitly placed strips for the
full-colour people. Both advance from replayed tick/input state; neither guesses
animation from a filename or implicit grid.

### 3.3 Enemy/Boss presentation — pack actor sheets plus bullet floor

> **Scope: procedural fallback / low-level floor only.** “No enemy sheet” below
> describes the engine fallback. The current v4 runtime loads
> `packs/v4/actors/enemies.png` and `packs/v4/actors/bosses.png` for 16 enemies
> and 5 bosses (alongside the five-player atlas); their
> authoritative cells, visible sizes, and naming contract are in
> [`v4-art-direction.md` §9](./v4-art-direction.md#9-图集与动画技术规格).

The procedural floor has no `enemies.png` and no `createEnemyAtlas`. When that
fallback is visible, enemies are drawn from the **bullet atlas**:
`batches.enemies` is constructed on it (`src/main.ts:173`), `grunt` is a tinted
`orb.large`, `weaver` a `ring`, `turret` a `halo` (the base pack's
`grunt`/`weaver`/`turret`, `tools/make-v4-content.ts`), and the boss `sentinel` is
a `halo` drawn at 56×56 out of a 32px cell (`tools/make-v4-content.ts`).
`width` and `height` default to the cell size and are overridden per enemy — the
turret is 40×40 (`tools/make-v4-content.ts`).

Two consequences an artist should know before touching this. Enemies scale a
32px cell up by as much as 1.75×, so the bullet sheet's cells are already being
asked to hold up at boss size. And enemies inherit the tint discipline
completely: every enemy on screen is white art multiplied by a `tint`
(the v4 campaign's per-enemy `tint`, `tools/make-v4-content.ts`), so the first enemy sheet is not
competing against a blank screen but against silhouettes that already read at
speed.

The pre-v4 generic-sheet proposal was:

| Property | Value |
|---|---|
| Cell size | **48 × 48** (upstream used 32×32; we have the fill rate) |
| Grid | 8 columns × N rows, one row per enemy type |
| Animation | 4 frames per row, advancing every 5 ticks |
| Orientation | facing down (toward the player) |

Nothing in the generic fallback reads that table. `EnemySpec` carries a `sprite` name
and no frame count at all (`src/sim/enemy.ts:46-48`), so the animation row is a
historical proposal, not the v4 contract. V4's live actor atlas contract is in
the linked art-direction document. Upstream's `enemy.png` was 512×512 and used **three of its 256 cells**.
Do not reserve space speculatively; add rows as enemy types are actually
authored.

### 3.4 Backgrounds — there is no image, and there is not going to be one

**Backgrounds are fragment shaders.** There is no `bg-*.png`, no tiling texture
and no plan for either. A background is a full-screen quad at `Layer.Background`
running a shader registered with `defineBackground`
(`src/render/background.ts:149`), one scene per file under
`src/v4/backgrounds/`, reaching the game only because
`src/v4/backgrounds/index.ts` imports it and the v4 composition root loads that
index. The old `src/render/backgrounds/index.ts` path is a compatibility entry
point only. Fourteen authored scenes exist. Six are stage/menu places, each its own shader:
`drift`, `expanse`, `stratum`, `surge`, `undertow`, `vault`. Seven more are the
**boss family** — `signet`, `cordon`, `intaglio`, `sable`, `regnum`, `umbra`,
`decree` — each a per-scene near-identical port of a pbakaus/radiant reference
(MIT). `signal-decay` is the terminal game-over/ending scene. The former
`GOLD_GLSL` and `VEIL_GLSL` sibling sharing has been retired: every authored
scene is now standalone, and a structural test forbids scene-to-scene imports.
See [`docs/extending.md` §12](./extending.md#12-adding-a-background-scene),
“One reference, one scene.”

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

| Scene | Constants | Values (`src/v4/backgrounds/`) |
|---|---|---|
| `drift` | deep → lift | `(0.015, 0.022, 0.050)` → `(0.045, 0.075, 0.130)` (`drift.ts:36-37`) |
| `expanse` | haze / sky top / sky lift / ground deep / ground lift | `(0.014, 0.020, 0.044)`, `(0.004, 0.006, 0.014)`, `(0.016, 0.034, 0.055)`, `(0.016, 0.024, 0.050)`, `(0.038, 0.104, 0.152)` (`expanse.ts:82-86`) — `SKY_LIFT`/`GROUND_LIFT` pull the scene toward cyan-ice (R/G ≈0.37), the one deliberate stage-body edit of the seal-family round, closing the hue collision with `drift` |
| `stratum` | haze / deep / lift | `(0.006, 0.014, 0.012)`, `(0.010, 0.022, 0.019)`, `(0.035, 0.082, 0.070)` (`stratum.ts:103-105`) |
| `surge` | base / glow | `(0.030, 0.010, 0.028)` → `(0.130, 0.028, 0.075)` (`surge.ts:40-41`) — the base campaign no longer names this scene (its boss cards name the boss-family scenes instead); kept registered as an extension surface and for temporary pack fixtures |
| `undertow` | haze / wall deep / wall lift | `(0.018, 0.010, 0.030)`, `(0.026, 0.014, 0.044)`, `(0.100, 0.048, 0.150)` (`undertow.ts:86-88`) |
| `vault` | haze / deep / lift | `(0.010, 0.007, 0.002)`, `(0.022, 0.016, 0.005)`, `(0.085, 0.060, 0.018)` (`vault.ts:130-132`) — analytic peak ≈0.079, still pending the live `test:visual`/`dev` measurement the other rows already carry |

Read the magnitudes before proposing anything. The brightest constant in the
game is `0.155`, and it is a *lift* term multiplied by a fraction before it is
added, so it never lands at 0.155 on screen. This is not a stylistic preference
about moodiness; see the constraint below.

There is also a hard ceiling above these numbers. Bloom is on in the shipped game
— `PostProcessing` defaults to disabled (`src/render/post.ts:210`) and `src/main.ts:209`
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

**Bright enough to see, dark enough to play — 亮到能看,暗到能玩.** The play field
has to stay readable on top of the background at all times, but the old fixed
"peak near 0.1" ceiling is RETIRED (see the shader-ports round). `background.ts`'s
header now states the replacement: scenes ship at their ported reference's native
richness with a per-scene `EXPOSURE` constant, structured peaks landing in roughly
the 0.25-0.35 raw band, MEASURED in the acceptance pass rather than prescribed by a
number chosen in advance. If you find yourself losing a bullet against a
background, lower that scene's `EXPOSURE` — the sprite is not the thing to change.

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
| `burst` | `burst` (fx sheet) | `(1, 0.72, 0.38)` | additive |
| `burst.big` | `burst.big` (fx sheet) | `(1, 0.55, 0.3)` | additive |

The last two are **frame-animated** — a single particle whose sprite is a
one-shot strip on the separate fx sheet (§1.4), not a bullet cell. They augment
the scatter above (scatter = sparks thrown off; the strip = the hero flash), fire
on every enemy kill (`burst`) and boss/player death (`burst.big`), and their
`life` equals the strip's `stripLength` so the particle dies exactly as its last
frame finishes. A pack reskins them (or adds its own) through `assets.effects`
(`docs/packs.md`); absent one, the procedural `FX_STRIPS` floor draws.

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
  `32 * p.scale` on both axes (`src/main.ts:449-450`) — the cell size is assumed,
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

### 3.7 v4 engine-owned UI — RGB production master to runtime atlas

The v4 interface layout and ornament atlas are engine-owned presentation. A pack
may still replace the documented life/bomb glyphs, but it does not replace these
six production-derived frames or their composition. Reference, production and
preserved exploration sources are deliberately separate:

| Asset | Role |
|---|---|
| `docs/art/v4/ui-style-lock.png` | high-level composition, linework and negative-space reference; never read by the build |
| `docs/art/v4/ui-production-ornaments-master.png` | accepted generated **1086×1448 RGB green-screen original** for six differentiated component families |
| `docs/art/v4/ui-screen-perimeter-master.png` | preserved generated **1254×1254 RGB green-screen perimeter study**; rejected as a closed runtime frame after live composition review and not read by the build |
| `src/assets/v4/ui-v4.png` | generated **1024×768 RGBA** runtime atlas; never edit it by hand |

The production master yields six text-free ornament cells. Their committed
runtime cells are:

| Cell | Size | Runtime use |
|---|---:|---|
| `ui.title.masthead` | 400×96 | title identity and crest silhouette |
| `ui.menu.row` | 300×50 | normal/selected menu-row frame, alpha-modulated by state |
| `ui.character.frame` | 170×300 | compact frame over the enlarged selected real actor crop |
| `ui.dialogue.frame` | 456×164 | dialogue silhouette and circular portrait well |
| `ui.status.frame` | 300×436 | pause, clear, game-over, ending and result card |
| `ui.boss.ornament` | 440×72 | authored caps/crest behind the compact Boss facts |

Title, Difficulty and Character deliberately have no closed outer panel. Their
masthead, rows, actor frame and sparse anchors establish hierarchy while the live
shader remains part of the composition. The procedural `ui.panel.9slice`
(`48×48`, 12px corners) remains available only for bounded utility backplates;
it is not stretched around those three screens.

They extend rather than replace the original UI vocabulary. Atlas rows 0–255
retain the existing 32 procedural cells — logo, nine-slice, cursor, divider,
focus/graze, HUD icons, crests, difficulty/status seals, compact Boss bars,
nameplate, prompt and assist seal. The lower rows hold the six production-derived
ornaments, for 38 named cells in total. `src/render/v4-ui-layout.ts` is the one
source of truth for their named atlas rectangles and 480×640 display composition.

Build it with:

```sh
bun run make:v4-ui
```

`tools/make-v4-ui.ts` performs the conversion deterministically:

1. Decode the committed RGB production master and sample its median key colour
   from the empty six-pixel outer band; do not assume a hand-typed green.
2. Derive a soft straight-alpha matte from key distance and green dominance,
   then uncomposite RGB against the sampled key. Merely setting green pixels'
   alpha to zero is wrong because it leaves green fringes in partially covered
   edge pixels.
3. Take the six declared component regions from the ornament master and
   centre-crop each to its destination aspect ratio (`cover`). Reject any crop
   that would require upscaling.
4. Area-filter into the atlas in **premultiplied-alpha space**, then return to
   straight RGBA. This keeps antialiased bone-white and pink linework from being
   darkened by transparent green or black.
5. Paint the original 32 procedural cells, add the six converted ornaments and
   encode the complete 1024×768 atlas.

All words remain runtime data. Titles, menu labels, character blurbs, Boss and
phase names, dialogue, counters and third-party pack strings are drawn by
`main.ts`; no source ornament may bake text or a second character portrait.
This preserves arbitrary Unicode and lets the character/dialogue frames surround
the real actor atlas or the established pack portrait fallback.

`tools/v4-ui-atlas.test.ts` pins the production-master hash, regenerates the
committed atlas byte-for-byte, locks the original 256 procedural rows, verifies
all 38 rectangles, and checks each production ornament for transparent space,
fractional antialias coverage and residual key green. The originals manifest
separately byte-locks the retained perimeter study. Those checks establish the
asset pipeline; `bun run dev` is still required to judge crop balance, open
screen composition, text fit and readability over every live shader.

---

## 4. Generating art with an image model

The v4 UI production master is the accepted exception to the single-cell
workflow below: its six declared crops are explicit and deterministic (§3.7),
not an image model's attempted runtime atlas layout.

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

> **Art Kit lifecycle.** The pre-v4 example assets and Art Kit generator are
> retired. There is no current Art Kit command or authoritative template. After
> v4's final visual and asset contracts are locked, redesign the example and Art
> Kit together so the new templates read the final engine sizes and names. Until
> that coordinated rebuild, use the live loader contract in this document and
> `packs/v4` as the source of truth.

### 5.0 The preferred route is a pack — no code edit at all

Before the source-level swap below, know that there is a higher-level one that
needs **no editing of `src/` at all**: drop an [asset pack](./packs.md) into
`packs/`. A pack is a folder with a `pack.json` manifest naming a `bullets.png`
(and optionally a ship, HUD icons and sounds); the loader fetches it, runs the
same dimension, margin and whiteness checks this section describes — in the
browser, against your real pixels — and reports every failure by name. It layers
over the placeholders, needs only a page refresh under `bun run dev`, and is the
right choice for shipping a reskin. Today `packs/v4` is the sole shipped pack;
`packs/example` is README-only until it and the Art Kit are rebuilt from the
final v4 contract.

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
`BulletSystem` through the real v4 emitters in
`src/v4/gameplay/patterns.ts` to a target
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

---

## 8. BulletPack reference import — live surfaces and fidelity audit

The renderer has native strip surfaces for bullets, effects, lasers, missiles,
pickups, the player ship and player effects. The purchased BulletPack reference
import can exercise all seven generated sheets during a local audit. That output
is not retained or shipped. A new Art Kit will be designed after v4 is final; it
will be an authoring starter rather than an inventory of every renderer surface.

### The reference importer — `tools/import-bulletpack.ts`

It produces a **native self-describing strip** pack (not the retired
whiten-and-regrid-to-a-32px-grid form, which took frame 0 and flattened every
source into one cell size). `tools/bulletpack-map.json` declares every logical
frame count explicitly; filename suffixes are not trusted. Every enemy- and
player-bullet row is preserved as a complete looping strip, including rows whose
filenames omit `_stripN`. Directional art is rotated once at import so its
heading is +x (rule 7).

The output is one shared PNG per runtime texture namespace:

| Namespace | Generated sheet | Named strips |
|---|---|---:|
| bullets | `bullets/bullets.png` | 70 (16 tinted floor names + baked campaign/player names) |
| effects | `explosions/explosions.png` | 11 |
| lasers | `lasers/lasers.png` | 11 (8 bodies + 3 caps) |
| missiles | `missiles/missiles.png` | 13 bodies |
| pickups | `misc/pickups.png` | 10 (8 field items + 2 result-card tallies) |
| player ship | `player/ship.png` | 1 five-bank strip |
| player effects | `player/player-effects.png` | 9 (option, 3 thrusters, 2 residues, 3 bombs) |

Several strip records may point at one source PNG through explicit
`src`/`x`/`y`/`stride` metadata (§5.6 of `docs/packs.md`). This keeps each render
batch on one texture without forcing unrelated namespaces, filtering rules or
fallbacks into a single oversized mega-atlas. Legacy one-PNG-per-strip manifests
remain valid when those placement fields are omitted.

The importer emits:

- **`bullets.png` + `assets.bullets: { sheet, strips }`** (§3.1's object form): the
  16 built-in cells as **`tinted`** native strips — whitened to luminance so the
  base campaign's per-instance tint still colour-codes the curtain, animation
  frames kept, each **fit to a coherent per-cell size** so the reskin stays
  readable (a per-cell fit, *not* the retired uniform regrid that dropped
  animation and one-size-flattened all sixteen) — **plus** the coloured designs
  as **`baked`** native strips **keyed by the names the base four-stage campaign
  already fires** (`src/render/procedural.ts` `BULLET_VARIANTS` — `orb.medium.decree`,
  `needle.pin`, …), **pixel-exact** (no whiten, no resample; only lossless crop and
  90° rotation to bring directional art to +x, rule 7 §1.3).

  **A baked strip only reaches real play if its name is one content fires.** The
  base game *is* the unqualified consumer: `nativeBulletAtlas` keeps a pack strip
  named `orb.medium.decree` over the floor-cell alias, so that chancellor bullet
  draws the baked design the moment the pack loads — no companion content pack.
  A baked strip keyed by a name **no** spec fires (the old `oval.teal`-style
  vocabulary) is **dead presentation**: it packs onto the sheet and never draws.
  So the importer maps a baked design **onto a `BULLET_VARIANTS` name**, and only
  where orientation and bullet size fit — directional families (`needle`/`kunai`/
  `scale`, player shots) take elongated art rotated to +x, radial families take
  compact art whose native size stays near a bullet's. The four-stage campaign
  fires 54 baked names: 48 direct mappings plus six fired aliases that reuse
  complete baked BulletPack rows. Five registered compatibility aliases are not fired by the base
  campaign: `needle.lance`, `needle.column`, `halo.seal`, `halo.crown` and
  `glow.small.beam`. They are code aliases, not omitted source files.
- **`assets.effects`**: all eight explosion sources plus the three missile
  detonation strips are reachable through the existing death/detonation tiers.
  Native colour and animation are retained, and every frame is re-padded with a
  transparent margin for the seam gate.
- **`assets.lasers`**: all eight body skins and all three hit caps are named by
  reachable laser specs in the campaign. Body frames carry no longitudinal
  padding; tileable frames extend their boundary texels to both +x edges. The
  short-axis pad remains, with `contentH` carried to rendering so the visible
  band lands at `skin.thickness` rather than shrinking inside its frame.
- **`assets.missiles`**: all thirteen body strips are named by reachable missile
  specs. The three missile explosion sources live on the effects sheet instead.
- **`assets.pickups`**: eight coin/gem/bar loops are reachable as field items;
  both shadowed coins are sampled by the result-card tally.

Its in-tool self-check replicates the loader's browser-only measured gates
headlessly: complete floor-cell coverage, exact strip bounds, independent x/y
transparent margins, non-empty logical frames and mean saturation on tinted
strips. Source images sharing a generated sheet are decoded once, and the
runtime loader likewise deduplicates fetch/decode/hash work by URL.

The source inventory is explicit in `extra/extras.json`: **117 PNG files** plus
four non-art/junk files were inspected; all **117 PNGs have named runtime
consumers** and **0 PNGs are staged**. `Bermuda_Medium copy.png` is byte-identical
to the consumed `Bermuda_Medium.png`, so it is represented without packing
duplicate pixels. The ten `Player Ship/` images are live too: the ship is the
v4 heroine's compact back-wing/core layer and explicitly declares five-way
banking semantics, while the option, three thrusters, two residue strips and
three bomb strips use the player-effects atlas.

### What “consumed” does and does not prove

File-level accounting is complete, but that is not the same as a source-faithful
visual sign-off. The remaining audit items are deliberately recorded instead of
being hidden behind the 117/117 number:

- Twelve floor sources currently contribute whitened/resampled projections to
  tintable built-in bullet cells; their original RGB and exact authored framing
  are not independently reachable as baked variants.
- `Medium_Gradius2.png` reaches the `kunai` floor projection but has no bare
  runtime consumer that displays its original coloured strip.
- The result-card gold/silver tally currently samples frame 0; the remaining
  coin animation frames are present in the atlas but not shown there.
- The terminal frame of `P1_Bullet_Hit.png` can fall outside the short spark
  lifetime, depending on the effect consumer.
- Laser-body geometry is now corrected mechanically: generated frames fill the
  longitudinal axis, preserve short-axis padding, and compensate that padding
  at draw time. Browser inspection remains the final rendering check, not an
  unimplemented atlas task.
- Some directional sources carry large transparent cells. Drawing by full cell
  bounds preserves safety but can make their painted blade/needle content look
  smaller than the intended gameplay silhouette.

These are presentation/fidelity tasks, not missing files. Do not describe the
pack as visually complete until they pass the browser audit.

### Provenance and local use

Product: **16Bit Bullets, Explosions & Misc Asset Pack** by **J i m**
(`jinvorionstg` on itch.io). The user confirmed the purchase on 2026-07-20, and
the product-page terms allow commercial project use. That permission does not
grant redistribution of the purchased source sprites, so the generated
`packs/bulletpack/` tree is generated only on demand, remains gitignored, and is
removed after the local audit; the committed importer and semantic map can
reproduce it from the purchaser's copy.

When no explicit `?pack=` is supplied, project-owned `v4` is the default; a
temporarily regenerated `bulletpack` is only the purchaser-local fallback when
v4 is absent. An explicit query remains authoritative, so `?pack=bulletpack` or
another deliberately added local pack still wins when intentionally requested.
The README-only `packs/example` workspace has no manifest and cannot be selected.
