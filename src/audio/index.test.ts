import { test, expect, describe, beforeEach, afterEach } from 'bun:test';

import { fx, sim } from '../core/random';
import { Audio, defineSound, soundNames } from './index';

/**
 * The registry is module-level and shared by every test file that imports the
 * audio module, so anything defined here is namespaced and never reused.
 */
const NS = 'test:audio.test/';

let nextName = 0;
/** A registry name no other test can collide with. */
function unique(label: string): string {
  return `${NS}${label}-${nextName++}`;
}

/* ------------------------------------------------------------------ */
/* WebAudio stub                                                       */
/* ------------------------------------------------------------------ */

/**
 * `bun test` has no WebAudio, which is the environment the module is designed
 * to be inert in — but "inert" alone would leave every playback path untested.
 * Installing a stub on `globalThis` exercises them, and doubles as proof that
 * the module looks the API up at unlock rather than binding it at import.
 */

class FakeAudioParam {
  value = 1;
}

class FakeAudioNode {
  readonly outputs: FakeAudioNode[] = [];
  disconnects = 0;

  connect(target: FakeAudioNode): FakeAudioNode {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnects++;
  }
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
  starts = 0;
  stops = 0;

  start(): void {
    this.starts++;
  }

  stop(): void {
    // Matches WebAudio: stopping a source that never started is an error, and
    // `stopAll` must survive it.
    if (this.starts === 0) throw new Error('cannot stop a source that never started');
    this.stops++;
  }
}

interface StubOptions {
  failConstruction?: boolean;
  failResume?: boolean;
  state?: string;
  resumeGate?: Promise<void>;
  decode?: (data: ArrayBuffer) => Promise<FakeAudioBuffer>;
}

let options: StubOptions = {};
let contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination = new FakeAudioNode();

  readonly gains: FakeGainNode[] = [];
  readonly sources: FakeBufferSource[] = [];
  readonly buffers: FakeAudioBuffer[] = [];
  resumes = 0;
  decodes = 0;
  closes = 0;

  constructor() {
    if (options.failConstruction) throw new Error('AudioContext refused');
    if (options.state !== undefined) this.state = options.state;
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

  async resume(): Promise<void> {
    this.resumes++;
    if (options.failResume) throw new Error('resume refused');
    if (options.resumeGate) await options.resumeGate;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closes++;
    this.state = 'closed';
  }

  async decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    this.decodes++;
    if (options.decode) return options.decode(data);
    return new FakeAudioBuffer(1, 256, this.sampleRate);
  }

  /** The gain every voice is routed through. Built first, at unlock. */
  get master(): FakeGainNode {
    return this.gains[0] as FakeGainNode;
  }

  /** Per-voice gains, in play order. */
  get voiceGains(): FakeGainNode[] {
    return this.gains.slice(1);
  }
}

interface Scope {
  AudioContext?: unknown;
  performance?: unknown;
  fetch?: unknown;
}
const scope = globalThis as unknown as Scope;

const realPerformance = scope.performance;
const realFetch = scope.fetch;

/** Throttling reads a wall clock, so tests drive one rather than sleeping. */
let clock = 0;

function installWebAudio(): void {
  options = {};
  contexts = [];
  clock = 1000;
  scope.AudioContext = FakeAudioContext;
  scope.performance = { now: () => clock };
  // A default that never succeeds, so no test can reach the network: a
  // url-backed sound left in the registry by an earlier test would otherwise
  // be fetched for real at the next unlock.
  scope.fetch = async () => {
    throw new Error('fetch not stubbed for this test');
  };
}

function removeWebAudio(): void {
  delete scope.AudioContext;
  scope.performance = realPerformance;
  scope.fetch = realFetch;
}

/** The context the engine built during `unlock`. */
function context(): FakeAudioContext {
  expect(contexts).toHaveLength(1);
  return contexts[0] as FakeAudioContext;
}

/** An unlocked engine plus its context. */
async function unlocked(init?: { masterVolume?: number }): Promise<{
  audio: Audio;
  ctx: FakeAudioContext;
}> {
  const audio = new Audio(init);
  await audio.unlock();
  return { audio, ctx: context() };
}

/* ------------------------------------------------------------------ */

describe('registry', () => {
  test('defineSound registers a name that soundNames reports', () => {
    const name = unique('registered');
    expect(soundNames()).not.toContain(name);

    defineSound(name, {});

    expect(soundNames()).toContain(name);
  });

  test('the built-in placeholder sounds are registered', () => {
    expect(soundNames()).toEqual(
      expect.arrayContaining(['shot', 'hit', 'explosion', 'graze', 'pickup', 'death']),
    );
  });

  test('redefining a name replaces it rather than throwing', () => {
    // Swapping a generated placeholder for a real asset has to be possible from
    // a content file. Rejecting the duplicate would force an engine edit.
    const name = unique('redefined');
    defineSound(name, { volume: 0.2 });

    expect(() => defineSound(name, { volume: 0.9 })).not.toThrow();
    expect(soundNames().filter((n) => n === name)).toHaveLength(1);
  });

  test('the returned name list is a snapshot, not the live registry', () => {
    const before = soundNames();
    const name = unique('snapshot-probe');
    defineSound(name, {});

    expect(before).not.toContain(name);
    expect(soundNames()).toContain(name);
  });
});

describe('without an AudioContext', () => {
  // This is `bun test` as it comes: the module must be completely inert here.

  test('the global really is absent, so these tests are not vacuous', () => {
    expect('AudioContext' in globalThis).toBe(false);
  });

  test('constructs', () => {
    expect(() => new Audio()).not.toThrow();
  });

  test('unlock resolves and leaves the engine locked', async () => {
    const audio = new Audio();
    expect(audio.unlocked).toBe(false);

    await audio.unlock();

    expect(audio.unlocked).toBe(false);
  });

  test('repeated unlock is safe', async () => {
    const audio = new Audio();
    await audio.unlock();
    await audio.unlock();
    await Promise.all([audio.unlock(), audio.unlock()]);
    expect(audio.unlocked).toBe(false);
  });

  test('playing a known sound is a no-op that does not throw', () => {
    const audio = new Audio();
    expect(() => audio.play('shot')).not.toThrow();
  });

  test('playing an unknown sound is a no-op that does not throw', () => {
    const audio = new Audio();
    expect(() => audio.play(`${NS}never-defined`)).not.toThrow();
  });

  test('playing an unknown sound after unlock still does not throw', async () => {
    const audio = new Audio();
    await audio.unlock();
    expect(() => audio.play(`${NS}never-defined`)).not.toThrow();
  });

  test('stopAll does not throw with nothing playing', () => {
    const audio = new Audio();
    expect(() => audio.stopAll()).not.toThrow();
  });

  test('masterVolume round-trips without a graph to apply it to', () => {
    const audio = new Audio({ masterVolume: 0.4 });
    expect(audio.masterVolume).toBe(0.4);

    audio.masterVolume = 0.7;
    expect(audio.masterVolume).toBe(0.7);
  });

  test('a whole frame of calls is survivable', () => {
    const audio = new Audio();
    expect(() => {
      for (const name of ['shot', 'hit', 'explosion', 'graze', 'pickup', 'death']) {
        for (let i = 0; i < 10; i++) audio.play(name);
      }
      audio.stopAll();
    }).not.toThrow();
  });
});

describe('with WebAudio', () => {
  beforeEach(installWebAudio);
  afterEach(removeWebAudio);

  describe('unlock', () => {
    test('builds a context and routes a master gain to its destination', async () => {
      const { audio, ctx } = await unlocked();

      expect(audio.unlocked).toBe(true);
      expect(ctx.master.outputs).toEqual([ctx.destination]);
    });

    test('resumes a suspended context', async () => {
      const { ctx } = await unlocked();

      expect(ctx.resumes).toBe(1);
      expect(ctx.state).toBe('running');
    });

    test('does not resume a context that is already running', async () => {
      options.state = 'running';
      const { ctx } = await unlocked();

      expect(ctx.resumes).toBe(0);
    });

    test('a second unlock does not build a second context', async () => {
      const { audio } = await unlocked();

      await audio.unlock();

      expect(contexts).toHaveLength(1);
    });

    test('concurrent unlocks share one context', async () => {
      // A single tap can deliver both keydown and pointerdown.
      const audio = new Audio();

      await Promise.all([audio.unlock(), audio.unlock(), audio.unlock()]);

      expect(contexts).toHaveLength(1);
      expect(audio.unlocked).toBe(true);
    });

    test('replays the title confirm requested while the context is resuming', async () => {
      let resume!: () => void;
      options.resumeGate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const audio = new Audio();

      const ready = audio.unlock();
      audio.play('ui-confirm');
      expect(context().sources).toHaveLength(0);

      resume();
      await ready;

      expect(audio.unlocked).toBe(true);
      expect(context().sources).toHaveLength(1);
      expect(context().voiceGains[0]?.gain.value).toBe(0.29);
    });

    test('a refused context leaves the engine silent, not broken', async () => {
      options.failConstruction = true;
      const audio = new Audio();

      await audio.unlock();

      expect(audio.unlocked).toBe(false);
      expect(() => audio.play('shot')).not.toThrow();
      expect(() => audio.stopAll()).not.toThrow();
    });

    test('a rejected resume leaves the engine silent, not broken', async () => {
      options.failResume = true;
      const audio = new Audio();

      await audio.unlock();

      expect(audio.unlocked).toBe(false);
      audio.play('shot');
      expect(context().sources).toHaveLength(0);
    });

    test('drops a queued cue when unlock fails instead of replaying it on a later retry', async () => {
      let resume!: () => void;
      options.resumeGate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      options.failResume = true;
      const audio = new Audio();

      const failed = audio.unlock();
      audio.play('ui-confirm');
      resume();
      await failed;

      options.failResume = false;
      options.resumeGate = undefined;
      await audio.unlock();

      expect(audio.unlocked).toBe(true);
      expect(contexts[1]?.sources).toHaveLength(0);
    });

    test('a context that fails to come up is closed, not leaked', async () => {
      // Browsers cap live contexts per document, so a player who keeps tapping
      // through a failure must not exhaust the budget.
      options.failResume = true;
      const audio = new Audio();

      await audio.unlock();
      await audio.unlock();
      await audio.unlock();

      expect(contexts).toHaveLength(3);
      for (const ctx of contexts) expect(ctx.closes).toBe(1);
    });

    test('a failed unlock can be retried', async () => {
      options.failConstruction = true;
      const audio = new Audio();
      await audio.unlock();
      expect(audio.unlocked).toBe(false);

      options.failConstruction = false;
      await audio.unlock();

      expect(audio.unlocked).toBe(true);
    });

    test('a successful unlock does not close its context', async () => {
      const { ctx } = await unlocked();
      expect(ctx.closes).toBe(0);
    });

    test('generates every registered placeholder up front', async () => {
      // Synthesis in the middle of a run is a frame hitch; unlock is the only
      // moment where paying for it is free.
      const name = unique('pregenerated');
      defineSound(name, {});
      const { ctx } = await unlocked();

      expect(ctx.buffers.length).toBeGreaterThanOrEqual(7);

      const before = ctx.buffers.length;
      new Audio(); // unrelated instance must not disturb the count
      expect(ctx.buffers.length).toBe(before);
    });
  });

  describe('play', () => {
    test('is a no-op before unlock', () => {
      const audio = new Audio();

      audio.play('shot');

      expect(contexts).toHaveLength(0);
    });

    test('an unknown name never reaches the context', async () => {
      const { audio, ctx } = await unlocked();

      expect(() => audio.play(`${NS}never-defined`)).not.toThrow();
      expect(ctx.sources).toHaveLength(0);
    });

    test('starts one source per play, routed through a gain to master', async () => {
      const { audio, ctx } = await unlocked();

      audio.play('shot');

      expect(ctx.sources).toHaveLength(1);
      const source = ctx.sources[0] as FakeBufferSource;
      const voiceGain = ctx.voiceGains[0] as FakeGainNode;
      expect(source.starts).toBe(1);
      expect(source.buffer).not.toBeNull();
      expect(source.outputs).toEqual([voiceGain]);
      expect(voiceGain.outputs).toEqual([ctx.master]);
    });

    test('the per-sound volume lands on the voice, not on the master', async () => {
      // Mixing a sound into the master would make it the last-played sound's
      // volume for everything else too.
      const name = unique('quiet');
      defineSound(name, { volume: 0.25 });
      const { audio, ctx } = await unlocked({ masterVolume: 0.8 });

      audio.play(name);

      expect((ctx.voiceGains[0] as FakeGainNode).gain.value).toBe(0.25);
      expect(ctx.master.gain.value).toBe(0.8);
    });

    test('a sound with no explicit volume plays at full voice gain', async () => {
      const name = unique('default-volume');
      defineSound(name, {});
      const { audio, ctx } = await unlocked();

      audio.play(name);

      expect((ctx.voiceGains[0] as FakeGainNode).gain.value).toBe(1);
    });

    test('reuses the generated buffer instead of re-synthesising', async () => {
      const { audio, ctx } = await unlocked();
      const before = ctx.buffers.length;

      for (let i = 0; i < 20; i++) {
        audio.play('hit');
        clock += 1000;
      }

      expect(ctx.buffers.length).toBe(before);
    });

    test('a sound defined after unlock is generated on first play', async () => {
      const { audio, ctx } = await unlocked();
      const before = ctx.buffers.length;

      const name = unique('late');
      defineSound(name, {});
      audio.play(name);

      expect(ctx.buffers.length).toBe(before + 1);
      expect(ctx.sources).toHaveLength(1);
    });

    test('each play gets its own source and gain', async () => {
      const name = unique('repeat');
      defineSound(name, { polyphony: 8 });
      const { audio, ctx } = await unlocked();

      for (let i = 0; i < 3; i++) audio.play(name);

      expect(ctx.sources).toHaveLength(3);
      expect(new Set(ctx.sources).size).toBe(3);
      expect(ctx.voiceGains).toHaveLength(3);
    });
  });

  describe('polyphony', () => {
    test('drops plays past the cap', async () => {
      const name = unique('capped');
      defineSound(name, { polyphony: 2 });
      const { audio, ctx } = await unlocked();

      for (let i = 0; i < 10; i++) audio.play(name);

      expect(ctx.sources).toHaveLength(2);
    });

    test('a finished voice frees its slot', async () => {
      const name = unique('recycled');
      defineSound(name, { polyphony: 1 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      audio.play(name);
      expect(ctx.sources).toHaveLength(1);

      // Past the end of a 0.1s placeholder.
      ctx.currentTime += 1;
      audio.play(name);

      expect(ctx.sources).toHaveLength(2);
    });

    test('a retired voice is disconnected rather than left in the graph', async () => {
      const name = unique('retired');
      defineSound(name, { polyphony: 4 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      const first = ctx.sources[0] as FakeBufferSource;
      const firstGain = ctx.voiceGains[0] as FakeGainNode;

      ctx.currentTime += 1;
      audio.play(name);

      expect(first.disconnects).toBe(1);
      expect(firstGain.disconnects).toBe(1);
    });

    test('a voice still playing is not retired early', async () => {
      const name = unique('sustained');
      defineSound(name, { polyphony: 4 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      const first = ctx.sources[0] as FakeBufferSource;

      // The default placeholder runs 0.1s; half of it has passed.
      ctx.currentTime += 0.05;
      audio.play(name);

      expect(first.disconnects).toBe(0);
    });

    test('the cap is per sound, not global', async () => {
      const a = unique('cap-a');
      const b = unique('cap-b');
      defineSound(a, { polyphony: 1 });
      defineSound(b, { polyphony: 1 });
      const { audio, ctx } = await unlocked();

      audio.play(a);
      audio.play(a);
      audio.play(b);
      audio.play(b);

      expect(ctx.sources).toHaveLength(2);
    });

    test('defaults to eight voices', async () => {
      const name = unique('default-polyphony');
      defineSound(name, {});
      const { audio, ctx } = await unlocked();

      for (let i = 0; i < 20; i++) audio.play(name);

      expect(ctx.sources).toHaveLength(8);
    });

    test('a polyphony of zero is floored at one rather than muting the sound', async () => {
      const name = unique('zero-polyphony');
      defineSound(name, { polyphony: 0 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      audio.play(name);

      expect(ctx.sources).toHaveLength(1);
    });

    test('a fractional polyphony rounds down', async () => {
      const name = unique('fractional-polyphony');
      defineSound(name, { polyphony: 2.9 });
      const { audio, ctx } = await unlocked();

      for (let i = 0; i < 5; i++) audio.play(name);

      expect(ctx.sources).toHaveLength(2);
    });

    test('a NaN polyphony falls back to the default', async () => {
      const name = unique('nan-polyphony');
      defineSound(name, { polyphony: Number.NaN });
      const { audio, ctx } = await unlocked();

      for (let i = 0; i < 20; i++) audio.play(name);

      expect(ctx.sources).toHaveLength(8);
    });
  });

  describe('throttling', () => {
    test('drops a repeat inside the window', async () => {
      const name = unique('throttled');
      defineSound(name, { throttleMs: 50, polyphony: 16 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      clock += 49;
      audio.play(name);

      expect(ctx.sources).toHaveLength(1);
    });

    test('plays again once the window has passed', async () => {
      const name = unique('throttle-expiry');
      defineSound(name, { throttleMs: 50, polyphony: 16 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      clock += 50;
      audio.play(name);

      expect(ctx.sources).toHaveLength(2);
    });

    test('a burst collapses to one voice per window', async () => {
      // The case this exists for: a shot fired every tick at 60Hz.
      const name = unique('machine-gun');
      defineSound(name, { throttleMs: 40, polyphony: 16 });
      const { audio, ctx } = await unlocked();

      for (let tick = 0; tick < 60; tick++) {
        audio.play(name);
        clock += 1000 / 60;
      }

      expect(ctx.sources.length).toBeLessThanOrEqual(26);
      expect(ctx.sources.length).toBeGreaterThan(0);
    });

    test('windows are per sound', async () => {
      const a = unique('throttle-a');
      const b = unique('throttle-b');
      defineSound(a, { throttleMs: 100 });
      defineSound(b, { throttleMs: 100 });
      const { audio, ctx } = await unlocked();

      audio.play(a);
      audio.play(b);

      expect(ctx.sources).toHaveLength(2);
    });

    test('no throttle by default', async () => {
      const name = unique('unthrottled');
      defineSound(name, { polyphony: 16 });
      const { audio, ctx } = await unlocked();

      for (let i = 0; i < 5; i++) audio.play(name);

      expect(ctx.sources).toHaveLength(5);
    });

    test('a play dropped for polyphony does not open a throttle window', async () => {
      // The window belongs to a voice that started. Stamping it on a drop would
      // let a full voice pool silently suppress the play after it.
      const name = unique('drop-then-throttle');
      defineSound(name, { polyphony: 1, throttleMs: 100 });
      const { audio, ctx } = await unlocked();

      audio.play(name); // starts, stamps the window at t
      clock += 200; // window has expired
      audio.play(name); // dropped: the first voice is still live
      ctx.currentTime += 1; // the first voice ends
      clock += 1; // still well inside a window the drop would have opened

      audio.play(name);

      expect(ctx.sources).toHaveLength(2);
    });

    test('a negative throttle is treated as none', async () => {
      const name = unique('negative-throttle');
      defineSound(name, { throttleMs: -100, polyphony: 16 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      audio.play(name);

      expect(ctx.sources).toHaveLength(2);
    });
  });

  describe('stopAll', () => {
    test('stops and disconnects every live voice', async () => {
      const name = unique('stoppable');
      defineSound(name, { polyphony: 8 });
      const { audio, ctx } = await unlocked();

      for (let i = 0; i < 3; i++) audio.play(name);
      audio.stopAll();

      for (const source of ctx.sources) {
        expect(source.stops).toBe(1);
        expect(source.disconnects).toBe(1);
      }
      for (const gain of ctx.voiceGains) expect(gain.disconnects).toBe(1);
    });

    test('leaves the engine playable', async () => {
      const name = unique('stop-then-play');
      defineSound(name, { polyphony: 1 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      audio.stopAll();
      audio.play(name);

      expect(ctx.sources).toHaveLength(2);
      expect((ctx.sources[1] as FakeBufferSource).starts).toBe(1);
    });

    test('clears throttle windows so the next run is not swallowed', async () => {
      const name = unique('stop-clears-throttle');
      defineSound(name, { throttleMs: 5000 });
      const { audio, ctx } = await unlocked();

      audio.play(name);
      audio.stopAll();
      audio.play(name);

      expect(ctx.sources).toHaveLength(2);
    });

    test('does not stop the same voice twice', async () => {
      const name = unique('stop-twice');
      defineSound(name, {});
      const { audio, ctx } = await unlocked();

      audio.play(name);
      audio.stopAll();
      audio.stopAll();

      expect((ctx.sources[0] as FakeBufferSource).stops).toBe(1);
    });

    test('is safe with nothing playing', async () => {
      const { audio } = await unlocked();
      expect(() => audio.stopAll()).not.toThrow();
    });

    test('does not tear down the master gain', async () => {
      const { audio, ctx } = await unlocked();
      audio.play('shot');

      audio.stopAll();

      expect(ctx.master.disconnects).toBe(0);
    });
  });

  describe('masterVolume', () => {
    test('the constructor option reaches the graph at unlock', async () => {
      const { ctx } = await unlocked({ masterVolume: 0.35 });

      expect(ctx.master.gain.value).toBe(0.35);
    });

    test('a later change reaches a live graph', async () => {
      const { audio, ctx } = await unlocked();

      audio.masterVolume = 0.1;

      expect(audio.masterVolume).toBe(0.1);
      expect(ctx.master.gain.value).toBe(0.1);
    });

    test('clamps to the audible range', () => {
      const audio = new Audio();

      audio.masterVolume = 5;
      expect(audio.masterVolume).toBe(1);

      audio.masterVolume = -2;
      expect(audio.masterVolume).toBe(0);
    });

    test('a NaN volume is ignored rather than poisoning the gain', async () => {
      // A NaN on an AudioParam silences the whole graph and is near impossible
      // to trace back from a bug report.
      const { audio, ctx } = await unlocked({ masterVolume: 0.6 });

      audio.masterVolume = Number.NaN;

      expect(audio.masterVolume).toBe(0.6);
      expect(ctx.master.gain.value).toBe(0.6);
    });

    test('a NaN constructor option falls back to full volume', () => {
      expect(new Audio({ masterVolume: Number.NaN }).masterVolume).toBe(1);
    });

    test('zero is honoured rather than falling back to full volume', async () => {
      const { audio, ctx } = await unlocked({ masterVolume: 0 });

      expect(audio.masterVolume).toBe(0);
      expect(ctx.master.gain.value).toBe(0);
    });

    test('a muted engine still plays, so unmuting is immediate', async () => {
      const { audio, ctx } = await unlocked({ masterVolume: 0 });

      audio.play('shot');

      expect(ctx.sources).toHaveLength(1);
    });
  });

  describe('url-backed sounds', () => {
    /**
     * Every url sound any test has registered is fetched again at each unlock,
     * because buffers belong to a context. Assertions therefore count one url
     * rather than the whole log.
     */
    let requested: string[] = [];
    const timesFetched = (url: string): number =>
      requested.filter((u) => u === url).length;

    beforeEach(() => {
      requested = [];
    });

    /** Let the fetch/decode chain settle. */
    async function settle(): Promise<void> {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }

    function serve(body: ArrayBuffer | null, ok = true): void {
      scope.fetch = async (url: string) => {
        requested.push(url);
        return {
          ok,
          arrayBuffer: async () => {
            if (!body) throw new Error('no body');
            return body;
          },
        };
      };
    }

    /** A fetch that hangs until the returned release is called. */
    function serveWhenReleased(): () => void {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      scope.fetch = async (url: string) => {
        requested.push(url);
        await gate;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      };
      return release;
    }

    test('fetches and decodes, then plays from the decoded buffer', async () => {
      const release = serveWhenReleased();
      const name = unique('url');
      defineSound(name, { url: '/sfx/whatever.wav' });

      const { audio, ctx } = await unlocked();
      // The load is kicked off at unlock but never awaited — `unlock` runs
      // inside an input handler. A play before it lands is silent by design.
      audio.play(name);
      expect(ctx.sources).toHaveLength(0);

      release();
      await settle();

      audio.play(name);
      expect(timesFetched('/sfx/whatever.wav')).toBe(1);
      expect(ctx.decodes).toBe(1);
      expect(ctx.sources).toHaveLength(1);
    });

    test('never synthesises a placeholder over a url sound', async () => {
      serve(new ArrayBuffer(8));
      const name = unique('url-no-placeholder');
      defineSound(name, { url: '/sfx/a.wav' });

      const { audio, ctx } = await unlocked();
      const generated = ctx.buffers.length;
      audio.play(name);

      expect(ctx.buffers.length).toBe(generated);
    });

    test('a failed fetch leaves the sound silent and never throws', async () => {
      scope.fetch = async () => {
        throw new Error('network down');
      };
      const name = unique('url-network-error');
      defineSound(name, { url: '/sfx/missing.wav' });

      const { audio, ctx } = await unlocked();
      await settle();

      expect(() => audio.play(name)).not.toThrow();
      expect(ctx.sources).toHaveLength(0);
    });

    test('a non-ok response leaves the sound silent', async () => {
      serve(new ArrayBuffer(8), false);
      const name = unique('url-404');
      defineSound(name, { url: '/sfx/gone.wav' });

      const { audio, ctx } = await unlocked();
      await settle();

      audio.play(name);
      expect(ctx.decodes).toBe(0);
      expect(ctx.sources).toHaveLength(0);
    });

    test('a decode failure leaves the sound silent', async () => {
      serve(new ArrayBuffer(8));
      options.decode = async () => {
        throw new Error('not audio');
      };
      const name = unique('url-undecodable');
      defineSound(name, { url: '/sfx/corrupt.wav' });

      const { audio, ctx } = await unlocked();
      await settle();

      expect(() => audio.play(name)).not.toThrow();
      expect(ctx.sources).toHaveLength(0);
    });

    test('repeated plays while loading do not stack fetches', async () => {
      const release = serveWhenReleased();
      const name = unique('url-single-flight');
      defineSound(name, { url: '/sfx/once.wav', throttleMs: 0, polyphony: 16 });

      const { audio } = await unlocked();
      for (let i = 0; i < 10; i++) audio.play(name);

      release();
      await settle();

      expect(timesFetched('/sfx/once.wav')).toBe(1);
    });
  });

  describe('synthesis', () => {
    test('every placeholder is a mono buffer at the context sample rate', async () => {
      const { ctx } = await unlocked();

      expect(ctx.buffers.length).toBeGreaterThanOrEqual(6);
      for (const buffer of ctx.buffers) {
        expect(buffer.numberOfChannels).toBe(1);
        expect(buffer.sampleRate).toBe(44100);
        expect(buffer.length).toBeGreaterThan(0);
      }
    });

    test('no sample leaves the representable range', async () => {
      const { ctx } = await unlocked();

      for (const buffer of ctx.buffers) {
        for (const sample of buffer.getChannelData()) {
          expect(Number.isFinite(sample)).toBe(true);
          expect(Math.abs(sample)).toBeLessThanOrEqual(1);
        }
      }
    });

    test('every placeholder starts and ends at silence', async () => {
      // A waveform that begins or ends off zero clicks, and a click on a sound
      // fired sixty times a second is the loudest thing in the mix.
      const { ctx } = await unlocked();

      for (const buffer of ctx.buffers) {
        const data = buffer.getChannelData();
        // `Math.abs` because the envelope multiplying a negative sample by zero
        // yields -0, which `toBe(0)` rejects and no listener can hear.
        expect(Math.abs(data[0] as number)).toBe(0);
        expect(Math.abs(data[data.length - 1] as number)).toBe(0);
      }
    });

    test('none of them is silence throughout', async () => {
      const { ctx } = await unlocked();

      for (const buffer of ctx.buffers) {
        const data = buffer.getChannelData();
        let peak = 0;
        for (const sample of data) peak = Math.max(peak, Math.abs(sample));
        expect(peak).toBeGreaterThan(0.05);
      }
    });

    test('the six built-ins are distinct sounds, not one repeated', async () => {
      const { ctx } = await unlocked();

      const lengths = new Set(ctx.buffers.map((b) => b.length));
      expect(lengths.size).toBeGreaterThanOrEqual(6);
    });

    test('a registered name with no synth of its own gets the placeholder blip', async () => {
      // Silence would hide the omission; an audible default surfaces it.
      const name = unique('unauthored');
      defineSound(name, {});
      const { audio, ctx } = await unlocked();

      audio.play(name);

      const buffer = (ctx.sources[0] as FakeBufferSource).buffer as FakeAudioBuffer;
      expect(buffer.length).toBe(Math.ceil(0.1 * 44100));
    });

    test('amplitude decays across the sound rather than holding flat', async () => {
      const name = unique('decaying');
      defineSound(name, {});
      const { audio, ctx } = await unlocked();
      audio.play(name);

      const data = (ctx.sources[0] as FakeBufferSource).buffer!.getChannelData();
      const peakOver = (from: number, to: number): number => {
        let peak = 0;
        for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(data[i] as number));
        return peak;
      };

      const head = peakOver(0, Math.floor(data.length / 4));
      const tail = peakOver(Math.floor((data.length * 3) / 4), data.length);
      expect(tail).toBeLessThan(head);
    });
  });

  describe('randomness discipline', () => {
    const realRandom = Math.random;

    afterEach(() => {
      Math.random = realRandom;
    });

    test('synthesis never touches the simulation stream', async () => {
      // Noise drawn from `sim` would mean unlocking audio moves every later
      // bullet. That is exactly the coupling CLAUDE.md rule 2 forbids.
      const before = sim.getState();

      await unlocked();

      expect(sim.getState()).toEqual(before);
    });

    test('synthesis does draw from fx, so the guard above is not vacuous', async () => {
      const before = fx.getState();

      await unlocked();

      expect(fx.getState()).not.toEqual(before);
    });

    test('no audio path reaches for Math.random', async () => {
      Math.random = () => {
        throw new Error('audio called Math.random');
      };

      const name = unique('no-math-random');
      defineSound(name, { polyphony: 4 });
      const audio = new Audio();

      await audio.unlock();
      for (let i = 0; i < 10; i++) audio.play(name);
      audio.stopAll();

      expect(context().sources.length).toBeGreaterThan(0);
    });

    test('playing does not advance the simulation stream', async () => {
      const { audio } = await unlocked();
      const before = sim.getState();

      for (const sound of ['shot', 'hit', 'explosion', 'graze', 'pickup', 'death']) {
        audio.play(sound);
      }
      audio.stopAll();

      expect(sim.getState()).toEqual(before);
    });
  });
});
