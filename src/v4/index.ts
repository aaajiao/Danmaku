/**
 * V4 edition composition root.
 *
 * This is compiled, reviewed project code rather than a downloadable asset
 * pack. It installs the deterministic danmaku vocabulary, authored background
 * shaders, v4 fallback score, and the four-stage campaign in dependency order.
 * `packs/v4` remains the data-only release presentation selected by the loader.
 */

import './gameplay/behaviours';
import './gameplay/patterns';
import './backgrounds';
import './audio';
import './content';

export { CONTENT_FINGERPRINT } from './content';
