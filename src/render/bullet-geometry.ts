/**
 * Presentation geometry for a carried blade projectile.
 *
 * The simulation owns the capsule: `bladeHalf` is half the centre line and
 * `radius` rounds both ends. A skin may carry more texels, but it must never be
 * drawn as a 5px spark around a 30px lethal capsule. Explicit content width or
 * height still wins; otherwise the quad covers the collision silhouette in the
 * sprite convention (long axis local +x, rotation applied by SpriteBatch).
 */
export function bladeDisplaySize(
  style: { width?: number; height?: number },
  bladeHalf: number,
  radius: number,
  strip?: {
    frameW: number;
    frameH: number;
    displayW?: number;
    displayH?: number;
    contentW?: number;
    contentH?: number;
  },
): { width?: number; height?: number } {
  if (style.width !== undefined || style.height !== undefined) {
    if (bladeHalf <= 0) return { width: style.width, height: style.height };
    return {
      width: style.width ?? 2 * (bladeHalf + radius),
      height: style.height ?? Math.max(4, 2 * radius),
    };
  }

  const lethalW = bladeHalf > 0 ? 2 * (bladeHalf + radius) : 2 * radius;
  const lethalH = bladeHalf > 0 ? Math.max(4, 2 * radius) : 2 * radius;
  if (
    strip === undefined ||
    strip.contentW === undefined ||
    strip.contentH === undefined ||
    strip.contentW <= 0 ||
    strip.contentH <= 0
  ) {
    if (bladeHalf <= 0) return { width: undefined, height: undefined };
    return { width: lethalW, height: lethalH };
  }

  // `displayW/H` size the whole padded frame. Work out how much of that quad is
  // actually painted, then compensate only an axis whose paint is smaller than
  // the lethal circle/capsule. The existing Law-of-Geometry size stays intact on
  // every safe axis; transparent gutters never count as a danger cue.
  const baseW = strip.displayW ?? strip.frameW;
  const baseH = strip.displayH ?? strip.frameH;
  const paintedW = baseW * strip.contentW / strip.frameW;
  const paintedH = baseH * strip.contentH / strip.frameH;
  return {
    width: baseW * Math.max(1, lethalW / paintedW),
    height: baseH * Math.max(1, lethalH / paintedH),
  };
}
