# Danmaku

A bullet-hell shooter built on three.js.

It began by studying [toho-like-js](https://github.com/takahirox/toho-like-js)
by takahirox, a raw-WebGL Touhou-style shooter from 2017. That is not a port and
upstream is not in this repository — see the licence note below. What was taken
across is mechanism: the polar motion DSL its bullet patterns are written in,
and a long list of things it got wrong that are documented in `CLAUDE.md` so we
do not repeat them.

## Running it

```bash
bun install
bun run dev        # http://localhost:3000
```

| | |
|---|---|
| Arrows / gamepad stick | move |
| `Z` | shoot |
| `X` | bomb |
| `Shift` | focus — slower, tighter, and it widens item pickup |
| `Space` | start / confirm |
| `B` | toggle bloom (a display setting; deliberately outside the replay log) |

```bash
bun test           # simulation and engine tests — no GL context needed
bun run typecheck
bun run build      # → dist/
```

Three checks need a real framebuffer and so are pages you open by hand:

```bash
bun run test:visual    # layer ordering, by pixel readback
bun run test:assets    # atlas loading and sprite orientation
bun run test:density   # is a single bullet still findable in a full curtain
```

## Layout

```
src/core/       loop, input, seeded RNG, object pool, exact trigonometry
src/sim/        motion DSL, collision, bullets, enemies, bosses, items,
                bombs, options, effects, replay — engine-agnostic
src/game/       run rules, state machine, screens — game logic, no three.js
src/render/     three.js: instanced sprite batching, atlases, layered stage,
                post-processing, generic background engine and registries
src/content/    generic pattern primitives plus shot/stage registries
src/v4/         compiled edition root: gameplay vocabulary, authored shaders,
                generated campaign data
src/audio/      sound registry and runtime synthesis
src/packs/      data-pack validation, injection and loading
packs/v4/       project-owned raster/HUD art pack; data only, no TS or GLSL
src/main.ts     the browser shell
docs/           asset spec and extension guide
```

`src/v4/index.ts` is the compile-time composition root. It registers v4's
patterns and behaviours, then its shader scenes, then the four-stage campaign;
the generic engine and registries remain outside that directory. Nothing under
`src/sim/`, `src/content/`, `src/game/` or `src/v4/gameplay/` imports a renderer
value, which is what lets the whole simulation — and every determinism check —
run with no GL context. `src/architecture.test.ts` enforces it.

The similarly named `packs/v4` has a different job: it is a runtime-loaded,
pure-data art pack containing project-owned atlases and HUD images. Packs may
paint and arrange registered names, but no pack can inject TypeScript,
JavaScript or GLSL. See [`src/v4/README.md`](./src/v4/README.md) for the ownership
boundary and migration guarantees.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — the agent contract. The determinism rules live
  here, and they are the ones worth reading before changing anything.
- [`docs/assets.md`](./docs/assets.md) — image asset specification and
  generation guide.
- [`docs/extending.md`](./docs/extending.md) — adding bullets, patterns, motion
  behaviours, art and 3D content.
- [`docs/v4-art-direction.md`](./docs/v4-art-direction.md) — the illustrated v4
  source of truth: Japanese STG negative space, Ghost-layer women, the
  project-owned projectile/UI package, unchanged authored background shaders and
  BulletPack as a purchaser-local compatibility reference.
- [`src/v4/README.md`](./src/v4/README.md) — where the compiled v4 edition ends,
  where the generic engine begins, and why `packs/v4` remains data-only.

## The one thing to know

The simulation is **frame-locked**. A tick is a tick; every speed in the content
data is pixels *per tick*, never per second. A fixed 60 Hz accumulator drives it,
and interpolation happens only in the view layer.

Randomness comes from a seeded generator, with cosmetic effects on a separate
stream so visual work cannot move the simulation.

Together those make a run reproducible from a seed plus an input log, which is
what makes replays, recorded patterns and any future netplay possible. Almost
every subtle way to break this project runs through breaking one of them.

## Licence

MIT — see [`LICENSE`](./LICENSE). **It covers our work only.**

[toho-like-js](https://github.com/takahirox/toho-like-js) is third-party code
with no licence of its own, and its art and audio are Touhou Project derivatives.
We hold no rights to it and cannot license it onward, so **it is not in this
repository at all** — not in the tree and not in the history. Clone it separately
if you want it for reference.

[`NOTICE`](./NOTICE) states the scope precisely. See also `CLAUDE.md` rule 9.
