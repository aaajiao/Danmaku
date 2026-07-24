/**
 * The headless half of the music engine: the registry, its overwrite seam, the
 * built-in launch set, and that the runtime is inert (never throwing) where
 * WebAudio does not exist — which `bun test` is, having no `AudioContext`. The
 * crossfade, the loop points and the drone's actual sound are browser-judged;
 * `docs/audio.md` says which dev flow verifies them, honestly, the way the
 * density page's note does for readability.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  defineMusic,
  Music,
  musicNames,
  replaceMusic,
  trackPhrase,
} from './music';

const NS = 'test:music.test/';
let nextName = 0;

function unique(label: string): string {
  return `${NS}${label}-${nextName++}`;
}

describe('the music registry', () => {
  test('a duplicate name overwrites rather than throwing — the replacement seam', () => {
    // Like `defineSound`: the placeholder floor exists to be replaced, from a
    // content file or a pack, without editing the engine.
    defineMusic('test-overwrite', {});
    expect(() => defineMusic('test-overwrite', { url: 'x.wav' })).not.toThrow();
    // Still one entry, not two.
    const count = musicNames().filter((n) => n === 'test-overwrite').length;
    expect(count).toBe(1);
  });

  test('replaceMusic overlays an asset without discarding the authored synth', () => {
    const name = unique('overlay');
    defineMusic(name, {
      volume: 0.23,
      loopStart: 1,
      loopEnd: 4,
      synth: { beatsPerLoop: 4, motif: [0, Number.NaN, 2, Number.NaN] },
    });

    replaceMusic(name, { url: '/pack/overlay.wav' });

    expect(trackPhrase(name)).toEqual({ beats: 4, sounded: 2, trance: false });
  });

  test('defineMusic still replaces the whole entry rather than overlaying it', () => {
    const name = unique('whole-replacement');
    defineMusic(name, { synth: { beatsPerLoop: 2, motif: [0, 1] } });

    defineMusic(name, { url: '/pack/replacement.wav' });

    expect(trackPhrase(name)).toBeUndefined();
  });

  test('a non-finite loop point or volume does not poison the registry', () => {
    // Spec values arrive unvalidated; NaN must never reach a gain or a scheduler.
    expect(() =>
      defineMusic('test-nan', {
        loopStart: Number.NaN,
        loopEnd: Number.POSITIVE_INFINITY,
        volume: Number.NaN,
      }),
    ).not.toThrow();
    expect(musicNames()).toContain('test-nan');
  });
});

/* ------------------------------------------------------------------ */
/* Focused WebAudio coverage for pack-asset failure                    */
/* ------------------------------------------------------------------ */

class FakeAudioParam {
  value = 1;

  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }

  cancelScheduledValues(): this {
    return this;
  }
}

class FakeAudioNode {
  connect(_target: FakeAudioNode): FakeAudioNode {
    return _target;
  }

  disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeAudioBuffer {
  readonly #data: Float32Array;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.#data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(): Float32Array {
    return this.#data;
  }
}

class FakeBufferSource extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  starts = 0;

  start(): void {
    this.starts++;
  }

  stop(): void {}
}

type Decode = (data: ArrayBuffer) => Promise<FakeAudioBuffer>;

let decode: Decode;
let contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination = new FakeAudioNode();
  readonly gains: FakeGainNode[] = [];
  readonly sources: FakeBufferSource[] = [];
  readonly buffers: FakeAudioBuffer[] = [];

  constructor() {
    contexts.push(this);
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }

  createBuffer(channels: number, length: number, rate: number): FakeAudioBuffer {
    const buffer = new FakeAudioBuffer(channels, length, rate);
    this.buffers.push(buffer);
    return buffer;
  }

  async resume(): Promise<void> {}
  async close(): Promise<void> {}

  async decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    return decode(data);
  }

  get voiceGains(): FakeGainNode[] {
    return this.gains.slice(1);
  }
}

interface TestScope {
  AudioContext?: unknown;
  fetch?: unknown;
}

const scope = globalThis as unknown as TestScope;
const realFetch = scope.fetch;

async function flushLoad(): Promise<void> {
  // fetch → arrayBuffer → decode/fallback is a short promise chain. Drive every
  // link without sleeping or coupling the test to wall-clock scheduling.
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('pack music failure fallback', () => {
  beforeEach(() => {
    contexts = [];
    decode = async () => new FakeAudioBuffer(1, 256, 44100);
    scope.AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    delete scope.AudioContext;
    scope.fetch = realFetch;
  });

  for (const failure of ['fetch', 'response', 'decode'] as const) {
    test(`${failure} failure falls back to the preserved synth exactly once`, async () => {
      const name = unique(`fallback-${failure}`);
      defineMusic(name, {
        volume: 0.23,
        loopStart: 1,
        loopEnd: 4,
        synth: {
          loopSeconds: 6,
          beatsPerLoop: 4,
          voices: ['lead'],
          motif: [0, 2, Number.NaN, Number.NaN],
        },
      });
      replaceMusic(name, { url: `/pack/${failure}.wav` });

      let fetches = 0;
      scope.fetch = async () => {
        fetches++;
        if (failure === 'fetch') throw new Error('offline');
        return {
          ok: failure !== 'response',
          arrayBuffer: async () => new ArrayBuffer(8),
        };
      };
      if (failure === 'decode') {
        decode = async () => {
          throw new Error('undecodable');
        };
      }

      const music = new Music();
      await music.unlock();
      music.play(name);
      await flushLoad();

      // The next normal reconcile starts the generated floor.
      music.play(name);
      expect(fetches).toBe(1);
      expect(music.current).toBe(name);

      const ctx = contexts[0] as FakeAudioContext;
      expect(ctx.buffers).toHaveLength(1);
      expect(ctx.sources).toHaveLength(1);
      expect(ctx.sources[0]?.buffer).toBe(ctx.buffers[0]);
      expect(ctx.voiceGains[0]?.gain.value).toBe(0.23);
      expect(ctx.sources[0]?.loopStart).toBe(1);
      expect(ctx.sources[0]?.loopEnd).toBe(4);

      // Idempotent reconciliation cannot refetch the failed URL.
      for (let i = 0; i < 5; i++) music.play(name);
      expect(fetches).toBe(1);
    });
  }

  test('a failed URL-only guest track stays silent without retrying every tick', async () => {
    const name = unique('url-only');
    defineMusic(name, { url: '/pack/guest.wav' });

    let fetches = 0;
    scope.fetch = async () => {
      fetches++;
      return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    };

    const music = new Music();
    await music.unlock();
    music.play(name);
    await flushLoad();
    for (let i = 0; i < 5; i++) music.play(name);

    expect(fetches).toBe(1);
    expect(music.current).toBeUndefined();
    expect((contexts[0] as FakeAudioContext).sources).toHaveLength(0);
  });

  test('preload decodes a named track without starting or selecting it', async () => {
    const name = unique('preload');
    decode = async () => new FakeAudioBuffer(1, 44100 * 10, 44100);
    defineMusic(name, {
      url: '/pack/preload.wav',
      loopStart: 1.5,
      loopEnd: 8,
    });

    let fetches = 0;
    scope.fetch = async () => {
      fetches++;
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    };

    const music = new Music();
    await music.unlock();
    await music.preload([name, 'unknown-preload-track']);

    const ctx = contexts[0] as FakeAudioContext;
    expect(fetches).toBe(1);
    expect(music.current).toBeUndefined();
    expect(ctx.sources).toHaveLength(0);

    music.play(name);
    expect(fetches).toBe(1);
    expect(music.current).toBe(name);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]?.loopStart).toBe(1.5);
    expect(ctx.sources[0]?.loopEnd).toBe(8);
  });

  test('concurrent preload calls await one shared URL decode', async () => {
    const name = unique('awaitable-preload');
    defineMusic(name, { url: '/pack/awaitable.wav' });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetches = 0;
    scope.fetch = async () => {
      fetches++;
      await gate;
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    };

    const music = new Music();
    await music.unlock();
    let resolved = 0;
    const first = music.preload([name]).then(() => {
      resolved++;
    });
    const second = music.preload([name]).then(() => {
      resolved++;
    });
    await Promise.resolve();

    expect(fetches).toBe(1);
    expect(resolved).toBe(0);
    expect((contexts[0] as FakeAudioContext).sources).toHaveLength(0);

    release();
    await Promise.all([first, second]);

    expect(resolved).toBe(2);
    expect(music.current).toBeUndefined();
    music.play(name);
    expect(fetches).toBe(1);
    expect(music.current).toBe(name);
  });

  test('a replacement URL can load while an older request is still in flight', async () => {
    const name = unique('replacement-during-load');
    const oldUrl = '/pack/old.wav';
    const newUrl = '/pack/new.wav';
    defineMusic(name, { url: oldUrl });

    let releaseOld!: () => void;
    let releaseNew!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const newGate = new Promise<void>((resolve) => {
      releaseNew = resolve;
    });
    const requested: string[] = [];
    scope.fetch = async (url: string) => {
      requested.push(url);
      if (url === oldUrl) await oldGate;
      if (url === newUrl) await newGate;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    };

    const music = new Music();
    await music.unlock();
    const oldLoad = music.preload([name]);
    replaceMusic(name, { url: newUrl });
    const newLoad = music.preload([name]);
    await Promise.resolve();

    expect(requested.filter((url) => url === oldUrl)).toHaveLength(1);
    expect(requested.filter((url) => url === newUrl)).toHaveLength(1);

    releaseOld();
    await oldLoad;
    music.play(name);
    expect(music.current).toBeUndefined();

    releaseNew();
    await newLoad;
    music.play(name);
    expect(music.current).toBe(name);
    expect((contexts[0] as FakeAudioContext).sources).toHaveLength(1);
  });
});

describe('the runtime is inert without WebAudio', () => {
  // `bun test` has no `AudioContext`, so every one of these exercises the
  // no-context branch — the same total-degradation contract the sound engine
  // holds: audio may go silent, never take the run down.

  test('constructing, unlocking and playing never throw', async () => {
    const name = unique('runtime-known');
    defineMusic(name, { synth: { loopSeconds: 6 } });
    const music = new Music({ masterVolume: 0.5 });
    await music.unlock();

    expect(music.unlocked).toBe(false); // No context came up.
    expect(() => music.play(name, 1)).not.toThrow();
    // Nothing started, so nothing is current — which is what makes the shell's
    // reconcile start the theme on the first tick after a real unlock.
    expect(music.current).toBeUndefined();
    expect(() => music.stopAll()).not.toThrow();
  });

  test('playing an unknown track is a no-op', () => {
    const music = new Music();
    expect(() => music.play('no-such-track')).not.toThrow();
    expect(music.current).toBeUndefined();
  });

  test('masterVolume clamps to [0,1] and reads back', () => {
    const music = new Music({ masterVolume: 0.4 });
    expect(music.masterVolume).toBe(0.4);
    music.masterVolume = 2;
    expect(music.masterVolume).toBe(1);
    music.masterVolume = -1;
    expect(music.masterVolume).toBe(0);
  });
});
