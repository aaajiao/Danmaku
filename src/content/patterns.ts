/**
 * Compatibility facade for the active edition's danmaku vocabulary.
 *
 * Registry machinery and emitter primitives stay engine-owned in
 * `pattern-registry.ts`. Importing this historical entry point installs the
 * compiled v4 pattern definitions, then re-exports the generic API used by the
 * simulation and pack validator.
 */

import '../v4/gameplay/patterns';

export * from './pattern-registry';
