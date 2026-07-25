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
| Authored shader-driven scenes | [`backgrounds/`](./backgrounds), with fixed hybrid plates in [`src/assets/v4/backgrounds`](../assets/v4/backgrounds) | Registry, shared GLSL helpers, art preload, cross-fade and renderer in [`src/render/background.ts`](../render/background.ts) |
| Campaign structure and simulation authoring | [`tools/make-v4-content.ts`](../../tools/make-v4-content.ts) | Pack schema and injector in [`src/packs/`](../packs) plus the enemy/boss/stage/player registries |
| Campaign dialogue and ending copy | [`content/narrative.ts`](./content/narrative.ts) | Boss dialogue transport in campaign data; generic paging and transitions in [`src/game/states.ts`](../game/states.ts) |
| Ending visual choreography | [`ending/`](./ending) and [`backgrounds/wear-field.ts`](./backgrounds/wear-field.ts) | The generic ending page clock in [`src/game/states.ts`](../game/states.ts), batch opacity and trace drawing in [`src/main.ts`](../main.ts), and scalar uniform application in [`src/render/background.ts`](../render/background.ts) |
| Generated campaign | [`content/campaign.json`](./content/campaign.json) and [`content/campaign.fingerprint.ts`](./content/campaign.fingerprint.ts) | Replay identity hashes campaign data plus compiled v4 patterns/behaviours; simulation carries only the opaque string |
| Compiled edition images | [`src/assets/v4`](../assets/v4) | Bun resolves imports; [`tools/relocate-v4-assets.ts`](../../tools/relocate-v4-assets.ts) closes the production inventory inside the presentation-pack boundary at `dist/packs/v4/assets/` |
| Raster and HUD art | [`packs/v4`](../../packs/v4) via [`tools/make-v4-pack.ts`](../../tools/make-v4-pack.ts) | Runtime pack loader, atlas renderer and procedural fallback |
| Audio identity and release assets | [`audio/`](./audio), [`docs/v4-audio-direction.md`](../../docs/v4-audio-direction.md), and generated release audio in [`packs/v4`](../../packs/v4) | Sound/music registries, synthesis and WebAudio playback in [`src/audio`](../audio) |

The distinction is ownership, not duplication. `src/v4` supplies one edition's
definitions to generic registries; the registries, simulation and renderer do
not become v4-specific.

## Composition and pack boundary

[`index.ts`](./index.ts) installs the edition in dependency order:

1. deterministic motion behaviours;
2. deterministic danmaku patterns;
3. authored background shaders and their optional project-owned painted plates;
4. v4 audio identity and fallback score;
5. generated campaign data and the stage-keyed v4 ending.

[`src/main.ts`](../main.ts) imports that root before it calls the runtime pack
loader. Campaign injection can therefore resolve every pattern, behaviour,
scene and music name before a guest pack is discovered.

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

- Structural and simulation campaign changes start in
  [`tools/make-v4-content.ts`](../../tools/make-v4-content.ts). English dialogue
  and ending changes start in [`content/narrative.ts`](./content/narrative.ts).
  Dialogue is assembled into campaign data, so either kind of generated-content
  change is followed by `bun run make:v4-content`. Do not hand-edit generated
  JSON or its fingerprint.
- Ending layer targets and the presentation-only stage-4 route recorder live in
  [`ending/`](./ending). They may change frozen rendering, never `Run`, campaign
  bytes or replay identity.
- Pattern and behaviour changes are ordinary reviewed TypeScript under
  [`gameplay/`](./gameplay). They remain inside the deterministic and headless
  architecture scans.
- Scene changes are made in [`backgrounds/`](./backgrounds), one fragment shader
  per file, and imported by its index. A scene may bind one fixed plate from
  [`src/assets/v4/backgrounds`](../assets/v4/backgrounds); composition and motion
  remain in that scene's shader. The generic background renderer remains
  scene-free.
- Track identity and the emergency score floor belong in [`audio/`](./audio);
  release samples are generated into `packs/v4` under the v4 audio direction.
- Replaceable sprite/HUD art changes belong to the independent `packs/v4`
  generator and manifest. Shader-coupled background plates belong to
  `src/assets/v4/backgrounds` and are compiled with the edition. Neither path may
  be used as a route for simulation or guest shader logic.

## Ending visual boundary

The real stage-4 terminal ending selects the independent `wear-field` scene.
GAME OVER keeps the neutral shader-only `signal-decay` scene, so v4's narrative
image cannot leak into a generic failure or guest campaign.

`wear-field` uses one original 1086×1448 master, deterministically compiled by
`bun run make:v4-backgrounds` to a 480×640 runtime plate. It is not a set of
three CGs and contains no character, throne, baked copy or pre-drawn route. The
three authored pages subtract the painted contribution at targets `0.30`,
`0.16` and `0.04`: first the frozen field remains as residue, then the diminished
player and the route actually flown through stage 4 become the evidence, and
finally body and trace leave with almost all of the plate. Fixed-tick shader
motion remains underneath.

The generic state machine exposes only page index, count and fixed-tick page age.
[`ending/presentation.ts`](./ending/presentation.ts) owns the v4 layer mix;
[`ending/trace.ts`](./ending/trace.ts) samples the completed run into bounded,
death-separated presentation segments. Neither module mutates simulation state,
draws RNG or changes replay content. That split is part of the edition boundary,
not a generic ending style for packs to inherit.

## Ownership migration and the first authored revision

The move into `src/v4` was an ownership-only, replay-neutral migration:

- `content/campaign.json` is byte-identical to the former
  `src/packs/base-pack.json`. Its SHA-256 is
  `919d306d8f6aad6399705060392ed982aa1ade333ab8f0c4105dfacc6a7a42ea`, and the
  replay-facing fingerprint was `919d306d8f6a`.
- [`tools/make-v4-content.test.ts`](../../tools/make-v4-content.test.ts) pins the
  committed campaign bytes and generated fingerprint to their authoring source.
- [`backgrounds/index.test.ts`](./backgrounds/index.test.ts) pins every migrated
  scene's assembled GLSL SHA-256 and scroll speed to the pre-move runtime values.
- The traces used by [`src/base-content.golden.test.ts`](../base-content.golden.test.ts)
  were not regenerated for that move.

The later spatial-language revision is deliberately **not** replay-neutral. It
adds `alternating-fan`, `gap-ring`, `weave` and `lane-wall`, reauthors the cast's
actual firing signatures, and regenerates the eight Normal/Lunatic traces. The
generated `CONTENT_FINGERPRINT` now hashes campaign JSON together with the exact
`patterns.ts` and `behaviours.ts` bytes, closing the migration-era hole where
compiled danmaku could change under an unchanged replay identity.

The current Boss-identity revision is also intentional simulation drift. It adds
`moon-gate`, `verdict-shear`, `archive-trace` and `memory-groove`; carries one
exclusive verb through every phase of Sentinel, Magistrate, Chancellor and
Regent; and regenerates all eight Normal/Lunatic traces. Their ordinary bullets
also use four exclusive atlas cadences and dedicated V4-style painters—lunar
eyes, verdict blades, archive eye-seals, and rooted crown crystals—rather than
decorated generic floors; `boss-phase` raises four view-only declaration
sequences. The resulting replay fingerprint is `6299ed3e66aa`.
Player focus stances and five identity bombs remain part of the earlier
intentional gameplay revision.

`campaign.json` still contains the description “stage-1 and stage-2, their cast
and bosses.” That string is stale historical metadata: the actual edition has
four stages, sixteen enemies and five bosses. It remains frozen in this migration
because metadata is part of the hashed campaign bytes. Correct it only in a
separate, intentional content revision that regenerates the JSON and fingerprint
and explicitly accounts for the resulting replay compatibility change.

If a future change moves any baseline above, describe it as a gameplay,
presentation or compatibility change. It is no longer merely an ownership move.
