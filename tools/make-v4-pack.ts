/**
 * Generate the project-owned `packs/v4/` presentation pack.
 *
 *     bun tools/make-v4-pack.ts
 *
 * This is an original, deterministic pixel-art construction.  It studies the
 * v4 style locks' vocabulary (heart cores, skeletal spines, open rings and
 * branching mycelium), but it neither reads nor copies the purchased
 * BulletPack.  The generator is the source of truth: every committed PNG and
 * every manifest coordinate is rebuilt from the tables below.
 *
 * Background scenes and actor atlases deliberately do not appear here.  A pack
 * replaces the reskin surfaces the loader already exposes; the existing shader
 * scenes and the v4 women remain engine-owned and unchanged.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  BULLET_CELLS,
  BULLET_VARIANTS,
  FX_STRIPS,
  LASER_STRIP_CELLS,
  MISSILE_STRIPS,
  PICKUP_STRIPS,
} from '../src/render/procedural';
import { validateManifest, type PackManifest, type PackStrip } from '../src/packs/manifest';
import { ColourType, encodePng } from './png';

export const V4_PACK_DIR = join(import.meta.dir, '..', 'packs', 'v4');

type Rgba = readonly [r: number, g: number, b: number, a: number];

interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Palette {
  readonly shadow: Rgba;
  readonly surface: Rgba;
  readonly bone: Rgba;
  readonly mycelium: Rgba;
  readonly heart: Rgba;
}

interface RowSpec {
  readonly name: string;
  readonly frameW: number;
  readonly frameH: number;
  readonly frames: number;
  readonly ticksPerFrame: number;
  readonly mode: 'loop' | 'once';
  readonly color: 'baked' | 'tinted';
}

interface BuiltRow extends RowSpec {
  readonly bitmap: Bitmap;
  readonly bounds: Bounds;
}

interface PackedRows {
  readonly bitmap: Bitmap;
  readonly strips: Record<string, PackStrip>;
}

export interface V4PackBuild {
  readonly manifest: PackManifest;
  /** Paths are relative to `packs/v4/`. */
  readonly files: ReadonlyMap<string, Uint8Array | string>;
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

function bitmap(width: number, height: number): Bitmap {
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

function pixelIndex(image: Bitmap, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

/** Straight-alpha source-over; all arithmetic is integer-rounded and stable. */
function over(image: Bitmap, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || color[3] === 0) return;
  const at = pixelIndex(image, x, y);
  const da = image.rgba[at + 3] ?? 0;
  const sa = color[3];
  if (sa === 255 || da === 0) {
    image.rgba[at] = color[0];
    image.rgba[at + 1] = color[1];
    image.rgba[at + 2] = color[2];
    image.rgba[at + 3] = sa;
    return;
  }
  const outA = sa + Math.round((da * (255 - sa)) / 255);
  const dstWeight = (da * (255 - sa)) / 255;
  image.rgba[at] = clampByte((color[0] * sa + (image.rgba[at]! * dstWeight)) / outA);
  image.rgba[at + 1] = clampByte((color[1] * sa + (image.rgba[at + 1]! * dstWeight)) / outA);
  image.rgba[at + 2] = clampByte((color[2] * sa + (image.rgba[at + 2]! * dstWeight)) / outA);
  image.rgba[at + 3] = outA;
}

function copyBitmap(source: Bitmap, target: Bitmap, dx: number, dy: number): void {
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const src = pixelIndex(source, x, y);
      const a = source.rgba[src + 3] ?? 0;
      if (a === 0) continue;
      over(target, dx + x, dy + y, [
        source.rgba[src]!,
        source.rgba[src + 1]!,
        source.rgba[src + 2]!,
        a,
      ]);
    }
  }
}

function encode(image: Bitmap): Uint8Array {
  return encodePng(image.width, image.height, ColourType.RGBA, (x, y) => {
    const at = pixelIndex(image, x, y);
    return [
      image.rgba[at]!,
      image.rgba[at + 1]!,
      image.rgba[at + 2]!,
      image.rgba[at + 3]!,
    ];
  });
}

function alphaBounds(image: Bitmap, x0 = 0, y0 = 0, width = image.width, height = image.height): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      if ((image.rgba[pixelIndex(image, x, y) + 3] ?? 0) === 0) continue;
      minX = Math.min(minX, x - x0);
      minY = Math.min(minY, y - y0);
      maxX = Math.max(maxX, x - x0);
      maxY = Math.max(maxY, y - y0);
    }
  }
  if (!Number.isFinite(minX)) throw new Error(`empty ${width}x${height} bitmap region at ${x0},${y0}`);
  return { minX, minY, maxX, maxY };
}

function unionBounds(bounds: readonly Bounds[]): Bounds {
  if (bounds.length === 0) throw new Error('cannot union zero bounds');
  return bounds.reduce<Bounds>((out, b) => ({
    minX: Math.min(out.minX, b.minX),
    minY: Math.min(out.minY, b.minY),
    maxX: Math.max(out.maxX, b.maxX),
    maxY: Math.max(out.maxY, b.maxY),
  }), bounds[0]!);
}

function boundsSize(b: Bounds): { width: number; height: number } {
  return { width: b.maxX - b.minX + 1, height: b.maxY - b.minY + 1 };
}

function disc(image: Bitmap, cx: number, cy: number, radius: number, color: Rgba): void {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) over(image, x, y, color);
    }
  }
}

function ellipse(image: Bitmap, cx: number, cy: number, rx: number, ry: number, color: Rgba): void {
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const limit = rx2 * ry2;
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx * ry2 + dy * dy * rx2 <= limit) over(image, x, y, color);
    }
  }
}

function ring(image: Bitmap, cx: number, cy: number, radius: number, thickness: number, color: Rgba): void {
  const outer = radius * radius;
  const innerR = Math.max(0, radius - thickness);
  const inner = innerR * innerR;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = dx * dx + dy * dy;
      if (d <= outer && d >= inner) over(image, x, y, color);
    }
  }
}

function line(image: Bitmap, x0: number, y0: number, x1: number, y1: number, color: Rgba, width = 1): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    disc(image, x, y, Math.max(0, Math.floor((width - 1) / 2)), color);
    if (x === x1 && y === y1) break;
    const twice = err * 2;
    if (twice >= dy) { err += dy; x += sx; }
    if (twice <= dx) { err += dx; y += sy; }
  }
}

/** Deterministic bitmap arc made from the same integer line primitive. */
function arcLine(
  image: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number,
  color: Rgba,
  width = 1,
): void {
  const steps = Math.max(4, Math.ceil(Math.abs(end - start) * radius / 3));
  let px = cx + Math.round(Math.cos(start) * radius);
  let py = cy + Math.round(Math.sin(start) * radius);
  for (let i = 1; i <= steps; i++) {
    const angle = start + ((end - start) * i) / steps;
    const x = cx + Math.round(Math.cos(angle) * radius);
    const y = cy + Math.round(Math.sin(angle) * radius);
    line(image, px, py, x, y, color, width);
    px = x;
    py = y;
  }
}

type Point = readonly [x: number, y: number];

/** Fill a clockwise or counter-clockwise convex polygon at integer centres. */
function convex(image: Bitmap, points: readonly Point[], color: Rgba): void {
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));
  let winding = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let sign = 0;
      let inside = true;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        if (cross === 0) continue;
        const nextSign = cross < 0 ? -1 : 1;
        if (sign !== 0 && nextSign !== sign) { inside = false; break; }
        sign = nextSign;
      }
      if (inside) over(image, x, y, color);
      winding += sign;
    }
  }
  // Keep `winding` observable so an accidental empty polygon cannot be erased as
  // a seemingly unused calculation by a future mechanical rewrite.
  if (!Number.isFinite(winding)) throw new Error('invalid polygon winding');
}

function heart(image: Bitmap, cx: number, cy: number, size: number, color: Rgba): void {
  if (size <= 1) {
    over(image, cx, cy - 1, color);
    over(image, cx - 1, cy, color);
    over(image, cx, cy, color);
    over(image, cx + 1, cy, color);
    over(image, cx, cy + 1, color);
    return;
  }
  disc(image, cx - size, cy - size, size, color);
  disc(image, cx + size, cy - size, size, color);
  convex(image, [
    [cx - size * 2, cy - size],
    [cx + size * 2, cy - size],
    [cx, cy + size * 2],
  ], color);
}

const DIR8: readonly Point[] = [
  [0, -8], [6, -6], [8, 0], [6, 6], [0, 8], [-6, 6], [-8, 0], [-6, -6],
];

const NEUTRAL: Palette = {
  shadow: [84, 84, 84, 100],
  surface: [166, 166, 166, 220],
  bone: [235, 235, 235, 255],
  mycelium: [198, 198, 198, 210],
  heart: [255, 255, 255, 255],
};

const PALETTES = {
  scout: {
    shadow: [30, 78, 162, 92], surface: [50, 183, 255, 225], bone: [226, 248, 255, 255],
    mycelium: [101, 131, 255, 220], heart: [255, 133, 218, 255],
  },
  lance: {
    shadow: [136, 20, 87, 95], surface: [255, 61, 159, 230], bone: [255, 244, 233, 255],
    mycelium: [255, 163, 48, 225], heart: [255, 97, 145, 255],
  },
  hound: {
    shadow: [16, 104, 72, 95], surface: [55, 218, 138, 225], bone: [238, 255, 213, 255],
    mycelium: [199, 241, 53, 225], heart: [255, 171, 37, 255],
  },
  spire: {
    shadow: [80, 35, 151, 96], surface: [156, 78, 255, 228], bone: [237, 246, 255, 255],
    mycelium: [46, 221, 255, 230], heart: [247, 110, 241, 255],
  },
  maw: {
    shadow: [142, 29, 42, 96], surface: [255, 78, 51, 230], bone: [255, 227, 214, 255],
    mycelium: [255, 72, 166, 225], heart: [200, 255, 53, 255],
  },
  stage1: {
    shadow: [24, 68, 137, 92], surface: [57, 167, 237, 225], bone: [227, 247, 255, 255],
    mycelium: [92, 215, 255, 220], heart: [255, 135, 220, 255],
  },
  stage2: {
    shadow: [17, 89, 76, 92], surface: [38, 189, 139, 225], bone: [235, 250, 222, 255],
    mycelium: [180, 222, 53, 220], heart: [255, 186, 54, 255],
  },
  stage3: {
    shadow: [125, 61, 22, 92], surface: [235, 151, 47, 225], bone: [255, 239, 219, 255],
    mycelium: [250, 77, 153, 220], heart: [255, 103, 189, 255],
  },
  stage4: {
    shadow: [80, 25, 122, 96], surface: [151, 65, 230, 228], bone: [246, 226, 255, 255],
    mycelium: [255, 54, 119, 225], heart: [255, 93, 76, 255],
  },
} satisfies Record<string, Palette>;

type Rgb = readonly [r: number, g: number, b: number];

function personPalette(surface: Rgb, mycelium: Rgb, heartColour: Rgb, bone: Rgb = [239, 246, 250]): Palette {
  return {
    shadow: [clampByte(surface[0] * 0.34), clampByte(surface[1] * 0.34), clampByte(surface[2] * 0.34), 96],
    surface: [surface[0], surface[1], surface[2], 228],
    bone: [bone[0], bone[1], bone[2], 255],
    mycelium: [mycelium[0], mycelium[1], mycelium[2], 224],
    heart: [heartColour[0], heartColour[1], heartColour[2], 255],
  };
}

/**
 * The real base-campaign people.  Projectile ownership is authored against
 * these ids rather than guessed from a filename or a missile number.  The five
 * players, sixteen enemies and five bosses are all present exactly once.
 */
export const V4_OWNER_IDS = [
  'player.scout', 'player.lance', 'player.hound', 'player.spire', 'player.maw',
  'enemy.grunt', 'enemy.weaver', 'enemy.turret',
  'enemy.drifter', 'enemy.lash', 'enemy.hunter', 'enemy.censer', 'enemy.bastion',
  'enemy.clerk', 'enemy.stele', 'enemy.summons', 'enemy.assessor', 'enemy.ray',
  'enemy.usher', 'enemy.marshal', 'enemy.notary',
  'boss.sentinel', 'boss.warden', 'boss.magistrate', 'boss.chancellor', 'boss.regent',
] as const;

export type V4ProjectileOwner = typeof V4_OWNER_IDS[number];

/**
 * Identity colour lives in a woman's heart/mycelium accents and in the spell
 * she fires.  Closely related people may share a family hue, but no lookup is
 * inferred from stage order: each palette is attached to an actual runtime
 * consumer.  Actors remain cold ghost bodies; these are their small hot accents.
 */
export const V4_OWNER_PALETTES: Record<V4ProjectileOwner, Palette> = {
  'player.scout': PALETTES.scout,
  'player.lance': PALETTES.lance,
  'player.hound': PALETTES.hound,
  'player.spire': PALETTES.spire,
  'player.maw': PALETTES.maw,

  'enemy.grunt': personPalette([68, 169, 238], [102, 224, 255], [255, 132, 214]),
  'enemy.weaver': personPalette([94, 111, 226], [71, 221, 218], [255, 105, 190]),
  'enemy.turret': personPalette([67, 205, 235], [255, 176, 58], [255, 91, 143]),
  'enemy.drifter': personPalette([48, 191, 154], [190, 232, 63], [255, 181, 57]),
  'enemy.lash': personPalette([239, 76, 142], [65, 218, 248], [255, 119, 190]),
  'enemy.hunter': personPalette([55, 202, 143], [75, 232, 207], [255, 177, 58]),
  'enemy.censer': personPalette([241, 137, 48], [247, 72, 145], [255, 203, 66]),
  'enemy.bastion': personPalette([83, 153, 204], [98, 214, 151], [255, 135, 52]),
  'enemy.clerk': personPalette([210, 102, 145], [154, 88, 220], [255, 205, 93]),
  'enemy.stele': personPalette([116, 91, 166], [221, 152, 59], [255, 110, 174]),
  'enemy.summons': personPalette([224, 186, 57], [69, 213, 236], [255, 117, 175]),
  'enemy.assessor': personPalette([224, 144, 44], [238, 77, 152], [255, 211, 117]),
  'enemy.ray': personPalette([55, 191, 139], [51, 220, 247], [255, 126, 194]),
  'enemy.usher': personPalette([114, 194, 152], [242, 188, 70], [255, 135, 184]),
  'enemy.marshal': personPalette([54, 164, 157], [233, 157, 57], [255, 93, 91]),
  'enemy.notary': personPalette([142, 81, 202], [241, 181, 62], [245, 78, 161]),

  // Stage-one silver/cyan and stage-two indigo/teal identities. Their former
  // green-pink-gold / gold-green sets belonged to later-stage spell language
  // and visibly drifted from both Boss actor concepts and the stage palette.
  'boss.sentinel': personPalette([64, 174, 224], [129, 214, 242], [240, 216, 226]),
  'boss.warden': personPalette([76, 92, 184], [64, 185, 159], [226, 232, 240]),
  'boss.magistrate': personPalette([54, 205, 243], [74, 113, 238], [244, 250, 255]),
  'boss.chancellor': personPalette([231, 73, 146], [245, 175, 53], [255, 72, 91]),
  'boss.regent': personPalette([147, 73, 225], [242, 65, 120], [255, 205, 73]),
};

/** Runtime strip names each actual person can cause to draw. Laser caps are
 * included even though they are resolved by the render-side skin registry and
 * therefore never appear as `style.sprite` in the v4 campaign JSON. */
export const V4_OWNER_PROJECTILES: Record<V4ProjectileOwner, readonly string[]> = {
  'player.scout': ['glow.small.bolt', 'glow.medium.bolt', 'glow.large.bolt', 'bolt.hyper', 'orb.small.satellite'],
  'player.lance': ['needle.pin', 'needle.pin.t0', 'needle.pin.t1', 'needle.pin.t2', 'needle.lance', 'scale.satellite'],
  'player.hound': ['scale.tracker', 'scale.chase', 'scale.chase.hi', 'orb.small.battery'],
  'player.spire': ['beam.cyan', 'cap.v3', 'needle.column'],
  'player.maw': ['glow.small.spray', 'glow.small.spray.t1', 'glow.small.spray.t2', 'glow.small.spray.t3', 'orb.small.clinch'],

  'enemy.grunt': ['orb.small.chaff'],
  'enemy.weaver': ['orb.small.chaff', 'missile.6'],
  'enemy.turret': ['scale.heavy', 'orb.small.beacon', 'missile.0'],
  'enemy.drifter': ['orb.small.spark', 'missile.2'],
  'enemy.lash': ['beam.v3', 'cap.v3', 'missile.7'],
  'enemy.hunter': ['kunai.seeker', 'missile.1'],
  'enemy.censer': ['petal.pyre'],
  'enemy.bastion': ['orb.small.assay', 'orb.small.spark'],
  'enemy.clerk': ['orb.small.writ', 'missile.8'],
  'enemy.stele': ['orb.medium.slab', 'missile.11'],
  'enemy.summons': ['needle.subpoena', 'missile.5'],
  'enemy.assessor': ['spark.duty'],
  'enemy.ray': ['beam.slim', 'cap.green'],
  'enemy.usher': ['needle.picket'],
  'enemy.marshal': ['orb.medium.bulwark', 'missile.10'],
  'enemy.notary': ['spark.levy', 'halo.signet'],

  'boss.sentinel': ['scale.shard', 'petal.corolla', 'needle.vigil', 'needle.tithe'],
  'boss.warden': ['orb.small.fee', 'orb.small.spark', 'missile.3', 'beam.heavy', 'cap.green', 'needle.lien', 'petal.ember', 'scale.shell'],
  'boss.magistrate': ['orb.small.spark', 'scale.escrow', 'missile.4', 'beam.blue', 'cap.v3', 'scale.shell', 'petal.ember', 'beam.cyan', 'kunai.seeker'],
  'boss.chancellor': ['orb.small.writ', 'orb.medium.ledger', 'spark.docket', 'halo.witness', 'orb.small.brief', 'missile.9', 'beam.warm', 'cap.yellow', 'beam.v3.stream', 'cap.v3', 'beam.stream', 'cap.green', 'orb.medium.decree', 'spark.levy'],
  'boss.regent': ['orb.small.writ', 'halo.mandamus', 'halo.diadem', 'orb.medium.tenure', 'orb.medium.lattice', 'needle.warrant', 'missile.massive', 'orb.medium.mandamus', 'spark.levy', 'orb.medium.decree'],
};

function invertOwners(): Readonly<Record<string, readonly V4ProjectileOwner[]>> {
  const out: Record<string, V4ProjectileOwner[]> = {};
  for (const owner of V4_OWNER_IDS) {
    for (const name of V4_OWNER_PROJECTILES[owner]) (out[name] ??= []).push(owner);
  }
  return out;
}

export const V4_PROJECTILE_OWNERS = invertOwners();

export type V4ProjectileFaction = 'neutral' | 'player' | 'hostile' | 'shared';

/** Presentation faction is derived from the authored runtime owners, never from
 * a sprite-name convention. Shared player/hostile resources remain explicitly
 * shared instead of being made to look safe or dangerous by accident. */
export function projectileFaction(name: string): V4ProjectileFaction {
  const owners = V4_PROJECTILE_OWNERS[name] ?? [];
  if (owners.length === 0) return 'neutral';
  const hasPlayer = owners.some((owner) => owner.startsWith('player.'));
  const hasHostile = owners.some((owner) => !owner.startsWith('player.'));
  if (hasPlayer && hasHostile) return 'shared';
  return hasPlayer ? 'player' : 'hostile';
}

/**
 * A baked shared strip cannot change colour per firer.  It therefore carries a
 * visible lineage: first owner's surface, second owner's mycelium, final owner's
 * heart, common bone.  This is deliberately neither one claimant's palette nor
 * an averaged mud colour. `beam.cyan` and `scale.satellite` consequently read as
 * dual heritage until the renderer grows a presentation-only per-owner skin.
 */
function sharedLineagePalette(owners: readonly V4ProjectileOwner[]): Palette {
  const first = V4_OWNER_PALETTES[owners[0]!]!;
  const second = V4_OWNER_PALETTES[owners[Math.min(1, owners.length - 1)]!]!;
  const last = V4_OWNER_PALETTES[owners[owners.length - 1]!]!;
  return {
    shadow: NEUTRAL.shadow,
    surface: first.surface,
    bone: NEUTRAL.bone,
    mycelium: second.mycelium,
    heart: last.heart,
  };
}

export function paletteForProjectile(name: string): Palette {
  const owners = V4_PROJECTILE_OWNERS[name];
  if (owners === undefined || owners.length === 0) return NEUTRAL;
  if (owners.length === 1) return V4_OWNER_PALETTES[owners[0]!]!;
  return sharedLineagePalette(owners);
}

/** Hostile silhouettes use a solid bone-white keyline; friendly silhouettes
 * use a solid owner-colour keyline. Neutral registry floors keep their original
 * painter colour, so tintable fallback cells retain their authored geometry. */
function bulletKeyline(p: Palette, faction: V4ProjectileFaction, fallback: Rgba): Rgba {
  if (faction === 'hostile') return p.bone;
  if (faction === 'player') return [p.surface[0], p.surface[1], p.surface[2], 255];
  return fallback;
}

export function baseBulletName(name: string): string {
  return BULLET_VARIANTS[name] ?? name;
}

export function bulletExtentClass(base: string): 'small' | 'medium' | 'large' | 'directional' {
  if (base === 'orb.small' || base === 'glow.small' || base === 'mote') return 'small';
  if (base === 'orb.medium' || base === 'glow.medium' || base === 'spark' || base === 'scale' || base === 'petal') return 'medium';
  if (base === 'kunai' || base === 'needle' || base === 'shard') return 'directional';
  return 'large';
}

export type V4AnatomyLayer = 'surface' | 'skeleton' | 'mycelium' | 'heart';

const BULLET_LAYER_OVERRIDES: Readonly<Partial<Record<string, V4AnatomyLayer>>> = {
  // Surface: membrane, petal, writ and seal — the open outline is the event.
  'orb.small.chaff': 'surface',
  'orb.small.writ': 'surface',
  'orb.small.brief': 'surface',
  'orb.medium.slab': 'surface',
  'orb.medium.bulwark': 'surface',
  'petal.corolla': 'surface',
  'petal.pyre': 'surface',
  'petal.ember': 'surface',
  'scale.shell': 'surface',
  'halo.signet': 'surface',
  'halo.witness': 'surface',
  'halo.mandamus': 'surface',
  'halo.diadem': 'surface',
  'orb.small.satellite': 'surface',

  // Skeleton: straight, rigid and countable structure.
  'scale.heavy': 'skeleton',
  'scale.shard': 'skeleton',
  'needle.vigil': 'skeleton',
  'needle.tithe': 'skeleton',
  'needle.picket': 'skeleton',
  'needle.pin': 'skeleton',
  'needle.pin.t0': 'skeleton',
  'needle.pin.t1': 'skeleton',
  'needle.pin.t2': 'skeleton',
  'orb.small.battery': 'skeleton',

  // Mycelium: a tracking, wavering, spiralling or seeking relation.
  'orb.small.spark': 'mycelium',
  'orb.small.fee': 'mycelium',
  'kunai.seeker': 'mycelium',
  'needle.lien': 'mycelium',
  'needle.subpoena': 'mycelium',
  'needle.warrant': 'mycelium',
  'scale.escrow': 'mycelium',
  'scale.tracker': 'mycelium',
  'scale.chase': 'mycelium',
  'scale.chase.hi': 'mycelium',
  'spark.levy': 'mycelium',
  'spark.docket': 'mycelium',
  'spark.duty': 'mycelium',
  'orb.small.clinch': 'mycelium',

  // Heart: concentrated power, authority and player shot growth.
  'orb.small.beacon': 'heart',
  'orb.small.assay': 'heart',
  'orb.medium.ledger': 'heart',
  'orb.medium.decree': 'heart',
  'orb.medium.lattice': 'heart',
  'orb.medium.tenure': 'heart',
  'orb.medium.mandamus': 'heart',
  'glow.small.bolt': 'heart',
  'glow.medium.bolt': 'heart',
  'glow.large.bolt': 'heart',
  'bolt.hyper': 'heart',
  'glow.small.spray': 'heart',
  'glow.small.spray.t1': 'heart',
  'glow.small.spray.t2': 'heart',
  'glow.small.spray.t3': 'heart',
  'scale.satellite': 'heart',
};

export function bulletAnatomyLayer(name: string): V4AnatomyLayer {
  const explicit = BULLET_LAYER_OVERRIDES[name];
  if (explicit !== undefined) return explicit;
  switch (baseBulletName(name)) {
    case 'kunai':
    case 'scale':
    case 'shard':
    case 'needle': return 'skeleton';
    case 'spark': return 'mycelium';
    case 'glow.small':
    case 'glow.medium':
    case 'glow.large':
    case 'star':
    case 'mote': return 'heart';
    default: return 'surface';
  }
}

function drawRoundBullet(
  image: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  frame: number,
  p: Palette,
  hollow: boolean,
  layer: V4AnatomyLayer,
  faction: V4ProjectileFaction,
): void {
  const reach = Math.max(2, radius - 2);
  const d = DIR8[(frame * 2) % DIR8.length]!;
  const opposite = DIR8[(frame * 2 + 4) % DIR8.length]!;
  switch (layer) {
    case 'surface': {
      if (!hollow) disc(image, cx, cy, radius - 1, [p.surface[0], p.surface[1], p.surface[2], 54]);
      ring(image, cx, cy, radius, hollow ? 2 : 1, bulletKeyline(p, faction, p.surface));
      if (hollow && radius >= 7) ring(image, cx, cy, Math.max(2, radius - 4), 1, [p.surface[0], p.surface[1], p.surface[2], 128]);
      // One travelling seam makes a membrane animate without filling its void.
      disc(image, cx + Math.round((d[0] * reach) / 8), cy + Math.round((d[1] * reach) / 8), 1, p.bone);
      break;
    }
    case 'skeleton':
      ring(image, cx, cy, radius, 1, bulletKeyline(
        p, faction, [p.surface[0], p.surface[1], p.surface[2], 130],
      ));
      line(image,
        cx + Math.round((d[0] * reach) / 8), cy + Math.round((d[1] * reach) / 8),
        cx + Math.round((opposite[0] * reach) / 8), cy + Math.round((opposite[1] * reach) / 8), p.bone);
      ring(image, cx, cy, Math.max(2, Math.floor(radius / 2)), 1, p.bone);
      heart(image, cx, cy, 1, p.heart);
      break;
    case 'mycelium': {
      ring(image, cx, cy, radius, 1, bulletKeyline(
        p, faction, [p.surface[0], p.surface[1], p.surface[2], 110],
      ));
      for (let branch = 0; branch < 3; branch++) {
        const end = DIR8[(frame + branch * 3) % DIR8.length]!;
        const ex = cx + Math.round((end[0] * reach) / 8);
        const ey = cy + Math.round((end[1] * reach) / 8);
        line(image, cx, cy, ex, ey, p.mycelium);
        disc(image, ex, ey, 1, branch === 0 ? p.bone : p.mycelium);
      }
      heart(image, cx, cy, 1, p.heart);
      break;
    }
    case 'heart': {
      ring(image, cx, cy, radius, 1, bulletKeyline(
        p, faction, [p.surface[0], p.surface[1], p.surface[2], 150],
      ));
      ring(image, cx, cy, Math.max(2, radius - 3), 1, p.mycelium);
      const pulse = radius >= 8 && frame % 2 === 1 ? 2 : 1;
      heart(image, cx, cy, pulse, frame % 3 === 2 ? p.bone : p.heart);
      if (faction === 'hostile') {
        // The stable threat core overwrites centre animation, so hostile heart
        // rounds carry their motion on a small orbiting identity node instead.
        over(
          image,
          cx + Math.round((d[0] * reach) / 8),
          cy + Math.round((d[1] * reach) / 8),
          p.mycelium,
        );
      }
      break;
    }
  }
}

function drawDirectionalBullet(
  image: Bitmap,
  cx: number,
  cy: number,
  halfL: number,
  halfH: number,
  frame: number,
  p: Palette,
  layer: V4AnatomyLayer,
  faction: V4ProjectileFaction,
  petalShape = false,
): void {
  const tail = cx - halfL;
  const tip = cx + halfL;
  const shoulder = cx - Math.max(1, Math.floor(halfL / 3));
  const points: Point[] = petalShape
    ? [[tail, cy - 1], [shoulder, cy - halfH], [tip, cy], [shoulder, cy + halfH], [tail, cy + 1]]
    : [[tail, cy - Math.max(1, halfH - 1)], [shoulder, cy - halfH], [tip, cy], [shoulder, cy + halfH], [tail, cy + Math.max(1, halfH - 1)]];
  if (layer === 'surface') convex(image, points, [p.surface[0], p.surface[1], p.surface[2], 48]);
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const fallback = layer === 'skeleton' ? p.bone : p.surface;
    line(image, a[0], a[1], b[0], b[1], bulletKeyline(p, faction, fallback));
  }
  const branch = frame % 2 === 0 ? 1 : -1;
  switch (layer) {
    case 'surface':
      disc(image, tail + 3 + (frame % Math.max(1, halfL - 3)), cy + branch, 1, p.bone);
      break;
    case 'skeleton':
      line(image, tail + 2, cy, tip - 2, cy, p.bone);
      line(image, cx - 3, cy, cx, cy - Math.max(1, halfH - 1), p.bone);
      line(image, cx - 3, cy, cx, cy + Math.max(1, halfH - 1), p.bone);
      disc(image, cx + (frame % 3) - 1, cy, 1, p.heart);
      break;
    case 'mycelium': {
      line(image, tail + 2, cy, tip - 2, cy, [p.mycelium[0], p.mycelium[1], p.mycelium[2], 150]);
      const nodeX = cx - 3 + (frame % 4) * 2;
      line(image, nodeX, cy, nodeX + 3, cy + branch * Math.max(1, halfH - 1), p.mycelium);
      disc(image, nodeX + 3, cy + branch * Math.max(1, halfH - 1), 1, p.bone);
      heart(image, cx - Math.floor(halfL / 4), cy, 1, p.heart);
      break;
    }
    case 'heart':
      ring(image, cx - Math.floor(halfL / 4), cy, Math.max(2, halfH - 1), 1, p.mycelium);
      heart(image, cx - Math.floor(halfL / 4), cy, frame % 2 === 0 ? 1 : Math.min(2, halfH - 1), p.heart);
      line(image, cx, cy, tip - 2, cy, p.bone);
      break;
  }
}

function drawCrystalBullet(
  image: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  frame: number,
  p: Palette,
  layer: V4AnatomyLayer,
  faction: V4ProjectileFaction,
  points = 4,
): void {
  const step = points === 5 ? 1 : 2;
  const phase = frame % 2;
  for (let i = 0; i < 8; i += step) {
    const d = DIR8[(i + phase) % DIR8.length]!;
    const ex = cx + Math.round((d[0] * radius) / 8);
    const ey = cy + Math.round((d[1] * radius) / 8);
    const color = layer === 'skeleton' ? p.bone
      : layer === 'mycelium' ? p.mycelium
        : i % 4 === 0 ? p.surface : [p.surface[0], p.surface[1], p.surface[2], 120] as const;
    if (layer !== 'heart' || i % 2 === 0) {
      line(image, cx, cy, ex, ey, bulletKeyline(p, faction, color));
    }
  }
  if (layer === 'surface') ring(image, cx, cy, Math.max(2, Math.floor(radius / 2)), 1, p.surface);
  if (layer === 'mycelium') {
    const d = DIR8[(frame * 2 + 1) % DIR8.length]!;
    disc(image, cx + Math.round((d[0] * radius) / 8), cy + Math.round((d[1] * radius) / 8), 1, p.bone);
  }
  heart(image, cx, cy, layer === 'heart' && frame % 2 === 1 ? 2 : 1, p.heart);
}

/** Every hostile baked bullet ends on the same five-pixel threat mark: four
 * fully opaque bone-white pixels around one fully opaque identity-colour pixel.
 * It sits inside existing bounds, so presentation improves without changing
 * projectile size, collision semantics or directional heading. */
function drawHostileThreatCore(
  image: Bitmap,
  cx: number,
  cy: number,
  p: Palette,
  faction: V4ProjectileFaction,
): void {
  if (faction !== 'hostile') return;
  disc(image, cx, cy, 1, p.bone);
  over(image, cx, cy, p.heart);
}

function drawBulletFrame(image: Bitmap, x: number, y: number, name: string, frame: number): void {
  const cx = x + 16;
  const cy = y + 16;
  const base = baseBulletName(name);
  const p = paletteForProjectile(name);
  const layer = bulletAnatomyLayer(name);
  const faction = projectileFaction(name);
  switch (base) {
    case 'orb.small': drawRoundBullet(image, cx, cy, 5, frame, p, false, layer, faction); break;
    case 'orb.medium': drawRoundBullet(image, cx, cy, 9, frame, p, false, layer, faction); break;
    case 'orb.large': drawRoundBullet(image, cx, cy, 13, frame, p, false, layer, faction); break;
    case 'ring': drawRoundBullet(image, cx, cy, 13, frame, p, true, layer, faction); break;
    case 'halo':
      drawRoundBullet(image, cx, cy, 13, frame, p, true, layer, faction);
      ring(image, cx, cy, 8, 1, p.mycelium);
      break;
    case 'glow.small': drawRoundBullet(image, cx, cy, 6, frame, p, false, layer, faction); break;
    case 'glow.medium': drawRoundBullet(image, cx, cy, 10, frame, p, false, layer, faction); break;
    case 'glow.large': drawRoundBullet(image, cx, cy, 13, frame, p, false, layer, faction); break;
    case 'kunai': drawDirectionalBullet(image, cx, cy, 11, 4, frame, p, layer, faction); break;
    case 'scale': drawDirectionalBullet(image, cx, cy, 9, 5, frame, p, layer, faction, true); break;
    case 'shard': drawDirectionalBullet(image, cx, cy, 12, 3, frame, p, layer, faction); break;
    case 'needle': drawDirectionalBullet(image, cx, cy, 12, 2, frame, p, layer, faction); break;
    case 'petal': drawDirectionalBullet(image, cx, cy, 9, 5, frame, p, layer, faction, true); break;
    case 'star': drawCrystalBullet(image, cx, cy, 13, frame, p, layer, faction, 5); break;
    case 'spark': drawCrystalBullet(image, cx, cy, 10, frame, p, layer, faction); break;
    case 'mote': drawRoundBullet(image, cx, cy, 4, frame, p, false, layer, faction); break;
    default: throw new Error(`no v4 bullet painter for "${base}"`);
  }
  drawHostileThreatCore(image, cx, cy, p, faction);
}

/** Three variants are registry floors but are not named by the current base JSON. */
export const UNREACHED_BULLET_VARIANTS = new Set([
  'halo.seal', 'halo.crown', 'glow.small.beam',
]);

export const V4_BULLET_NAMES = [
  ...BULLET_CELLS,
  ...Object.keys(BULLET_VARIANTS).filter((name) => !UNREACHED_BULLET_VARIANTS.has(name)),
] as readonly string[];

function buildBullets(): { bytes: Uint8Array; strips: NonNullable<Extract<NonNullable<PackManifest['assets']>['bullets'], object>['strips']> } {
  const stripsPerRow = 8;
  const frames = 4;
  const frameW = 32;
  const frameH = 32;
  const stripW = frames * frameW;
  const width = stripsPerRow * stripW;
  const height = Math.ceil(V4_BULLET_NAMES.length / stripsPerRow) * frameH;
  const image = bitmap(width, height);
  const strips: Record<string, {
    x: number; y: number; frameW: number; frameH: number; frames: number; stride: number;
    ticksPerFrame: number; mode: 'loop'; color: 'tinted' | 'baked'; contentW: number; contentH: number;
  }> = {};

  V4_BULLET_NAMES.forEach((name, index) => {
    const x = (index % stripsPerRow) * stripW;
    const y = Math.floor(index / stripsPerRow) * frameH;
    const frameBounds: Bounds[] = [];
    for (let frame = 0; frame < frames; frame++) {
      drawBulletFrame(image, x + frame * frameW, y, name, frame);
      frameBounds.push(alphaBounds(image, x + frame * frameW, y, frameW, frameH));
    }
    const union = unionBounds(frameBounds);
    const content = boundsSize(union);
    strips[name] = {
      x, y, frameW, frameH, frames, stride: frameW, ticksPerFrame: 5, mode: 'loop',
      color: (BULLET_CELLS as readonly string[]).includes(name) ? 'tinted' : 'baked',
      contentW: content.width,
      contentH: content.height,
    };
  });
  return { bytes: encode(image), strips };
}

/** Shared presentation remains for the ship and legacy fallback strips. */
export const V4_SHARED_PLAYER_PALETTE = personPalette(
  [103, 194, 224], [221, 91, 190], [255, 190, 72], [242, 247, 250],
);
/** Material and boss-body feedback follow the Ghost body palette, not bullet hues. */
export const V4_GHOST_FX_PALETTE: Palette = {
  shadow: [0x59, 0x65, 0x74, 96],
  surface: [0xb9, 0xc4, 0xcf, 228],
  bone: [0xe9, 0xf0, 0xf4, 255],
  mycelium: [0xdd, 0xf4, 0xff, 224],
  heart: [0xf0, 0xd8, 0xe2, 255],
};
const V4_SHARED_ENEMY_FX_PALETTE = personPalette(
  [171, 106, 201], [235, 118, 68], [255, 207, 91], [240, 240, 238],
);
const V4_SHARED_MISSILE_FX_PALETTE = personPalette(
  [81, 188, 174], [220, 97, 177], [255, 180, 58], [240, 248, 244],
);

export function paletteForEffect(name: string): Palette {
  const optionOwner = OPTION_EFFECT_OWNERS[name];
  if (optionOwner !== undefined) return V4_OWNER_PALETTES[optionOwner];
  const bombOwner = BOMB_EFFECT_OWNERS[name];
  if (bombOwner !== undefined) return V4_OWNER_PALETTES[bombOwner];
  if (name.startsWith('player.') || name === 'boom.player') return V4_SHARED_PLAYER_PALETTE;
  if (name.startsWith('missile.pop.')) return V4_SHARED_MISSILE_FX_PALETTE;
  if (
    name.startsWith('material.')
    || name.startsWith('boss.distress.')
    || name === 'boss.break'
    || name.startsWith('boss.death.')
  ) {
    return V4_GHOST_FX_PALETTE;
  }
  // `debris` serves both player and boss; a single baked strip must remain a
  // shared lifecycle ember rather than falsely wearing either faction's colour.
  if (name === 'debris') return sharedLineagePalette(['player.maw', 'boss.regent']);
  return V4_SHARED_ENEMY_FX_PALETTE;
}

const OPTION_EFFECT_OWNERS: Readonly<Record<string, V4ProjectileOwner>> = {
  'player.option.scout': 'player.scout',
  'player.option.lance': 'player.lance',
  'player.option.hound': 'player.hound',
  'player.option.spire': 'player.spire',
  'player.option.maw': 'player.maw',
};

const BOMB_EFFECT_OWNERS: Readonly<Record<string, V4ProjectileOwner>> = {
  'player.bomb.scout-tide': 'player.scout',
  'player.bomb.lance-pierce': 'player.lance',
  'player.bomb.hound-pack': 'player.hound',
  'player.bomb.spire-field': 'player.spire',
  'player.bomb.maw-devour': 'player.maw',
};

function drawBurst(image: Bitmap, cx: number, cy: number, frame: number, frames: number, maxRadius: number, p: Palette): void {
  const t = frames <= 1 ? 0 : frame / (frames - 1);
  const radius = Math.max(2, Math.round(2 + (maxRadius - 2) * t));
  const alpha = clampByte(235 - t * 150);
  ring(image, cx, cy, radius, Math.max(1, Math.floor(maxRadius / 9)), [p.surface[0], p.surface[1], p.surface[2], alpha]);
  const core = Math.max(1, Math.round(4 * (1 - t) + 1));
  heart(image, cx, cy, core, [p.heart[0], p.heart[1], p.heart[2], Math.max(60, alpha)]);
  for (let i = 0; i < DIR8.length; i += 2) {
    const d = DIR8[i]!;
    const reach = Math.max(3, radius - 2);
    line(image, cx + Math.round((d[0] * 2) / 8), cy + Math.round((d[1] * 2) / 8),
      cx + Math.round((d[0] * reach) / 8), cy + Math.round((d[1] * reach) / 8),
      [p.mycelium[0], p.mycelium[1], p.mycelium[2], Math.max(45, alpha - 30)]);
  }
}

function loopPulse(frame: number, frames: number): number {
  const half = frames / 2;
  return frame <= half ? frame / half : (frames - frame) / half;
}

function drawEffectFrame(image: Bitmap, x: number, y: number, spec: RowSpec, frame: number): void {
  const cx = x + Math.floor(spec.frameW / 2);
  const cy = y + Math.floor(spec.frameH / 2);
  const p = paletteForEffect(spec.name);
  const maxR = Math.max(2, Math.floor(Math.min(spec.frameW, spec.frameH) / 2) - 3);

  if (spec.name === 'player.option') {
    ring(image, cx, cy, 8 + (frame % 2), 1, p.surface);
    const d = DIR8[(frame * 2) % DIR8.length]!;
    disc(image, cx + Math.round(d[0] / 2), cy + Math.round(d[1] / 2), 2, p.mycelium);
    heart(image, cx, cy, 2, p.heart);
    return;
  }
  if (spec.name === 'player.option.scout') {
    ring(image, cx, cy, 7 + (frame % 3), 1, p.surface);
    ring(image, cx, cy, 4 + ((frame + 1) % 2), 1, p.mycelium);
    heart(image, cx, cy, 2, p.heart);
    return;
  }
  if (spec.name === 'player.option.lance') {
    line(image, cx, cy - 9, cx, cy + 8, p.bone, 2);
    line(image, cx - 4 + frame % 3, cy + 5, cx + 4, cy + 5, p.surface);
    heart(image, cx, cy - 3, 2, p.heart);
    return;
  }
  if (spec.name === 'player.option.hound') {
    for (const [dx, dy] of [[-6, 4], [0, -5], [6, 4]] as const) disc(image, cx + dx, cy + dy, 3, p.surface);
    line(image, cx - 6, cy + 4, cx + 6, cy + 4, p.mycelium);
    heart(image, cx, cy - 5 + (frame % 2), 1, p.heart);
    return;
  }
  if (spec.name === 'player.option.spire') {
    convex(image, [[cx, cy - 9], [cx + 7, cy], [cx, cy + 9], [cx - 7, cy]], [p.surface[0], p.surface[1], p.surface[2], 155]);
    line(image, cx, cy - 8, cx, cy + 8, p.bone);
    line(image, cx - 5, cy + (frame % 3) - 1, cx + 5, cy + (frame % 3) - 1, p.mycelium);
    heart(image, cx, cy, 2, p.heart);
    return;
  }
  if (spec.name === 'player.option.maw') {
    ring(image, cx, cy, 9, 2, p.surface);
    disc(image, cx - 3 + frame % 2, cy, 4, [p.shadow[0], p.shadow[1], p.shadow[2], 210]);
    line(image, cx + 1, cy - 7, cx + 6, cy - 2, p.mycelium);
    line(image, cx + 1, cy + 7, cx + 6, cy + 2, p.mycelium);
    heart(image, cx + 3, cy, 1, p.heart);
    return;
  }
  if (spec.name.startsWith('player.thruster.particle.')) {
    const shift = spec.name.endsWith('.0') ? -1 : 1;
    const fall = 2 + (frame % 4);
    line(image, cx, cy - 4, cx + shift * 2, cy + fall, [p.mycelium[0], p.mycelium[1], p.mycelium[2], 150]);
    heart(image, cx, cy - 4 + (frame % 2), 1, p.heart);
    return;
  }
  if (spec.name.startsWith('player.thruster.')) {
    const strength = spec.name.endsWith('.up') ? 1 : spec.name.endsWith('.cruise') ? 0 : -1;
    const top = y + 3;
    const bottom = y + spec.frameH - 3 - Math.max(0, -strength * 3);
    const flutter = frame % 2;
    convex(image, [[cx - 4, top], [cx + 4, top], [cx + 2 + flutter, bottom - 4], [cx, bottom], [cx - 2 - flutter, bottom - 4]],
      [p.shadow[0], p.shadow[1], p.shadow[2], 150]);
    line(image, cx, top, cx, bottom - 1, p.bone);
    line(image, cx, top + 4, cx - 3, top + 9 + strength, p.mycelium);
    line(image, cx, top + 6, cx + 3, top + 12 + strength, p.surface);
    heart(image, cx, top + 2, 1, p.heart);
    return;
  }
  if (spec.name === 'player.bomb.field') {
    const t = frame / Math.max(1, spec.frames - 1);
    const r = Math.max(5, Math.round(5 + (maxR - 5) * t));
    ring(image, cx, cy, r, 2, [p.surface[0], p.surface[1], p.surface[2], clampByte(220 - 110 * t)]);
    ring(image, cx, cy, Math.max(3, r - 5), 1, p.mycelium);
    for (let i = 0; i < DIR8.length; i += 2) {
      const d = DIR8[(i + frame) % DIR8.length]!;
      line(image, cx + Math.round((d[0] * 3) / 8), cy + Math.round((d[1] * 3) / 8),
        cx + Math.round((d[0] * Math.max(4, r - 2)) / 8), cy + Math.round((d[1] * Math.max(4, r - 2)) / 8), p.mycelium);
    }
    heart(image, cx, cy, 2, p.heart);
    return;
  }
  if (spec.name === 'player.bomb.scout-tide') {
    const r = 7 + frame % 12;
    ring(image, cx, cy, r, 2, p.surface);
    ring(image, cx, cy, Math.max(3, r - 7), 1, p.mycelium);
    heart(image, cx, cy, 2, p.heart);
    return;
  }
  if (spec.name === 'player.bomb.lance-pierce') {
    const lift = frame % 4;
    convex(image, [[cx, cy - 20], [cx + 7, cy + 12], [cx, cy + 20], [cx - 7, cy + 12]], [p.surface[0], p.surface[1], p.surface[2], 180]);
    line(image, cx, cy - 20, cx, cy + 18, p.bone, 2);
    line(image, cx - 6, cy + 11 + lift, cx + 6, cy + 11 + lift, p.mycelium);
    heart(image, cx, cy - 8, 2, p.heart);
    return;
  }
  if (spec.name === 'player.bomb.hound-pack') {
    const sway = frame % 3 - 1;
    for (const [dx, dy] of [[-13, 7], [0, -7], [13, 7]] as const) {
      const hx = cx + dx + sway;
      const hy = cy + dy;
      // Three readable familiar heads: pointed ears and a small bone muzzle,
      // rather than three network-status dots joined by a HUD line.
      convex(image, [[hx - 4, hy - 2], [hx - 2, hy - 7], [hx, hy - 3]], p.surface);
      convex(image, [[hx, hy - 3], [hx + 2, hy - 7], [hx + 4, hy - 2]], p.surface);
      disc(image, hx, hy, 4, p.surface);
      line(image, hx - 2, hy + 1, hx, hy + 3, p.bone);
      line(image, hx, hy + 3, hx + 2, hy + 1, p.bone);
      heart(image, hx, hy - 1, 1, p.heart);
    }
    line(image, cx - 13 + sway, cy + 7, cx, cy - 7, p.mycelium);
    line(image, cx, cy - 7, cx + 13 + sway, cy + 7, p.mycelium);
    return;
  }
  if (spec.name === 'player.bomb.spire-field') {
    const r = 8 + frame % 10;
    // An open relay field surrounding a three-column tower. It cannot be read
    // as the solid diamond used by the gem pickup.
    ring(image, cx, cy, r, 1, [p.surface[0], p.surface[1], p.surface[2], 175]);
    line(image, cx, cy - r, cx, cy + r, p.bone, 2);
    const side = Math.max(3, Math.round(r * 0.42));
    const half = Math.max(4, Math.round(r * 0.58));
    line(image, cx - side, cy - half, cx - side, cy + half, p.surface);
    line(image, cx + side, cy - half, cx + side, cy + half, p.surface);
    line(image, cx - r + 2, cy, cx + r - 2, cy, p.mycelium);
    heart(image, cx, cy, 2, p.heart);
    return;
  }
  if (spec.name === 'player.bomb.maw-devour') {
    const r = 11 + frame % 8;
    ring(image, cx, cy, r, 3, p.surface);
    disc(image, cx - 4, cy, r - 6, [p.shadow[0], p.shadow[1], p.shadow[2], 220]);
    line(image, cx + 2, cy - r + 3, cx + r - 3, cy - 2, p.mycelium, 2);
    line(image, cx + 2, cy + r - 3, cx + r - 3, cy + 2, p.mycelium, 2);
    heart(image, cx + 5, cy, 2, p.heart);
    return;
  }
  if (spec.name === 'player.bomb.projectile' || spec.name === 'player.bomb.missile') {
    const halfL = Math.max(5, Math.floor(spec.frameH / 2) - 3);
    const halfH = Math.max(2, Math.floor(spec.frameW / 2) - 3);
    // These presentation-only bomb sprites travel upward and therefore remain
    // nose-up; rule 7 applies to heading-rotated bullets, not this fixed draw.
    convex(image, [[cx, cy - halfL], [cx + halfH, cy + 2], [cx, cy + halfL], [cx - halfH, cy + 2]],
      [p.shadow[0], p.shadow[1], p.shadow[2], 165]);
    line(image, cx, cy - halfL + 1, cx, cy + halfL - 1, p.bone);
    line(image, cx, cy, cx + (frame % 2 === 0 ? halfH - 1 : -halfH + 1), cy + 3, p.mycelium);
    heart(image, cx, cy - 1, 1, p.heart);
    return;
  }
  if (spec.name === 'debris') {
    // An 8px frame has only a 4px paint budget after the mandatory 2px rim.
    // Animate the ember by an integer one-pixel orbit, never by growing through
    // that seam margin.
    const px = cx - (frame % 2);
    const py = cy - (Math.floor(frame / 2) % 2);
    disc(image, px, py, 1, p.bone);
    over(image, px, py, p.heart);
    return;
  }
  if (spec.name === 'boom.boss.back') {
    const t = frame / Math.max(1, spec.frames - 1);
    const r = Math.max(4, Math.round(4 + (maxR - 4) * t));
    disc(image, cx, cy, r, [p.shadow[0], p.shadow[1], p.shadow[2], clampByte(180 - 85 * t)]);
    ring(image, cx, cy, Math.max(2, r - 2), 2, [p.surface[0], p.surface[1], p.surface[2], 90]);
    heart(image, cx, cy, 2, [p.heart[0], p.heart[1], p.heart[2], 100]);
    return;
  }
  if (spec.name === 'boom.elite.spray') {
    const t = frame / Math.max(1, spec.frames - 1);
    const reach = Math.max(2, Math.round((maxR - 2) * t));
    for (let i = 0; i < DIR8.length; i++) {
      const d = DIR8[(i + frame) % DIR8.length]!;
      const mx = cx + Math.round((d[0] * reach) / 8);
      const my = cy + Math.round((d[1] * reach) / 8);
      disc(image, mx, my, 1 + (i % 2), i % 2 === 0 ? p.surface : p.mycelium);
    }
    heart(image, cx, cy, 1, p.heart);
    return;
  }
  if (spec.name === 'material.surface') {
    const t = frame / Math.max(1, spec.frames - 1);
    const r = Math.max(2, Math.round(3 + 16 * t));
    ring(image, cx, cy, r, 1, p.surface);
    for (let i = 0; i < 4; i++) { const d = DIR8[(i * 2 + frame) % DIR8.length]!; line(image, cx, cy, cx + Math.round((d[0] * r) / 8), cy + Math.round((d[1] * r) / 8), p.surface, 1); }
    return;
  }
  if (spec.name === 'material.skeleton') {
    const t = frame / Math.max(1, spec.frames - 1);
    line(image, cx - 7 + Math.round(3 * t), cy, cx + 7 - Math.round(3 * t), cy, p.bone, 2);
    disc(image, cx - 6 + Math.round(3 * t), cy, 2, p.bone); disc(image, cx + 6 - Math.round(3 * t), cy, 2, p.bone);
    return;
  }
  if (spec.name === 'material.mycelium') {
    const t = frame / Math.max(1, spec.frames - 1);
    const gap = 1 + Math.round(5 * t);
    const retract = 11 - Math.round(3 * t);
    line(image, cx - retract, cy + 2, cx - 8, cy - 3, p.mycelium);
    line(image, cx - 8, cy - 3, cx - gap, cy, p.mycelium);
    line(image, cx + gap, cy, cx + 8, cy + 3, p.mycelium);
    line(image, cx + 8, cy + 3, cx + retract, cy - 2, p.mycelium);
    line(image, cx - retract + 2, cy + 1, cx - retract - 2, cy - 5, p.surface);
    line(image, cx - retract + 3, cy + 2, cx - retract, cy + 6, p.mycelium);
    line(image, cx + retract - 2, cy - 1, cx + retract + 2, cy + 5, p.surface);
    line(image, cx + retract - 3, cy - 2, cx + retract, cy - 6, p.mycelium);
    disc(image, cx - gap, cy, 1, p.bone);
    disc(image, cx + gap, cy, 1, p.bone);
    return;
  }
  if (spec.name === 'material.heart') {
    const t = frame / Math.max(1, spec.frames - 1); const r = t < 0.4 ? Math.max(2, 4 - Math.round(4 * t)) : 3 + Math.round(2 * (t - 0.4));
    heart(image, cx, cy, r, p.heart); return;
  }
  if (spec.name === 'boss.distress.surface') {
    const pulse = loopPulse(frame, spec.frames);
    const membraneR = 14 + Math.round(8 * pulse);
    ring(image, cx, cy, membraneR, 1, [p.surface[0], p.surface[1], p.surface[2], clampByte(130 + pulse * 90)]);
    ring(image, cx, cy, 8 + Math.round(4 * (1 - pulse)), 1, [p.mycelium[0], p.mycelium[1], p.mycelium[2], 135]);
    for (let i = 0; i < 4; i++) {
      const d = DIR8[(i * 2 + 1) % DIR8.length]!;
      const inner = Math.round(membraneR * 0.48);
      const middle = Math.round(membraneR * 0.72);
      line(
        image,
        cx + Math.round((d[0] * inner) / 8),
        cy + Math.round((d[1] * inner) / 8),
        cx + Math.round((d[0] * middle) / 8) + (i % 2 === 0 ? 1 : -1),
        cy + Math.round((d[1] * middle) / 8),
        p.bone,
      );
      line(
        image,
        cx + Math.round((d[0] * middle) / 8) + (i % 2 === 0 ? 1 : -1),
        cy + Math.round((d[1] * middle) / 8),
        cx + Math.round((d[0] * (membraneR + 2)) / 8),
        cy + Math.round((d[1] * (membraneR + 2)) / 8),
        p.surface,
      );
    }
    return;
  }
  if (spec.name === 'boss.distress.skeleton') {
    const pulse = loopPulse(frame, spec.frames);
    const gap = 3 + Math.round(4 * pulse);
    line(image, cx - 22, cy - 11, cx - 9 - gap, cy - 2, p.bone, 2);
    line(image, cx + 9 + gap, cy + 2, cx + 22, cy + 11, p.bone, 2);
    disc(image, cx - 9 - gap, cy - 2, 2, p.bone);
    disc(image, cx + 9 + gap, cy + 2, 2, p.bone);
    line(image, cx - 2, cy - 21, cx + 3, cy - 11, p.surface);
    line(image, cx + 3, cy - 11, cx - 3, cy - 2, p.surface);
    line(image, cx - 3, cy - 2, cx + 2, cy + 8, p.surface);
    line(image, cx + 2, cy + 8, cx - 2, cy + 21, p.mycelium);
    return;
  }
  if (spec.name === 'boss.distress.mycelium') {
    const pulse = loopPulse(frame, spec.frames);
    const gap = 3 + Math.round(7 * pulse);
    const retract = 24 - Math.round(4 * pulse);
    line(image, cx - retract, cy + 13, cx - 17, cy - 7, p.mycelium);
    line(image, cx - 17, cy - 7, cx - gap, cy, p.mycelium);
    line(image, cx + retract, cy - 13, cx + 17, cy + 7, p.mycelium);
    line(image, cx + 17, cy + 7, cx + gap, cy, p.mycelium);
    line(image, cx - 19, cy + 2, cx - 13, cy - 18, p.mycelium);
    line(image, cx - 13, cy - 18, cx - gap - 2, cy - 5, p.surface);
    line(image, cx + 19, cy - 2, cx + 13, cy + 18, p.mycelium);
    line(image, cx + 13, cy + 18, cx + gap + 2, cy + 5, p.surface);
    disc(image, cx - gap + 1, cy - 1, 1, p.bone);
    disc(image, cx + gap - 1, cy + 1, 1, p.bone);
    return;
  }
  if (spec.name === 'boss.distress.crack') {
    for (let i = 0; i <= frame; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      line(image, cx + side * (2 + i), cy - 7 + i * 3, cx + side * (11 + i * 2), cy + i * 3, p.bone);
      line(image, cx + side * (11 + i * 2), cy + i * 3, cx + side * (19 + i * 2), cy + 13 + i * 2, p.surface);
    }
    return;
  }
  if (spec.name === 'boss.distress.heart') {
    const pulse = loopPulse(frame, spec.frames);
    ring(image, cx, cy, 9 + Math.round(2 * pulse), 1, [p.mycelium[0], p.mycelium[1], p.mycelium[2], 125]);
    heart(image, cx, cy, pulse >= 0.75 ? 6 : 5, p.heart);
    return;
  }
  if (spec.name === 'boss.break') {
    const t = frame / Math.max(1, spec.frames - 1);
    const r = 10 + Math.round(32 * t);
    const split = Math.round(2 * t);
    arcLine(image, cx - split, cy, r, -0.2 * Math.PI, 0.62 * Math.PI, p.surface, 2);
    arcLine(image, cx + split, cy, r, 0.84 * Math.PI, 1.68 * Math.PI, p.surface, 2);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + (i % 2 === 0 ? -0.08 : 0.08);
      const inner = 5 + Math.round(8 * t);
      const outer = 18 + Math.round(24 * t);
      line(image, cx + Math.round(Math.cos(a) * inner), cy + Math.round(Math.sin(a) * inner), cx + Math.round(Math.cos(a) * outer), cy + Math.round(Math.sin(a) * outer), p.bone);
    }
    line(image, cx - 3, cy - 9, cx + 2, cy - 3, p.mycelium);
    line(image, cx + 2, cy - 3, cx - 2, cy + 3, p.mycelium);
    line(image, cx - 2, cy + 3, cx + 3, cy + 10, p.mycelium);
    return;
  }
  if (spec.name.startsWith('boss.death.')) {
    const t = frame / Math.max(1, spec.frames - 1); const spread = 8 + Math.round(42 * t);
    if (spec.name.endsWith('.sentinel')) {
      const colours = [p.surface, p.mycelium, p.bone] as const;
      for (let i = 0; i < 3; i++) {
        arcLine(
          image,
          cx,
          cy,
          Math.max(3, Math.round(spread * (0.45 + i * 0.24))),
          -0.3 + i,
          1.8 + i,
          colours[i]!,
        );
      }
    } else if (spec.name.endsWith('.warden')) {
      for (let i = -2; i <= 2; i++) line(image, cx + i * (7 + Math.round(t * 7)), cy - spread, cx + i * (7 + Math.round(t * 7)), cy + spread, i % 2 === 0 ? p.bone : p.surface, 2);
    } else if (spec.name.endsWith('.magistrate')) {
      convex(image, [[cx, cy + 4], [cx - spread, cy - Math.round(spread * 0.7)], [cx - spread + 5, cy - Math.round(spread * 0.4)]], p.bone);
      convex(image, [[cx, cy + 4], [cx + spread, cy - Math.round(spread * 0.7)], [cx + spread - 5, cy - Math.round(spread * 0.4)]], p.surface);
      ring(image, cx, cy, 6 + Math.round(10 * t), 1, p.mycelium);
    } else if (spec.name.endsWith('.chancellor')) {
      for (let i = -1; i <= 1; i++) {
        const ox = i * (18 + Math.round(6 * t));
        const top = cy - spread + (i === 0 ? 0 : i < 0 ? 6 : 10);
        const bottom = top + Math.round(spread * 1.35);
        line(image, cx + ox - 9, top, cx + ox + 9, top, p.bone);
        line(image, cx + ox - 9, top, cx + ox - 9, bottom, p.surface);
        line(image, cx + ox + 9, top, cx + ox + 9, bottom, p.surface);
        line(image, cx + ox - 9, bottom, cx + ox + 9, bottom, p.surface);
        for (let row = 1; row <= 3; row++) {
          const writingY = top + Math.round(((bottom - top) * row) / 4);
          line(image, cx + ox - 5, writingY, cx + ox + 5, writingY, row % 2 === 0 ? p.mycelium : p.bone);
        }
      }
      for (let i = -2; i <= 2; i++) line(image, cx, cy, cx + i * Math.round(spread * 0.35), cy + spread, p.mycelium);
    } else {
      line(image, cx - spread, cy - 5, cx - Math.round(spread * 0.55), cy - Math.round(spread * 0.65), p.bone, 2);
      line(image, cx - Math.round(spread * 0.55), cy - Math.round(spread * 0.65), cx, cy - 10, p.surface, 2);
      line(image, cx, cy - 10, cx + Math.round(spread * 0.55), cy - Math.round(spread * 0.65), p.surface, 2);
      line(image, cx + Math.round(spread * 0.55), cy - Math.round(spread * 0.65), cx + spread, cy - 5, p.bone, 2);
      arcLine(image, cx, cy + 8, spread, Math.PI, Math.PI * 2, p.surface);
      for (let i = -2; i <= 2; i++) line(image, cx + i * 4, cy + 5, cx + i * Math.round(spread * 0.35), cy + spread, p.mycelium);
    }
    return;
  }
  drawBurst(image, cx, cy, frame, spec.frames, maxR, p);
  if (spec.name === 'burst.big' || spec.name === 'boom.boss.top' || spec.name === 'boom.player') {
    const t = frame / Math.max(1, spec.frames - 1);
    ring(image, cx + 2, cy - 2, Math.max(2, Math.round(maxR * 0.65 * t)), 1, p.mycelium);
  }
}

const NATIVE_EFFECT_NAMES = [
  'burst', 'burst.big', 'material.surface', 'material.skeleton', 'material.mycelium', 'material.heart',
  'boss.distress.surface', 'boss.distress.skeleton', 'boss.distress.mycelium',
  'boss.distress.crack', 'boss.distress.heart', 'boss.break',
  'boss.death.sentinel', 'boss.death.warden', 'boss.death.magistrate', 'boss.death.chancellor', 'boss.death.regent',
  'missile.pop.tiny', 'missile.pop.mid', 'missile.pop.big',
  'boom.elite', 'boom.elite.spray', 'boom.boss.back', 'boom.boss.top', 'boom.player', 'debris',
] as const;

const PLAYER_EFFECT_SPECS: readonly RowSpec[] = [
  { name: 'player.option', frameW: 24, frameH: 24, frames: 4, ticksPerFrame: 4, mode: 'loop', color: 'baked' },
  { name: 'player.option.scout', frameW: 24, frameH: 24, frames: 4, ticksPerFrame: 4, mode: 'loop', color: 'baked' },
  { name: 'player.option.lance', frameW: 24, frameH: 24, frames: 4, ticksPerFrame: 4, mode: 'loop', color: 'baked' },
  { name: 'player.option.hound', frameW: 24, frameH: 24, frames: 4, ticksPerFrame: 4, mode: 'loop', color: 'baked' },
  { name: 'player.option.spire', frameW: 24, frameH: 24, frames: 4, ticksPerFrame: 4, mode: 'loop', color: 'baked' },
  { name: 'player.option.maw', frameW: 24, frameH: 24, frames: 4, ticksPerFrame: 4, mode: 'loop', color: 'baked' },
  { name: 'player.thruster.up', frameW: 20, frameH: 28, frames: 4, ticksPerFrame: 3, mode: 'loop', color: 'baked' },
  { name: 'player.thruster.cruise', frameW: 20, frameH: 24, frames: 4, ticksPerFrame: 3, mode: 'loop', color: 'baked' },
  { name: 'player.thruster.down', frameW: 20, frameH: 20, frames: 4, ticksPerFrame: 3, mode: 'loop', color: 'baked' },
  { name: 'player.thruster.particle.0', frameW: 12, frameH: 16, frames: 6, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.thruster.particle.1', frameW: 12, frameH: 16, frames: 6, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.bomb.missile', frameW: 16, frameH: 28, frames: 8, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.bomb.projectile', frameW: 12, frameH: 24, frames: 6, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.bomb.field', frameW: 48, frameH: 48, frames: 30, ticksPerFrame: 3, mode: 'once', color: 'baked' },
  { name: 'player.bomb.scout-tide', frameW: 48, frameH: 48, frames: 30, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.bomb.lance-pierce', frameW: 24, frameH: 48, frames: 12, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.bomb.hound-pack', frameW: 48, frameH: 40, frames: 12, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.bomb.spire-field', frameW: 48, frameH: 48, frames: 20, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
  { name: 'player.bomb.maw-devour', frameW: 48, frameH: 48, frames: 16, ticksPerFrame: 2, mode: 'loop', color: 'baked' },
];

export const V4_EFFECT_SPECS: readonly RowSpec[] = [
  ...NATIVE_EFFECT_NAMES.map((name): RowSpec => {
    const floor = FX_STRIPS[name]!;
    return {
      name,
      frameW: floor.frameW,
      frameH: floor.frameH,
      frames: floor.frames,
      ticksPerFrame: floor.ticksPerFrame,
      mode: floor.mode,
      color: 'baked',
    };
  }),
  ...PLAYER_EFFECT_SPECS,
];

function buildRows(specs: readonly RowSpec[], draw: (image: Bitmap, x: number, y: number, spec: RowSpec, frame: number) => void, src: string): PackedRows {
  const rows: BuiltRow[] = specs.map((spec) => {
    const row = bitmap(spec.frameW * spec.frames, spec.frameH);
    const frameBounds: Bounds[] = [];
    for (let frame = 0; frame < spec.frames; frame++) {
      draw(row, frame * spec.frameW, 0, spec, frame);
      frameBounds.push(alphaBounds(row, frame * spec.frameW, 0, spec.frameW, spec.frameH));
    }
    return { ...spec, bitmap: row, bounds: unionBounds(frameBounds) };
  });
  const width = Math.max(...rows.map((row) => row.bitmap.width));

  // Keep every animation strip horizontally contiguous, but place shorter
  // strips beside one another instead of uploading a full-width transparent
  // row for each entry. Height/width/name form a stable ordering, and the
  // first-fit shelves have no RNG or platform-dependent object enumeration.
  const ordered = [...rows].sort((a, b) =>
    b.frameH - a.frameH
    || b.bitmap.width - a.bitmap.width
    || a.name.localeCompare(b.name),
  );
  const shelves: { y: number; height: number; usedWidth: number }[] = [];
  const placements = new Map<string, { x: number; y: number }>();
  let height = 0;
  for (const row of ordered) {
    let shelf = shelves.find((candidate) =>
      row.frameH <= candidate.height && candidate.usedWidth + row.bitmap.width <= width,
    );
    if (shelf === undefined) {
      shelf = { y: height, height: row.frameH, usedWidth: 0 };
      shelves.push(shelf);
      height += row.frameH;
    }
    placements.set(row.name, { x: shelf.usedWidth, y: shelf.y });
    shelf.usedWidth += row.bitmap.width;
  }

  const atlas = bitmap(width, height);
  const strips: Record<string, PackStrip> = {};
  for (const row of rows) {
    const placement = placements.get(row.name);
    if (placement === undefined) throw new Error(`missing atlas placement for ${row.name}`);
    copyBitmap(row.bitmap, atlas, placement.x, placement.y);
    const size = boundsSize(row.bounds);
    strips[row.name] = {
      src,
      x: placement.x,
      y: placement.y,
      frames: row.frames,
      frameW: row.frameW,
      frameH: row.frameH,
      stride: row.frameW,
      ticksPerFrame: row.ticksPerFrame,
      mode: row.mode,
      color: row.color,
      contentW: size.width,
      contentH: size.height,
    };
  }
  return { bitmap: atlas, strips };
}

export const V4_LASER_SPECS: readonly RowSpec[] = LASER_STRIP_CELLS.map((name): RowSpec => ({
  name,
  frameW: name.startsWith('beam.') ? 48 : 28,
  frameH: name.startsWith('beam.') ? 24 : 28,
  frames: name.startsWith('beam.') ? 4 : 4,
  ticksPerFrame: 3,
  mode: 'loop',
  color: 'baked',
}));

function drawLaserFrame(image: Bitmap, x: number, y: number, spec: RowSpec, frame: number): void {
  const p = paletteForProjectile(spec.name);
  const cx = x + Math.floor(spec.frameW / 2);
  const cy = y + Math.floor(spec.frameH / 2);
  if (spec.name.startsWith('beam.')) {
    const thick = spec.name.includes('heavy') || spec.name.includes('v3.stream') ? 16
      : spec.name.includes('slim') ? 8 : 12;
    const top = cy - Math.floor(thick / 2);
    const bottom = cy + Math.floor(thick / 2);
    for (let py = top; py <= bottom; py++) {
      const distance = Math.abs(py - cy);
      const color = distance <= 1
        ? (frame % 2 === 0 ? p.bone : p.heart)
        : distance <= Math.floor(thick / 4) ? p.surface
          : [p.mycelium[0], p.mycelium[1], p.mycelium[2], 115] as const;
      // Bodies paint the complete on-beam axis.  There is no branch, heart, or
      // animation feature along x, so the right edge and next tile's left edge
      // are byte-identical and cannot reveal a seam.
      for (let px = x; px < x + spec.frameW; px++) over(image, px, py, color);
    }
    return;
  }
  const radius = 9 + (frame % 2);
  ring(image, cx, cy, radius, 2, p.surface);
  for (let i = 0; i < DIR8.length; i += 2) {
    const d = DIR8[(i + frame) % DIR8.length]!;
    line(image, cx + Math.round(d[0] / 3), cy + Math.round(d[1] / 3),
      cx + Math.round((d[0] * radius) / 8), cy + Math.round((d[1] * radius) / 8), p.mycelium);
  }
  heart(image, cx, cy, 2, p.heart);
}

export const V4_MISSILE_SPECS: readonly RowSpec[] = Object.entries(MISSILE_STRIPS).map(([name, floor]): RowSpec => ({
  name,
  frameW: name === 'missile.massive' ? 80 : 32,
  frameH: name === 'missile.massive' ? 48 : 16,
  frames: floor.frames,
  ticksPerFrame: floor.ticksPerFrame,
  mode: floor.mode,
  color: 'baked',
}));

function drawMissileFrame(image: Bitmap, x: number, y: number, spec: RowSpec, frame: number): void {
  const p = paletteForProjectile(spec.name);
  const cx = x + Math.floor(spec.frameW / 2);
  const cy = y + Math.floor(spec.frameH / 2);
  const tail = x + 3;
  const nose = x + spec.frameW - 3;
  const halfH = Math.max(3, Math.floor(spec.frameH / 2) - 3);
  const massive = spec.name === 'missile.massive';
  const ribs = massive ? 6 : 3;
  const span = nose - tail - 9;

  // A heart-writ, not a rocket: one bone axis, open ribs and loose hyphae. There
  // is deliberately no closed hull, aircraft fin, nozzle or exhaust triangle.
  line(image, tail + 4, cy, nose - 1, cy, p.bone);
  line(image, nose - 4, cy - 2, nose, cy, p.bone);
  line(image, nose - 4, cy + 2, nose, cy, p.bone);
  for (let rib = 0; rib < ribs; rib++) {
    const rx = tail + 7 + Math.round((span * rib) / Math.max(1, ribs - 1));
    const breathe = (frame + rib) % 3 - 1;
    const reach = Math.min(
      halfH - 1,
      Math.max(2, Math.round(halfH * (0.52 + (rib % 2) * 0.2)) + breathe),
    );
    line(image, rx, cy, rx - 3, cy - reach, rib % 2 === 0 ? p.surface : p.mycelium);
    line(image, rx, cy, rx - 3, cy + reach, rib % 2 === 0 ? p.mycelium : p.surface);
    disc(image, rx - 3, cy - reach, 1, p.surface);
    disc(image, rx - 3, cy + reach, 1, p.mycelium);
  }

  // Two trailing filaments replace propulsion. Their one-pixel breathing is a
  // living connection back to the firer, not a flame implying machinery.
  const flutter = frame % 3 - 1;
  line(image, tail + 8, cy, tail, cy - Math.max(2, halfH - 1) + flutter, p.mycelium);
  line(image, tail + 8, cy, tail + 1, cy + Math.max(2, halfH - 1) - flutter, p.surface);
  const heartX = cx + Math.floor(spec.frameW / 9);
  heart(image, heartX, cy, massive ? 3 : (frame % 2 === 0 ? 1 : 2), p.heart);
  ring(image, heartX, cy, massive ? 6 : 3, 1, [p.mycelium[0], p.mycelium[1], p.mycelium[2], 150]);
  if (spec.name === 'missile.massive') {
    // The Regent's massive writ is a long open thorax with a floating seal. It
    // stays porous at final size; the negative spaces are part of its identity.
    ring(image, cx - 17, cy, 8 + (frame % 2), 1, p.surface);
    line(image, cx - 9, cy, cx + 12, cy - 12, p.mycelium);
    line(image, cx - 9, cy, cx + 12, cy + 12, p.mycelium);
  }
}

function pickupPalette(name: string): Palette {
  if (name.includes('silver')) return PALETTES.stage1;
  if (name.includes('gold') || name === 'pickup.bar') return PALETTES.stage3;
  if (name.includes('green')) return PALETTES.hound;
  if (name.includes('yellow')) return PALETTES.lance;
  if (name.includes('cyan')) return PALETTES.scout;
  if (name.includes('pink')) return PALETTES.maw;
  return PALETTES.spire;
}

export const V4_PICKUP_SPECS: readonly RowSpec[] = Object.entries(PICKUP_STRIPS).map(([name, floor]): RowSpec => ({
  name,
  frameW: name === 'pickup.bar' ? 28 : 24,
  frameH: name === 'pickup.bar' ? 20 : 24,
  frames: floor.frames,
  ticksPerFrame: floor.ticksPerFrame,
  mode: floor.mode,
  color: 'baked',
}));

function drawPickupFrame(image: Bitmap, x: number, y: number, spec: RowSpec, frame: number): void {
  const p = pickupPalette(spec.name);
  const cx = x + Math.floor(spec.frameW / 2);
  const cy = y + Math.floor(spec.frameH / 2);
  const phase = frame % spec.frames;
  const halfW = Math.max(2, Math.round((spec.frameW / 2 - 3) * (phase <= spec.frames / 2
    ? 1 - 0.65 * (phase / Math.max(1, spec.frames / 2))
    : 0.35 + 0.65 * ((phase - spec.frames / 2) / Math.max(1, spec.frames / 2)))));
  const halfH = Math.floor(spec.frameH / 2) - 3;
  if (spec.name === 'pickup.bar') {
    convex(image, [[cx - halfW, cy - halfH], [cx + halfW, cy - halfH], [cx + halfW - 2, cy + halfH], [cx - halfW + 2, cy + halfH]],
      [p.surface[0], p.surface[1], p.surface[2], 205]);
  } else if (spec.name.includes('coin')) {
    ellipse(image, cx, cy, halfW, halfH, [p.surface[0], p.surface[1], p.surface[2], 205]);
    if (halfW > 3) ring(image, cx, cy, Math.min(halfW - 1, halfH - 2), 1, p.bone);
  } else {
    convex(image, [[cx, cy - halfH], [cx + halfW, cy], [cx, cy + halfH], [cx - halfW, cy]],
      [p.surface[0], p.surface[1], p.surface[2], 205]);
    line(image, cx, cy - halfH + 1, cx, cy + halfH - 1, p.bone);
  }
  heart(image, cx, cy, halfW >= 5 ? 2 : 1, p.heart);
  if (halfW >= 5) {
    line(image, cx - halfW + 1, cy, cx, cy - Math.max(2, halfH - 2), p.mycelium);
    line(image, cx + halfW - 1, cy, cx, cy + Math.max(2, halfH - 2), p.mycelium);
  }
}

function drawShipFrame(image: Bitmap, x: number, y: number, frame: number): void {
  const cx = x + 32;
  const cy = y + 32;
  const bank = frame - 2;
  const p = V4_SHARED_PLAYER_PALETTE;
  const wingShift = bank * 2;
  // Open crescents leave a dark, playable negative space around the heroine;
  // this is a back-wing/core, not a second protagonist or a copied spacecraft.
  ring(image, cx - 13 + wingShift, cy + 1, 12, 3, [p.surface[0], p.surface[1], p.surface[2], 190]);
  ring(image, cx + 13 + wingShift, cy + 1, 12, 3, [p.mycelium[0], p.mycelium[1], p.mycelium[2], 185]);
  // Mask the inner-facing half of each circle by simply restoring its opening as
  // transparent was intentionally avoided: the two rings overlap into a winged
  // infinity, with the actor atlas covering their centre at runtime.
  line(image, cx - 24 + wingShift, cy + 12, cx - 5 + wingShift, cy - 18, p.bone);
  line(image, cx + 24 + wingShift, cy + 12, cx + 5 + wingShift, cy - 18, p.bone);
  line(image, cx - 25 + wingShift, cy + 4, cx - 8 + wingShift, cy + 17, p.mycelium);
  line(image, cx + 25 + wingShift, cy + 4, cx + 8 + wingShift, cy + 17, p.surface);
  heart(image, cx + wingShift, cy + 3, 3, p.heart);
  ring(image, cx + wingShift, cy + 3, 8 + (Math.abs(bank) === 2 ? 1 : 0), 1, p.bone);
}

function buildShip(): { bytes: Uint8Array; contentW: number; contentH: number } {
  const frameW = 64;
  const frameH = 64;
  const frames = 5;
  const image = bitmap(frameW * frames, frameH);
  const bounds: Bounds[] = [];
  for (let frame = 0; frame < frames; frame++) {
    drawShipFrame(image, frame * frameW, 0, frame);
    bounds.push(alphaBounds(image, frame * frameW, 0, frameW, frameH));
  }
  const size = boundsSize(unionBounds(bounds));
  return { bytes: encode(image), contentW: size.width, contentH: size.height };
}

function buildHud(kind: 'life' | 'bomb'): Uint8Array {
  const image = bitmap(16, 16);
  const p = V4_SHARED_PLAYER_PALETTE;
  if (kind === 'life') {
    heart(image, 8, 8, 3, p.heart);
    line(image, 8, 3, 8, 13, p.bone);
    line(image, 3, 8, 5, 6, p.mycelium);
    line(image, 11, 10, 13, 8, p.surface);
  } else {
    // Four soft organs around a shared heart: a casting flower, not a weapon
    // sight. In particular there is no enclosing target ring and no long
    // horizontal/vertical stroke through the centre.
    ellipse(image, 5, 5, 2, 1, p.surface);
    ellipse(image, 11, 5, 1, 2, p.mycelium);
    ellipse(image, 11, 11, 2, 1, p.surface);
    ellipse(image, 5, 11, 1, 2, p.mycelium);
    line(image, 6, 6, 8, 8, p.bone);
    line(image, 10, 6, 8, 8, p.mycelium);
    line(image, 10, 10, 8, 8, p.bone);
    line(image, 6, 10, 8, 8, p.surface);
    heart(image, 8, 8, 1, p.heart);
  }
  return encode(image);
}

function buildReadme(manifest: PackManifest): string {
  const bulletAsset = manifest.assets?.bullets;
  if (bulletAsset === undefined || typeof bulletAsset === 'string') {
    throw new Error('v4 README needs the native bullet-sheet manifest');
  }
  const bulletCount = Object.keys(bulletAsset.strips).length;
  return `# v4 — 余白御寮 project-owned art pack

This committed pack is generated by \`bun run make:v4-pack\`.  It is original
project artwork: the generator does not read BulletPack and no purchased pixels
are present.  The style vocabulary is v4's own — open surface rings, skeletal
spines, branching mycelium and a warm heart core — redrawn at STG-native sizes.

## Runtime surface ledger

| Surface | Count | File |
|---|---:|---|
| Native bullet names (16 neutral floors + 56 current base variants) | ${bulletCount} | \`bullets/bullets.png\` |
| Native effects | ${NATIVE_EFFECT_NAMES.length} | \`effects/effects.png\` |
| Player option / thrust / bomb effects | ${PLAYER_EFFECT_SPECS.length} | \`effects/effects.png\` |
| Laser bodies + caps | ${V4_LASER_SPECS.length} | \`lasers/lasers.png\` |
| Missile bodies | ${V4_MISSILE_SPECS.length} | \`missiles/missiles.png\` |
| Pickups + result-tally coins | ${V4_PICKUP_SPECS.length} | \`pickups/pickups.png\` |
| Five-bank heart-wing core | 1 strip / 5 frames | \`player/ship.png\` |
| HUD life / bomb | 2 | \`hud/*.png\` |

Every animation strip remains horizontally contiguous. Multi-strip sheets use
a deterministic first-fit shelf layout, avoiding transparent full-width rows
without changing frame order, names or sampling geometry.

The procedural \`pulse\` floor is intentionally not replaced: it is an
engine-tinted neutral glow, not one of the purchased-pack-equivalent native
effect surfaces. Three registry variants currently unused by base content
(\`halo.seal\`, \`halo.crown\`, \`glow.small.beam\`) likewise retain their
procedural aliases. A test walks the
actual base JSON, so a future campaign edit that starts using one must add it to
this pack before the build turns green.

## Semantic colour families

- SCOUT: ice cyan, ultramarine, silver; LANCE: sakura, amber, bone white.
- HOUND: emerald, yellow-green, gold; SPIRE: violet, electric cyan, silver.
- MAW: vermilion, peach-magenta, acid green.
- Every one of the 16 enemies and 5 bosses has an explicit runtime-consumer
  palette entry. Missiles and lasers resolve through that owner ledger — never
  through a filename fragment, stage guess or missile-number cycle.
- A baked name shared by several people uses a declared multi-lineage scheme:
  first owner's surface, second owner's mycelium, final owner's heart, neutral
  bone. It does not impersonate one claimant. The important remaining shared
  enemy/player names are \`beam.cyan\` and \`scale.satellite\`; separating them
  further requires a presentation-only per-firer skin seam in the renderer.

## Four anatomical silhouettes

The semantic runtime name selects a primary anatomy, not merely a hue:

- \`surface\`: translucent membrane, travelling seam and open interior;
- \`skeleton\`: rigid bone axis, ribs and joints;
- \`mycelium\`: asymmetric branches, travelling nodes and seeking filaments;
- \`heart\`: a compact pulsing organ inside a light boundary.

Names that alias the same engine floor can therefore carry different alpha
silhouettes. For example \`orb.small.chaff\`, \`orb.small.battery\`,
\`orb.small.spark\` and \`orb.small.beacon\` are surface/skeleton/mycelium/heart,
not four colour swaps of one orb.

Actor material hits and Boss distress/Break/death use the Ghost body palette:
surface silver, bone white, cold-rim mycelium and the low-saturation pink-white
heart core. They deliberately do not inherit the saturated enemy projectile
palette. The five Boss death strips preserve identity as lunar fragments, a
seal cage, twin blades, archive tablets with script, and a rooted crown/dome.

Hostile bullets carry an opaque bone-white keyline and a five-pixel threat core;
player bullets keep an opaque identity-colour keyline. This faction grammar is
independent of the semantic anatomy above and remains readable against every
stage palette.

All oriented bullet and missile art points east (+x), matching CLAUDE.md rule 7.
Small bullets paint 6–14px, medium bullets 16–22px, large bullets 24–28px;
directional bodies stay at or below 25px on their long axis. Standard frames
clear at least 2px transparent padding. Laser bodies are the sole longitudinal
exception: they paint edge-to-edge with identical first/last columns, so tiled
beams are seamless while their cross-axis still clears padding.

Missiles retain their gameplay name and collision, but no longer look like
aircraft weapons: they are porous heart-writs made from a bone axis, open ribs,
loose hyphae and a pulsing organ. There is no closed hull, fin, nozzle or exhaust
flame. Each built-in heroine owns an option strip and her named spell-card strip;
the shared option/thrust/legacy-bomb/death fallback surfaces and five-bank
back-wing use one explicit cyan/magenta/amber multi-player palette instead. The
Bomb HUD is a four-organ casting flower, not a crosshair.

## Ownership

Copyright © 2026 Danmaku project owner.  License identifier:
\`${manifest.license}\`.  This pack may be shipped with this project; it does
not grant standalone redistribution rights outside the project.
`;
}

export function buildV4Pack(): V4PackBuild {
  const bullets = buildBullets();
  const effects = buildRows(V4_EFFECT_SPECS, drawEffectFrame, 'effects/effects.png');
  const lasers = buildRows(V4_LASER_SPECS, drawLaserFrame, 'lasers/lasers.png');
  const missiles = buildRows(V4_MISSILE_SPECS, drawMissileFrame, 'missiles/missiles.png');
  const pickups = buildRows(V4_PICKUP_SPECS, drawPickupFrame, 'pickups/pickups.png');
  const ship = buildShip();

  const manifest: PackManifest = {
    format: 1,
    name: 'v4',
    version: '4.0.0',
    author: 'Danmaku project',
    license: 'LicenseRef-Danmaku-Project-Owned',
    description: 'Original v4 Japanese-STG presentation pack: runtime-owner-linked surface, skeleton, mycelium and heart bullets; seamless lasers; open-rib heart-writs, effects, pickups, shared five-bank heart-wing and organic HUD. Existing background shaders remain engine-owned and unchanged.',
    assets: {
      bullets: { sheet: 'bullets/bullets.png', strips: bullets.strips },
      ship: {
        src: 'player/ship.png',
        frameW: 64,
        frameH: 64,
        frames: 5,
        stride: 64,
        ticksPerFrame: 1,
        mode: 'loop',
        color: 'baked',
        contentW: ship.contentW,
        contentH: ship.contentH,
        banking: 'five-way',
      },
      filter: 'nearest',
      effects: effects.strips,
      lasers: lasers.strips,
      missiles: missiles.strips,
      pickups: pickups.strips,
    },
    hud: { life: 'hud/life.png', bomb: 'hud/bomb.png' },
  };

  const validation = validateManifest(manifest, 'v4');
  if ('errors' in validation) {
    throw new Error(`generated v4 manifest is invalid:\n${validation.errors.join('\n')}`);
  }

  const files = new Map<string, Uint8Array | string>([
    ['bullets/bullets.png', bullets.bytes],
    ['effects/effects.png', encode(effects.bitmap)],
    ['lasers/lasers.png', encode(lasers.bitmap)],
    ['missiles/missiles.png', encode(missiles.bitmap)],
    ['pickups/pickups.png', encode(pickups.bitmap)],
    ['player/ship.png', ship.bytes],
    ['hud/life.png', buildHud('life')],
    ['hud/bomb.png', buildHud('bomb')],
    ['pack.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['README.md', buildReadme(manifest)],
  ]);
  return { manifest, files };
}

export function writeV4Pack(outDir = V4_PACK_DIR): V4PackBuild {
  const build = buildV4Pack();
  for (const [relative, contents] of build.files) {
    const path = join(outDir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return build;
}

if (import.meta.main) {
  const build = writeV4Pack();
  const assets = build.manifest.assets!;
  const bullets = assets.bullets as Exclude<typeof assets.bullets, string | undefined>;
  console.log(`v4 pack: ${Object.keys(bullets.strips).length} bullets`);
  console.log(`v4 pack: ${Object.keys(assets.effects ?? {}).length} effects (${NATIVE_EFFECT_NAMES.length} native + ${PLAYER_EFFECT_SPECS.length} player)`);
  console.log(`v4 pack: ${Object.keys(assets.lasers ?? {}).length} lasers, ${Object.keys(assets.missiles ?? {}).length} missiles, ${Object.keys(assets.pickups ?? {}).length} pickups`);
  console.log(`v4 pack: wrote ${build.files.size} files to ${V4_PACK_DIR}`);
}
