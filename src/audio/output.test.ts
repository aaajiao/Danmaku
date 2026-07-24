import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Audio } from './index';
import { Music } from './music';
import { AudioOutput } from './output';

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
  readonly outputs: FakeAudioNode[] = [];

  connect(target: FakeAudioNode): FakeAudioNode {
    if (settings.failCaptureConnect && target instanceof FakeMediaDestination) {
      throw new Error('capture connection refused');
    }
    this.outputs.push(target);
    return target;
  }

  disconnect(target?: FakeAudioNode): void {
    if (target === undefined) {
      this.outputs.length = 0;
      return;
    }
    let at = this.outputs.indexOf(target);
    while (at !== -1) {
      this.outputs.splice(at, 1);
      at = this.outputs.indexOf(target);
    }
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
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;

  start(): void {}
  stop(): void {}
}

class FakeMediaStreamTrack {
  readonly kind = 'audio';
  stops = 0;
  readyState: MediaStreamTrackState = 'live';

  stop(): void {
    this.stops++;
    this.readyState = 'ended';
  }
}

class FakeMediaStream {
  constructor(readonly tracks: FakeMediaStreamTrack[]) {}

  getAudioTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }
}

class FakeMediaDestination extends FakeAudioNode {
  readonly stream: FakeMediaStream;

  constructor(tracks = 1) {
    super();
    this.stream = new FakeMediaStream(
      Array.from({ length: tracks }, () => new FakeMediaStreamTrack()),
    );
  }
}

interface Settings {
  failResume: boolean;
  failCaptureConnect: boolean;
  mediaTracks: number;
  mediaUnsupported: boolean;
  resumeGate?: Promise<void>;
}

let settings: Settings;
let contexts: FakeAudioContext[];

class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination = new FakeAudioNode();
  readonly gains: FakeGainNode[] = [];
  readonly mediaDestinations: FakeMediaDestination[] = [];
  resumes = 0;
  closes = 0;

  constructor() {
    contexts.push(this);
    if (settings.mediaUnsupported) {
      (
        this as unknown as {
          createMediaStreamDestination?: undefined;
        }
      ).createMediaStreamDestination = undefined;
    }
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource();
  }

  createBuffer(channels: number, length: number, rate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, rate);
  }

  async decodeAudioData(): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer(1, 256, this.sampleRate);
  }

  createMediaStreamDestination(): FakeMediaDestination {
    const destination = new FakeMediaDestination(settings.mediaTracks);
    this.mediaDestinations.push(destination);
    return destination;
  }

  async resume(): Promise<void> {
    this.resumes++;
    if (settings.resumeGate) await settings.resumeGate;
    if (settings.failResume) throw new Error('resume refused');
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closes++;
    this.state = 'closed';
  }
}

interface Scope {
  AudioContext?: unknown;
  fetch?: unknown;
}

const scope = globalThis as unknown as Scope;
const realAudioContext = scope.AudioContext;
const realFetch = scope.fetch;

beforeEach(() => {
  settings = {
    failResume: false,
    failCaptureConnect: false,
    mediaTracks: 1,
    mediaUnsupported: false,
  };
  contexts = [];
  scope.AudioContext = FakeAudioContext;
  scope.fetch = async () => {
    throw new Error('URL audio is outside this graph test');
  };
});

afterEach(() => {
  if (realAudioContext === undefined) delete scope.AudioContext;
  else scope.AudioContext = realAudioContext;
  scope.fetch = realFetch;
});

describe('AudioOutput', () => {
  test('shares one concurrent unlock while keeping independent master buses', async () => {
    const output = new AudioOutput();
    const audio = new Audio({ output, masterVolume: 0.8 });
    const music = new Music({ output, masterVolume: 0.4 });

    await Promise.all([audio.unlock(), music.unlock(), output.unlock()]);

    expect(contexts).toHaveLength(1);
    const ctx = contexts[0] as FakeAudioContext;
    expect(ctx.resumes).toBe(1);
    expect(output.unlocked).toBe(true);
    expect(audio.unlocked).toBe(true);
    expect(music.unlocked).toBe(true);

    const sfxBus = ctx.gains.find((gain) => gain.gain.value === 0.8);
    const musicBus = ctx.gains.find((gain) => gain.gain.value === 0.4);
    expect(sfxBus).toBeDefined();
    expect(musicBus).toBeDefined();
    expect(sfxBus).not.toBe(musicBus);
    expect(sfxBus?.outputs).toEqual([ctx.destination]);
    expect(musicBus?.outputs).toEqual([ctx.destination]);

    audio.masterVolume = 0.2;
    expect(sfxBus?.gain.value).toBe(0.2);
    expect(musicBus?.gain.value).toBe(0.4);
    music.masterVolume = 0.1;
    expect(sfxBus?.gain.value).toBe(0.2);
    expect(musicBus?.gain.value).toBe(0.1);
  });

  test('a lease exposes exactly one mixed track and release preserves speakers', async () => {
    const output = new AudioOutput();
    const audio = new Audio({ output, masterVolume: 0.8 });
    const music = new Music({ output, masterVolume: 0.4 });
    await Promise.all([audio.unlock(), music.unlock()]);

    const ctx = contexts[0] as FakeAudioContext;
    const speakerBuses = ctx.gains.filter((gain) => gain.outputs.includes(ctx.destination));
    expect(speakerBuses).toHaveLength(2);

    const lease = output.capture();
    expect(lease).toBeDefined();
    if (!lease) throw new Error('expected a capture lease');
    expect(lease.stream.getAudioTracks()).toEqual([lease.track]);
    expect(ctx.mediaDestinations).toHaveLength(1);
    const captureDestination = ctx.mediaDestinations[0] as FakeMediaDestination;
    for (const bus of speakerBuses) {
      expect(bus.outputs).toEqual([ctx.destination, captureDestination]);
    }
    expect(output.capture()).toBeUndefined();

    lease.release();
    lease.release();

    expect((lease.track as unknown as FakeMediaStreamTrack).stops).toBe(1);
    for (const bus of speakerBuses) expect(bus.outputs).toEqual([ctx.destination]);
    expect(ctx.closes).toBe(0);

    const next = output.capture();
    expect(next).toBeDefined();
    expect(next?.track).not.toBe(lease.track);
    expect(ctx.mediaDestinations).toHaveLength(2);
    // Normal recorder shutdown can end the track before the lease disconnects.
    next?.track.stop();
    next?.release();
    expect((next?.track as unknown as FakeMediaStreamTrack).stops).toBe(1);
  });

  test('a suspended shared context must resume again before capture', async () => {
    const output = new AudioOutput();
    const audio = new Audio({ output });
    const music = new Music({ output });
    await Promise.all([audio.unlock(), music.unlock()]);

    const ctx = contexts[0] as FakeAudioContext;
    expect(ctx.resumes).toBe(1);
    ctx.state = 'suspended';
    expect(output.unlocked).toBe(false);
    expect(output.capture()).toBeUndefined();

    // Audio and Music already own their buses, so export readiness explicitly
    // revalidates the shared output instead of trusting their old unlock flags.
    await Promise.all([audio.unlock(), music.unlock()]);
    expect(ctx.resumes).toBe(1);
    expect(await output.unlock()).toBe(ctx as unknown as AudioContext);
    expect(ctx.resumes).toBe(2);
    expect(output.unlocked).toBe(true);
    output.capture()?.release();
  });

  test('a refused resume cannot expose a silent capture track and can retry', async () => {
    const output = new AudioOutput();
    await output.unlock();
    const ctx = contexts[0] as FakeAudioContext;
    ctx.state = 'suspended';
    settings.failResume = true;

    expect(await output.unlock()).toBeUndefined();
    expect(output.unlocked).toBe(false);
    expect(output.capture()).toBeUndefined();

    settings.failResume = false;
    expect(await output.unlock()).toBe(ctx as unknown as AudioContext);
    expect(output.unlocked).toBe(true);
  });

  test('capture is unavailable while locked or without a media destination API', async () => {
    const output = new AudioOutput();
    expect(output.capture()).toBeUndefined();

    settings.mediaUnsupported = true;
    await output.unlock();

    expect(output.unlocked).toBe(true);
    expect(output.capture()).toBeUndefined();
  });

  test('an invalid destination or capture connection cannot mute speakers', async () => {
    const output = new AudioOutput();
    const audio = new Audio({ output });
    const music = new Music({ output });
    await Promise.all([audio.unlock(), music.unlock()]);
    const ctx = contexts[0] as FakeAudioContext;
    const speakerBuses = ctx.gains.filter((gain) => gain.outputs.includes(ctx.destination));

    settings.mediaTracks = 2;
    const invalid = output.capture();
    expect(invalid).toBeUndefined();
    for (const track of (ctx.mediaDestinations[0] as FakeMediaDestination).stream.tracks) {
      expect(track.stops).toBe(1);
    }

    settings.mediaTracks = 1;
    settings.failCaptureConnect = true;
    expect(output.capture()).toBeUndefined();
    for (const bus of speakerBuses) expect(bus.outputs).toEqual([ctx.destination]);
    expect(ctx.closes).toBe(0);
  });

  test('a failed shared unlock closes one context and a later gesture retries', async () => {
    settings.failResume = true;
    const output = new AudioOutput();
    const audio = new Audio({ output });
    const music = new Music({ output });

    await Promise.all([audio.unlock(), music.unlock(), output.unlock()]);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.closes).toBe(1);
    expect(output.unlocked).toBe(false);
    expect(audio.unlocked).toBe(false);
    expect(music.unlocked).toBe(false);

    settings.failResume = false;
    await Promise.all([audio.unlock(), music.unlock()]);

    expect(contexts).toHaveLength(2);
    expect(output.unlocked).toBe(true);
    expect(audio.unlocked).toBe(true);
    expect(music.unlocked).toBe(true);
  });
});
