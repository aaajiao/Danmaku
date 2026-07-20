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
  behaviours, enemies, bosses, stages, background scenes, art and 3D content.
- [`docs/assets.md`](./docs/assets.md) — the image asset specification.
- [`README.md`](./README.md) — controls, commands and layout.

Two things to know before touching anything:

- **Run the checks and show the output.** `bun run typecheck`, `bun test`,
  `bun run build`. Rendering changes additionally need a browser — every
  rendering bug found in this project so far was silent in the console and
  invisible to the type checker.
- **Rule citations are load-bearing.** Source comments cite CLAUDE.md's hard
  rules by number. Check the number against the heading, not against memory: an
  audit found seven that pointed at the wrong rule.
