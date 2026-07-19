# Danmaku repository agent contract

This file applies to the repository root and all descendants unless a deeper
`AGENTS.md` narrows a rule for its own subtree.

## How to use this contract

- `must`, `never`, and the product/runtime invariants below are hard boundaries.
- Everything described as a preference, default, or example may be adapted when
  the change is safer, clearer, or faster another way. Briefly record a material
  deviation and its reason in the handoff; do not wait for permission for a
  reversible internal engineering choice.
- Keep this file durable and broad. Feature-specific numbers, temporary plans,
  acceptance traces, and one-off implementation lessons belong in the owning
  design document, ADR, roadmap item, test, or fixture—not as permanent root
  rules.
- Optimize for a playable, observable vertical slice. Process exists to protect
  the work and shorten feedback, not to create ceremony.
- Proceed with reasonable assumptions for safe, reversible, in-scope work. Ask
  only when a missing choice would change product meaning, destroy/overwrite
  material state, affect an external party, or materially expand the scope.

## 1. Non-negotiable product identity

- This repository builds a deterministic 1-bit STG from
  `1bit-stg-complete-asset-kit-v4/`.
- The work is an observable behavior/material system, not a score, rank,
  victory, morality, or optimization system. Do not introduce those concepts
  through copy, mechanics, telemetry, achievements, or hidden state.
- Preserve the material/digital double helix: gameplay facts may project into
  visual, audio, haptic, UI, narrative, and memory layers; presentation never
  writes gameplay authority back.
- Treat subtraction, absence, interruption, residue, witness, and handoff as
  authored behaviors. Do not fill intentional silence with generic feedback.
- Before changing gameplay, narrative, copy, visual/audio language, PWA
  identity, or content, read and follow the complete project skill:
  `.agents/skills/aaajiao/SKILL.md`.
- Content or observable rules outside V4 must pass
  `stg-dev/docs/CONTENT_EXTENSION_ZH.md` and receive the required extension ADR
  and provenance. Never create a second gameplay language beside V4.

## 2. Authority and deterministic runtime

When sources disagree, use this order:

1. `1bit-stg-complete-asset-kit-v4/manifests/**` canonical contracts;
2. `1bit-stg-complete-asset-kit-v4/runtime/**` reference machines/oracles;
3. `1bit-stg-complete-asset-kit-v4/gameplay/tools/sim_core.py` QA oracle;
4. `stg-dev/src/authority/**` production authority adapters;
5. `stg-dev/src/game/**` application and presentation integration.

The following rules are firm:

- Do not edit V4 to make application code or tests pass unless the user
  explicitly requests a source-kit change. Fail closed on version, schema, ID,
  reference, file-universe, or SHA-256 drift.
- Silence in V4 is not permission to invent gameplay facts. Preserve unavailable
  facts as typed absence; do not coerce missing information to zero, neutral
  input, or fabricated history.
- Composition is an authority decision. Two valid machines do not imply their
  join timing, ownership, ordering, or failure semantics. Use a focused
  extension decision when an observable join is absent from V4.
- Integer `tick120` is the gameplay time identity. Milliseconds are derived.
  V4 60 Hz machines advance only on every second master tick.
- Pause freezes gameplay time and discards wall time observed while paused.
- Same-tick ordering is
  `collision-off -> state/damage -> collision-on -> entity-spawn -> feedback`.
- Canonical event IDs come only from the V4 schema. Unknown IDs, duplicate
  occurrence keys, incomplete required payloads, and feedback-to-gameplay
  writes are errors.
- Pattern execution uses the canonical seeded RNG stream, stable cadence/entity
  ordering, declaration-order motion operators, enforced safe gaps, and swept
  warning/collision geometry.
- Projectile and laser flight are entity-owned. Collision and lifecycle may not
  be inferred from animation, alpha, atlas frames, audio, reduced motion, or
  renderer state. Never recycle a live collider when a pool is full.
- Weather and accessibility are projections and must preserve the gameplay
  trace.
- Cross-run restore order is material record, ghost/witness projection, then
  player input return. A run ends in observation/handoff, not victory.

## 3. Architecture: shared authority, chapter-owned orchestration

Organize code by ownership and reason to change, not by line count alone and
not by story chapter alone.

- Shared authority owns rules that must remain identical across the game:
  clock, events, RNG, input facts, player/projectile/laser lifecycle, collision,
  persistence, canonical schemas, and read-only projection ports. Keep one
  source of truth for each of these.
- A chapter owns the sequence and policy unique to one playable segment: its
  admission, local state, pattern assembly, transitions, handoff, chapter-only
  presentation, and acceptance path. Chapters consume shared authority; they do
  not copy or fork it.
- Run/session code should be a thin conductor. It selects the active chapter,
  routes input and authoritative ticks, and performs explicit handoffs. A
  chapter should expose a narrow lifecycle such as `start`, `step`, `snapshot`,
  and `handoff`, while keeping mutable internals private.
- Keep the dependency direction one-way:
  `V4 facts -> shared authority -> chapter owner -> presentation/application`.
  Presentation can observe frozen snapshots and feedback ports only.
- When introducing a boundary, prefer a recognizable shared area and a chapter
  area (for example `authority/run/chapters/<chapter>` and, when useful,
  `game/chapters/<chapter>`). These names are a default, not a demand for a
  repository-wide move.

A large file is a warning signal, not an automatic failure. Split a file when
one or more of these are true:

- it owns several independent authorities or several unrelated reasons to
  change;
- chapter-specific policy is mixed into reusable mechanisms;
- a focused test requires constructing most of the game;
- merge conflicts or review navigation repeatedly slow work;
- the public surface is hard to describe without listing unrelated behavior;
- test setup and fixtures obscure the behavior being proved.

Do not split stable cohesive logic into tiny files merely to reduce line count.
Temporary co-location is acceptable while a boundary is still being learned if
there is one owner, no duplicated authority, a focused test, and a clear future
extraction trigger. Prefer incremental extraction along the next real vertical
slice over a large speculative rewrite. Source and tests should gradually mirror
the same shared/chapter boundaries.

## 4. Decision and implementation workflow

- Before a non-trivial gameplay slice, trace the source fact to its producer,
  deterministic consumer, and observable result. Classify a blocker as an
  authority/design gap, implementation defect, or verification problem.
- Reversible internal choices—file layout, private names, helper boundaries,
  test organization, and equivalent algorithms—do not require an ADR when they
  preserve authority and observable behavior. Make a reasonable choice and
  continue.
- Observable rules, content, authority composition, persistence meaning, or a
  new source of gameplay truth do require the owning design/extension decision
  before implementation. Keep proposal/acceptance and implementation as
  separately reviewable changes when practical.
- Prefer the smallest vertical slice that closes a producer, consumer, and
  observable behavior. A broad scaffold or higher coverage number is not
  progress unless it advances the playable loop or retires a named risk.
- Before enabling a selector, router, or transition in the live run, enumerate
  its legal outputs and prove each has a fail-closed admission path. Never
  silently reroll, substitute, or rely on the convenient test seed.
- Report integration depth honestly: adapter, direct executor, live-admitted
  capability, session-owned behavior, and player-visible path are different
  completion states.
- Authority research needs a stop condition. Once the sources, current path,
  and exact omission are known, implement the written rule or propose the
  smallest missing decision; do not keep development waiting on speculative
  archaeology.

## 5. Toolchain

The application is Bun-only. Use the version pinned by the repository and CI
(currently 1.3.14), and keep `stg-dev/bun.lock` as the only JavaScript lockfile.
Do not introduce npm, npx, pnpm, Yarn, `package-lock.json`, or parallel package
scripts. Run application commands from `stg-dev/`:

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

V4 Python validators are immutable reference oracles, not an alternate app
toolchain. Invoke them with `python3 -B` to avoid bytecode output. Do not replace
oracle evidence with a wrapper that simply returns expected values.

## 6. Risk-based verification

Choose evidence from the changed authority and its consumers. The default loop
is focused and fast; broad gates are milestone/release evidence, not a ritual
after every edit.

- A completed code slice runs `git diff --check`, strict typecheck, and the
  smallest focused tests that prove the changed contract, lifecycle, hostile
  input, and relevant cadence/profile behavior.
- Documentation-only changes run `git diff --check` plus link, command, owner,
  and stale-fact review. Do not run application suites unless executable or
  generated inputs changed.
- Leaf changes normally run their focused tests. Shared clock, event, schema,
  player/projectile lifecycle, session, or persistence changes expand to all
  directly affected consumers; use the full unit suite when that dependency
  surface cannot be enumerated reliably.
- Content, schema, bundle, PWA, or runtime-integration changes also run
  `content:check` and `build`. A user-visible path runs its relevant
  production-preview Playwright spec.
- Keep smoke limited to boot and critical availability. Complete journeys and
  chapter acceptance paths belong in E2E. Run `test:all` for a milestone,
  release candidate, PR readiness, broad cross-cutting change, or explicit
  request—not for every small commit.
- Aim for a focused feedback loop measured in seconds or tens of seconds. If a
  narrow suite becomes slow, profile setup and separate one real producer case
  from pure downstream cases before raising timeouts.
- A long deterministic prefix must retain at least one test using the real
  authoritative producer. Pure consumers may use an exact-schema fixture pinned
  to that producer. A fixture is test input, never a second gameplay authority
  or proof of producer lifecycle/order.
- Reproduce the narrow failure, fix it, and rerun that scope before escalating.
  Do not skip, mute, weaken, or inflate timeouts without measured cause.
- Do not run heavy suites concurrently. Cheap independent checks may run in
  parallel. Reuse prior evidence only while its source, fixtures, manifests,
  lockfile, and build inputs remain unchanged.
- State exactly what ran. Never report an unrun gate as passing.
- Use the in-app browser/Chrome for exploratory inspection and Playwright for
  deterministic repository evidence. Screenshots prove presentation only, not
  collision, ordering, determinism, or lifecycle. Preserve accessibility trace
  parity and gamepad edge semantics. Hardware claims require a recorded
  physical-device matrix, not browser mocks.

Automatic GitHub push/PR CI is intentionally paused during the current early
development phase. Keep workflows manual-only until the game reaches an Alpha
candidate with the P0 authoritative loop closed, the full local gate stable,
and the user explicitly agrees to re-enable automation. Local verification is
still required.

## 7. Game-development documentation

Documentation is a production artifact. One changing fact has one canonical
owner; other documents link to it instead of copying counts, hashes, status,
test output, or implementation history.

- Root `README.md`: repository onboarding, document map, coarse playable
  boundary, and shortest setup path.
- `stg-dev/README_ZH.md`: application quickstart, inputs, PWA/dev commands, and
  stable package map.
- `stg-dev/docs/GAME_DESIGN_ZH.md`: player experience, authored loop, game
  rules, material/negative-space meaning, input intent, and accessibility intent.
- `stg-dev/docs/ARCHITECTURE_ZH.md`: stable technical boundaries, dependency
  direction, clocks, event/lifecycle contracts, persistence, and shared/chapter
  architecture.
- `stg-dev/docs/ROADMAP_ZH.md`: the single current production status, milestone,
  priority, dependency, risk, and definition-of-done owner.
- `stg-dev/docs/TESTING_ZH.md`: QA strategy, scope selection, commands, release
  gates, performance policy, and device evidence.
- `stg-dev/docs/CONTENT_EXTENSION_ZH.md`: extension intake, approval, and
  provenance.
- `stg-dev/docs/adr/**`: one durable decision per ADR, including alternatives,
  consequences, provenance, rollback, and supersession.

When a chapter needs more than a short GDD/roadmap entry, give it one indexed
chapter document or small chapter folder that owns its flow, local assets,
acceptance path, and links to relevant ADRs/tests. Keep shared mechanics in the
GDD/architecture and current completion in the roadmap; do not duplicate them
inside every chapter. The exact folder layout may evolve with the game.

Route a slice only to documents whose owned facts changed: player rule to GDD;
stable technical boundary to architecture/ADR; current state to roadmap; test
method to the testing guide; chapter-local flow to its chapter document.
Accepted ADRs are historical decisions, not rolling test reports. Preserve
provenance and use an erratum or successor when meaning changes.

Before a documentation commit, verify links and commands, check owned status
for stale claims, and remove duplicated mutable facts.

## 8. Code, assets, and workspace discipline

- Prefer manifest-derived registries over copied ID lists.
- Keep authority renderer-independent and deterministic. Expose frozen
  snapshots/read-only feedback ports; do not leak mutable authority state.
- Use stable code-point ordering and explicit occurrence identity. Do not rely
  on locale sort, render cadence, floating-point time, or accidental insertion
  order as identity.
- Preserve unrelated user changes. Use `apply_patch` for hand edits. Avoid
  destructive Git operations and broad deletion targets.
- Reuse V4 art before generating substitutes. New generated art needs approved
  purpose/provenance and exact runtime/PWA sizing evidence.
- Keep Python bytecode, build output, browser reports, local caches, and macOS
  `Icon\r` metadata ignored and untracked.
- Intentional `.agents/skills/**` changes are normal repository changes. Review,
  verify, commit, and push them like other focused work; do not treat them as
  local Codex cache.

## 9. Commit and push workflow

- Work on a focused non-`main` branch. Never commit or push directly to `main`.
- Finish, verify, commit, and—when authorized—push each reviewable vertical
  slice before starting another completed responsibility. Do not stockpile
  finished work in the working tree.
- A commit must be coherent and usable. Do not knowingly commit a broken or
  half-integrated state merely to make the tree clean. If work is interrupted,
  finish the current safe boundary or keep the incomplete paths isolated and
  report them plainly.
- Split commits by authority or production responsibility. Avoid opaque mixes
  of V4 source, runtime refactor, generated assets, skills, tests, and unrelated
  documentation.
- Stage explicit paths, inspect the staged diff, and preserve unrelated or
  unfinished changes. A focused documentation commit may coexist with isolated
  unstaged implementation work.
- Commit messages state the authority or production-document change. The
  handoff names the exact verification evidence.
- Explicit push authorization for the current non-`main` workstream continues
  for its subsequent completed commits until revoked. Verify branch, upstream,
  and staged scope before every push.
- Opening a PR, amending/rebasing published history, rewriting history, or force
  updating a remote needs separate explicit authorization. The remote is
  `https://github.com/aaajiao/Danmaku.git`.

## 10. Completion and communication

- Lead with the playable or production outcome in plain language.
- Distinguish completed, directly testable, session-integrated, and
  player-visible work. Name remaining blockers without hiding them behind test
  counts.
- Report the commit and push status for every completed slice, plus the tests
  actually run. If a broader gate was intentionally deferred, say why and when
  it becomes necessary.
