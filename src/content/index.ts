/**
 * Every content module, imported for its registration side effects.
 *
 * ## Why this file has to exist
 *
 * Content registers itself when its module is evaluated — `defineEnemy`,
 * `defineBoss`, `definePattern`, `defineBehaviour`, `defineShot`, `defineStage`
 * all run at import time. A module nothing imports is never evaluated, so its
 * content simply does not exist at runtime.
 *
 * That failure is silent and it already happened: `behaviours.ts`, `shots.ts`
 * and `stage-2.ts` were written, tested and green, while being unreachable from
 * the running game. Their tests imported them directly, so the suite proved
 * they *worked* and proved nothing about whether they were *there*. A bundle
 * count is what caught it — 41 modules, unchanged after adding a stage.
 *
 * So: one place that imports all of it, and one test asserting the registries
 * are populated after importing only this file. Adding content means adding a
 * line here. Forgetting to is the mistake this file makes visible.
 */

import './behaviours';
import './patterns';
import './shots';
import './stage';
import './stage-2';
