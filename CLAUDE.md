# Danmaku

A bullet-hell (danmaku) shooter built on three.js.

It began by studying [toho-like-js](https://github.com/takahirox/toho-like-js) by
takahirox, a raw-WebGL Touhou-style shooter at commit `8ff780d` (2017-06-13).
This is **not** a port, and upstream is not in this repository. What was taken
across is mechanism — chiefly the polar motion DSL its patterns are written in —
along with a list of its mistakes, recorded below so they are not repeated.

## Repository layout

```
src/core/          loop, input, seeded RNG, object pool, exact trigonometry
src/sim/           motion DSL, collision, bullets, enemies, bosses, player,
                   options, bombs, items, effects, replay
src/render/        three.js: sprite batching, atlases, layered stage,
                   post-processing, background engine
src/content/       generic pattern registry/primitives, shot and stage registries,
                   plus compatibility facades for the active edition
src/game/          run rules, state machine, screens — all game logic, no three.js
src/audio/         sound registry and runtime synthesis
src/packs/         drop-in packs: pure shape validation, content injector,
                   loader, and compatibility entry for bundled edition content
src/v4/            compile-time edition root: gameplay definitions, authored
                   background shaders, and generated four-stage campaign data
src/main.ts        the browser shell: input in, pixels out, nothing else
docs/              asset specification, extension guide, pack format
packs/             project-owned shipped art (`v4`) plus the README-only
                   `example` workspace; generated/imported packs are local
test/visual/       checks that need a real GL context and cannot run in `bun test`
tools/             fixture and v4 content/art generation, dev server, build copy
```

`src/v4/index.ts` is the active edition's **compile-time composition root**. It
installs v4's deterministic patterns and motion behaviours from
`src/v4/gameplay/`, its authored shader scenes from `src/v4/backgrounds/`, and
then its campaign from `src/v4/content/`, in that dependency order. The generic
registries and systems stay outside the edition under `src/content/`, `src/sim/`,
`src/render/`, `src/game/` and `src/packs/`.

The built-in campaign — stage-1 through stage-4, their sixteen trash enemies and
five bosses — is no longer engine TypeScript, and neither is the player side: the
five characters (scout, lance, hound, spire, maw), their five shots, five option
sets and five identity bombs are data too. All of it is `src/v4/content/campaign.json`,
authored by `tools/make-v4-content.ts` and injected through the same
validate+inject pipeline as any fetched pack by `src/v4/content/index.ts`.
`src/packs/bundled.ts` is only the compatibility entry for historical imports.
The ways bundled edition content differs from a fetched pack are under "How this
is extended".

Four tests scan whole trees rather than testing one module, and all four exist
because the thing they check fails silently:

```
src/determinism.test.ts       approximated `Math` in generic + v4 gameplay trees (rule 3)
src/architecture.test.ts      renderer/pack imports in headless trees (the rule below)
src/reachability.test.ts      registered content a real playthrough never touches
src/balance.test.ts           the damage model, re-derived from the real `Run`
```

The last two live at the `src/` root, beside `main.ts`, not under `src/game/`.
They drive the *composed* game — which needs the bundled v4 campaign injected —
and composition is the shell's layer, where importing game + edition + render is
what the tests do. `src/difficulty-honesty.test.ts` moved to the root for the
same reason. The scan-scope tests (`determinism`, `architecture`) scan
`sim`/`content`/`game`/`core` plus `v4/gameplay`; the root is not one of those
trees.

The last two are newer than the rest of this document and are described under
"Registration is not reachability" and "The damage model is measured, not typed"
below. Both were written after an audit found roughly twenty-five defects that
the other 1289 tests were all green through.

### The import boundary

`src/sim/`, `src/content/`, `src/game/` and `src/v4/gameplay/` must not import
**values** from `src/render/`. All four are enforced. They also import nothing
from `src/packs/`: edition gameplay is compiled code, not pack-loader code.

The simulation is engine-agnostic by construction, which is what makes it
testable headlessly and reproducible. `bun test` *is* that headless run: it has
no GL context, and everything the determinism contract rests on is proved there.

**`import type` is exempt, and the distinction is the whole point.** A type-only
import erases completely — no runtime edge, nothing dragged into a headless
process. `src/sim/effects.ts` borrows `BulletCell` that way, and borrowing the
name beats duplicating a list of sprite names that would then drift.

A **value** import is the violation, test files included. That is not pedantry:
the only one that ever survived here was in a test, and it survived precisely
because a test importing the renderer looks harmless. It is not — it spends the
exact property the rule buys. `src/architecture.test.ts` now enforces this; until
it was written the rule had been convention-only for the life of the project.

If you need a value from the renderer, the design is wrong, not the rule. Invert
the dependency: have content name the thing as a **string** and let the shell
resolve it. `StageSpec.background` is that pattern — a stage says which scene it
is set in, and never learns that fragment shaders exist.

Upstream is **not in this repository** — not in the tree, not in the history.
See NOTICE for why. What it taught is recorded below under "What upstream is good
for"; if you want to read the original, clone it separately. `.gitignore` has an
entry for `toho-like-js/` so a local copy can never be committed by accident.

## Stack

- **three.js** r185 — rendering
- **Bun** — package manager, dev server, bundler, test runner. One tool.
- **TypeScript, ESM** — strict, `noUncheckedIndexedAccess`, no globals

### Stay bundler-agnostic

Bun was chosen because this project needs no framework plugins. Shaders stay
**inline template strings**, so there is no GLSL-loader dependency. Use standard
ESM imports; for an asset, a bundler-resolved default import
(`import URL from './x.png'`, typed by `src/assets.d.ts`), which Bun copies into
`dist/` and rewrites — verified through `bun run build`. **Not**
`new URL('./x.png', import.meta.url)`: under this dev server that keeps the
source file's `file://` path in the client bundle and 404s, which is why
`docs/assets.md` §5 walks the import form instead. If Bun ever falls short,
swapping bundlers should be a config change, not a refactor.

---

## Hard rules

These are not style preferences. Breaking any of them breaks the game in ways that
are hard to detect and hard to undo.

Source comments cite these by number. **Inserting a rule renumbers the ones below
it and silently invalidates every citation** — run

```
grep -rn "rule [0-9]" src docs test tools *.md
```

and fix them in the same change. A comment pointing at the wrong rule is worse
than no citation, because it will be believed.

That is not hypothetical. An audit of this repository found **seven** citations
pointing at the wrong rule, including three that named rule 2 or 3 for something
rule 4 says. No renumbering caused them; they were simply written from memory.
So check the number against the heading rather than against your recollection of
it, and note that the grep above covers four trees — an earlier version of this
paragraph scanned only `src` and `docs`, which is how the ones in `test/` and
`tools/` went unexamined.

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

`src/determinism.test.ts` scans `sim`, `content`, `core`, `game` and
`v4/gameplay`, and fails on any approximated `Math` call. **That guard exists
because this was fixed once and the fix was incomplete**: `motion.ts` was
converted, the then-active `patterns.ts` was not, and
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

| Surface | Register with | Registry / engine API |
|---|---|---|
| Danmaku patterns | `definePattern` | `src/content/pattern-registry.ts` |
| Motion the polar model cannot express | `defineBehaviour` | `src/sim/motion.ts` |
| Player shot types | `defineShot` | `src/content/shots.ts` |
| Enemy types | `defineEnemy` | `src/sim/enemy.ts` |
| Bosses and their spell cards | `defineBoss` | `src/sim/boss.ts` |
| Playable characters | `defineCharacter` | `src/game/run.ts` |
| Option (sub-ship) formations | `defineOptions` | `src/sim/option.ts` |
| Bombs | `defineBomb` | `src/sim/bomb.ts` |
| Pickups | `defineItem` | `src/sim/item.ts` |
| Particle effects | `defineEffect` | `src/sim/effects.ts` |
| Stages and waves | `defineStage` | `src/content/stage.ts` |
| Background scenes | `defineBackground` | `src/render/background.ts` |
| Dialogue portraits | `definePortrait` | `src/render/portrait.ts` |
| Sounds | `defineSound` | `src/audio/index.ts` |
| Music tracks | `defineMusic` | `src/audio/music.ts` |
| Sprite regions (and animation strips) | `Atlas.define` / `defineGrid` / `defineStrip` | `src/render/atlas.ts` |
| Render layers | `Layer` constants | `src/render/stage.ts` |
| Asset packs (reskins + content) | drop a folder in `packs/` | `docs/packs.md` |

Content references registry entries **by name**, never by index, so re-packing an
atlas or reordering a table cannot silently repoint at the wrong thing.

The last column is where a registry's *mechanism* lives, not where v4's authored
definitions do. `src/v4/gameplay/` owns the active edition's executable pattern
and behaviour definitions; `src/v4/backgrounds/` owns its GLSL scenes; and
`tools/make-v4-content.ts` authors the enemies, bosses, stages and player side
emitted to `src/v4/content/campaign.json`. The generic `define*` APIs, systems
and per-tick runtime constants remain outside `src/v4`. A new enemy, boss, stage,
weapon, option set, bomb or character *for v4* is written in the v4 content
generator (`docs/extending.md` §6–§7), while a new executable pattern, behaviour
or shader is compiled under the matching v4 directory and imported by its index.

The last row is the one that is not code: an **asset pack** is a folder dropped
into `packs/`, and it extends the game without importing a module or editing the
engine. It carries two kinds of thing. A **reskin** replaces the sprite *skins*
that patterns, effects and the HUD draw with — bullet sheet, ship, HUD icons,
sounds, music tracks (a stage or boss names a track by string, exactly as it
names a scene; the file is presentation and stays under the warn-only skin
identity, while the track name it carries in the spec is content), and dialogue
portraits (a `portraits` section of name→image, the face a boss's `speaker` names —
presentation, warn-only, with a procedural silhouette as the floor). The optional
`assets.actors.portraits` sheet is the higher-resolution built-in-cast close-up
surface: speaker plus selected character chooses its strip, with the field actor
crop and then the ordinary portrait registry as floors. **Content**
(format 2, gated by a `requires` capability) adds JSON data
across nine sections — enemies, stages, bosses, shots, characters, options, bombs,
effects and items: an enemy is an `EnemySpec`, a stage is waves chained into a
selectable campaign, a boss is spell-card phases sized in seconds — and may carry a
pre-fight dialogue exchange, which is boss content and travels strict — a character
names its shot/options/bomb and joins the SELECT screen. What a pack never carries
is *code*: no TypeScript, JavaScript or GLSL can cross the manifest boundary. The
patterns an enemy or boss fires, the behaviours that steer a bullet and the shader
scenes a stage is set in are precompiled edition code, joined to a pack only by
registered name, and a new item `kind` stays a game rule. Dialogue is the boundary drawn
once more: the *text* is content the sim runs (advancing a line is input that
delays the boss), the *portrait* is only presentation. A pack paints and arranges;
it never scripts a new rule. The replay contract splits on that line: a reskin cannot
change the simulation so a skin mismatch **warns**, while content changes what the
game does so a content mismatch **refuses**, exactly like a mismatched character or
stage — and a pack character flown on any campaign is a content run for that reason.
The format, both validation layers and the boundary are
[`docs/packs.md`](./docs/packs.md).

**`packs/v4` is the only loadable pack committed and shipped by this repository.**
It is a pure-data **art pack**: manifest metadata plus project-owned raster atlases
and HUD images, with no `content`, TypeScript or GLSL. It paints the compiled v4
edition but does not define it. `packs/example` is deliberately README-only until
v4 is final, when both the example assets and Art Kit are redesigned from the
final surface contract. The obsolete example/clearing/Art-Kit generators are
retired; the purchased-BulletPack importer remains an audit tool whose output is
temporary local data, not a second shipped pack.

The **v4 campaign is this format's largest consumer**:
`src/v4/content/index.ts` statically imports `campaign.json` and runs the same
validator and injector as a fetched pack. It differs in four ways: there is zero
network fetch; names register **unqualified** (`grunt`, `sentinel`, `stage-1`);
its entry takes the plain START row and joins neither guest `packs` nor
`packsData` identity; and a validation failure throws at boot. It does carry the
build-owned `CONTENT_FINGERPRINT`, derived from the exact campaign bytes plus
the compiled v4 pattern/behaviour sources they invoke, and recorded in replay
meta. Later data **or executable danmaku** drift is therefore refused rather
than replayed silently. `src/packs/bundled.ts` only preserves the old import
surface.

The ownership migration itself was replay-neutral: `campaign.json` was byte-for-
byte identical to the former `src/packs/base-pack.json`, with historical
fingerprint `919d306d8f6a`, and its golden traces were not regenerated. The later
spatial-language revision deliberately moved gameplay, regenerated those traces,
and expanded the fingerprint to cover executable v4 gameplay as well as JSON.
Every scene's assembled GLSL source and scroll speed remains SHA-256 pinned in
`src/v4/backgrounds/index.test.ts`. The manifest's description still says
“stage-1 and stage-2”; the actual inventory is four stages, sixteen enemies and
five bosses. Fix that metadata only as an explicit content revision, never as
unrelated cleanup.

**A registry only has what something imported.** A module nobody imports never
runs, so its `define*` calls never happen and the name resolves to nothing at the
moment a player reaches it. Two edition entry points make that composition
explicit:

```
src/v4/index.ts                    the edition layers, in dependency order
src/v4/backgrounds/index.ts        every authored v4 scene
```

The background index has a directory-scanning test that fails when a sibling is
missing. Compatibility facades under `src/content/`, `src/render/backgrounds/`
and `src/packs/bundled.ts` preserve old import paths; they are not ownership
roots. This has already gone wrong once: behaviours, shots and stage-2 were
written, tested, green — and absent from the bundle.

### Registration is not reachability

Importing a module proves the name *resolves*. It does not prove a running game
ever asks for it, and those are different claims. The shipped build had
`stage-2`, `warden` and `magistrate` fully written, imported, unit-tested and
green — and unreachable, because `stage-1` never named a boss to send or a stage
to follow. Every registry was correct. Nothing joined them up. (Those names are
now v4 campaign data, injected at boot; the wire is a wave and a `next` in
`src/v4/content/campaign.json`, and the pack injector's own reachability pass —
`docs/packs.md` §9.3 — rejects a stage no `next` reaches before this test ever
runs.)

That is the shape of nearly every defect the audit found: not a broken
subsystem, but a missing wire between two working ones — an argument not passed,
a ceiling read from the wrong table, a registry with no consumer. Unit tests
cannot see it, because a unit test supplies the missing wire itself, as a
fixture.

`src/reachability.test.ts` closes it. It drives the real `StateMachine`
through the real `GameContext`, the way `main.ts` does, with a scripted pilot,
and asserts that a genuine playthrough touches every stage, boss, boss phase,
declared scene, item kind, particle effect, state screen, the top power tier,
and fourteen event types. **Content that nothing reaches fails the build.**

It has been watched failing: deleting `stage-1`'s `boss` and `next` — exactly
the state the project shipped in — turns its 24 assertions into 10 pass, 14
fail, while the rest of the suite stays green.

So: adding v4 data means editing `tools/make-v4-content.ts`, regenerating the
campaign and making something reach every new entry. Adding executable v4
vocabulary means defining it under `src/v4/gameplay/` or
`src/v4/backgrounds/` and importing it from the edition root/index. A guest pack
may arrange those registered names but cannot add executable vocabulary.

### The damage model is measured, not typed

`REFERENCE_DPS` in `src/sim/boss.ts` is the rate every boss in the game is sized
from, and `phaseHp(seconds)` / `phaseClock(hp)` are how content asks for a phase
in the units a designer actually thinks in.

It used to be a literal — `0.56`, typed once into a test file and repeated in
three prose comments. It was unverifiable and it was wrong, and each consumer
was wrong differently: `boss.ts` sized above it and produced phases no loadout
could drain inside their own clocks; the since-retired `stage-2.ts` (its content
now lives in `src/v4/content/campaign.json`) inferred it was far too generous
and sized an order of magnitude *below* it, giving a midboss less health than
two trash enemies.

`src/balance.test.ts` re-derives the number by driving the real `Run`
across every character × power tier × focus state. If player damage changes for
any reason — a weapon tier, an option layout, a hitbox shape — it fails, and the
boss content has to be revisited. That coupling is the point: **a tuning
constant no test can measure will drift away from the thing it describes, and
every reader of it will be confidently wrong in a different direction.**

See [`docs/extending.md`](./docs/extending.md).

---

## Rendering

One `SpriteBatch` per layer and blend mode; each is a single instanced draw call.
Position, rotation, scale, UV rect and tint are per-instance attributes, so
rotation happens on the GPU and only instance buffers move per frame.

**A sprite carries colour one of two ways, and the batch draws both identically.**
The procedural floor and every shared bullet cell are *white + per-instance tint*:
one greyscale shape recoloured by the shader's `texel * tint` multiply, so the
floor sheet serves every colour and stays small, and the base campaign
colour-codes a curtain by tinting the same cell many hues — the honest,
recolourable rule-9 mode. A loaded pack may instead **bake** colour into the
pixels of a *named variant* strip and declare `color: 'baked'`; its tint then
defaults to identity white and the multiply becomes a *modulation* — a sub-1
channel tones or fades, a >1 channel (the boss hit-flash) lifts toward the clamp —
rather than the colour source. Either way one texture is one instanced draw call —
the batching story is unchanged; what changed is that "white" is the floor's
**mode**, not a law every sheet obeys, and that baked colour lives in a variant
named by content, not tinted onto a shared floor cell. Upstream baked each bullet
colour into its own cell **and** never used its tint channel at all; we keep both
paths and let the art choose which.

Native art is horizontal **animation strips** — a static cell is the degenerate
`frames: 1`, one vocabulary, no second format (`Atlas` stores every entry as a
`Strip`; frame selection is a pure tick-clocked function in `src/render/strip.ts`
that reads a run-relative entity `.age`, never a wall clock or `loop.count`). See
`docs/assets.md` §"Animation strips" and `docs/packs.md`.

Upstream was already well batched (~17 draw calls a frame regardless of bullet
count), so draw-call count was never the performance argument. Its real costs were
full `bufferData` re-uploads per drawer per frame and per-vertex trigonometry in
JS. Instancing addresses both.

### Backgrounds are scenes, and a stage names one

`src/render/background.ts` is an engine and names no scene: a full-screen quad at
`Layer.Background`, a fixed uniform set, an optional preloaded painted-plate
owner, and a cross-fade. Every scene is driven by a fragment shader in its own
file under `src/v4/backgrounds/`. A scene may additionally sample one
project-owned opaque plate through `BackgroundSpec.art`; the shader still owns
the composition and all motion. The historical `src/render/backgrounds/index.ts`
path is a compatibility import only.

A stage declares where it is set with `StageSpec.background`, and a spell card
may override it with `SpellCard.background`. Both are **strings**, because
`src/content` and `src/sim` may not import the renderer. The names resolve in the
shell, which is the only place that knows both halves.

The shell **reconciles rather than reacts**. `Run.scene` is a getter reporting
which scene the run wants right now; `main.ts` compares it against what is on
the quad each tick and starts a cross-fade when they differ. Scene is a
*condition*, not an occurrence, and conditions pushed through the event queue
drift — miss one event and the screen stays wrong until something unrelated
fixes it. Reconciling is idempotent, so a paused, replayed, or restarted run
needs no resynchronisation path.

Two constraints bind every scene, and both are in `background.ts`'s header:

- **`uTick` advances in `step()` and nowhere else.** No `performance.now`, ever.
  A background on a wall clock desynchronises from a replay visually while every
  test stays green, because the simulation is untouched and nothing can notice.
  `src/v4/backgrounds/index.test.ts` scans for wall-clock sources and pins each
  migrated shader's assembled source hash and scroll rate. Optional painted
  plates are decoded before the fixed-tick loop starts; their load completion
  may never switch a live scene on an arbitrary wall-clock frame.
- **亮到能看,暗到能玩 — bright enough to see, dark enough to play.** The fixed
  "peak near 0.1" ceiling is RETIRED: the diversity rounds proved the structure
  was present all along and only the ceiling made it invisible, so scenes ship at
  their ported reference's native richness with a per-scene EXPOSURE constant,
  structured peaks landing in roughly the 0.25-0.35 raw band (graded by role —
  menu brightest, stages leaving a curtain its headroom, seals a calmer boss
  station). The exposure that ships is MEASURED in acceptance (the density page
  and `bun run dev` under real curtains are the arbiter); the numbers describe
  what shipped, not the reverse. What still binds: bounded per-tick luminance
  steps (coherent motion, no strobing), no structure at a bullet's spatial
  frequency in the play band (a bright scene must not counterfeit bullets), and
  bullets/UI winning the contrast fight (bullets are 1.0-white + bloom; the scene
  never approaches that). A scene running its projection to infinity (a spiral or
  perspective one) still decays its structured terms faster than its brightness,
  or what that aliases into looks exactly like sparse bullets.

GLSL `sin`/`cos` are used freely. Rule 3 binds `sim`, `content`, `core` and
`game` because their results integrate into positions; these values reach the
framebuffer and stop.

---

## What upstream is good for

Read it for mechanism, not structure — clone it separately if you want to.
File references below are paths **inside the upstream repository**, not this one.

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

Upstream's replay fixtures were originally intended as a migration oracle. **They
cannot serve that purpose and must not be used for it**, quite apart from no
longer being in the tree.

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

## Multi-agent workflows: pick the model per stage

When orchestrating subagents (the Workflow tool), do not let every stage inherit
the session model. Match the model to what the stage actually does:

- **Sonnet 5** (`model: 'sonnet'`) for mechanical stages: inventory scans,
  citation sweeps, grep-and-report mapping, fixture generation, applying a
  mapped fix across files. Pair with `effort: 'low'` or `'medium'` when the
  task is rote.
- **Opus 4.8** (`model: 'opus'`) for stages that decide or verify: design
  proposals, judging, adversarial verification, anything writing simulation
  code or reasoning about the determinism contract.
- The session model is for the main loop — final synthesis and the judgement
  calls that follow the workflow, not for fan-out stages.

The reasoning is the same as the `sim`/`fx` RNG split: spend the expensive
resource only where it changes the outcome. A mapping agent on the top-tier
model produces the same grep results at several times the cost; a judge on a
small model produces confident verdicts that have to be re-checked anyway.

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

`bun run dev` now runs `tools/serve.ts`, a Bun wrapper that serves the app *and*
the `packs/` tree plus a synthesized `/packs/index.json`, because the bare
`bun ./index.html` answers every unknown route with the HTML entry and so can
never serve a pack. `bun run build` gains `tools/copy-packs.ts`, which stages
`packs/` into `dist/`. Both are dev/build tooling; the built output stays plain
static files. If a change touches the pack manifest, note that **the error
strings in `src/packs/manifest.ts` are a compatibility contract** — asserted
verbatim in `manifest.test.ts`, quoted verbatim in `docs/packs.md`, and matched
by pack-author tooling — so rewording one is a breaking change, not a cleanup.

Tests must be green before a change is done, and "green" means you ran them and
saw it. If a change touches the simulation, motion DSL, RNG, input, or content
data, also run the replay regression. A change that alters replay output is either
a bug or a deliberate divergence — say which.

Rendering changes need a browser check as well: `bun run dev`, then confirm the
field actually draws. The rendering bugs found so far — reversed winding, an inert
`renderOrder`, a spatial-hash collision — were all invisible to the type checker
and silent in the console.

Three checks need a real framebuffer and so cannot live in `bun test`. Each is a
page you open by hand:

```
bun run test:visual     # → http://localhost:3006   layer ordering
bun run test:assets     # → http://localhost:3007   atlas loading, and cell padding
bun run test:density    # → http://localhost:3008   readability under bullet load
```

`test:visual` draws two overlapping quads on known layers, reads the pixel where
they cross, and then repeats the measurement with `sortObjects` forced off to
prove it can fail. Run it after any change to `Stage`, `SpriteBatch`, or the
`Layer` constants.

`test:assets` is the only thing that measures the **generated sheet's actual
pixels**. `procedural.test.ts` checks each cell's declared geometry against
`MAX_CELL_EXTENT`, which is sound but is arithmetic — `bun test` has no canvas.
Run this after touching a painter in `render/procedural.ts`, and read the
printed table: geometry and painted footprint differ in both directions, and it
is the painted number `docs/assets.md` quotes.

`test:density` is the one to run after touching a tint or bloom. It is a
judgement call rather than an assertion — whether a single bullet stays findable
in a full curtain — and no automated check can answer it.

**It renders on black and composites no scene**, so it cannot currently answer
the same question for a background; judge that in `bun run dev`. Compositing a
scene into it would be the better tool and is not a small change: the page's
automated half measures frame time, and a full-screen shader alters fill cost,
so the scene would have to go into a readability-only panel rather than into the
timed levels. Until then, a background's readability is judged in `bun run dev`
under a real curtain, not against a fixed peak number: structured peaks now sit
in roughly the 0.25-0.35 raw band (per-scene EXPOSURE, graded by role), well
below a bullet's 1.0-white + bloom, with structure an order of magnitude coarser
than a bullet. The number that ships is measured from whatever is on the quad,
not a target set in advance.
