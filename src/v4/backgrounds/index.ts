/**
 * The authored v4 backgrounds.
 *
 * `../../render/background.ts` is the engine — registry, `Background`, the shared noise
 * helpers, the cross-fade. Nothing in it looks like anything. Everything that
 * does lives here, one scene per file, and reaches the game only because this
 * index imports it.
 *
 * These are side-effect imports. A background module nothing imports never
 * calls `defineBackground`, so the scene simply does not exist at runtime and
 * `getBackgroundSpec` throws the first time a stage names it. That failure has
 * already happened once in this repository, to content rather than to
 * backgrounds — see `content/index.ts`. `index.test.ts` reads this directory
 * and fails when a file here is missing from the list below.
 *
 * ## Why these are not in `src/content/`
 *
 * They are content in every sense that matters to whoever writes one. They are
 * not in `src/content/` because a background is a fragment shader, registering
 * one means importing `../../render/background`, and `src/content/` may not import from
 * `src/render/` (CLAUDE.md, "Repository layout"). That rule is what keeps the
 * simulation headlessly testable, and it is worth more than the tidiness of
 * having all authored material under one root.
 *
 * A stage therefore names its scene as a **string** and never imports it. The
 * name is resolved in the shell, which is the only place that knows both.
 *
 * ## One editing hazard, which has bitten twice
 *
 * Shader source is a template literal, so a **backtick anywhere inside it ends
 * the string**. That includes backticks in your GLSL comments — writing
 * `` `depth` `` to set a term in prose type terminates the literal and the rest
 * of the shader is parsed as TypeScript. The errors that follow point at
 * whatever line the parser finally gave up on, never at the backtick, so they
 * read as nonsense: "no value exists in scope for the shorthand property
 * 'depth'".
 *
 * The compiler does catch it, which is the saving grace. But recognise the shape
 * of it rather than debugging it twice, and write GLSL comments in plain prose.
 */

import './cordon';
import './decree';
import './drift';
import './expanse';
import './intaglio';
import './regnum';
import './sable';
import './signal-decay';
import './signet';
import './stratum';
import './structure';
import './surge';
import './umbra';
import './undertow';
import './vault';
