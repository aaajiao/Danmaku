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

The available project gates are below. Select them by change risk as described
in section 6; do not run every gate after every small edit. Run commands from
`stg-dev/`:

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

## 6. Risk-based verification workflow

Choose tests from the changed authority and its consumers. The default feedback
loop is focused and fast; broad gates are escalation and release evidence, not
a ritual after every small edit.

- Every completed code slice must pass `git diff --check`, strict typecheck, and
  the smallest test file/name scope that proves the changed behavior. A typical
  focused command is `bun run test -- <test-file> -t "<case or describe>"`.
- Documentation-only changes require `git diff --check` plus link, command, and
  stale-fact review. Do not run JavaScript suites unless the documentation
  change also modifies generated content, manifests, executable examples, or a
  release artifact.
- Leaf authority or one-pattern changes run their focused contract, lifecycle,
  determinism, hostile-input, and relevant profile/cadence cases. Expand to
  directly affected consumer test files when a public contract changes.
- Shared clock, event bus, projectile/player lifecycle, schema, session, or
  persistence changes first run focused reproductions, then all directly
  affected suites. Run `bun run test:unit` once only when the dependency surface
  is broad enough that enumerating consumers would be less trustworthy.
- Content, schema, bundle, PWA, or runtime-integration changes run
  `bun run content:check` and `bun run build` in addition to focused tests and
  typecheck. Pure leaf authority work does not need a build unless it changes a
  bundled or user-visible path.
- User-visible changes run the relevant production-preview Playwright spec.
  Keep smoke limited to boot and critical availability; complete flows belong
  in E2E, and unrelated browser specs need not be repeated.
- Run `bun run test:all` once after targeted scopes are green for a milestone,
  release candidate, PR readiness check, broad cross-cutting change, or an
  explicit request. Do not run it once per small commit.
- Automatic GitHub push/PR CI is intentionally paused during the current
  `FOUNDATION` phase; `.github/workflows/ci.yml` is manual-only. This does not
  waive local pre-commit evidence. Do not restore automatic triggers before the
  roadmap reaches an Alpha candidate with the P0 authority loop closed and the
  full gate stable, unless the user explicitly asks sooner.
- When debugging a failure, reproduce the narrow failing scope, fix it, and
  rerun that scope before escalating. Distinguish assertion failures from time
  budget failures. Increase a timeout only with measured evidence; never skip,
  mute, or weaken an assertion to make a gate pass.
- Do not run heavy suites concurrently: resource contention makes timing
  evidence unreliable. Cheap independent checks may run in parallel.
- A prior full-gate result may be reused only while the tested source, fixtures,
  manifests, dependency lock, and build inputs remain unchanged. State exactly
  which commands were run; never report an unrun gate as passing.
- Use the in-app browser/Chrome connector for exploratory visual or logged-in
  inspection. Keep Playwright for deterministic repository tests and CI. One
  does not replace the other.
- Visual screenshots are presentation evidence only; they cannot prove
  collision, ordering, determinism, or lifecycle correctness. Preserve
  accessibility trace parity and gamepad edge semantics. Hardware claims
  require a recorded physical-device matrix, not browser mocks.

## 7. Game-development documentation workflow

Treat documentation as owned production artifacts. One fact has one canonical
document owner; other documents link to it instead of copying mutable counts,
hashes, test output, or implementation history.

- Root `README.md` is the repository onboarding and document map: identity,
  coarse current playable boundary, shortest setup/run/verification path, and
  links. `stg-dev/README_ZH.md` is the application-package quickstart: directory
  map, inputs, PWA/dev commands, and stable authority boundary. Neither README
  is a changelog, pattern ledger, test report, or hash store.
- `stg-dev/docs/GAME_DESIGN_ZH.md` is the GDD/design bible. It owns player
  experience, authored loops, game rules, material/negative-space semantics,
  input intent, and accessibility intent. Do not put implementation class
  names, current test totals, build results, or engineering coverage there.
- `stg-dev/docs/ARCHITECTURE_ZH.md` is the technical design document. It owns
  stable authority boundaries, dependency direction, clocks, event ordering,
  lifecycle contracts, persistence seams, and cross-module decisions. Current
  completion percentages, backlog, and per-pattern trace dumps belong elsewhere.
- `stg-dev/docs/ROADMAP_ZH.md` is the single hand-maintained production-status
  owner. It records milestones, priority, DONE/WIP/TODO state, dependencies,
  risks, and concise definitions of done. A compact current coverage snapshot is
  allowed; per-seed hashes, long test output, and mechanism specifications are
  not.
- `stg-dev/docs/TESTING_ZH.md` owns QA strategy, scope-selection rules, commands,
  release gates, performance policy, and device matrices.
  `stg-dev/e2e/README.md` may remain a short local E2E runbook. Exact seeds,
  hashes, event counts, and expected traces live in executable fixtures or
  immutable generated/CI evidence, not duplicated prose.
- `stg-dev/docs/CONTENT_EXTENSION_ZH.md` owns extension intake, approval, and
  provenance requirements. Do not restate those rules in feature status notes.
- Each ADR owns one durable decision, alternatives, consequences, provenance,
  and rollback/supersession path. Accepted ADRs do not receive rolling coverage
  or test-total updates; only status, explicit supersession, or dated errata may
  change. Preserve historical umbrella ADRs and their provenance, and create a
  focused successor ADR for a new independent decision.
- Route a vertical slice only to documents whose owned facts changed: player
  rule -> GDD; stable technical boundary -> architecture or a focused ADR;
  production status -> roadmap; QA method -> testing guide. Ordinary capability
  work should not be copied into every README, GDD, architecture, roadmap, QA,
  and ADR file.
- Before a documentation commit, verify links and commands, scan owned status
  fields for stale dates/counts, and remove duplicate claims. When moving V4
  authority or provenance, retain the original ADR plus commit/digest and add
  reciprocal links; never silently rewrite or delete its source history.

## 8. Code and file discipline

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

## 9. Commit and push workflow

- Work on a focused branch; never commit directly to `main`.
- Finish, verify, commit, and—when authorized—push one reviewable vertical slice
  before starting the next slice. Do not accumulate several already-complete
  responsibilities in the worktree.
- Split commits by authority responsibility: content authority, clock/events,
  gameplay lifecycle, narrative state, E2E, documentation policy, or another
  coherent seam. Do not mix V4 source edits, runtime refactors, generated
  assets, skills, and unrelated documentation in one opaque commit.
- Stage explicit paths, inspect the staged diff and status, and preserve all
  unrelated user changes. Never use broad staging to sweep in unknown files.
  Keep macOS `Icon\r`, generated Python bytecode, build output, browser reports,
  and local caches untracked. Intentional `.agents/skills/**` changes are normal
  repository changes and receive their own focused commit when appropriate.
- Each commit message must state the authority or production-document change,
  and the handoff must name the exact verification evidence that passed.
- Pushing requires explicit user authorization. When the user authorizes pushes
  for the current non-`main` branch/workstream, treat that as continuing
  authorization to push each newly completed commit on that same branch until
  revoked; verify the branch and upstream before every push.
- Never push `main`, open a PR, amend/rebase published history, rewrite history,
  or force-update a remote without separate explicit authorization. The
  configured remote is `https://github.com/aaajiao/Danmaku.git`.
