/**
 * V4 edition composition root.
 *
 * This is compiled, reviewed project code rather than a downloadable asset
 * pack. It installs the deterministic danmaku vocabulary, authored background
 * shaders, and the four-stage campaign in dependency order. `packs/v4` remains
 * the data-only raster presentation selected by the loader.
 */

import './gameplay/behaviours';
import './gameplay/patterns';
import './backgrounds';
import './content';

export { CONTENT_FINGERPRINT } from './content';
