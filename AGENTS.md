# Danmaku repository agent contract

This file applies to the repository root and every descendant unless a deeper
`AGENTS.md` explicitly narrows a rule.

## 1. Project identity

- This repository builds a deterministic 1-bit STG from
  `1bit-stg-complete-asset-kit-v4/`.
- The product is an observable behavior/material system, not a score, rank,
  victory, morality, or optimization system. Do not add those concepts through
  copy, mechanics, telemetry, achievements, or hidden state.
- Preserve the material/digital double helix: gameplay facts may project into
  visual, audio, haptic, UI, narrative, and memory layers; presentation never
  writes gameplay authority back.
- Treat subtraction, absence, interruption, residue, witness, and handoff as
  first-class authored behaviors. Do not fill intentional silence with generic
  game feedback.

## 2. Required project skill

Before changing gameplay, narrative, copy, visual/audio language, PWA identity,
or adding content, read the complete project skill:

```text
.agents/skills/aaajiao/SKILL.md
```

Follow it throughout the task. Any content outside V4 must also pass
`stg-dev/docs/CONTENT_EXTENSION_ZH.md` and include an extension ADR/provenance
record. Never create a second gameplay language beside V4.

## 3. Authority and source order

Use this precedence when sources appear to disagree:

1. `1bit-stg-complete-asset-kit-v4/manifests/**` canonical contracts;
2. `1bit-stg-complete-asset-kit-v4/runtime/**` reference machines/oracles;
3. `1bit-stg-complete-asset-kit-v4/gameplay/tools/sim_core.py` QA oracle;
4. `stg-dev/src/authority/**` production authority adapters;
5. `stg-dev/src/game/**` application/presentation integration.

Do not edit the V4 asset kit to make application tests pass unless the user
explicitly asks to change the source kit. Fail fast on version, schema, ID,
reference, file-universe, or SHA-256 drift. Do not commit generated Python
`__pycache__`/`.pyc`, build output, browser reports, or local caches.

## 4. Runtime invariants

- Integer `tick120` is the only gameplay time identity. Milliseconds are a
  derived projection. V4 60 Hz machines advance only every second master tick.
- Pause freezes gameplay time and discards wall time observed while paused.
- Same-tick ordering is:
  `collision-off -> state/damage -> collision-on -> entity-spawn -> feedback`.
- Canonical event IDs come only from the V4 event schema. Unknown IDs, duplicate
  occurrence keys, incomplete required payloads, and feedback-to-gameplay writes
  are errors.
- Pattern execution uses one seeded Mulberry32 stream, stable cadence/entity
  ordering, declaration-order motion operators, enforced safe gaps, and swept
  warning/collision geometry.
- Projectile and laser flight are entity-owned. Never infer collision or
  lifecycle completion from animation time, alpha, atlas frames, audio, reduced
  motion, or renderer state. Never recycle a live collider when a pool is full.
- Weather and accessibility profiles are projections and must produce the same
  gameplay trace.
- Cross-run restore order is material record, ghost/witness projection, then
  player input return. A run ends in observation/handoff, not victory.

## 5. Bun-only application toolchain

The application package manager and JavaScript runtime are Bun 1.3.14. Keep
`stg-dev/bun.lock` as the only JavaScript lockfile. Do not introduce npm, npx,
pnpm, Yarn, package-lock, or parallel scripts.

Run commands from `stg-dev/`:

```sh
bun install --frozen-lockfile
bun run content:check
bun run typecheck
bun run test:unit
bun run build
bun run test:smoke
bun run test:e2e
bun run test:all
```

The V4 package ships several Python reference validators. They are immutable
oracles rather than an application toolchain; invoke them with `python3 -B` so
they cannot write bytecode caches. Do not replace oracle evidence with a wrapper
that merely returns expected hashes.

## 6. Verification expectations

- A code change is unfinished until relevant focused tests, strict typecheck,
  and `git diff --check` pass.
- Changes to content/build/runtime integration must run `bun run content:check`
  and `bun run build`.
- Changes to a user-visible path must run the relevant production-preview
  Playwright test. Keep smoke short; put complete flows in E2E.
- Use the in-app browser/Chrome connector for exploratory visual or logged-in
  inspection. Keep Playwright for deterministic repository tests and CI. One
  does not replace the other.
- Visual screenshots are evidence for presentation only; they cannot prove
  collision, ordering, determinism, or lifecycle correctness.
- Preserve accessibility trace parity and test gamepad edge semantics. Hardware
  claims require a recorded physical-device matrix; do not infer them from
  browser mocks.

## 7. Code and file discipline

- Prefer manifest-derived registries over copied ID lists.
- Keep authority modules renderer-independent and deterministic. Expose frozen
  snapshots/read-only feedback ports; avoid leaking mutable authority state.
- Use stable code-point ordering and explicit occurrence identities. Do not rely
  on object insertion order, locale sort, render cadence, or floating-point time
  as an identity.
- Preserve unrelated user changes. Use `apply_patch` for hand edits. Do not use
  destructive Git commands or broad deletion targets.
- New generated art must have an approved purpose/provenance and exact PWA or
  runtime sizing tests. Reuse V4 assets before generating substitutes.

## 8. Git workflow

- Work on a focused branch; never commit directly to `main`.
- Make small, reviewable commits by vertical responsibility: content authority,
  clock/events, gameplay lifecycle, narrative state, E2E, or docs.
- Each commit must state the authority change and have passing evidence. Do not
  mix V4 source edits, runtime refactors, generated assets, and documentation in
  one opaque commit.
- Do not push, open a PR, rewrite history, or force-update a remote unless the
  user explicitly requests it. The configured remote is
  `https://github.com/aaajiao/Danmaku.git`.
