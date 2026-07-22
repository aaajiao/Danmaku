import { describe, expect, test } from 'bun:test';
import { decodePng, type DecodedImage } from '../../tools/png-decode';
import { bladeDisplaySize } from './bullet-geometry';
import { MISSILE_STRIPS, bulletEngineContent, displaySize, unionExtent } from './procedural';

interface ProjectileSpec {
  readonly style: { readonly sprite: string; readonly width?: number; readonly height?: number };
  readonly radius: number;
  readonly blade?: { readonly length: number };
  readonly laser?: unknown;
  readonly missile?: unknown;
}

interface NativeStrip {
  readonly x?: number;
  readonly y?: number;
  readonly frameW: number;
  readonly frameH: number;
  readonly frames?: number;
  readonly stride?: number;
  readonly contentW: number;
  readonly contentH: number;
}

function collectProjectiles(value: unknown, out: ProjectileSpec[] = []): ProjectileSpec[] {
  if (Array.isArray(value)) {
    value.forEach((child) => collectProjectiles(child, out));
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  const record = value as Record<string, unknown>;
  const style = record.style;
  if (
    typeof record.radius === 'number' &&
    style !== null &&
    typeof style === 'object' &&
    typeof (style as Record<string, unknown>).sprite === 'string'
  ) {
    out.push(value as ProjectileSpec);
  }
  Object.values(record).forEach((child) => collectProjectiles(child, out));
  return out;
}

function measuredUnion(image: DecodedImage, strip: NativeStrip): { width: number; height: number } {
  let minX = strip.frameW;
  let minY = strip.frameH;
  let maxX = -1;
  let maxY = -1;
  const frames = strip.frames ?? 1;
  const stride = strip.stride ?? strip.frameW;
  for (let frame = 0; frame < frames; frame++) {
    const frameX = (strip.x ?? 0) + frame * stride;
    const frameY = strip.y ?? 0;
    for (let y = 0; y < strip.frameH; y++) {
      for (let x = 0; x < strip.frameW; x++) {
        const alpha = image.rgba[(((frameY + y) * image.width + frameX + x) * 4) + 3]!;
        if (alpha === 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe('v4 hostile projectile visibility', () => {
  test('decoded paint contains every non-laser circle and capsule fired by enemies or bosses', async () => {
    const base = await Bun.file(new URL('../v4/content/campaign.json', import.meta.url)).json() as {
      content: { enemies: unknown; bosses: unknown };
    };
    const manifest = await Bun.file(new URL('../../packs/v4/pack.json', import.meta.url)).json() as {
      assets: {
        bullets: { sheet: string; strips: Record<string, NativeStrip> };
        missiles: Record<string, NativeStrip & { src: string }>;
      };
    };
    const bulletImage = decodePng(await Bun.file(new URL(`../../packs/v4/${manifest.assets.bullets.sheet}`, import.meta.url)).bytes());
    const missileEntry = Object.values(manifest.assets.missiles)[0]!;
    const missileImage = decodePng(await Bun.file(new URL(`../../packs/v4/${missileEntry.src}`, import.meta.url)).bytes());
    const specs = [
      ...collectProjectiles(base.content.enemies),
      ...collectProjectiles(base.content.bosses),
    ].filter((spec) => spec.laser === undefined);
    const seen = new Set<string>();

    for (const spec of specs) {
      const name = spec.style.sprite;
      const missile = spec.missile !== undefined;
      const strip = missile ? manifest.assets.missiles[name] : manifest.assets.bullets.strips[name];
      expect(strip, name).toBeDefined();
      if (strip === undefined) continue;
      const measured = measuredUnion(missile ? missileImage : bulletImage, strip);
      expect(measured.width, `${name} manifest contentW`).toBe(strip.contentW);
      expect(measured.height, `${name} manifest contentH`).toBe(strip.contentH);

      const engine = missile ? unionExtent(MISSILE_STRIPS[name]!) : bulletEngineContent(name)!;
      const fitted = displaySize(engine, strip.frameW, strip.frameH, strip.contentW, strip.contentH);
      const size = bladeDisplaySize(
        spec.style,
        (spec.blade?.length ?? 0) / 2,
        spec.radius,
        { ...strip, ...fitted },
      );
      const quadW = size.width ?? fitted.displayW ?? strip.frameW;
      const quadH = size.height ?? fitted.displayH ?? strip.frameH;
      const visibleW = quadW * measured.width / strip.frameW;
      const visibleH = quadH * measured.height / strip.frameH;
      const lethalW = spec.blade === undefined ? spec.radius * 2 : spec.blade.length + spec.radius * 2;
      const lethalH = spec.radius * 2;
      expect(visibleW + 1e-9, `${name} visible width`).toBeGreaterThanOrEqual(lethalW);
      expect(visibleH + 1e-9, `${name} visible height`).toBeGreaterThanOrEqual(lethalH);
      seen.add(name);
    }

    expect(seen.has('needle.subpoena')).toBeTrue();
    expect(seen.has('needle.tithe')).toBeTrue();
    for (const name of Object.keys(MISSILE_STRIPS)) expect(seen.has(name), name).toBeTrue();
  });
});
