# Image assets — specification and generation guide

This is the brief for producing art for this game, whether by hand or with an
image model. It is a spec, not a mood board: the numbers are load-bearing, and
the engine will render nonsense if they are wrong.

Read [`CLAUDE.md`](../CLAUDE.md) rule 6 first. Upstream's art is Touhou Project
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

### 1.2 Every cell is padded

Textures sample without smoothing at their edges, and a sheet with shapes
touching their cell boundaries will bleed neighbouring cells into each other
along the seams. Upstream had no padding and no half-texel inset at all — it got
away with it because it used `NEAREST` filtering everywhere.

**Keep at least 2px of fully transparent margin inside every cell.** A 32×32
cell should contain art no larger than 28×28, centred.

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
| Play field | **480 × 480** px |
| Full frame | **640 × 480** px (right 160px is the HUD sidebar) |
| Origin | top-left, **y increases downward** |
| Units | 1 world unit = 1 pixel |
| Depth | disabled; order is explicit via layers |

Art is authored at **final display size**. There is no global scale factor.
A 32px bullet occupies 32 of the field's 480 pixels — about 6.7% of its width.

---

## 3. Sheet specifications

### 3.1 Bullet sheet — `bullets.png`

The engine currently generates this procedurally at runtime
(`src/render/procedural.ts`). That generator **is** the reference
implementation: a replacement PNG must match its grid exactly, and then
`createBulletAtlas()` is swapped for `loadAtlas('bullets.png', BULLET_GRID)`
with nothing else changing.

| Property | Value |
|---|---|
| Image size | **256 × 64** |
| Cell size | **32 × 32** |
| Grid | **8 columns × 2 rows** = 16 cells |
| Colour | white / greyscale on transparent |
| Padding | ≥ 2px transparent inside each cell |
| Format | PNG, RGBA, 8-bit |

Cells in row-major order. Names are the contract — content references
`'orb.medium'`, never index 1 — so re-packing the sheet cannot silently
repoint a bullet at the wrong art.

| # | Name | Intent | Rotates |
|---|---|---|---|
| 0 | `orb.small` | 10px soft round shot, the workhorse | no |
| 1 | `orb.medium` | 16px round shot | no |
| 2 | `orb.large` | 26px heavy round shot | no |
| 3 | `ring` | hollow ring, reads through dense fire | no |
| 4 | `kunai` | leaf-shaped blade, 26×9 | **yes** |
| 5 | `scale` | short diamond, 20×12 | **yes** |
| 6 | `star` | 5-point star | no (spins) |
| 7 | `shard` | long thin diamond, 26×7 | **yes** |
| 8 | `glow.small` | soft halo, no hard core | no |
| 9 | `glow.medium` | soft halo | no |
| 10 | `glow.large` | soft halo, 30px | no |
| 11 | `halo` | thin hollow ring | no |
| 12 | `needle` | long slim blade, 28×5 | **yes** |
| 13 | `petal` | asymmetric leaf | **yes** |
| 14 | `spark` | 4-point star | no (spins) |
| 15 | `mote` | 6px dust, for trails | no |

**Readability is the whole job.** A danmaku screen holds hundreds of
simultaneous bullets over a moving background, and the player must parse
them instantly. Two demands that pull against each other:

- **A hard, high-contrast core** so position is unambiguous. The lethal hitbox
  is far smaller than the sprite, and the player reads the *centre*, not
  the silhouette.
- **A soft outer falloff** so a dense curtain does not turn into a solid mass.

The procedural generator resolves this with a radial gradient: opaque to ~45%
of the radius, then falling to zero by the edge. Match that energy distribution
even where the shape differs.

### 3.2 Player ship — `ship.png`

| Property | Value |
|---|---|
| Image size | **64 × 64** |
| Displayed at | ~40 × 40 |
| Orientation | **pointing up (−y)** — the ship does not rotate |
| Colour | white/greyscale preferred, tinted for damage flash |

Must include a **visually distinct centre point** marking the hitbox. This is
not a debug affordance — showing the hitbox is standard genre practice and a
real readability feature, because the ship sprite is many times larger than the
2.5px lethal radius.

If you want animation frames later, extend to a `32 × 48` grid: row 0 idle
(8 frames), row 1 banking left (4), row 2 banking right (4). That is the shape
upstream used and it works; it just does not exist yet.

### 3.3 Enemies — `enemies.png`

Not yet implemented. When it is:

| Property | Value |
|---|---|
| Cell size | **48 × 48** (upstream used 32×32; we have the fill rate) |
| Grid | 8 columns × N rows, one row per enemy type |
| Animation | 4 frames per row, advancing every 5 ticks |
| Orientation | facing down (toward the player) |

Upstream's `enemy.png` was 512×512 and used **three of its 256 cells**. Do not
reserve space speculatively — add rows as enemy types are actually authored.

### 3.4 Backgrounds — `bg-*.png`

| Property | Value |
|---|---|
| Image size | **512 × 512** |
| Tiling | **seamless on both axes** — hard requirement |
| Colour | full colour |

Backgrounds are tiled across a receding ground plane (upstream: 4× horizontally,
10× vertically, on a plane pitched 50° under a 60° perspective camera). Any
visible seam repeats across the whole field and is extremely obvious in motion.

Because the plane recedes, the texture is sampled at wildly varying scale — near
the horizon many texels collapse into one pixel. Avoid fine high-contrast detail
that will alias into shimmer. Broad forms, low contrast, no thin lines.

### 3.5 Effects — currently procedural, and that is a decision

Upstream's entire VFX vocabulary was **white rings and white discs at varying
alpha**, drawn into an offscreen canvas at runtime. None of it came from an
image file, which means its art direction could not reach its own effects layer
at all.

We generate effects the same way, deliberately: procedural rings scale to any
size without resolution loss, cost nothing to store, and can be re-tinted freely.

**If you want effects to carry a visual identity, that is a code change in
`src/render/procedural.ts`, not an art request.** Say so explicitly rather than
supplying PNGs that nothing will load.

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
  beautiful in isolation turns into unreadable soup.

---

## 5. Adding a sheet to the engine

```ts
import { loadAtlas } from './render/atlas';
import { BULLET_GRID, BULLET_CELLS } from './render/procedural';

const atlas = await loadAtlas(
  new URL('../assets/bullets.png', import.meta.url).href,
  BULLET_GRID,
);
atlas.defineGrid([...BULLET_CELLS]);
```

Then hand it to a `SpriteBatch` exactly as the procedural atlas is handed over
today. Nothing else changes — that is the point of naming the cells.

For non-grid art, name regions explicitly:

```ts
atlas.define('ship', { x: 0, y: 0, w: 64, h: 64 });
atlas.define('ship.hit', { x: 64, y: 0, w: 64, h: 64 });
```

Textures load with `NEAREST` filtering by default, which is right for pixel art
and wrong for smooth generated art. `loadTexture` sets `NEAREST`; the procedural
atlas overrides to `LINEAR`. Match the filter to the art, and be aware that
`LINEAR` is what makes cell padding non-negotiable.

---

## 6. Checklist

Before adding any sheet:

- [ ] Original work — not derived from Touhou or any other existing game
- [ ] Anything that will be tinted is white/greyscale, shaped by luminance and alpha
- [ ] ≥2px transparent padding inside every cell
- [ ] Rotating shapes point **right** (+x)
- [ ] Non-rotating shapes read correctly upright
- [ ] Backgrounds tile seamlessly on both axes
- [ ] RGBA, 8-bit PNG, alpha channel actually present
- [ ] Cell names registered, and content references names rather than indices
- [ ] Tested at real density (500+ on screen), not in isolation

That last one is the one people skip, and it is the one that decides whether the
game is playable.

---

## 7. What upstream's art set teaches

Worth knowing, since its sheets are sitting in `toho-like-js/` for reference:

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
