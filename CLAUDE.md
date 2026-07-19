# Danmaku

A bullet-hell (danmaku) shooter built on three.js.

Its starting point is [toho-like-js](https://github.com/takahirox/toho-like-js) by
takahirox — a raw-WebGL Touhou-style shooter, vendored here at commit `8ff780d`
(2017-06-13). This project is **not** a port. Upstream is a reference
implementation and a source of proven mechanisms; the destination is our own game.

## Repository layout

```
src/core/       loop, input, seeded RNG, object pool
src/sim/        motion DSL, collision, bullets, enemies, player, effects, replay
src/render/     three.js: sprite batching, atlases, layered stage, post-processing
src/content/    danmaku patterns, stage definitions
src/audio/      sound registry
docs/           asset specification, extension guide
toho-like-js/   frozen upstream baseline — READ-ONLY, never edit
```

`src/sim/` and `src/content/` must not import from `src/render/`. The simulation
is engine-agnostic by construction, which is what makes it testable headlessly and
reproducible. If you find yourself wanting a renderer type in a sim module, the
design is wrong, not the rule.

`toho-like-js/` exists so behaviour can be compared against a working original.
Treat it as a fossil: read it, learn from it, never modify it.

## Stack

- **three.js** r185 — rendering
- **Bun** — package manager, dev server, bundler, test runner. One tool.
- **TypeScript, ESM** — strict, `noUncheckedIndexedAccess`, no globals

### Stay bundler-agnostic

Bun was chosen because this project needs no framework plugins. Shaders stay
**inline template strings**, so there is no GLSL-loader dependency. Use standard
ESM imports and standard asset URLs (`new URL('./x.png', import.meta.url)`). If
Bun ever falls short, swapping bundlers should be a config change, not a refactor.

---

## Hard rules

These are not style preferences. Breaking any of them breaks the game in ways that
are hard to detect and hard to undo.

Source comments cite these by number. **Inserting a rule renumbers the ones below
it and silently invalidates every citation** — `grep -rn "rule [0-9]" src docs` and
fix them in the same change. A comment pointing at the wrong rule is worse than no
citation, because it will be believed.

### 1. Never let delta-time reach the simulation

The sim is **frame-locked**: one tick is one tick, and every constant is expressed
in **pixels per tick** (`r: 2` means 2px/tick). Upstream ran one tick per
`requestAnimationFrame`, so it runs 2.4× too fast on a 144Hz display.

We drive ticks from a **fixed 60Hz accumulator** (`src/core/loop.ts`) and
interpolate **only in the view layer**. `dt` must never reach `MoveVector`, entity
updates, or anything reading content data.

### 2. RNG is seeded, split by purpose, and order-sensitive

`src/core/random.ts` exports two streams:

- **`sim`** — everything that affects gameplay. Every draw is part of the
  determinism contract.
- **`fx`** — particles, scatter, screen shake. Never touches gameplay.

Rules:

- **Never call `Math.random()` in simulation code.**
- **Never draw cosmetics from `sim`.** Upstream drew damage-effect scatter from its
  single global generator, so adding one particle shifted every subsequent bullet.
  That is the exact mistake this split exists to prevent.
- RNG *call order* is part of the contract. Reordering calls changes outcomes even
  with an identical seed.

### 3. Trigonometry comes from `core/trig`, never from `Math`

ECMAScript specifies the transcendental `Math` functions as
*implementation-approximated*. Engines take that freedom: measured across
JavaScriptCore and V8, `sin`, `cos`, `tan`, `atan2`, `exp`, `log` and `hypot`
all disagree. Only `sqrt` and the basic operators are exactly specified.

It reaches gameplay. `moveX`/`moveY` integrate into position, so one ULP moves a
bullet and eventually flips a hit test; a flipped hit changes a death, which
changes how many draws come off the `sim` stream, after which two runs are
unrelated rather than close.

`src/core/trig.ts` is built only from IEEE-754-exact operations. Use `sinDeg`,
`cosDeg`, `atan2Deg`. It is not a tax — `atan2Deg` is faster than `Math.atan2`.

`src/determinism.test.ts` scans `sim`, `content` and `core` and fails on any
approximated `Math` call. **That guard exists because this was fixed once and
the fix was incomplete**: `motion.ts` was converted, `patterns.ts` was not, and
the whole suite stayed green — the divergence was silent, with an identical RNG
draw count and only the coordinates drifting. Exceptions belong in that test's
allowlist, with the argument for why they are safe.

### 4. Input is sampled once per tick, as digital bits

The simulation never touches a device. It reads a button bitmask from
`src/core/input.ts`, sampled exactly once at the top of each tick. A replay is a
frame-indexed log of that mask and nothing else.

- **Never poll a gamepad from render.** Gamepads are polled, not evented; polling
  per frame makes the sampled value frame-rate dependent.
- **Never let an analog value reach the sim.** Stick axes are quantized against a
  fixed deadzone. That threshold is a constant, not a setting — a user-tunable
  deadzone would make replays unreproducible between machines.
- **Taps must latch.** A press and release landing between two ticks is invisible
  to a naive `sample()`, which silently drops bombs and shots.
- New input sources (touch, network peer, AI) join by contributing to the same
  mask. Nothing else may learn they exist.

### 5. Depth testing is off — draw order is explicit

The play field is coplanar; sprites composite by `renderOrder`, never by depth.
Layers are named constants in `src/render/stage.ts`, spaced so new layers slot in
without renumbering. Do not reintroduce depth sorting for sprites.

3D content may opt into depth via `Stage.depthEnabled`, but sprites keep
`depthTest: false` regardless.

**`renderer.sortObjects` must stay `true`.** `renderOrder` is read by exactly two
things in three.js — the render-list comparators — and `sortObjects = false` skips
them entirely, at which point draw order silently degrades to scene-graph
insertion order and every `Layer` value becomes decorative. Turning sorting off
looks like it preserves explicit ordering. It destroys it.

### 6. The y-down projection reverses winding

The camera maps (0,0) to the top-left with y increasing downward, matching the
space content is authored in. That gives the projection a negative Y scale, which
reverses triangle winding — **front faces would be culled**. Every sprite material
must set `side: THREE.DoubleSide`.

This is not theoretical. It presented as a completely black play field with no
console error, and it will do so again for anything that builds its own material.

### 7. Rotating sprites point **+x** (east)

Anything with `orientToHeading` is rotated by the shader to match its heading, and
heading `0°` is `+x`. Draw blades, needles and shards pointing **right**.

Upstream drew them pointing up and compensated with a `+90°` offset baked into
`Element.getDirectionTheta`. We removed the offset rather than inherit a permanent
source of confusion. Art ported from upstream needs a 90° rotation.

### 8. `alive` is system-owned; use `despawn` to remove one entity

`Bullet.alive` is a state the system sets, not a control surface callers write.
To remove a single bullet — a shot that hits and does not pierce — call
`BulletSystem.despawn(bullet)`. It leaves collision, rendering and the pool in
one step.

Setting `alive = false` from outside does *not* remove anything: `step()`'s expiry
check never consults it, so the bullet keeps moving, keeps drawing and keeps its
pool slot until it flies off-field. That state was measurable — four concurrent
ghost bullets over 600 ticks — before `despawn` existed.

A flag meaning "please remove me" needs every present and future reader to
remember to check it. An explicit method has one implementation and one meaning.

### 9. Assets must be original

Upstream art and audio are Touhou Project derivatives, and the upstream repo has
**no LICENSE file** (default: all rights reserved). Upstream assets are for local
reference only. Everything we ship must be original work.

Placeholder art and sound are **generated procedurally at runtime**
(`src/render/procedural.ts`, `src/audio/`) so the game is never blocked on assets
and never tempted to borrow them. See [`docs/assets.md`](./docs/assets.md).

---

## How this is extended

New content is added by **writing a file and importing it**, never by editing the
engine. Every extension point is a registry:

| Surface | Register with | Defined in |
|---|---|---|
| Danmaku patterns | `definePattern` | `src/content/patterns.ts` |
| Motion the polar model cannot express | `defineBehaviour` | `src/sim/motion.ts` |
| Enemy types | `defineEnemy` | `src/sim/enemy.ts` |
| Particle effects | `defineEffect` | `src/sim/effects.ts` |
| Stages and waves | `defineStage` | `src/content/stage.ts` |
| Sounds | `defineSound` | `src/audio/` |
| Sprite regions | `Atlas.define` / `defineGrid` | `src/render/atlas.ts` |
| Render layers | `Layer` constants | `src/render/stage.ts` |

Content references registry entries **by name**, never by index, so re-packing an
atlas or reordering a table cannot silently repoint at the wrong thing.

See [`docs/extending.md`](./docs/extending.md).

---

## Rendering

One `SpriteBatch` per layer and blend mode; each is a single instanced draw call.
Position, rotation, scale, UV rect and tint are per-instance attributes, so
rotation happens on the GPU and only instance buffers move per frame.

**Bullets are white; colour is a per-instance tint.** One sheet serves every
colour in the game. Upstream baked each bullet colour into its own cell and never
used its per-vertex colour channel as a tint at all.

Upstream was already well batched (~17 draw calls a frame regardless of bullet
count), so draw-call count was never the performance argument. Its real costs were
full `bufferData` re-uploads per drawer per frame and per-vertex trigonometry in
JS. Instancing addresses both.

---

## What upstream is good for

Read it for mechanism, not structure.

**Worth studying:** the motion DSL (`source/MoveVector.js`, `source/Element.js`)
and the pattern data in `data/` — polar velocity with derivatives, clamps,
reflection and segment timelines. That vocabulary is genuinely good and ours
follows it.

**Known-wrong, do not reproduce:**

- `Element.checkCollision` (`source/Element.js:1099`) tests five points of one box
  against another and misses full containment. It is also asymmetric.
- `FreeList.get()` calls `window.alert` and throws on exhaustion — a modal dialog
  mid-game. Its global `MoveVector` pool (2000) sits below the bullet cap.
- Collision is brute-force with no partitioning: 500 player bullets × 200 enemies
  is 100k tests a tick. `TODO.txt` lists "divide area" as never done.
- Its RNG returns (-1, 1), not [0, 1) — a signed modulo — so randomized parameters
  can fall below their declared minimum.
- Its loader has no error handling: one 404 hangs the loading screen forever.

**Not being ported:** WebRTC co-op (`utility/Peer.js`, Chrome-prefixed and dead),
`GameSocket.js` (telemetry to a dead endpoint), and the standalone benchmark pages
(`webgl_test.html`, `webrtc_test.html`).

### Upstream replay fixtures cannot validate this engine

`toho-like-js/replay/*.txt` were originally intended as a migration oracle. **They
cannot serve that purpose and must not be used for it.**

Our generator differs from upstream's in two ways that both change the sequence:
it mixes with logical shifts (`>>>`) where upstream uses arithmetic ones (`>>`,
which sign-extend), and it returns [0, 1) where upstream returns (-1, 1). Upstream
is not canonical xorshift128 and we did not reproduce its quirks.

Determinism is still the product — it is simply **our** replays that prove it.
Record fresh fixtures with `src/sim/replay.ts` and gate on those.

---

## History: the plan changed

The original plan was to shim upstream's `Layer` facade onto three.js so its 9,800
lines ran unmodified, then migrate drawer by drawer.

**We did not do that.** Once the goal became our own game rather than a faithful
port, carrying upstream's ES5 entity hierarchies through a shim only to delete them
later was pure cost. We wrote a fresh TypeScript core instead and took the ideas
across by hand.

Recorded because the shim path is a reasonable-sounding idea that someone will
propose again. It was considered and rejected on those grounds, not overlooked.

---

## Verification

Run before declaring any change done, and show the output:

```
bun run typecheck     # tsc --noEmit
bun test
bun run build
```

Dev server: `bun run dev`. Install: `bun install` (never `npm install` — the
lockfile is `bun.lock`).

Tests must be green before a change is done, and "green" means you ran them and
saw it. If a change touches the simulation, motion DSL, RNG, input, or content
data, also run the replay regression. A change that alters replay output is either
a bug or a deliberate divergence — say which.

Rendering changes need a browser check as well: `bun run dev`, then confirm the
field actually draws. The two rendering bugs found so far — reversed winding and a
spatial-hash collision — were both invisible to the type checker and silent in the
console.
