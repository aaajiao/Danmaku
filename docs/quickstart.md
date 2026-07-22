# Pack quickstart — deferred until v4 is final

`packs/v4` is currently the repository's only loadable, committed and shipped
pack. The old `clearing` walkthrough and generated `example` pack described a
pre-v4 asset contract, so they were retired instead of being left as misleading
templates.

`packs/example/` intentionally contains only a README. After v4's visual and
asset contracts are locked, that directory and a new Art Kit will be rebuilt
together from the final atlas names, dimensions, animation rules and ownership
model. There is no current example-pack or Art-Kit generation command.

Until that rebuild, use the authoritative references directly:

- [`docs/packs.md`](./packs.md) — manifest format, validation, activation and
  content injection.
- [`docs/extending.md`](./extending.md) — adding bullets, patterns, enemies,
  bosses, stages and behaviours.
- [`docs/assets.md`](./assets.md) — current image constraints and the v4 source
  of truth.
- [`packs/v4/README.md`](../packs/v4/README.md) — the only shipped pack's atlas
  layout and project-owned provenance.

For temporary local experiments, create a separately named directory under
`packs/` with a valid `pack.json`, run `bun run dev`, and select it explicitly
with `?pack=<name>`. Do not use `packs/example` as scratch space: keeping it
manifest-free ensures it cannot enter the development index or production
build before the coordinated v4-derived example is ready.

Before committing any future pack work, run:

```sh
bun run typecheck
bun run typecheck:tools
bun test
bun run build
```
