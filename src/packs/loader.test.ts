import { afterEach, describe, expect, test } from 'bun:test';
import { hashPack } from './manifest';
import {
  implicitArtPack,
  laserBodyAllowsLongAxisFill,
  loadPacks,
  measureStripFrames,
  shouldSurfacePackReport,
} from './loader';

describe('implicit art-pack selection', () => {
  test('project-owned v4 wins, BulletPack is only the local reference fallback', () => {
    expect(implicitArtPack(['example', 'bulletpack', 'v4'])).toBe('v4');
    expect(implicitArtPack(['example', 'bulletpack'])).toBe('bulletpack');
    expect(implicitArtPack(['clearing', 'example'])).toBeNull();
  });

  test('the implicit v4 default stays off-screen while explicit audits and failures surface', () => {
    expect(shouldSurfacePackReport(false, 0)).toBe(false);
    expect(shouldSurfacePackReport(true, 0)).toBe(true);
    expect(shouldSurfacePackReport(false, 1)).toBe(true);
  });
});

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_IMAGE = globalThis.Image;
const ORIGINAL_DOCUMENT = globalThis.document;
const ORIGINAL_LOG = console.log;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  globalThis.Image = ORIGINAL_IMAGE;
  globalThis.document = ORIGINAL_DOCUMENT;
  console.log = ORIGINAL_LOG;
});

describe('laser-body seam exception', () => {
  const painted = (fullHeight = false): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(8 * 6 * 4);
    const y0 = fullHeight ? 0 : 2;
    const y1 = fullHeight ? 6 : 4;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < 8; x++) data[(y * 8 + x) * 4 + 3] = 255;
    }
    return data;
  };

  test('only registered body names receive the +x margin exemption', () => {
    expect(laserBodyAllowsLongAxisFill('beam.warm')).toBe(true);
    expect(laserBodyAllowsLongAxisFill('beam.v3.stream')).toBe(true);
    expect(laserBodyAllowsLongAxisFill('cap.yellow')).toBe(false);
    expect(laserBodyAllowsLongAxisFill('beam.pack-new')).toBe(false);
  });

  test('a body may fill frameW, but its short axis must still clear two pixels per side', () => {
    const strip = {
      frames: 1,
      frameW: 8,
      frameH: 6,
      stride: 8,
      color: 'baked' as const,
    };
    const strict: string[] = [];
    measureStripFrames('p', 'laser.png', 'beam.warm', strip, painted(), 8, 0, 0, strict);
    expect(strict).toHaveLength(1); // ordinary strips cannot paint all 8px in X

    const body: string[] = [];
    measureStripFrames('p', 'laser.png', 'beam.warm', strip, painted(), 8, 0, 0, body, true);
    expect(body).toEqual([]);

    const padded = painted();
    for (let y = 2; y < 4; y++) {
      padded[(y * 8) * 4 + 3] = 0;
      padded[(y * 8 + 7) * 4 + 3] = 0;
    }
    const longitudinalGap: string[] = [];
    measureStripFrames('p', 'laser.png', 'beam.warm', strip, padded, 8, 0, 0, longitudinalGap, true);
    expect(longitudinalGap).toHaveLength(1);
    expect(longitudinalGap[0]).toContain('must meet muzzle/tip and adjacent tiles');

    const badCrossAxis: string[] = [];
    measureStripFrames('p', 'laser.png', 'beam.warm', strip, painted(true), 8, 0, 0, badCrossAxis, true);
    expect(badCrossAxis).toHaveLength(1);
    expect(badCrossAxis[0]).toContain('must clear 2px of cross-axis margin');
  });
});

describe('shared PackStrip loading', () => {
  test('one URL is fetched, decoded and hashed once while every strip keeps its own winner geometry', async () => {
    const name = 'shared-runtime-test';
    const manifest = {
      format: 1,
      name,
      version: '1.0.0',
      author: 'Test',
      license: 'CC0-1.0',
      assets: {
        effects: {
          burst: {
            src: 'art.png',
            x: 11,
            y: 0,
            stride: 20,
            frames: 3,
            frameW: 8,
            frameH: 6,
            mode: 'once',
            color: 'baked',
          },
          pulse: {
            src: 'art.png',
            x: 0,
            y: 8,
            stride: 8,
            frames: 1,
            frameW: 8,
            frameH: 6,
            mode: 'loop',
            color: 'baked',
          },
        },
        lasers: {
          'beam.warm': {
            src: 'art.png',
            x: 10,
            y: 16,
            stride: 8,
            frames: 1,
            frameW: 8,
            frameH: 6,
            mode: 'loop',
            color: 'baked',
          },
        },
        missiles: {
          'missile.0': {
            src: 'art.png',
            x: 20,
            y: 16,
            stride: 8,
            frames: 1,
            frameW: 8,
            frameH: 6,
            mode: 'loop',
            color: 'baked',
          },
        },
        pickups: {
          'pickup.coin.silver': {
            src: 'art.png',
            x: 30,
            y: 16,
            stride: 8,
            frames: 1,
            frameW: 8,
            frameH: 6,
            mode: 'loop',
            color: 'baked',
          },
        },
      },
    } as const;
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const imageUrl = `/packs/${name}/art.png`;
    const fetches = new Map<string, number>();
    const decodes: string[] = [];
    const logs: string[] = [];
    let pixelReads = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetches.set(url, (fetches.get(url) ?? 0) + 1);
      if (url === '/packs/index.json') {
        return new Response(JSON.stringify([name]), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === `/packs/${name}/pack.json`) return new Response(manifestBytes);
      if (url === imageUrl) return new Response(imageBytes);
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    class TestImage {
      naturalWidth = 59;
      naturalHeight = 24;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(url: string) {
        decodes.push(url);
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = TestImage as unknown as typeof Image;
    globalThis.document = {
      createElement: () => {
        pixelReads++;
        return { width: 0, height: 0, getContext: () => null };
      },
    } as unknown as Document;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    const loaded = await loadPacks();

    expect(fetches.get(imageUrl)).toBe(1);
    expect(decodes).toEqual([imageUrl]);
    expect(pixelReads).toBe(1);
    expect(loaded.effectStrips?.burst).toMatchObject({
      url: imageUrl,
      x: 11,
      y: 0,
      stride: 20,
      frames: 3,
      frameW: 8,
      frameH: 6,
    });
    expect(loaded.effectStrips?.pulse?.url).toBe(imageUrl);
    expect(loaded.laserStrips?.['beam.warm']?.url).toBe(imageUrl);
    expect(loaded.missileStrips?.['missile.0']?.url).toBe(imageUrl);
    expect(loaded.pickupStrips?.['pickup.coin.silver']?.url).toBe(imageUrl);

    const expectedHash = await hashPack(manifestBytes, [imageBytes]);
    expect(loaded.packsMeta).toBe(`${name}@${expectedHash}`);

    const report = logs.join('\n');
    expect(report).toContain(`assets.effects: ${name} (2 strip winners)`);
    expect(report).toContain(`assets.lasers: ${name} (1 strip winner)`);
    expect(report).toContain(`assets.missiles: ${name} (1 strip winner)`);
    expect(report).toContain(`assets.pickups: ${name} (1 strip winner)`);
    expect(report).not.toContain('(no pack resources active — running on placeholders)');
  });

  test('last-wins remains per strip rather than replacing a whole strip pool', async () => {
    const first = 'shared-winner-a';
    const second = 'shared-winner-b';
    const strip = (src: string) => ({
      src,
      frames: 1,
      frameW: 8,
      frameH: 8,
      mode: 'once' as const,
      color: 'baked' as const,
    });
    const manifests = new Map<string, Uint8Array>([
      [
        first,
        new TextEncoder().encode(
          JSON.stringify({
            format: 1,
            name: first,
            version: '1.0.0',
            author: 'Test',
            license: 'CC0-1.0',
            assets: { effects: { burst: strip('first.png'), pulse: strip('first.png') } },
          }),
        ),
      ],
      [
        second,
        new TextEncoder().encode(
          JSON.stringify({
            format: 1,
            name: second,
            version: '1.0.0',
            author: 'Test',
            license: 'CC0-1.0',
            assets: { effects: { burst: strip('second.png') } },
          }),
        ),
      ],
    ]);
    const firstUrl = `/packs/${first}/first.png`;
    const secondUrl = `/packs/${second}/second.png`;
    const logs: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/packs/index.json') return new Response(JSON.stringify([first, second]));
      for (const [name, bytes] of manifests) {
        if (url === `/packs/${name}/pack.json`) {
          return new Response(bytes.slice().buffer as ArrayBuffer);
        }
      }
      if (url === firstUrl || url === secondUrl) return new Response(new Uint8Array([1, 2, 3]));
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    class TestImage {
      naturalWidth = 8;
      naturalHeight = 8;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = TestImage as unknown as typeof Image;
    globalThis.document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    } as unknown as Document;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    const loaded = await loadPacks();

    expect(loaded.effectStrips?.burst?.url).toBe(secondUrl);
    expect(loaded.effectStrips?.pulse?.url).toBe(firstUrl);
    const report = logs.join('\n');
    expect(report).toContain(`assets.effects: ${first} (1 strip winner)`);
    expect(report).toContain(`assets.effects: ${second} (1 strip winner)`);
  });
});

describe('packed sound loading', () => {
  test('normalises legacy and configured sounds and keeps last-winner policy with its file', async () => {
    const first = 'sound-policy-a';
    const second = 'sound-policy-b';
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const manifests = new Map<string, Uint8Array>([
      [
        first,
        encode({
          format: 1,
          name: first,
          version: '1.0.0',
          author: 'Test',
          license: 'CC0-1.0',
          sounds: {
            shot: 'shot.wav',
            'ui-confirm': {
              file: 'confirm-a.wav',
              volume: 0.2,
              polyphony: 1,
              throttleMs: 80,
            },
          },
        }),
      ],
      [
        second,
        encode({
          format: 1,
          name: second,
          version: '1.0.0',
          author: 'Test',
          license: 'CC0-1.0',
          sounds: {
            'ui-confirm': {
              file: 'confirm-b.wav',
              volume: 0.31,
              polyphony: 2,
              throttleMs: 40,
            },
          },
        }),
      ],
    ]);

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/packs/index.json') return new Response(JSON.stringify([first, second]));
      for (const [name, bytes] of manifests) {
        if (url === `/packs/${name}/pack.json`) {
          return new Response(bytes.slice().buffer as ArrayBuffer);
        }
      }
      if (url.endsWith('.wav')) return new Response(new Uint8Array([82, 73, 70, 70]));
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    console.log = () => undefined;

    const loaded = await loadPacks();

    expect(loaded.soundSpecs.shot).toEqual({
      url: `/packs/${first}/shot.wav`,
    });
    expect(loaded.soundSpecs['ui-confirm']).toEqual({
      url: `/packs/${second}/confirm-b.wav`,
      volume: 0.31,
      polyphony: 2,
      throttleMs: 40,
    });
  });
});
