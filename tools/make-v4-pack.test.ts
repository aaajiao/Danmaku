/**
 * Pixel and reachability contract for the committed project-owned v4 pack.
 *
 * These checks intentionally read the emitted PNG bytes.  A table saying a
 * frame has padding or a 12px visible body proves nothing if the painter and the
 * table drift; the decoded alpha is the authority.  Laser bodies have their own
 * longitudinal exception and are checked for exact edge continuity instead.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  BULLET_CELLS,
  BULLET_VARIANTS,
  FX_STRIPS,
  LASER_STRIP_CELLS,
  MISSILE_STRIP_CELLS,
  PICKUP_STRIP_CELLS,
} from '../src/render/procedural';
import { BASE_LASER_SKINS } from '../src/render/laser-skin';
import type { PackBulletSheet, PackStrip } from '../src/packs/manifest';
import { decodePng, type DecodedImage } from './png-decode';
import {
  V4_OWNER_IDS,
  V4_OWNER_PALETTES,
  V4_OWNER_PROJECTILES,
  V4_BULLET_NAMES,
  V4_EFFECT_SPECS,
  V4_LASER_SPECS,
  V4_MISSILE_SPECS,
  V4_PACK_DIR,
  V4_PICKUP_SPECS,
  V4_PROJECTILE_OWNERS,
  V4_SHARED_PLAYER_PALETTE,
  baseBulletName,
  bulletAnatomyLayer,
  buildV4Pack,
  bulletExtentClass,
  paletteForEffect,
  paletteForProjectile,
  projectileFaction,
  type V4ProjectileOwner,
} from './make-v4-pack';

interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface MeasuredFrame {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly painted: number;
  readonly hash: string;
}

const build = buildV4Pack();
const assets = build.manifest.assets!;
const bulletAsset = assets.bullets;
if (bulletAsset === undefined || typeof bulletAsset === 'string') {
  throw new Error('v4 test needs a native bullet sheet');
}
const bullets: PackBulletSheet = bulletAsset;

const decoded = new Map<string, DecodedImage>();

function bytes(relative: string): Uint8Array {
  const value = build.files.get(relative);
  if (!(value instanceof Uint8Array)) throw new Error(`${relative} is not a generated PNG`);
  return value;
}

function png(relative: string): DecodedImage {
  let image = decoded.get(relative);
  if (image === undefined) {
    image = decodePng(bytes(relative));
    decoded.set(relative, image);
  }
  return image;
}

function rgbaAt(image: DecodedImage, x: number, y: number): readonly [number, number, number, number] {
  const at = (y * image.width + x) * 4;
  return [image.rgba[at]!, image.rgba[at + 1]!, image.rgba[at + 2]!, image.rgba[at + 3]!];
}

function measureFrame(image: DecodedImage, rect: FrameRect): MeasuredFrame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let painted = 0;
  let hash = 2166136261;
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const rgba = rgbaAt(image, rect.x + x, rect.y + y);
      for (const channel of rgba) {
        hash ^= channel;
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      if (rgba[3] === 0) continue;
      painted++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (painted === 0) {
    return { minX: 0, minY: 0, maxX: -1, maxY: -1, painted, hash: hash.toString(16) };
  }
  return { minX, minY, maxX, maxY, painted, hash: hash.toString(16) };
}

function stripFrames(image: DecodedImage, strip: {
  x?: number; y?: number; frameW: number; frameH: number; frames?: number; stride?: number;
}): MeasuredFrame[] {
  const x = strip.x ?? 0;
  const y = strip.y ?? 0;
  const frames = strip.frames ?? 1;
  const stride = strip.stride ?? strip.frameW;
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(x + (frames - 1) * stride + strip.frameW).toBeLessThanOrEqual(image.width);
  expect(y + strip.frameH).toBeLessThanOrEqual(image.height);
  return Array.from({ length: frames }, (_, frame) => measureFrame(image, {
    x: x + frame * stride,
    y,
    width: strip.frameW,
    height: strip.frameH,
  }));
}

/** Hash only painted-vs-transparent geometry; colour differences cannot pass it. */
function alphaMaskHash(
  image: DecodedImage,
  strip: { x?: number; y?: number; frameW: number; frameH: number; stride?: number },
  frame = 0,
): string {
  const x0 = (strip.x ?? 0) + frame * (strip.stride ?? strip.frameW);
  const y0 = strip.y ?? 0;
  let hash = 2166136261;
  for (let y = 0; y < strip.frameH; y++) {
    for (let x = 0; x < strip.frameW; x++) {
      hash ^= rgbaAt(image, x0 + x, y0 + y)[3] === 0 ? 0 : 1;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(16);
}

function longestOpaqueRun(values: readonly number[]): number {
  let longest = 0;
  let run = 0;
  for (const alpha of values) {
    if (alpha > 0) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}

function unionSize(frames: readonly MeasuredFrame[]): { width: number; height: number } {
  return {
    width: Math.max(...frames.map((frame) => frame.maxX)) - Math.min(...frames.map((frame) => frame.minX)) + 1,
    height: Math.max(...frames.map((frame) => frame.maxY)) - Math.min(...frames.map((frame) => frame.minY)) + 1,
  };
}

function expectStandardPadding(frame: MeasuredFrame, frameW: number, frameH: number, pad = 2): void {
  expect(frame.minX).toBeGreaterThanOrEqual(pad);
  expect(frame.minY).toBeGreaterThanOrEqual(pad);
  expect(frame.maxX).toBeLessThanOrEqual(frameW - pad - 1);
  expect(frame.maxY).toBeLessThanOrEqual(frameH - pad - 1);
}

function expectAnimated(frames: readonly MeasuredFrame[]): void {
  if (frames.length <= 1) return;
  expect(new Set(frames.map((frame) => frame.hash)).size).toBeGreaterThan(1);
}

function expectExactContent(strip: { contentW?: number; contentH?: number }, frames: readonly MeasuredFrame[]): void {
  const union = unionSize(frames);
  expect(strip.contentW).toBe(union.width);
  expect(strip.contentH).toBe(union.height);
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function addOwner(
  out: Map<string, Set<V4ProjectileOwner>>,
  name: string,
  owner: V4ProjectileOwner,
): void {
  let owners = out.get(name);
  if (owners === undefined) {
    owners = new Set<V4ProjectileOwner>();
    out.set(name, owners);
  }
  owners.add(owner);
}

function collectProjectileSpecs(
  value: unknown,
  owner: V4ProjectileOwner,
  out: Map<string, Set<V4ProjectileOwner>>,
): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectProjectileSpecs(child, owner, out));
    return;
  }
  const object = record(value);
  if (object === undefined) return;
  const style = record(object.style);
  const sprite = style?.sprite;
  const projectile = style !== undefined && typeof sprite === 'string' && (
    'motion' in object || 'damage' in object || 'laser' in object || 'blade' in object || 'missile' in object
  );
  if (projectile && typeof sprite === 'string') {
    addOwner(out, sprite, owner);
    if ('laser' in object) {
      const skin = BASE_LASER_SKINS[sprite];
      if (skin !== undefined) addOwner(out, skin.cap, owner);
    }
  }
  for (const child of Object.values(object)) collectProjectileSpecs(child, owner, out);
}

function actualBaseProjectileOwners(): Map<string, Set<V4ProjectileOwner>> {
  const base = record(JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'src', 'v4', 'content', 'campaign.json'), 'utf8'),
  ));
  const content = record(base?.content);
  if (content === undefined) throw new Error('base pack has no content');
  const out = new Map<string, Set<V4ProjectileOwner>>();

  for (const kind of ['enemies', 'bosses'] as const) {
    const entries = record(content[kind]);
    if (entries === undefined) throw new Error(`base pack has no ${kind}`);
    const prefix = kind === 'enemies' ? 'enemy' : 'boss';
    for (const [name, spec] of Object.entries(entries)) {
      collectProjectileSpecs(spec, `${prefix}.${name}` as V4ProjectileOwner, out);
    }
  }

  const characters = record(content.characters);
  const shots = record(content.shots);
  const options = record(content.options);
  if (characters === undefined || shots === undefined || options === undefined) {
    throw new Error('base pack has no player-side content');
  }
  for (const [name, rawCharacter] of Object.entries(characters)) {
    const character = record(rawCharacter);
    const shot = character?.shot;
    const option = character?.options;
    if (typeof shot !== 'string' || typeof option !== 'string') throw new Error(`bad character ${name}`);
    const owner = `player.${name}` as V4ProjectileOwner;
    collectProjectileSpecs(shots[shot], owner, out);
    collectProjectileSpecs(options[option], owner, out);
  }
  return out;
}

function ownerEntries(
  owners: ReadonlyMap<string, ReadonlySet<V4ProjectileOwner>> | Readonly<Record<string, readonly V4ProjectileOwner[]>>,
): readonly (readonly [string, readonly V4ProjectileOwner[]])[] {
  const entries = owners instanceof Map ? [...owners.entries()] : Object.entries(owners);
  return entries
    .map(([name, values]) => [name, [...values].sort()] as const)
    .sort(([a], [b]) => a.localeCompare(b));
}

function containsRgb(image: DecodedImage, rgb: readonly [number, number, number]): boolean {
  for (let at = 0; at < image.rgba.length; at += 4) {
    if (
      image.rgba[at] === rgb[0]
      && image.rgba[at + 1] === rgb[1]
      && image.rgba[at + 2] === rgb[2]
      && image.rgba[at + 3]! > 0
    ) return true;
  }
  return false;
}

describe('generated output and exact manifest', () => {
  test('every committed file is byte-identical to the generator output', () => {
    for (const [relative, generated] of build.files) {
      const committed = readFileSync(join(V4_PACK_DIR, relative));
      const expected = typeof generated === 'string' ? Buffer.from(generated) : Buffer.from(generated);
      expect(committed.byteLength).toBe(expected.byteLength);
      expect(Buffer.compare(committed, expected)).toBe(0);
    }
  });

  test('category ledgers are complete, exact and project-owned', () => {
    expect(build.manifest.author).toBe('Danmaku project');
    expect(build.manifest.license).toBe('LicenseRef-Danmaku-Project-Owned');
    expect(Object.keys(bullets.strips)).toEqual([...V4_BULLET_NAMES]);
    expect(Object.keys(bullets.strips)).toHaveLength(70);

    const nativeEffects = Object.keys(FX_STRIPS).filter((name) => name !== 'pulse');
    expect(V4_EFFECT_SPECS.slice(0, nativeEffects.length).map((spec) => spec.name)).toEqual(nativeEffects);
    expect(Object.keys(assets.effects ?? {})).toEqual(V4_EFFECT_SPECS.map((spec) => spec.name));
    expect(Object.keys(assets.effects ?? {})).toHaveLength(20);
    expect(Object.keys(assets.lasers ?? {})).toEqual([...LASER_STRIP_CELLS]);
    expect(Object.keys(assets.missiles ?? {})).toEqual([...MISSILE_STRIP_CELLS]);
    expect(Object.keys(assets.pickups ?? {})).toEqual([...PICKUP_STRIP_CELLS]);
    const shipAsset = assets.ship;
    if (shipAsset === undefined || typeof shipAsset === 'string') throw new Error('v4 ship must be native');
    expect(shipAsset.frames).toBe(5);
    expect(shipAsset.banking).toBe('five-way');
    expect(build.manifest.hud).toEqual({ life: 'hud/life.png', bomb: 'hud/bomb.png' });
  });

  test('multi-strip atlases use deterministic non-overlapping shelf packing', () => {
    let savedAtlases = 0;
    for (const [relative, specs, strips] of [
      ['effects/effects.png', V4_EFFECT_SPECS, assets.effects ?? {}],
      ['lasers/lasers.png', V4_LASER_SPECS, assets.lasers ?? {}],
      ['missiles/missiles.png', V4_MISSILE_SPECS, assets.missiles ?? {}],
      ['pickups/pickups.png', V4_PICKUP_SPECS, assets.pickups ?? {}],
    ] as const) {
      const image = png(relative);
      const entries = Object.entries(strips);
      for (let i = 0; i < entries.length; i++) {
        const [aName, a] = entries[i]!;
        for (let j = i + 1; j < entries.length; j++) {
          const [bName, b] = entries[j]!;
          const aWidth = a.frameW * (a.frames ?? 1);
          const bWidth = b.frameW * (b.frames ?? 1);
          const overlaps =
            (a.x ?? 0) < (b.x ?? 0) + bWidth
            && (a.x ?? 0) + aWidth > (b.x ?? 0)
            && (a.y ?? 0) < (b.y ?? 0) + b.frameH
            && (a.y ?? 0) + a.frameH > (b.y ?? 0);
          expect(overlaps, `${relative}: ${aName} overlaps ${bName}`).toBe(false);
        }
      }
      const linearHeight = specs.reduce((sum, spec) => sum + spec.frameH, 0);
      expect(image.height, `${relative} must never exceed one-strip-per-row packing`).toBeLessThanOrEqual(
        linearHeight,
      );
      if (image.height < linearHeight) savedAtlases++;
    }
    expect(savedAtlases).toBeGreaterThanOrEqual(2);
  });
});

describe('runtime consumer ownership', () => {
  test('the owner ledger is exactly the five players, sixteen enemies and five bosses', () => {
    expect(V4_OWNER_IDS).toHaveLength(26);
    expect(new Set(V4_OWNER_IDS).size).toBe(26);
    expect(V4_OWNER_IDS.filter((name) => name.startsWith('player.'))).toHaveLength(5);
    expect(V4_OWNER_IDS.filter((name) => name.startsWith('enemy.'))).toHaveLength(16);
    expect(V4_OWNER_IDS.filter((name) => name.startsWith('boss.'))).toHaveLength(5);
    for (const owner of V4_OWNER_IDS) {
      expect(V4_OWNER_PROJECTILES[owner].length, owner).toBeGreaterThan(0);
      expect(V4_OWNER_PALETTES[owner], owner).toBeDefined();
    }
  });

  test('authored ownership equals the actual base JSON, including laser caps', () => {
    expect(ownerEntries(V4_PROJECTILE_OWNERS)).toEqual(ownerEntries(actualBaseProjectileOwners()));
  });

  test('known player, missile and beam corrections stay attached to their real consumers', () => {
    expect(V4_PROJECTILE_OWNERS['scale.satellite']).toEqual(['player.lance']);
    expect(V4_PROJECTILE_OWNERS['orb.small.satellite']).toEqual(['player.scout', 'player.spire']);
    expect(V4_PROJECTILE_OWNERS['orb.small.battery']).toEqual(['player.hound']);
    expect(V4_PROJECTILE_OWNERS['missile.2']).toEqual(['enemy.drifter']);
    expect(V4_PROJECTILE_OWNERS['missile.3']).toEqual(['boss.warden']);
    expect(V4_PROJECTILE_OWNERS['missile.4']).toEqual(['boss.magistrate']);
    expect(V4_PROJECTILE_OWNERS['missile.5']).toEqual(['enemy.summons']);
    expect(V4_PROJECTILE_OWNERS['missile.6']).toEqual(['enemy.weaver']);
    expect(V4_PROJECTILE_OWNERS['missile.7']).toEqual(['enemy.lash']);
    expect(V4_PROJECTILE_OWNERS['missile.9']).toEqual(['boss.chancellor']);
    expect(V4_PROJECTILE_OWNERS['missile.10']).toEqual(['enemy.marshal']);
    expect(V4_PROJECTILE_OWNERS['missile.11']).toEqual(['enemy.stele']);
    expect(V4_PROJECTILE_OWNERS['beam.slim']).toEqual(['enemy.ray']);
    expect(V4_PROJECTILE_OWNERS['beam.heavy']).toEqual(['boss.warden']);
    expect(V4_PROJECTILE_OWNERS['beam.cyan']).toEqual(['player.spire', 'boss.magistrate']);
  });

  test('presentation faction comes from runtime owners, including explicitly shared resources', () => {
    expect(projectileFaction('glow.small.bolt')).toBe('player');
    expect(projectileFaction('orb.small.chaff')).toBe('hostile');
    expect(projectileFaction('beam.cyan')).toBe('shared');
    expect(projectileFaction('orb.small')).toBe('neutral');

    const semanticBullets = V4_BULLET_NAMES.filter((name) => !(BULLET_CELLS as readonly string[]).includes(name));
    expect(semanticBullets.filter((name) => projectileFaction(name) === 'player')).toHaveLength(19);
    expect(semanticBullets.filter((name) => projectileFaction(name) === 'hostile')).toHaveLength(35);
    expect(semanticBullets.filter((name) => projectileFaction(name) === 'neutral')).toEqual([]);
    expect(semanticBullets.filter((name) => projectileFaction(name) === 'shared')).toEqual([]);
  });

  test('single-owner names use that person; shared names declare a neutral multi-lineage', () => {
    for (const [name, owners] of Object.entries(V4_PROJECTILE_OWNERS)) {
      const palette = paletteForProjectile(name);
      if (owners.length === 1) {
        expect(palette, name).toBe(V4_OWNER_PALETTES[owners[0]!]!);
        continue;
      }
      expect(palette.surface, name).toEqual(V4_OWNER_PALETTES[owners[0]!]!.surface);
      expect(palette.mycelium, name).toEqual(V4_OWNER_PALETTES[owners[1]!]!.mycelium);
      expect(palette.heart, name).toEqual(V4_OWNER_PALETTES[owners[owners.length - 1]!]!.heart);
      for (const owner of owners) expect(palette, `${name} vs ${owner}`).not.toEqual(V4_OWNER_PALETTES[owner]);
    }
  });
});

describe('bullet geometry and colour', () => {
  const sheet = png(bullets.sheet);

  const eastKeylineOffset: Readonly<Record<string, number>> = {
    'orb.small': 5,
    'orb.medium': 9,
    'orb.large': 13,
    ring: 13,
    halo: 13,
    'glow.small': 6,
    'glow.medium': 10,
    'glow.large': 13,
    kunai: 11,
    scale: 9,
    shard: 12,
    needle: 12,
    petal: 9,
    star: 13,
    spark: 10,
    mote: 4,
  };

  test('every declared frame is nonempty, animated, padded and content-exact', () => {
    for (const [name, strip] of Object.entries(bullets.strips)) {
      const frames = stripFrames(sheet, strip);
      for (const frame of frames) {
        expect(frame.painted, name).toBeGreaterThan(0);
        expectStandardPadding(frame, strip.frameW, strip.frameH);
      }
      expectAnimated(frames);
      expectExactContent(strip, frames);
    }
  });

  test('visible content obeys the STG small/medium/large budget', () => {
    for (const [name, strip] of Object.entries(bullets.strips)) {
      const size = unionSize(stripFrames(sheet, strip));
      const extent = Math.max(size.width, size.height);
      switch (bulletExtentClass(baseBulletName(name))) {
        case 'small':
          expect(extent, name).toBeGreaterThanOrEqual(6);
          expect(extent, name).toBeLessThanOrEqual(14);
          break;
        case 'medium':
          expect(extent, name).toBeGreaterThanOrEqual(16);
          expect(extent, name).toBeLessThanOrEqual(22);
          break;
        case 'large':
          expect(extent, name).toBeGreaterThanOrEqual(24);
          expect(extent, name).toBeLessThanOrEqual(28);
          break;
        case 'directional':
          expect(size.width, name).toBeGreaterThan(size.height);
          expect(size.width, name).toBeGreaterThanOrEqual(18);
          expect(size.width, name).toBeLessThanOrEqual(25);
          break;
      }
    }
  });

  test('floor cells stay neutral while every semantic variant carries baked chroma', () => {
    for (const [name, strip] of Object.entries(bullets.strips)) {
      let chromatic = false;
      for (let frame = 0; frame < (strip.frames ?? 1); frame++) {
        for (let y = 0; y < strip.frameH; y++) {
          for (let x = 0; x < strip.frameW; x++) {
            const rgba = rgbaAt(sheet, strip.x + frame * (strip.stride ?? strip.frameW) + x, strip.y + y);
            if (rgba[3] === 0) continue;
            if ((BULLET_CELLS as readonly string[]).includes(name)) {
              expect(rgba[0], name).toBe(rgba[1]);
              expect(rgba[1], name).toBe(rgba[2]);
            } else if (Math.max(rgba[0], rgba[1], rgba[2]) - Math.min(rgba[0], rgba[1], rgba[2]) >= 24) {
              chromatic = true;
            }
          }
        }
      }
      if (!(BULLET_CELLS as readonly string[]).includes(name)) expect(chromatic, name).toBe(true);
    }
  });

  test('hostile bullets have a solid threat core and bone keyline; player keylines stay chromatic', () => {
    for (const [name, strip] of Object.entries(bullets.strips)) {
      const faction = projectileFaction(name);
      if (faction === 'neutral') continue;
      expect(['player', 'hostile'], name).toContain(faction);

      const p = paletteForProjectile(name);
      const base = baseBulletName(name);
      const keylineOffset = eastKeylineOffset[base];
      if (keylineOffset === undefined) throw new Error(`missing keyline probe for ${base}`);

      for (let frame = 0; frame < (strip.frames ?? 1); frame++) {
        const frameX = strip.x + frame * (strip.stride ?? strip.frameW);
        const cx = frameX + Math.floor(strip.frameW / 2);
        const cy = strip.y + Math.floor(strip.frameH / 2);
        const diagonalX = base === 'spark' && frame % 2 === 1
          ? Math.round((keylineOffset * 6) / 8)
          : 0;
        const diagonalY = base === 'spark' && frame % 2 === 1
          ? Math.round((-keylineOffset * 6) / 8)
          : 0;
        const keyline = diagonalX > 0
          ? rgbaAt(sheet, cx + diagonalX, cy + diagonalY)
          : rgbaAt(sheet, cx + keylineOffset, cy);

        if (faction === 'player') {
          expect(keyline, `${name} frame ${frame} player keyline`).toEqual([
            p.surface[0], p.surface[1], p.surface[2], 255,
          ]);
          expect(keyline.slice(0, 3), `${name} frame ${frame} faction contrast`).not.toEqual(p.bone.slice(0, 3));
          continue;
        }

        expect(keyline, `${name} frame ${frame} hostile keyline`).toEqual(p.bone);
        expect(rgbaAt(sheet, cx, cy), `${name} frame ${frame} identity centre`).toEqual(p.heart);
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          expect(rgbaAt(sheet, cx + dx, cy + dy), `${name} frame ${frame} bone core`).toEqual(p.bone);
        }
      }
    }
  });

  test('directional silhouettes point east (+x): one-point nose, blunt tail', () => {
    const directionalBases = new Set(['kunai', 'scale', 'shard', 'needle', 'petal']);
    for (const [name, strip] of Object.entries(bullets.strips)) {
      if (!directionalBases.has(baseBulletName(name))) continue;
      const frame = stripFrames(sheet, strip)[0]!;
      let tail = 0;
      let nose = 0;
      for (let y = frame.minY; y <= frame.maxY; y++) {
        if (rgbaAt(sheet, strip.x + frame.minX, strip.y + y)[3] > 0) tail++;
        if (rgbaAt(sheet, strip.x + frame.maxX, strip.y + y)[3] > 0) nose++;
      }
      expect(nose, name).toBeLessThanOrEqual(tail);
      expect(nose, name).toBeLessThanOrEqual(2);
    }
  });

  test('surface, skeleton, mycelium and heart are different alpha silhouettes, not recolours', () => {
    const families = [
      [
        ['orb.small.chaff', 'surface'],
        ['orb.small.battery', 'skeleton'],
        ['orb.small.spark', 'mycelium'],
        ['orb.small.beacon', 'heart'],
      ],
      [
        ['scale.shell', 'surface'],
        ['scale.shard', 'skeleton'],
        ['scale.escrow', 'mycelium'],
        ['scale.satellite', 'heart'],
      ],
    ] as const;
    for (const family of families) {
      const masks = new Set<string>();
      for (const [name, layer] of family) {
        expect(bulletAnatomyLayer(name), name).toBe(layer);
        masks.add(alphaMaskHash(sheet, bullets.strips[name]!));
      }
      expect(masks.size).toBe(4);
    }
    expect(new Set(V4_BULLET_NAMES.map(bulletAnatomyLayer))).toEqual(
      new Set(['surface', 'skeleton', 'mycelium', 'heart']),
    );
  });
});

function categoryContract(
  label: string,
  relative: string,
  strips: Readonly<Record<string, PackStrip>>,
): void {
  describe(label, () => {
    const sheet = png(relative);
    test('every frame is nonempty, animated, padded and content-exact', () => {
      for (const [name, strip] of Object.entries(strips)) {
        const frames = stripFrames(sheet, strip);
        for (const frame of frames) {
          expect(frame.painted, name).toBeGreaterThan(0);
          expectStandardPadding(frame, strip.frameW, strip.frameH);
        }
        expectAnimated(frames);
        expectExactContent(strip, frames);
      }
    });
  });
}

categoryContract('effects atlas', 'effects/effects.png', assets.effects ?? {});
categoryContract('missiles atlas', 'missiles/missiles.png', assets.missiles ?? {});
categoryContract('pickups atlas', 'pickups/pickups.png', assets.pickups ?? {});

describe('missile anatomy', () => {
  const sheet = png('missiles/missiles.png');
  const strips = assets.missiles ?? {};

  test('every missile is a single-owner porous heart-writ, never a filled rocket hull', () => {
    for (const [name, strip] of Object.entries(strips)) {
      expect(V4_PROJECTILE_OWNERS[name], name).toHaveLength(1);
      for (let frameIndex = 0; frameIndex < (strip.frames ?? 1); frameIndex++) {
        const frameX = (strip.x ?? 0) + frameIndex * (strip.stride ?? strip.frameW);
        const frameY = strip.y ?? 0;
        const measured = measureFrame(sheet, {
          x: frameX,
          y: frameY,
          width: strip.frameW,
          height: strip.frameH,
        });
        const boundWidth = measured.maxX - measured.minX + 1;
        const boundHeight = measured.maxY - measured.minY + 1;
        const density = measured.painted / (boundWidth * boundHeight);
        expect(density, `${name} frame ${frameIndex}`).toBeLessThan(0.5);

        let broadRows = 0;
        for (let y = measured.minY; y <= measured.maxY; y++) {
          let painted = 0;
          for (let x = measured.minX; x <= measured.maxX; x++) {
            if (rgbaAt(sheet, frameX + x, frameY + y)[3] > 0) painted++;
          }
          if (painted >= boundWidth * 0.6) broadRows++;
        }
        expect(broadRows, `${name} frame ${frameIndex}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('laser seam contract', () => {
  const sheet = png('lasers/lasers.png');
  const strips = assets.lasers ?? {};

  test('caps are normally padded; bodies are cross-padded and longitudinally continuous', () => {
    for (const [name, strip] of Object.entries(strips)) {
      const frames = stripFrames(sheet, strip);
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const frame = frames[frameIndex]!;
        expect(frame.painted, name).toBeGreaterThan(0);
        if (!name.startsWith('beam.')) {
          expectStandardPadding(frame, strip.frameW, strip.frameH);
          continue;
        }
        expect(frame.minX, name).toBe(0);
        expect(frame.maxX, name).toBe(strip.frameW - 1);
        expect(frame.minY, name).toBeGreaterThanOrEqual(2);
        expect(frame.maxY, name).toBeLessThanOrEqual(strip.frameH - 3);
        const frameX = (strip.x ?? 0) + frameIndex * (strip.stride ?? strip.frameW);
        const frameY = strip.y ?? 0;
        let edgePaint = 0;
        for (let y = 0; y < strip.frameH; y++) {
          const left = rgbaAt(sheet, frameX, frameY + y);
          const right = rgbaAt(sheet, frameX + strip.frameW - 1, frameY + y);
          expect(right, `${name} frame ${frameIndex} row ${y}`).toEqual(left);
          if (left[3] === 0) continue;
          edgePaint++;
          for (let x = 1; x < strip.frameW - 1; x++) {
            expect(rgbaAt(sheet, frameX + x, frameY + y)[3], `${name} frame ${frameIndex} row ${y} x ${x}`).toBeGreaterThan(0);
          }
        }
        expect(edgePaint, name).toBeGreaterThan(0);
      }
      expectAnimated(frames);
      expectExactContent(strip, frames);
    }
  });
});

describe('ship and HUD', () => {
  test('shared player presentation carries several lineages and no single heroine palette', () => {
    for (const name of ['player.option', 'player.thruster.particle.0', 'player.bomb.field', 'boom.player']) {
      expect(paletteForEffect(name), name).toBe(V4_SHARED_PLAYER_PALETTE);
    }
    for (const owner of V4_OWNER_IDS.filter((name) => name.startsWith('player.'))) {
      expect(V4_SHARED_PLAYER_PALETTE, owner).not.toEqual(V4_OWNER_PALETTES[owner]);
    }

    const shipAsset = assets.ship;
    if (shipAsset === undefined || typeof shipAsset === 'string') throw new Error('v4 ship must be native');
    const image = png(shipAsset.src);
    const p = V4_SHARED_PLAYER_PALETTE;
    expect(containsRgb(image, [p.surface[0], p.surface[1], p.surface[2]])).toBe(true);
    expect(containsRgb(image, [p.mycelium[0], p.mycelium[1], p.mycelium[2]])).toBe(true);
    expect(containsRgb(image, [p.heart[0], p.heart[1], p.heart[2]])).toBe(true);
  });

  test('five heart-wing banks declare their semantics and are distinct, nonempty and padded', () => {
    const shipAsset = assets.ship;
    if (shipAsset === undefined || typeof shipAsset === 'string') throw new Error('v4 ship must be native');
    const image = png(shipAsset.src);
    const frames = stripFrames(image, shipAsset);
    expect(shipAsset.banking).toBe('five-way');
    expect(frames).toHaveLength(5);
    frames.forEach((frame) => {
      expect(frame.painted).toBeGreaterThan(0);
      expectStandardPadding(frame, shipAsset.frameW, shipAsset.frameH);
    });
    expect(new Set(frames.map((frame) => frame.hash)).size).toBe(5);
    expectExactContent(shipAsset, frames);
  });

  test('life and bomb icons are nonempty 16px RGBA with a transparent rim', () => {
    for (const path of ['hud/life.png', 'hud/bomb.png']) {
      const image = png(path);
      expect(image.width).toBe(16);
      expect(image.height).toBe(16);
      const frame = measureFrame(image, { x: 0, y: 0, width: 16, height: 16 });
      expect(frame.painted).toBeGreaterThan(0);
      expectStandardPadding(frame, 16, 16, 1);
    }
  });

  test('bomb HUD is an organic casting flower without a mechanical crosshair', () => {
    const image = png('hud/bomb.png');
    const centerRow = Array.from({ length: image.width }, (_, x) => rgbaAt(image, x, 8)[3]);
    const centerColumn = Array.from({ length: image.height }, (_, y) => rgbaAt(image, 8, y)[3]);
    expect(longestOpaqueRun(centerRow)).toBeLessThanOrEqual(3);
    expect(longestOpaqueRun(centerColumn)).toBeLessThanOrEqual(3);
  });
});

describe('base campaign name reachability', () => {
  test('every sprite string used by base-pack resolves on a v4 runtime surface', () => {
    const base = JSON.parse(readFileSync(join(import.meta.dir, '..', 'src', 'v4', 'content', 'campaign.json'), 'utf8')) as unknown;
    const used = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'sprite' && typeof child === 'string') used.add(child);
        walk(child);
      }
    };
    walk(base);
    const reachable = new Set([
      ...Object.keys(bullets.strips),
      ...Object.keys(assets.lasers ?? {}),
      ...Object.keys(assets.missiles ?? {}),
      'ship',
    ]);
    expect([...used].filter((name) => !reachable.has(name))).toEqual([]);
  });

  test('the 70-name bullet ledger is exactly floors plus currently reached variants', () => {
    const variants = V4_BULLET_NAMES.filter((name) => name in BULLET_VARIANTS);
    expect(V4_BULLET_NAMES.slice(0, BULLET_CELLS.length)).toEqual([...BULLET_CELLS]);
    expect(variants).toHaveLength(54);
  });
});
