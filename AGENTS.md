# Agent contract

The contract for this repository is [`CLAUDE.md`](./CLAUDE.md). Read it before
making any change — the determinism rules in particular are load-bearing, and
breaking one is neither obvious at the time nor easy to undo later.

This file exists because agents kept looking for it. An earlier version of
`CLAUDE.md` named `AGENTS.md` as the source of truth; the rules were later moved
into `CLAUDE.md` itself and this pointer went missing. Six separate agents
reported the dangling reference before it was restored, which is a decent
argument that both names should keep resolving.

See also:

- [`docs/extending.md`](./docs/extending.md) — adding bullets, patterns, motion
  behaviours, enemies, bosses, stages, art and 3D content.
- [`docs/assets.md`](./docs/assets.md) — the image asset specification.
