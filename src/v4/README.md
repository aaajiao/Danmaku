# v4 edition ownership

`src/v4` is the compile-time composition root for the active game edition. It
contains project code and bundled campaign data reviewed with the executable;
it is not a downloadable asset pack.

The similarly named [`packs/v4`](../../packs/v4) is deliberately separate. It
is a pure-data presentation pack: manifest metadata, project-owned raster
atlases and HUD images. It contains no campaign `content`, TypeScript,
JavaScript or GLSL. Loading that pack paints v4; it does not install v4's rules.

## Ownership map

| Surface | v4 source of truth | Generic machinery that remains outside v4 |
|---|---|---|
| Edition composition | [`index.ts`](./index.ts) | Browser boot in [`src/main.ts`](../main.ts) |
| Danmaku definitions | [`gameplay/patterns.ts`](./gameplay/patterns.ts) | Registry and emitter primitives in [`src/content/pattern-registry.ts`](../content/pattern-registry.ts) |
| Motion definitions | [`gameplay/behaviours.ts`](./gameplay/behaviours.ts) | Registry, timelines and integration in [`src/sim/motion.ts`](../sim/motion.ts) |
| Authored shader scenes | [`backgrounds/`](./backgrounds) | Registry, shared GLSL helpers, cross-fade and renderer in [`src/render/background.ts`](../render/background.ts) |
| Campaign authoring | [`tools/make-v4-content.ts`](../../tools/make-v4-content.ts) | Pack schema and injector in [`src/packs/`](../packs) plus the enemy/boss/stage/player registries |
| Generated campaign | [`content/campaign.json`](./content/campaign.json) and [`content/campaign.fingerprint.ts`](./content/campaign.fingerprint.ts) | Replay carries the opaque content fingerprint; simulation does not import the pack loader |
| Raster and HUD art | [`packs/v4`](../../packs/v4) via [`tools/make-v4-pack.ts`](../../tools/make-v4-pack.ts) | Runtime pack loader, atlas renderer and procedural fallback |

The distinction is ownership, not duplication. `src/v4` supplies one edition's
definitions to generic registries; the registries, simulation and renderer do
not become v4-specific.

## Composition and pack boundary

[`index.ts`](./index.ts) installs the edition in dependency order:

1. deterministic motion behaviours;
2. deterministic danmaku patterns;
3. authored background shaders;
4. generated campaign data.

[`src/main.ts`](../main.ts) imports that root before it calls the runtime pack
loader. Campaign injection can therefore resolve every pattern, behaviour and
scene name before a guest pack is discovered.

A pack may replace presentation and may arrange supported JSON content. It may
name an already registered pattern, behaviour or background, but the manifest
has no field that can evaluate code. No arbitrary pack—including `packs/v4`—can
inject TypeScript, JavaScript or GLSL. New executable v4 vocabulary belongs in
`src/v4` and ships only after compilation and review.

Historical import paths remain as compatibility facades:

- `src/content/patterns.ts` installs v4 patterns and re-exports the generic
  pattern API;
- `src/content/behaviours.ts` installs v4 behaviours;
- `src/render/backgrounds/index.ts` installs v4 scenes;
- `src/packs/bundled.ts` re-exports v4's bundled campaign entry.

Do not put new authored v4 implementation in those facades. Their purpose is to
keep older imports working while ownership stays visible under this directory.

## Editing the edition

- Campaign changes start in
  [`tools/make-v4-content.ts`](../../tools/make-v4-content.ts), followed by
  `bun run make:v4-content`. Do not hand-edit generated JSON or its fingerprint.
- Pattern and behaviour changes are ordinary reviewed TypeScript under
  [`gameplay/`](./gameplay). They remain inside the deterministic and headless
  architecture scans.
- Scene changes are made in [`backgrounds/`](./backgrounds), one fragment shader
  per file, and imported by its index. The generic background renderer remains
  scene-free.
- Art changes belong to the independent `packs/v4` generator and manifest. They
  must not be used as a route for simulation or shader logic.

## Ownership-migration baseline

The move into `src/v4` is an ownership-only, replay-neutral migration:

- `content/campaign.json` is byte-identical to the former
  `src/packs/base-pack.json`. Its SHA-256 is
  `919d306d8f6aad6399705060392ed982aa1ade333ab8f0c4105dfacc6a7a42ea`, and the
  replay-facing fingerprint is intentionally revised with authored campaign
  changes; the current campaign is `b342fac308ec`.
- [`tools/make-v4-content.test.ts`](../../tools/make-v4-content.test.ts) pins the
  committed campaign bytes and generated fingerprint to their authoring source.
- [`backgrounds/index.test.ts`](./backgrounds/index.test.ts) pins every migrated
  scene's assembled GLSL SHA-256 and scroll speed to the pre-move runtime values.
- The committed traces used by
  [`src/base-content.golden.test.ts`](../base-content.golden.test.ts) were not
  regenerated. Moving ownership must not change their simulation fingerprints.

`campaign.json` still contains the description “stage-1 and stage-2, their cast
and bosses.” That string is stale historical metadata: the actual edition has
four stages, sixteen enemies and five bosses. It remains frozen in this migration
because metadata is part of the hashed campaign bytes. Correct it only in a
separate, intentional content revision that regenerates the JSON and fingerprint
and explicitly accounts for the resulting replay compatibility change.

If a future change moves any baseline above, describe it as a gameplay,
presentation or compatibility change. It is no longer merely an ownership move.
