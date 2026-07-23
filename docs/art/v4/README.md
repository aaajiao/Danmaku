# v4 original art

This directory keeps the accepted, full-resolution generated artwork that
defines v4's visual direction.  These PNGs are source references, not runtime
atlases: runtime-ready crops and packed sheets live under `src/assets/v4/` and
`packs/v4/`.

`originals-manifest.json` records the byte-exact files, dimensions and SHA-256
hashes.  A generated image is not considered preserved until it is present in
this directory and listed there; the Codex generation cache is not a project
source.

The former `archive/colour-pose-drafts/` set was deliberately removed.  It was
an obsolete colour-pose exploration, not part of the accepted v4 art direction,
and remains recoverable from Git history.

## Accepted originals

- `style-lock-ghost-layers.png` — surface / skeleton / mycelium visual grammar.
- `player-cast-ghoststyle-master.png` — five-player pose master.
- `enemies-stage-1-ghoststyle-master.png` through
  `enemies-stage-4-ghoststyle-master.png` — four enemy-cast masters.
- `boss-cast-ghoststyle-master.png` — five-boss pose master.
- `boss-cast-ghoststyle-atlas-master.png` — accepted 25-pose isolation master
  used by `tools/v4-actor-assets.ts`; unlike the earlier flattened contact
  sheet, every silhouette has a recoverable foreground component before runtime
  packing.
- `projectile-style-lock.png` — projectile and effect language.
- `ui-style-lock.png` — UI composition and ornament language.
- `ui-production-ornaments-master.png` — accepted six-component UI production
  source generated from the UI style lock; keep its green-key original intact.
- `ui-screen-perimeter-master.png` — preserved generated perimeter study.  The
  closed outer frame was rejected after live composition review, so this file
  is retained as original art but is not read by the runtime-atlas generator.

Keep originals byte-for-byte.  Derive production assets into their runtime
locations; do not overwrite these files with crops, transparency conversions or
packed atlases.
