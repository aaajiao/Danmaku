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

Arrows or a gamepad to move, `Z` to shoot, `Shift` for focused movement.

```bash
bun test           # simulation and engine tests
bun run typecheck
bun run build      # → dist/
```

## Layout

```
src/core/       loop, input, seeded RNG, object pool
src/sim/        motion DSL, collision, bullets — engine-agnostic simulation
src/render/     three.js: instanced sprite batching, atlases, layered stage
src/content/    danmaku patterns
docs/           asset spec and extension guide
```

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — the agent contract. The determinism rules live
  here, and they are the ones worth reading before changing anything.
- [`docs/assets.md`](./docs/assets.md) — image asset specification and
  generation guide.
- [`docs/extending.md`](./docs/extending.md) — adding bullets, patterns, motion
  behaviours, art and 3D content.

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
