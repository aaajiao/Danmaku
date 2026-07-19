# Extending the engine

How to add content without editing the engine. Every extension point is a
registry: you write a file, register a named thing, and import it.

Read [`CLAUDE.md`](../CLAUDE.md) first — the hard rules there are not style
preferences, and §7 of this document lists the ones you can break silently.

| You want to add | Call | In |
|---|---|---|
| A bullet | (no registry — a `BulletSpec` value) | `src/sim/bullet.ts` |
| A danmaku pattern | `definePattern` | `src/content/patterns.ts` |
| Motion the polar model cannot express | `defineBehaviour` | `src/sim/motion.ts` |
| An enemy | `defineEnemy` | `src/sim/enemy.ts` |
| A particle effect | `defineEffect` | `src/sim/effects.ts` |
| A sprite region | `Atlas.define` / `Atlas.defineGrid` | `src/render/atlas.ts` |
| A render layer | a `Layer` constant | `src/render/stage.ts` |

Two facts about registries that will bite you before anything else does:

- **They throw on duplicate names.** `definePattern({ name: 'ring' })` twice is
  an error at import time, not a silent overwrite. Tests that register their own
  entries must namespace them — see the `NS` constant in
  `src/content/patterns.test.ts`.
- **Registration happens on import.** A `BulletSpec` naming
  `behaviour: 'homing'` throws at *spawn* time if nothing imported the module
  that registered it. Import content modules for their side effects from wherever
  you assemble a stage.

Content is referenced **by name, never by index**, so repacking an atlas or
reordering a table cannot repoint at the wrong thing.

### Where files go

`src/sim/` and `src/content/` must not import from `src/render/`. The one
allowed exception is a **type-only** import — `src/sim/effects.ts` does
`import type { BulletCell } from '../render/procedural'` so a renamed cell fails
the build, while keeping zero runtime dependency on the renderer. Anything
`import type` is erased; anything else is a layering violation.

---

## 1. Adding a bullet type

A bullet is a plain `BulletSpec` value. There is no registry — you export the
const and reference it from patterns.

```ts
import type { BulletSpec } from '../sim/bullet';

export const iceOrb: BulletSpec = {
  style: { sprite: 'orb.medium', r: 0.45, g: 0.75, b: 1 },
  radius: 4,
  motion: { r: 1.6, theta: 90 },
};
```

`style.sprite` is an atlas cell name (§4). `r/g/b/a` are a per-instance tint in
0..1, multiplied with the texel — the sheet is white, so this is where colour
comes from.

### Hitbox radius is not sprite size

This is the single most important number in the file, and it is deliberately
unrelated to how big the bullet looks:

| | Typical value |
|---|---|
| Sprite cell | **32 × 32** px |
| Drawn size | 16–30 px |
| `radius` (lethal) | **3–4** px |
| Player `radius` | **2.5** px |

The gap *is* the genre. The player reads the bright core and threads gaps that
look impossible, and a `radius` set to half the sprite width turns a fair
pattern into an unreadable one. Set `radius` from the visual core, not the
silhouette. `style.width` / `style.height` change the drawn size and nothing
else; collision never reads them.

### Orientation and spin

```ts
export const emberNeedle: BulletSpec = {
  style: {
    sprite: 'needle',
    r: 1, g: 0.5, b: 0.25,
    additive: true,
    orientToHeading: true,
    width: 30,
    height: 10,
  },
  radius: 3,
  motion: { r: 3.2 },
  life: 240,
  damage: 1,
};
```

`orientToHeading` rotates the sprite to match `vector.theta`, and heading 0° is
**+x**, so the art must point right (CLAUDE.md rule 6). `spin` adds a constant
rotation in radians/tick instead. They are mutually exclusive — `BulletSystem.step`
takes `orientToHeading` first and ignores `spin` when both are set.

**`style.additive` is a declaration, not a mechanism.** Blending is a material
property, so it is decided by *which batch* the bullet is drawn into. The
current render loop in `src/main.ts` routes on `faction` and never reads
`style.additive`. A bullet that must glow needs an additive batch and a renderer
that sends it there — see §5.

### Lifetime

A bullet despawns when any of these is true: `life` ticks elapse (omit for
"until offscreen"), it leaves the field by more than `bounds.margin`, or
`bounceCount` exceeds `maxBounces`.

```ts
export const ricochet: BulletSpec = {
  style: { sprite: 'kunai', r: 0.6, g: 1, b: 0.8, orientToHeading: true },
  radius: 3,
  motion: { r: 2.6 },
  bounce: true,
  maxBounces: 3,
};
```

### Timelines

`timeline` overrides `motion` after the first segment falls due. Counts are
ticks measured from the start of the timeline (or from the last `jump`).

```ts
/** Fires outward, brakes, then falls straight down. */
export const hesitantScale: BulletSpec = {
  style: { sprite: 'scale', r: 0.85, g: 0.8, b: 1, spin: 0.05 },
  radius: 4,
  motion: { r: 3 },
  timeline: [
    { count: 24, motion: { r: 0.15, theta: 90 } },
    { count: 60, motion: { r: 0.4, ra: 0.05, theta: 90, rrange: { max: 3.5 } } },
  ],
};
```

**A segment re-initialises the vector; it does not patch it.** `MotionTimeline`
calls `MoveVector.init(segment.motion)`, which resets every field to its default
before applying the params. Omitting `theta` does not preserve the current
heading — it snaps to the default **90 (down)**. That is often exactly what you
want, as above, but it is never what you expected the first time. Restate
`theta` in every segment where the heading matters.

`{ count, jump }` loops the timeline back to a segment index. The runner has a
64-iteration guard per tick, so a zero-length loop stalls rather than hangs.

---

## 2. Adding a danmaku pattern

A pattern is a factory. `create(options)` runs once when an emitter is built and
returns a closure called once per tick. Return `false` to retire the emitter;
anything else keeps it alive.

```ts
import { definePattern, fan, aimAngle } from './patterns';
import type { BulletSpec } from '../sim/bullet';

interface LatticeOptions {
  spec: BulletSpec;
  count?: number;
  period?: number;
  jitter?: number;
  growth?: number;
  duration?: number;
}

definePattern({
  name: 'lattice',
  description: 'Aimed fan with a jittered centre and a spread that widens each volley.',
  create(options) {
    const o = options as unknown as LatticeOptions;
    const count = o.count ?? 7;
    const period = o.period ?? 40;
    const jitter = o.jitter ?? 6;
    const growth = o.growth ?? 6;
    const duration = o.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;

      const centre = aimAngle(context) + context.rng.range(-jitter, jitter);
      fan(context, o.spec, count, centre, 20 + volley * growth);
      volley++;
      return true;
    };
  },
});
```

Per-tick state (`volley`) lives in the closure, so two emitters running the same
pattern never share it. The `options as unknown as T` cast is the house pattern:
options arrive as `Readonly<Record<string, unknown>>` because the registry cannot
know your shape.

### The EmitContext

| Field | Meaning |
|---|---|
| `age` | Ticks since the emitter started. Your clock — never `Date.now()`. |
| `x`, `y` | Emitter position. |
| `targetX`, `targetY` | Who to aim at. |
| `bullets` | The `BulletSystem` to spawn into. |
| `rng` | **The generator to draw from.** |
| `faction` | `'player'` or `'enemy'`. |

### Primitives, and spawning by hand

`ring(context, spec, count, offsetDeg)` and
`fan(context, spec, count, centreDeg, spreadDeg)` cover most cases.
`aimAngle(context)` gives the angle to the target in degrees.

When you need per-bullet control, spawn directly and set the vector:

```ts
definePattern({
  name: 'whip',
  description: 'A single lash of bullets whose speed ramps along the arc.',
  create(options) {
    const o = options as unknown as { spec: BulletSpec; length?: number; arc?: number };
    const length = o.length ?? 24;
    const arc = o.arc ?? 90;

    return (context) => {
      if (context.age >= length) return false;

      const bullet = context.bullets.spawn(
        context.x, context.y, o.spec, context.faction, context.rng,
      );
      if (!bullet) return true;   // pool at its ceiling — never assume a spawn

      const t = context.age / length;
      bullet.vector.theta = aimAngle(context) - arc / 2 + arc * t;
      bullet.vector.r *= 0.6 + t * 0.8;
      return true;
    };
  },
});
```

`spawn` returns `undefined` when the pool is capped, and it increments
`droppedSpawns`. Handle it. `ring` and `fan` already bail out on the first
refusal.

### Why patterns must draw only from `context.rng`

Not "should" — must, for two separate reasons.

1. **`Math.random()` cannot be seeded**, so one call anywhere in the sim makes
   every replay worthless. `src/core/random.test.ts` traps `Math.random` and
   fails if the generator reaches for it; nothing traps *your* file, so this one
   is on you.
2. **The module-level `sim` import is not the same thing as `context.rng`.**
   Emitters are handed a generator, and tests hand them a private `Random` so a
   pattern can be exercised in isolation. A pattern that closes over `sim`
   still runs, still looks deterministic, and quietly couples itself to global
   state — it will drift the moment anything else draws.

RNG *call order* is part of the contract. Adding a draw, or moving one across a
spawn, changes every subsequent value even at the same seed. Note that
`BulletSpec.motion` with `rrandom` / `trandom` / `wrandom` consumes draws at
spawn time, in exactly that order, before your pattern's next call.

Pin it down with a test:

```ts
import { test, expect } from 'bun:test';
import { Random } from '../core/random';
import { BulletSystem } from '../sim/bullet';
import { Emitter } from './patterns';

function run(seed: number): string {
  const rng = new Random(seed);
  const bullets = new BulletSystem({
    bounds: { width: 480, height: 480, margin: 48 },
    initial: 512,
    max: 512,
  });
  const emitter = new Emitter('lattice', 240, 90, 'enemy', { spec: iceOrb });

  for (let tick = 0; tick < 180; tick++) {
    emitter.step(bullets, 240, 400, rng);
    bullets.step(240, 400, rng);
  }
  return bullets.bullets.map((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)}`).join('|');
}

test('lattice is reproducible from its seed', () => {
  expect(run(12345)).toBe(run(12345));
  expect(run(12345)).not.toBe(run(54321));
});
```

---

## 3. Adding a motion behaviour

`MotionParams` covers polar velocity with two derivatives, clamps, gravity and
reflection. When a motion cannot be written that way — homing, splines, noise
fields — register a behaviour. It runs at the end of every `MoveVector.step`,
after the derivatives and clamps have been applied.

```ts
import { defineBehaviour } from '../sim/motion';

const DEG = 180 / Math.PI;

defineBehaviour('homing', (vector, context) => {
  const rate = vector.options['rate'] ?? 2.5;
  const delay = vector.options['delay'] ?? 20;
  const window = vector.options['window'] ?? 90;

  // A bullet that homes forever is unavoidable, not hard. Give the player a
  // window to dodge into.
  if (context.age < delay || context.age >= delay + window) return;

  const desired =
    Math.atan2(context.targetY - context.y, context.targetX - context.x) * DEG;

  // Shortest signed turn, wrapped into (-180, 180]. `theta` accumulates without
  // bound when `w` is set, so a naive difference can be thousands of degrees.
  const delta = ((((desired - vector.theta) % 360) + 540) % 360) - 180;
  vector.theta += Math.max(-rate, Math.min(rate, delta));
});
```

Used from a spec:

```ts
export const seeker: BulletSpec = {
  style: { sprite: 'kunai', r: 1, g: 0.6, b: 0.2, orientToHeading: true },
  radius: 3,
  motion: {
    r: 2.2,
    behaviour: 'homing',
    options: { rate: 2, delay: 24, window: 120 },
  },
  life: 420,
};
```

Notes that are easy to get wrong:

- **`options` is `Record<string, number>` and reads come back
  `number | undefined`** under `noUncheckedIndexedAccess`. The `?? default` is
  not optional politeness; it is how the code compiles.
- **`context.age` is ticks since the current *segment* began**, not since the
  bullet spawned. A timeline segment re-inits the vector and resets it.
- **`context.targetX/targetY` are whatever the caller passed to
  `BulletSystem.step`** — usually the player. A behaviour does not get to look
  anything up.
- **Behaviours are looked up at `init`, by name, and throw if unknown.** Import
  the module that registers them before spawning.
- **`rate` is degrees per tick**, like everything else. Never per second.

The third argument is the generator, for behaviours that need randomness:

```ts
defineBehaviour('waver', (vector, context, rng) => {
  const amount = vector.options['amount'] ?? 1.5;
  const period = vector.options['period'] ?? 8;
  if (context.age % period !== 0) return;
  vector.theta += rng.range(-amount, amount);
});
```

This is the sim stream. Every draw shifts the sequence for everything after it,
so a behaviour that draws every tick on every bullet is a determinism hazard
even though it is perfectly reproducible — gate it on a period, as above.

---

## 4. Adding art

[`docs/assets.md`](./assets.md) is the full specification. The parts that matter
when you are writing code:

### Bullet art is white, tinted per instance

One greyscale shape serves every colour in the game:

```ts
{ sprite: 'orb.medium', r: 0.45, g: 0.75, b: 1 }   // ice blue
{ sprite: 'orb.medium', r: 1, g: 0.4, b: 0.35 }    // ember red
```

Upstream baked each colour into its own cell and never used its per-vertex
colour channel as a tint at all — ten enemy bullet types were ten separately
coloured cells. Tinting means a designer retunes a whole pattern's palette
without asking for new art, and it is why the sheet is 256×64 rather than
1024×512. Draw with **luminance and alpha only**; a bullet drawn blue can never
be made red.

### The grid convention

`src/render/procedural.ts` generates the placeholder sheet and *is* the
reference implementation: 32×32 cells, 8 columns × 2 rows, row-major, ≥2px
transparent margin inside every cell.

To add a cell, add its name to `BULLET_CELLS` and a painter to `PAINTERS`.
`PAINTERS` is typed `Record<BulletCell, …>`, so adding the name without the
painter fails the build:

```ts
// in src/render/procedural.ts
function teardrop(ctx: Ctx, cx: number, cy: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx + 13, cy);
  ctx.quadraticCurveTo(cx - 4, cy - 9, cx - 13, cy);
  ctx.quadraticCurveTo(cx - 4, cy + 9, cx + 13, cy);
  ctx.fill();
}
```

Adding a 17th name overflows the 8×2 sheet — bump `BULLET_ROWS` with it.

### Named regions, for anything not on the grid

```ts
export const PROP_GRID: GridSpec = { cellW: 48, cellH: 48, gapX: 2, gapY: 2 };

export function definePropAtlas(texture: THREE.Texture): Atlas {
  const atlas = new Atlas(texture, 256, 128, PROP_GRID);
  atlas.defineGrid(['turret.idle', 'turret.fire', 'pod.idle', 'pod.fire']);
  atlas.define('banner', { x: 0, y: 96, w: 200, h: 24, pivotX: 0, pivotY: 0.5 });
  return atlas;
}
```

`defineGrid` names cells in row-major order and an empty string skips one.
`Atlas.get` throws on an unknown name, so a typo fails loudly at the draw call
rather than sampling garbage.

Swapping the generated sheet for a real PNG changes one line:

```ts
const atlas = await loadAtlas(
  new URL('../assets/bullets.png', import.meta.url).href,
  BULLET_GRID,
);
atlas.defineGrid([...BULLET_CELLS]);
```

`loadTexture` sets `NEAREST` filtering, right for pixel art; the procedural
atlas overrides to `LINEAR` because generated gradients are smooth. `LINEAR` is
what makes the 2px cell padding non-negotiable.

**`pivotX` / `pivotY` are carried on `Region` but `SpriteBatch` does not apply
them yet** — every sprite draws centred on its position. Offset the draw call
yourself, or implement the pivot in `SpriteBatch.draw`; do not assume the field
is read.

---

## 5. Adding a render layer

Depth testing is off for sprites, because the play field is coplanar. Draw order
is therefore explicit, and lives in `src/render/stage.ts`:

```ts
export const Layer = {
  Background: 0,
  BackgroundProps: 100,
  Enemies: 200,
  Items: 300,
  Player: 400,
  PlayerShots: 500,
  EnemyShots: 600,
  Effects: 700,
  Foreground: 800,
  Overlay: 900,
} as const;
```

Values are spaced by 100 so a new layer slots in without renumbering. Upstream
got its ordering implicitly, from the sequence of calls inside
`StageState._displayElements` — which works right up until you want to insert
something, and then the ordering lives in the middle of a method nobody wants to
touch.

Three ways to place an object, all equivalent:

```ts
stage.add(mesh, 'Effects');                    // named layer
stage.add(mesh, 'Overlay', 10);                // named layer + offset
stage.add(mesh, Layer.EnemyShots - 50);        // raw order, between two layers
```

To insert permanently, add a constant. Between `PlayerShots` (500) and
`EnemyShots` (600):

```ts
export const TRAIL_ORDER = Layer.EnemyShots - 50;

export function addTrailBatch(stage: Stage, atlas: Atlas): SpriteBatch {
  const trails = new SpriteBatch(atlas, {
    capacity: 2048,
    blending: 'additive',
    renderOrder: TRAIL_ORDER,
  });
  stage.add(trails.mesh, TRAIL_ORDER);
  return trails;
}
```

`stage.add` writes `renderOrder` onto the mesh, so it is the authority — the
`renderOrder` in `SpriteBatchOptions` only matters for a mesh you add to the
scene yourself. Passing both, as above, keeps the two from drifting. Passing
neither leaves the mesh at 0, drawing behind the background.

Two constraints on batching:

- **One `SpriteBatch` per layer *and* blend mode.** Each batch is one instanced
  draw call, and blending is a material property — additive and normal sprites
  in one batch is not expressible.
- **`renderer.sortObjects` must stay `true`.** `renderOrder` is read only by
  three.js's render-list comparators, which `sortObjects = false` skips
  entirely. Turn sorting off and draw order silently degrades to scene-graph
  insertion order, making every `Layer` value decorative. This does not
  reintroduce depth sorting: `renderOrder` is the comparators' first key, so z
  is only ever a tie-break within a layer.

Do not add `depthTest` to a sprite material to fix an ordering problem. Fix the
order.

---

## 6. Adding 3D content

This is where the project is going, and it is the reason the renderer is
three.js rather than the raw WebGL it came from. `Stage` already carries a
perspective camera set up in the same space as the sprites.

### The 3D coordinate space

`Stage.camera3D` is deliberately aligned with the sprite field, so you can
position 3D objects in the same numbers content is authored in:

| | |
|---|---|
| FOV | 60° |
| Position | `(width / 2, height / 2, -600)` |
| `up` | `(0, -1, 0)` — y-down, matching sprite space |
| Looks at | `(width / 2, height / 2, 0)` |
| near / far | 1 / 2000 |

Consequences worth internalising:

- **+y is down**, for meshes too. A mesh at `y = stage.height` sits at the
  bottom edge of the field.
- **+z recedes.** The camera sits at `z = -600` looking toward `+z`. Sprites are
  drawn at `z = 0`, so scenery *behind* the play field has `z > 0` and anything
  meant to pass in front has `z < 0` (down to `-599`, where near clipping
  starts).
- **The y-flip reverses triangle winding.** Every custom material must set
  `side: THREE.DoubleSide` or its front faces are culled. This presented once as
  a completely black field with no console error, and it will again
  (CLAUDE.md rule 5).

### Keeping 3D and sprites apart

`Stage` holds one scene and `render(perspective)` picks one camera for all of
it. Sprites need the orthographic camera; a ground plane needs the perspective
one. The mechanism that separates them is three.js's **camera layer channels** —
`Object3D.layers`, a 32-bit visibility mask tested per camera in
`WebGLRenderer.projectObject`.

> **Naming trap.** `Object3D.layers` (three.js visibility) and our `Layer`
> constants (draw order) are unrelated concepts that share a word. Objects
> default to channel 0 and cameras to channel 0, which is why everything works
> today without anyone touching either.

```ts
/** three.js camera channel. Unrelated to `Layer` — that is draw order, this is visibility. */
export const SCENERY_CHANNEL = 1;

export function addGroundPlane(stage: Stage): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(2000, 4000, 20, 40);
  const material = new THREE.MeshBasicMaterial({
    color: 0x1b2a4a,
    wireframe: true,
    side: THREE.DoubleSide,   // y-down reverses winding — rule 5
    depthTest: true,
    depthWrite: true,
  });

  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = Math.PI / 2;                          // lie flat in XZ
  ground.position.set(stage.width / 2, stage.height + 140, 900);
  ground.layers.set(SCENERY_CHANNEL);                       // ortho camera stops seeing it

  stage.camera3D.layers.set(SCENERY_CHANNEL);               // and it stops seeing sprites
  stage.add(ground, 'Background');
  return ground;
}
```

Those position numbers are a starting point, not a result. Framing a perspective
plane is not something you can typecheck — run `bun run dev` and tune it.

### The two-pass render

```ts
export function renderWithScenery(stage: Stage): void {
  const { renderer } = stage;

  renderer.autoClear = false;
  renderer.clear();

  stage.depthEnabled = true;
  stage.render(true);          // perspective pass: scenery only

  renderer.clearDepth();       // sprites must not be occluded by the floor
  stage.depthEnabled = false;
  stage.render(false);         // orthographic pass: sprites over the top
}
```

`autoClear = false` is what stops the second pass wiping the first.
`clearDepth()` between passes is what stops a ground plane at `z = 900` from
depth-rejecting sprites at `z = 0`.

**`stage.depthEnabled` is intent, not enforcement.** It flips the shared GL
depth state, but three.js re-applies `material.depthTest` and `material.depthWrite`
per material inside `setMaterial` on every draw. What actually governs is the
material: sprite materials hard-code `depthTest: false`, so sprites composite by
`renderOrder` no matter what the flag says, and your mesh occludes other meshes
only if *it* sets `depthTest: true`. Set both.

### Lights

Lights are `Object3D`s and are filtered by the same channel mask
(`object.isLight && object.layers.test(camera.layers)`). A light left on the
default channel contributes nothing to a perspective pass whose camera is on
channel 1 — the mesh renders black and there is no warning.

```ts
export function addLitProp(stage: Stage, mesh: THREE.Mesh): void {
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(0, -400, -300);
  light.layers.set(SCENERY_CHANNEL);   // or the perspective pass cannot see it
  mesh.layers.set(SCENERY_CHANNEL);
  stage.scene.add(light);
  stage.add(mesh, 'BackgroundProps');
}
```

`MeshBasicMaterial` needs no lights and is the right default for scenery that is
only ever a backdrop.

### Animating 3D content

3D scenery is view-only, so it is one of the few places `alpha` belongs — but
its clock is still the tick count, never wall time:

```ts
export function scrollGround(ground: THREE.Mesh, tick: number, alpha: number): void {
  const material = ground.material as THREE.MeshBasicMaterial;
  const map = material.map;
  if (map) map.offset.y = ((tick + alpha) * 0.004) % 1;
}
```

`Loop.render(alpha)` supplies the interpolation factor and `Loop.count` the
tick. Driving scenery from `performance.now()` instead makes the background
speed vary with refresh rate — the exact bug the fixed-timestep loop exists to
prevent, showing up in the one layer where nobody thinks to look for it.

**If 3D content ever feeds back into gameplay** — a mesh that occludes a
hitbox, a camera shake that moves the player — it stops being scenery and the
rules change. It must then run in `tick()`, draw from `sim`, and take no `alpha`.

---

## 7. Invariants you can break without noticing

None of these produce an error. Each produces a game that is subtly, silently
wrong, usually on someone else's machine.

**No delta-time in the simulation.** Every speed is px/tick, every rate is
per-tick. `tick()` is not handed a delta and must never derive one. A pattern
that reaches for `performance.now()` or scales by a frame time runs at a
different speed on a 144Hz display, and its replays stop reproducing. The only
legal use of real time is `alpha`, in `render()`, in the view layer.

**Seeded RNG only, in call order.** `Math.random()` must not appear anywhere in
`src/sim/` or `src/content/`. Draw from `context.rng` (patterns) or the passed
generator (behaviours), never the module-level `sim` import — a pattern that
closes over `sim` cannot be tested in isolation and couples to global state.
Adding, removing or reordering a draw changes every subsequent value at the same
seed. Remember that `rrandom` / `trandom` / `wrandom` on a spec consume draws at
spawn time, in that fixed order.

**Cosmetics come from `fx`, never `sim`.** Particles, screen shake, debris
scatter. Upstream drew effect scatter from its one global generator, so adding a
single particle shifted every subsequent bullet and desynced every replay. The
defence here is structural — `EffectSystem` exposes no parameter through which a
caller could hand it the sim stream — but a new system you write has no such
protection unless you build it in. If a value can be seen but not collided with,
it belongs on `fx`.

**Draw order is explicit.** Sprites keep `depthTest: false` and composite by
`renderOrder`. Do not fix a layering problem by enabling depth on a sprite
material, and do not set `renderer.sortObjects = false` — that silently reduces
every `Layer` constant to decoration.

**Content references names, not indices.** Atlas cells, patterns, behaviours,
enemies, effects. An index survives a repack and points at the wrong art; a name
throws.

**Rotating art points +x.** Anything with `orientToHeading` is rotated to match
its heading and 0° is east. Art ported from upstream, which pointed up, needs a
90° rotation.

**`side: THREE.DoubleSide` on every custom material.** The y-down projection has
a negative Y scale and reverses winding. Front faces get culled and you get a
black screen with a clean console.

---

## 8. Before you call it done

```
bun run typecheck     # tsc --noEmit
bun test
bun run build
```

Green means you ran it and saw it. Additionally:

- **Touched the sim, motion DSL, RNG, input or content data?** Run the replay
  regression. A change that alters replay output is either a bug or a deliberate
  divergence — say which in the commit message.
- **Touched rendering?** `bun run dev` and confirm the field actually draws.
  Both rendering bugs found so far — reversed winding, and a spatial-hash
  collision — passed the type checker and logged nothing.
- **Added bullet art?** Look at 500 of them on screen at once. Art that reads
  beautifully in isolation turns into soup at real density, and that is the only
  test that catches it.
