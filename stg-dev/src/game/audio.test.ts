import {beforeEach, describe, expect, it, vi} from "vitest";
import {V4_SHARED_ASSETS, v4Audio, v4RoomBed} from "../assets/shared-v4";
import {
  AudioTrace,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BiquadFilterNodeLike,
  type GainNodeLike,
} from "./audio";

/* ------------------------------------------------------------------ *
 * Deterministic fake AudioContext (jsdom has no WebAudio).
 * ------------------------------------------------------------------ */

interface ParamCall {
  readonly kind: "setValueAtTime" | "linearRampToValueAtTime" | "cancelScheduledValues";
  readonly value: number;
  readonly time: number;
}

class FakeParam implements AudioParamLike {
  value = 0;
  readonly calls: ParamCall[] = [];

  setValueAtTime(value: number, startTime: number): unknown {
    this.value = value;
    this.calls.push({kind: "setValueAtTime", value, time: startTime});
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): unknown {
    this.calls.push({kind: "linearRampToValueAtTime", value, time: endTime});
    return this;
  }

  cancelScheduledValues(cancelTime: number): unknown {
    this.calls.push({kind: "cancelScheduledValues", value: 0, time: cancelTime});
    return this;
  }

  ramps(): readonly ParamCall[] {
    return this.calls.filter((call) => call.kind === "linearRampToValueAtTime");
  }
}

class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  constructor(readonly label: string) {}
  connect(destination: AudioNodeLike): unknown {
    this.outputs.push(destination);
    return destination;
  }
  disconnect(): unknown {
    this.outputs.length = 0;
    return undefined;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
  channelCount = 2;
  channelCountMode = "max";
  channelInterpretation = "speakers";
  constructor() {
    super("gain");
  }
}

class FakeFilter extends FakeNode implements BiquadFilterNodeLike {
  type = "";
  readonly frequency = new FakeParam();
  constructor() {
    super("filter");
  }
}

class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly startCalls: number[] = [];
  readonly stopCalls: number[] = [];
  constructor() {
    super("source");
  }
  start(when = 0): unknown {
    this.startCalls.push(when);
    return undefined;
  }
  stop(when = 0): unknown {
    this.stopCalls.push(when);
    return undefined;
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  state = "suspended";
  readonly destination = new FakeNode("destination");
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly sources: FakeSource[] = [];
  readonly decoded: ArrayBuffer[] = [];
  resumeCount = 0;
  decodeFails = false;

  resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = "running";
    return Promise.resolve();
  }
  createGain(): GainNodeLike {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter(): BiquadFilterNodeLike {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createBufferSource(): AudioBufferSourceNodeLike {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    this.decoded.push(data);
    if (this.decodeFails) return Promise.reject(new Error("decode failed"));
    return Promise.resolve({duration: 1});
  }

  /** master is the first gain created; then mono; then the five buses. */
  master(): FakeGain {
    return this.gains[0]!;
  }
  mono(): FakeGain {
    return this.gains[1]!;
  }
  filter(): FakeFilter {
    return this.filters[0]!;
  }
  busNodes(): FakeGain[] {
    return this.gains.slice(2, 2 + V4_SHARED_ASSETS.audioMix.buses.length);
  }
  busNode(bus: string): FakeGain {
    const index = V4_SHARED_ASSETS.audioMix.buses.indexOf(
      bus as (typeof V4_SHARED_ASSETS.audioMix.buses)[number],
    );
    return this.busNodes()[index]!;
  }
}

/** Every load resolves; flush with `await settle()`. */
function makeHarness(options: {readonly fetchFails?: boolean} = {}) {
  const context = new FakeContext();
  const fetched: string[] = [];
  const trace = new AudioTrace({
    createContext: () => context,
    fetchAudio: (url) => {
      fetched.push(url);
      if (options.fetchFails === true) return Promise.reject(new Error("offline"));
      return Promise.resolve(new ArrayBuffer(8));
    },
  });
  return {context, trace, fetched};
}

/** Drains the microtask queue used by buffer loading. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/** Source nodes routed into the given bus node. */
function sourcesOnBus(context: FakeContext, bus: string): FakeSource[] {
  const busNode = context.busNode(bus);
  return context.sources.filter((source) =>
    source.outputs.some(
      (output) =>
        output === busNode ||
        (output instanceof FakeGain && output.outputs.includes(busNode)),
    ),
  );
}

const CROSSFADE_SECONDS = V4_SHARED_ASSETS.audioMix.roomCrossfadeMs / 1000;

describe("AudioTrace graph", () => {
  it("builds master + the five authored buses at the authored headroom", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();

    expect(V4_SHARED_ASSETS.audioMix.buses).toEqual([
      "room",
      "boss",
      "events",
      "weather",
      "ui",
    ]);
    expect(context.busNodes()).toHaveLength(5);
    // -6 dB headroom, as authored in mixContract.headroomDb.
    expect(context.master().gain.value).toBeCloseTo(10 ** (-6 / 20), 10);
    expect(context.master().outputs).toContain(context.destination);
    // buses -> low-pass -> mono -> master -> destination
    for (const bus of context.busNodes()) {
      expect(bus.outputs).toContain(context.filter());
      expect(bus.gain.value).toBe(1);
    }
    expect(context.filter().type).toBe("lowpass");
    expect(context.filter().outputs).toContain(context.mono());
    expect(context.mono().outputs).toContain(context.master());
  });

  it("resumes a suspended context on unlock and unlocks only once", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    const gainCount = context.gains.length;
    trace.unlock();
    expect(context.resumeCount).toBe(1);
    expect(context.gains).toHaveLength(gainCount);
  });

  it("mutes via master gain only, leaving buses untouched", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    trace.setEnabled(false);
    expect(context.master().gain.value).toBe(0);
    for (const bus of context.busNodes()) expect(bus.gain.value).toBe(1);
    trace.setEnabled(true);
    expect(context.master().gain.value).toBeCloseTo(10 ** (-6 / 20), 10);
  });
});

describe("bus routing", () => {
  it("routes each authored audio id to the bus its binding declares", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();

    const cases: readonly (readonly [string, string])[] = [
      ["sfx.player_damage", "events"],
      ["sfx.gaze_acquire", "events"],
      ["sfx.weather_rain", "weather"],
      ["sfx.weather_eclipse", "weather"],
      ["boss.absent_receiver.signal", "boss"],
      ["boss.no_dusk.signal", "boss"],
    ];
    for (const [audioId, bus] of cases) {
      expect(v4Audio(audioId).bus).toBe(bus);
      const before = sourcesOnBus(context, bus).length;
      trace.playCue(audioId);
      expect(sourcesOnBus(context, bus)).toHaveLength(before + 1);
    }
  });

  it("keeps the ui bus silent — no authored audio asset resolves to it", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    for (const audioId of Object.keys(V4_SHARED_ASSETS.audio)) {
      trace.playCue(audioId);
    }
    expect(sourcesOnBus(context, "ui")).toHaveLength(0);
  });

  it("plays a one-shot cue without looping", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    context.currentTime = 3.25;
    trace.playCue("sfx.scar_write");
    const source = context.sources.at(-1)!;
    expect(source.loop).toBe(false);
    expect(source.startCalls).toEqual([3.25]);
  });

  it("is silent for an id V4 does not author — no substitute sound", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    const before = context.sources.length;
    trace.playCue("sfx.does_not_exist");
    trace.playCue("");
    trace.playCue("damage");
    expect(context.sources).toHaveLength(before);
  });
});

describe("room bed crossfade", () => {
  it("crossfades over the authored roomCrossfadeMs on an authoritative room change", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    trace.setRoom("INFORMATION");
    await settle();

    const first = context.sources.at(-1)!;
    const firstGain = first.outputs[0] as FakeGain;
    expect(first.loop).toBe(true);
    expect(firstGain.outputs).toContain(context.busNode("room"));
    expect(firstGain.gain.ramps()).toEqual([
      {kind: "linearRampToValueAtTime", value: 1, time: CROSSFADE_SECONDS},
    ]);

    context.currentTime = 10;
    trace.setRoom("FORCED_ALIGNMENT");
    await settle();

    const second = context.sources.at(-1)!;
    const secondGain = second.outputs[0] as FakeGain;
    expect(second).not.toBe(first);
    // new bed fades in over 500 ms from the moment of the room change
    expect(secondGain.gain.ramps()).toEqual([
      {kind: "linearRampToValueAtTime", value: 1, time: 10 + CROSSFADE_SECONDS},
    ]);
    // old bed fades out over the same window and stops on the audio clock,
    // not on a timer this module owns
    expect(firstGain.gain.ramps().at(-1)).toEqual({
      kind: "linearRampToValueAtTime",
      value: 0,
      time: 10 + CROSSFADE_SECONDS,
    });
    expect(first.stopCalls).toEqual([10 + CROSSFADE_SECONDS]);
    expect(CROSSFADE_SECONDS).toBe(0.5);
  });

  it("resolves the bed through canonical room ids and never re-enters the same room", async () => {
    const {context, trace, fetched} = makeHarness();
    trace.unlock();
    await settle();
    trace.setRoom("FORCED_ALIGNMENT");
    await settle();
    expect(fetched).toContain(v4RoomBed("FORCED_ALIGNMENT").url);
    const count = context.sources.length;
    trace.setRoom("FORCED_ALIGNMENT");
    await settle();
    expect(context.sources).toHaveLength(count);
  });

  it("starts the pending room bed once the context unlocks", async () => {
    const {context, trace} = makeHarness();
    trace.setRoom("POLARIZED");
    await settle();
    expect(context.sources).toHaveLength(0);
    trace.unlock();
    await settle();
    const bed = context.sources.at(-1)!;
    expect(bed.loop).toBe(true);
  });

  it("stays silent for a room V4 does not bind, and never falls back to another bed", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    trace.setRoom("NOT_A_ROOM");
    await settle();
    expect(context.sources.filter((source) => source.loop)).toHaveLength(0);
  });
});

describe("gaze low-pass", () => {
  it("maps the authoritative gaze clamp onto the authored corner frequencies", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    const filter = context.filter();

    expect(V4_SHARED_ASSETS.audioMix.gazeLowPassHz).toEqual({
      open: 20000,
      clamped: 400,
    });
    expect(filter.frequency.value).toBe(20000);

    context.currentTime = 4;
    trace.setGazeClamped(true);
    expect(filter.frequency.value).toBe(400);
    expect(filter.frequency.calls.at(-1)).toEqual({
      kind: "setValueAtTime",
      value: 400,
      time: 4,
    });

    trace.setGazeClamped(false);
    expect(filter.frequency.value).toBe(20000);
  });

  it("does not re-schedule when the gaze state is unchanged", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    const filter = context.filter();
    const before = filter.frequency.calls.length;
    trace.setGazeClamped(false);
    expect(filter.frequency.calls).toHaveLength(before);
  });
});

describe("binaural mono downmix", () => {
  it("collapses the master chain to one channel and restores it", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    const mono = context.mono();
    expect(mono.channelCount).toBe(2);
    expect(mono.channelCountMode).toBe("max");

    trace.setBinauralMono(true);
    expect(mono.channelCount).toBe(1);
    expect(mono.channelCountMode).toBe("explicit");

    trace.setBinauralMono(false);
    expect(mono.channelCount).toBe(2);
    expect(mono.channelCountMode).toBe("max");
  });
});

describe("autoplay unlock", () => {
  it("drops cue requests before unlock and never bursts them afterwards", async () => {
    const {context, trace, fetched} = makeHarness();
    trace.playCue("sfx.player_damage");
    trace.playCue("sfx.gaze_acquire");
    trace.playCue("sfx.scar_write");
    expect(fetched).toHaveLength(0);
    expect(context.sources).toHaveLength(0);

    trace.unlock();
    await settle();
    // Unlock preloads buffers but must not replay the dropped requests.
    expect(context.sources).toHaveLength(0);
    trace.playCue("sfx.player_damage");
    expect(context.sources).toHaveLength(1);
  });

  it("drops a cue whose buffer has not decoded yet instead of queuing it", async () => {
    const context = new FakeContext();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const trace = new AudioTrace({
      createContext: () => context,
      fetchAudio: async () => {
        await gate;
        return new ArrayBuffer(8);
      },
    });
    trace.unlock();
    await settle();
    trace.playCue("sfx.player_damage");
    expect(context.sources).toHaveLength(0);
    release!();
    await settle();
    // No burst: the dropped request stays dropped.
    expect(context.sources).toHaveLength(0);
    trace.playCue("sfx.player_damage");
    expect(context.sources).toHaveLength(1);
  });
});

describe("failure isolation", () => {
  it("survives a context that cannot be constructed", () => {
    const trace = new AudioTrace({
      createContext: () => {
        throw new Error("no WebAudio");
      },
      fetchAudio: () => Promise.resolve(new ArrayBuffer(8)),
    });
    expect(() => {
      trace.unlock();
    }).not.toThrow();
    expect(() => {
      trace.playCue("sfx.player_damage");
      trace.setRoom("INFORMATION");
      trace.setGazeClamped(true);
      trace.setBinauralMono(true);
      trace.setEnabled(false);
      trace.setBusGain("room", 0.5);
    }).not.toThrow();
  });

  it("survives fetch failure without throwing into the caller", async () => {
    const {context, trace} = makeHarness({fetchFails: true});
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
    };
    globalThis.addEventListener?.("unhandledrejection", onRejection as EventListener);
    trace.unlock();
    trace.setRoom("INFORMATION");
    await settle();
    trace.playCue("sfx.player_damage");
    expect(context.sources).toHaveLength(0);
    expect(rejections).toHaveLength(0);
    globalThis.removeEventListener?.("unhandledrejection", onRejection as EventListener);
  });

  it("survives decode failure", async () => {
    const {context, trace} = makeHarness();
    context.decodeFails = true;
    trace.unlock();
    trace.setRoom("INFORMATION");
    await settle();
    trace.playCue("sfx.player_damage");
    expect(context.sources).toHaveLength(0);
  });

  it("survives a node that throws while starting playback", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    const spy = vi.spyOn(context, "createBufferSource").mockImplementation(() => {
      throw new Error("hardware went away");
    });
    expect(() => {
      trace.playCue("sfx.player_damage");
      trace.setRoom("INFORMATION");
    }).not.toThrow();
    spy.mockRestore();
  });

  it("is inert after dispose", async () => {
    const {context, trace} = makeHarness();
    trace.unlock();
    await settle();
    trace.dispose();
    const count = context.sources.length;
    trace.playCue("sfx.player_damage");
    trace.setRoom("INFORMATION");
    trace.unlock();
    await settle();
    expect(context.sources).toHaveLength(count);
  });
});

describe("presentation never writes gameplay", () => {
  const PUBLIC_API = [
    "constructor",
    "unlock",
    "setEnabled",
    "setBinauralMono",
    "setGazeClamped",
    "setBusGain",
    "setRoom",
    "playCue",
    "playAsset",
    "dispose",
  ];

  it("exposes only void feedback commands — no readable playback state", async () => {
    const names = Object.getOwnPropertyNames(AudioTrace.prototype).filter(
      (name) => !name.startsWith("#"),
    );
    expect(names.sort()).toEqual([...PUBLIC_API].sort());

    const {trace} = makeHarness();
    trace.unlock();
    await settle();
    trace.setRoom("INFORMATION");
    await settle();

    const results = [
      trace.unlock(),
      trace.setEnabled(true),
      trace.setBinauralMono(false),
      trace.setGazeClamped(true),
      trace.setBusGain("room", 1),
      trace.setRoom("POLARIZED"),
      trace.playCue("sfx.player_damage"),
      trace.playAsset(v4Audio("sfx.scar_write")),
      trace.dispose(),
    ];
    // Every method returns undefined: there is nothing for gameplay to read
    // back — no playback position, no completion promise, no readiness flag.
    for (const result of results) expect(result).toBeUndefined();
  });

  it("names no forbidden judgment or playback-position vocabulary", () => {
    const surface = Object.getOwnPropertyNames(AudioTrace.prototype).join(" ");
    for (const banned of [
      "score",
      "rank",
      "grade",
      "victory",
      "defeat",
      "currentTime",
      "position",
      "playhead",
      "isPlaying",
      "finished",
      "complete",
    ]) {
      expect(surface.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe("preload scope", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preloads every short cue on unlock but no room bed", async () => {
    const {trace, fetched} = makeHarness();
    trace.unlock();
    await settle();

    const shortCues = Object.values(V4_SHARED_ASSETS.audio).filter(
      (asset) => asset.category !== "room-bed",
    );
    expect(shortCues).toHaveLength(44);
    for (const asset of shortCues) expect(fetched).toContain(asset.url);
    for (const roomId of V4_SHARED_ASSETS.roomIds) {
      expect(fetched).not.toContain(v4RoomBed(roomId).url);
    }
  });

  it("fetches each url at most once", async () => {
    const {trace, fetched} = makeHarness();
    trace.unlock();
    await settle();
    trace.playCue("sfx.player_damage");
    trace.playCue("sfx.player_damage");
    trace.setRoom("INFORMATION");
    trace.setRoom("POLARIZED");
    trace.setRoom("INFORMATION");
    await settle();
    expect(new Set(fetched).size).toBe(fetched.length);
  });
});
