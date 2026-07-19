# Danmaku

A bullet-hell (danmaku) shooter built on three.js.

Its starting point is [toho-like-js](https://github.com/takahirox/toho-like-js) by
takahirox — a raw-WebGL Touhou-style shooter, vendored here at commit `8ff780d`
(2017-06-13). This project is **not** a faithful port. Upstream is a reference
implementation and a source of proven mechanisms; the destination is our own game.

## Repository layout

```
toho-like-js/     Frozen upstream baseline. READ-ONLY — never edit.
src/              Our code. Vite + TypeScript + ESM + three.js.
```

`toho-like-js/` exists so that any behaviour can be diffed against a working
original. Treat it as a fossil: read it, port from it, never modify it. If you
believe it needs changing, you actually need to change something in `src/`.

## Stack

- **three.js** — rendering
- **Vite** — dev server and build
- **TypeScript, ESM** — no globals, no script-tag load order

Upstream is ES5 with 38 ordered `<script>` tags and ~12 browser globals
(`__randomizer`, `__moveVectorManager`, `__bulletsParams`, `__game`, …). None of
that survives the port.

---

## Hard rules

These are not style preferences. Breaking any of them breaks the game in ways
that are hard to detect and hard to undo.

### 1. Never let delta-time reach the simulation

The sim is **frame-locked**: one logic tick is one frame, and every constant in
the content data is expressed in **pixels per frame** (`r: 2` means 2px/frame).
Upstream simply ran one tick per `requestAnimationFrame`, which means it runs
2.4× too fast on a 144Hz display.

We fix that with a **fixed 60Hz accumulator** driving the tick, and interpolation
**only in the view layer**. `dt` must never reach `MoveVector`, entity updates, or
anything that reads content data.

Introducing delta-time into the sim would silently invalidate every tuning value
in `data/` and destroy reproducibility.

### 2. RNG is seeded, single-purpose, and order-sensitive

- Simulation randomness comes from the seeded xorshift128 generator only.
- **Never call `Math.random()` in simulation code.** Upstream has zero occurrences;
  keep it that way.
- **Cosmetic effects get their own RNG stream.** Upstream draws damage-effect
  scatter from the same global stream as gameplay (`Effect.js:1244`), welding
  visuals to determinism — any change to effect spawning desyncs the sim. Do not
  reproduce that mistake.
- RNG *call order* is part of the contract. Reordering calls changes outcomes even
  with an identical seed.

### 3. Depth testing is off — draw order is explicit

Upstream disables `DEPTH_TEST` and relies purely on call sequence. In three.js,
replicate that ordering with `renderOrder`. Do not reintroduce depth-based sorting
for sprites.

### 4. Porting content data is where the parse-time traps are

`data/` is ~2,350 lines of hand-authored JS literals and is the most valuable
thing upstream has — the motion DSL (`MoveVector`: `r`/`theta`/`w`, accelerations,
clamps, reflections, `aimed`, `target`, segment timelines with index jumps) is
engine-agnostic and has zero rendering coupling. Port it close to verbatim.

Two load-order side effects must be handled deliberately when converting to ESM:

- `data/bullets_params.js:1` instantiates `DanmakuHelper` **at parse time**.
- `data/enemies_params.js:317` consumes **100 RNG draws at parse time**, baking
  stage-2 enemy positions into constants.

Module evaluation order or any lazy/dynamic import changes these values silently.
Make the generation explicit and eagerly evaluated; do not rely on import order.

### 5. Assets must be original

Upstream art and audio are Touhou Project derivatives, and the upstream repo has
**no LICENSE file** (default: all rights reserved). Upstream assets are for local
reference only. Anything shipped, published, or committed as ours must be original
work. Do not build features that assume a Touhou asset will be there.

---

## Architecture we are porting from

Read `toho-like-js/` for detail; this is the shape.

**The renderer is a single clean seam.** No file in `toho-like-js/source/` touches
`gl.*` directly — everything goes through the `Layer` facade in
`toho-like-js/utility/WebGL.js` (~400 LOC, ~10 public methods, one shader program:
a textured quad times a per-vertex tint). Replacing `Layer` replaces the renderer.

**Entities are already split three ways**, which maps almost 1:1 onto three.js:

| Upstream | Ours |
|---|---|
| `Element` — position, collision box, motion vectors | sim object |
| `ElementView` — vertex/UV/index/colour arrays | instance attributes |
| `ElementDrawer` — GL buffers + texture, batches all views | `InstancedMesh` |

**Two canvases.** `bgCanvas` (480×480, WebGL) draws game entities; `mainCanvas`
(640×480, Canvas2D) draws HUD, sidebar, dialogue, and every non-gameplay screen.
Only the first is being ported to three.js.

**Upstream is already well batched** — ~17 draw calls per frame regardless of
entity count; a thousand bullets is one call. three.js is not a performance win by
itself. The real CPU costs upstream are full `bufferData` re-upload of four buffers
per drawer per frame, and per-vertex `Math.cos`/`Math.sin` in JS. Instancing fixes
both. That, not draw-call count, is the performance argument.

**Collision is brute-force AABB with no spatial partitioning**, and upstream's
`checkCollision` (`Element.js:1099`) tests only 5 points of one box against
another — it misses full containment. Fix it; don't port the bug.

**Pools are fixed-size and fail loudly.** `FreeList.get()` throws and calls
`window.alert` on exhaustion. The global `MoveVector` pool (2000) is the real
ceiling, below the 1000-enemy-bullet cap. Make pool growth or graceful degradation
an explicit decision, not an accident.

**Not being ported:** WebRTC co-op (`utility/Peer.js`, Chrome-prefixed and dead),
`GameSocket.js` (telemetry to a dead Heroku endpoint), and the standalone
benchmark pages (`webgl_test.html`, `webrtc_test.html`, ~2,750 LOC with their own
duplicated mini-engines).

## Migration strategy

1. **Layer shim.** Reimplement `Layer`'s public surface on three.js
   `BufferGeometry` + `RawShaderMaterial`, so upstream game logic runs unmodified.
   This is the checkpoint that proves the renderer swap is correct before anything
   else changes.
2. **Per-drawer instancing.** Migrate the 17 drawers to `InstancedMesh` one at a
   time, verifying after each.
3. **Diverge.** Only once the above is green does the game become ours.

### Replay fixtures are the migration oracle

`toho-like-js/replay/replay1.txt` and `replay2.txt` record a seed plus a sparse
frame-indexed input log (`{count, key}`) — not state snapshots. Same seed + same
inputs + same integer frame stepping ⇒ identical outcome.

During steps 1–2 they are the strongest available proof that the port did not
drift. Use them as a regression gate. Once step 3 begins and behaviour
deliberately diverges, retire them and replace them with our own fixtures — do not
let stale fixtures silently rot into ignored failures.

## Verification

Run before declaring any change done, and show the output:

```
npm run typecheck
npm run test
npm run build
```

If a change touches the simulation, motion DSL, RNG, or content data, also run the
replay regression. A change that alters replay output is either a bug or a
deliberate divergence — say which.
