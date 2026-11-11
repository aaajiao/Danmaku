import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { GamepadRumble } from './gamepad-rumble';
import { HapticOutput } from './output';

/** A promise the test settles by hand. */
interface Deferred {
  readonly promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(reason?: unknown): void;
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PlayCall {
  readonly type: string;
  readonly params: GamepadEffectParameters;
  readonly result: Deferred;
}

/** An actuator whose every call returns a promise the test controls. */
class FakeActuator {
  readonly plays: PlayCall[] = [];
  readonly resets: Deferred[] = [];
  throwOnPlay = false;
  throwOnReset = false;

  playEffect(type: string, params: GamepadEffectParameters): Promise<unknown> {
    if (this.throwOnPlay) throw new Error('synchronous browser failure');
    const result = deferred();
    this.plays.push({ type, params, result });
    return result.promise;
  }

  reset(): Promise<unknown> {
    if (this.throwOnReset) throw new Error('synchronous browser failure');
    const result = deferred();
    this.resets.push(result);
    return result.promise;
  }

  lastPlay(): PlayCall {
    const call = this.plays[this.plays.length - 1];
    if (!call) throw new Error('no playEffect yet');
    return call;
  }
}

interface FakePad {
  connected: boolean;
  vibrationActuator: unknown;
}

function pad(actuator: unknown = new FakeActuator()): FakePad {
  return { connected: true, vibrationActuator: actuator };
}

/** A scripted `navigator.getGamepads()`; counts every read. */
class Pads {
  slots: (FakePad | null)[] = [];
  reads = 0;
  readonly get = (): readonly (Gamepad | null)[] => {
    this.reads++;
    return this.slots as unknown as readonly (Gamepad | null)[];
  };
}

/** Let every already-settled promise's handlers run. No timers involved. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const LEVEL = { strong: 0.25, weak: 0.75 };

let warnings: unknown[][];
let originalWarn: typeof console.warn;

beforeEach(() => {
  warnings = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
});

afterEach(() => {
  console.warn = originalWarn;
});

function setup(slots: (FakePad | null)[]) {
  const pads = new Pads();
  pads.slots = slots;
  const rumble = new GamepadRumble(pads.get);
  return { pads, rumble };
}

describe('GamepadRumble.observe', () => {
  test('resets each newly seen pad exactly once, whatever happens later', () => {
    const a = new FakeActuator();
    const b = new FakeActuator();
    const { rumble } = setup([pad(a), null, pad(b)]);
    for (let i = 0; i < 5; i++) rumble.observe();
    expect(a.resets.length).toBe(1);
    expect(b.resets.length).toBe(1);
    expect(a.plays.length).toBe(0);
  });

  test('an actuator that appears after the pad still gets its first-sight reset, once', () => {
    // Chromium resolves haptics capability asynchronously: the pad can be
    // listed with a null actuator for some ticks before the actuator arrives.
    const p: FakePad = { connected: true, vibrationActuator: null };
    const { rumble } = setup([p]);
    rumble.observe();
    rumble.observe();
    expect(rumble.sink(0)).toBeUndefined();
    const actuator = new FakeActuator();
    p.vibrationActuator = actuator;
    rumble.observe();
    expect(actuator.resets.length).toBe(1);
    expect(rumble.sink(0)).toBeDefined();
    for (let i = 0; i < 5; i++) rumble.observe();
    expect(actuator.resets.length).toBe(1);
  });

  test('seenCapable turns true at the first pad with a callable playEffect, and stays', () => {
    const { pads, rumble } = setup([]);
    rumble.observe();
    expect(rumble.seenCapable).toBe(false);
    // A pad the browser exposes without an actuator is not a rumble surface.
    pads.slots = [{ connected: true, vibrationActuator: null }, pad({ reset: () => undefined })];
    rumble.observe();
    expect(rumble.seenCapable).toBe(false);
    pads.slots = [pad()];
    rumble.observe();
    expect(rumble.seenCapable).toBe(true);
    pads.slots = [null];
    rumble.observe();
    expect(rumble.seenCapable).toBe(true);
  });

  test('a reconnect is a new generation: reset again, and a different sink', () => {
    const actuator = new FakeActuator();
    const p = pad(actuator);
    const { pads, rumble } = setup([p]);
    rumble.observe();
    const first = rumble.sink(0);
    expect(first).toBeDefined();
    expect(rumble.sink(0)).toBe(first);

    pads.slots = [null];
    rumble.observe();
    expect(rumble.sink(0)).toBeUndefined();

    pads.slots = [p];
    rumble.observe();
    const second = rumble.sink(0);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(actuator.resets.length).toBe(2);
  });

  test('connected:false counts as empty, and so does a shrunken array', () => {
    const actuator = new FakeActuator();
    const p = pad(actuator);
    const { pads, rumble } = setup([p]);
    rumble.observe();
    const first = rumble.sink(0);

    p.connected = false;
    rumble.observe();
    expect(rumble.sink(0)).toBeUndefined();
    p.connected = true;
    rumble.observe();
    const second = rumble.sink(0);
    expect(second).not.toBe(first);

    pads.slots = [];
    rumble.observe();
    expect(rumble.sink(0)).toBeUndefined();
    pads.slots = [p];
    rumble.observe();
    expect(rumble.sink(0)).not.toBe(second);
    expect(actuator.resets.length).toBe(3);
  });

  test('the same pad object staying connected is the same generation', () => {
    const { rumble } = setup([pad()]);
    rumble.observe();
    const sink = rumble.sink(0);
    for (let i = 0; i < 10; i++) rumble.observe();
    expect(rumble.sink(0)).toBe(sink);
  });

  test('a fresh Gamepad object each read (as Chromium returns) does not advance the generation', () => {
    const actuator = new FakeActuator();
    const pads = new Pads();
    const rumble = new GamepadRumble(() => {
      pads.reads++;
      return [pad(actuator)] as unknown as readonly (Gamepad | null)[];
    });
    rumble.observe();
    const sink = rumble.sink(0);
    rumble.observe();
    expect(rumble.sink(0)).toBe(sink);
    expect(actuator.resets.length).toBe(1);
  });

  test('a pad with no reset() is stopped with a zero-magnitude effect instead', () => {
    const plays: GamepadEffectParameters[] = [];
    const actuator = {
      playEffect(_type: string, params: GamepadEffectParameters): Promise<unknown> {
        plays.push(params);
        return Promise.resolve('complete');
      },
    };
    const { rumble } = setup([pad(actuator)]);
    rumble.observe();
    expect(plays).toEqual([{ startDelay: 0, duration: 0, strongMagnitude: 0, weakMagnitude: 0 }]);
  });

  test('a reset() that throws or rejects never reaches the caller', async () => {
    const throwing = new FakeActuator();
    throwing.throwOnReset = true;
    const rejecting = new FakeActuator();
    const { rumble } = setup([pad(throwing), pad(rejecting)]);
    expect(() => rumble.observe()).not.toThrow();
    rejecting.resets[0]?.reject(undefined);
    await flush();
    // The rejected reset does not refuse the pad: it is a stop, not a send.
    expect(rumble.sink(1)).toBeDefined();
  });

  test('a getPads that throws or returns junk reads as no pads', () => {
    const throwing = new GamepadRumble(() => {
      throw new Error('SecurityError');
    });
    expect(() => throwing.observe()).not.toThrow();
    expect(throwing.sink(0)).toBeUndefined();

    const junk = new GamepadRumble(() => null as unknown as readonly (Gamepad | null)[]);
    expect(() => junk.observe()).not.toThrow();
    expect(junk.sink(0)).toBeUndefined();
  });
});

describe('GamepadRumble.sink', () => {
  test('undefined for an undefined index, an empty slot, or before observe()', () => {
    const { rumble } = setup([null, pad()]);
    expect(rumble.sink(1)).toBeUndefined(); // not observed yet
    rumble.observe();
    expect(rumble.sink(undefined)).toBeUndefined();
    expect(rumble.sink(0)).toBeUndefined();
    expect(rumble.sink(5)).toBeUndefined();
    expect(rumble.sink(1)).toBeDefined();
  });

  test('a pad without vibrationActuator yields undefined', () => {
    const missing: FakePad = { connected: true, vibrationActuator: undefined };
    const { rumble } = setup([pad(null), missing]);
    rumble.observe();
    expect(rumble.sink(0)).toBeUndefined();
    expect(rumble.sink(1)).toBeUndefined();
  });

  test('an actuator without playEffect (Firefox) yields undefined', () => {
    const resets: number[] = [];
    const { rumble } = setup([pad({ reset: () => resets.push(1) }), pad({ playEffect: 'nope' })]);
    rumble.observe();
    expect(rumble.sink(0)).toBeUndefined();
    expect(rumble.sink(1)).toBeUndefined();
    // Still reset on first sight: a stop is worth attempting whatever it lacks.
    expect(resets.length).toBe(1);
  });

  test('send plays a bounded dual-rumble effect', () => {
    const actuator = new FakeActuator();
    const { rumble } = setup([pad(actuator)]);
    rumble.observe();
    rumble.sink(0)?.send(LEVEL, 600);
    expect(actuator.plays.map((p) => [p.type, p.params])).toEqual([
      ['dual-rumble', { startDelay: 0, duration: 600, strongMagnitude: 0.25, weakMagnitude: 0.75 }],
    ]);
  });

  test('send clamps magnitudes and the 5000 ms ceiling, so a bad caller cannot earn invalid-parameter', () => {
    const actuator = new FakeActuator();
    const { rumble } = setup([pad(actuator)]);
    rumble.observe();
    const sink = rumble.sink(0);
    sink?.send({ strong: 2, weak: Number.NaN }, 99_999);
    sink?.send({ strong: -1, weak: 0.5 }, Number.POSITIVE_INFINITY);
    expect(actuator.plays.map((p) => p.params)).toEqual([
      { startDelay: 0, duration: 5000, strongMagnitude: 1, weakMagnitude: 0 },
      { startDelay: 0, duration: 0, strongMagnitude: 0, weakMagnitude: 0.5 },
    ]);
  });

  test('the sink re-reads the pad at every send and stop, never retaining it', () => {
    const first = new FakeActuator();
    const second = new FakeActuator();
    const p = pad(first);
    const { pads, rumble } = setup([p]);
    rumble.observe();
    const sink = rumble.sink(0);
    const before = pads.reads;
    sink?.send(LEVEL, 600);
    expect(pads.reads).toBe(before + 1);
    // The browser hands out a different actuator object on the same pad.
    p.vibrationActuator = second;
    sink?.send(LEVEL, 600);
    sink?.stop();
    expect(pads.reads).toBe(before + 3);
    expect(first.plays.length).toBe(1);
    expect(second.plays.length).toBe(1);
    expect(second.resets.length).toBe(1);
  });

  test('a stale sink from an earlier generation drives nothing', () => {
    const old = new FakeActuator();
    const fresh = new FakeActuator();
    const { pads, rumble } = setup([pad(old)]);
    rumble.observe();
    const stale = rumble.sink(0);
    pads.slots = [null];
    rumble.observe();
    pads.slots = [pad(fresh)];
    rumble.observe();
    stale?.send(LEVEL, 600);
    stale?.stop();
    expect(fresh.plays.length).toBe(0);
    expect(fresh.resets.length).toBe(1); // only observe()'s first-sight reset
  });

  test('stop uses reset(); without reset() it plays a zero effect', () => {
    const withReset = new FakeActuator();
    const plays: GamepadEffectParameters[] = [];
    const withoutReset = {
      playEffect(_t: string, params: GamepadEffectParameters): Promise<unknown> {
        plays.push(params);
        return new Promise<unknown>(() => undefined); // never settles
      },
    };
    const { rumble } = setup([pad(withReset), pad(withoutReset)]);
    rumble.observe();
    rumble.sink(0)?.stop();
    rumble.sink(1)?.stop();
    expect(withReset.resets.length).toBe(2); // observe + stop
    expect(plays.length).toBe(2); // observe + stop
    expect(plays[1]).toEqual({ startDelay: 0, duration: 0, strongMagnitude: 0, weakMagnitude: 0 });
  });
});

describe('GamepadRumble playEffect outcomes', () => {
  function primed() {
    const actuator = new FakeActuator();
    const ctx = setup([pad(actuator)]);
    ctx.rumble.observe();
    const sink = ctx.rumble.sink(0);
    if (!sink) throw new Error('expected a sink');
    let expired = 0;
    sink.send(LEVEL, 600, () => expired++);
    return { ...ctx, actuator, sink, expired: () => expired };
  }

  test('"complete" calls onExpired, asynchronously', async () => {
    const { actuator, rumble, sink, expired } = primed();
    actuator.lastPlay().result.resolve('complete');
    expect(expired()).toBe(0);
    await flush();
    expect(expired()).toBe(1);
    expect(rumble.sink(0)).toBe(sink);
  });

  test('"preempted" calls onExpired too, asynchronously: something else stopped it', async () => {
    // The driver decides whether the write is still current (its serial); the
    // sink only reports that the effect is no longer playing.
    const { actuator, rumble, sink, expired } = primed();
    actuator.lastPlay().result.resolve('preempted');
    expect(expired()).toBe(0);
    await flush();
    expect(expired()).toBe(1);
    expect(rumble.sink(0)).toBe(sink);
  });

  test('an undocumented result value does nothing', async () => {
    const { actuator, rumble, sink, expired } = primed();
    actuator.lastPlay().result.resolve(undefined);
    await flush();
    expect(expired()).toBe(0);
    expect(rumble.sink(0)).toBe(sink);
  });

  test('"invalid-parameter" refuses the pad permanently and warns once', async () => {
    const { actuator, rumble, sink, expired } = primed();
    actuator.lastPlay().result.resolve('invalid-parameter');
    await flush();
    expect(expired()).toBe(0);
    expect(rumble.sink(0)).toBeUndefined();
    expect(warnings.length).toBe(1);
    // A sink still held by the driver sends nothing more.
    sink.send(LEVEL, 600);
    expect(actuator.plays.length).toBe(1);
    // retry() does not clear it: it is our bug, not a missing pad.
    rumble.retry();
    expect(rumble.sink(0)).toBeUndefined();
  });

  test('"invalid-parameter" warns once per instance, not once per result', async () => {
    const a = new FakeActuator();
    const b = new FakeActuator();
    const { rumble } = setup([pad(a), pad(b)]);
    rumble.observe();
    rumble.sink(0)?.send(LEVEL, 600);
    rumble.sink(0)?.send(LEVEL, 600);
    rumble.sink(1)?.send(LEVEL, 600);
    for (const call of [...a.plays, ...b.plays]) call.result.resolve('invalid-parameter');
    await flush();
    expect(warnings.length).toBe(1);
  });

  test('"not-supported" refuses until retry()', async () => {
    const { actuator, rumble, sink } = primed();
    actuator.lastPlay().result.resolve('not-supported');
    await flush();
    expect(rumble.sink(0)).toBeUndefined();
    sink.send(LEVEL, 600);
    expect(actuator.plays.length).toBe(1);
    rumble.retry();
    expect(rumble.sink(0)).toBe(sink);
    expect(warnings.length).toBe(0);
  });

  test('a rejection with an undefined reason refuses until retry()', async () => {
    const { actuator, rumble, sink } = primed();
    actuator.lastPlay().result.reject(undefined);
    await flush();
    expect(rumble.sink(0)).toBeUndefined();
    rumble.retry();
    expect(rumble.sink(0)).toBe(sink);
  });

  test('a rejection refuses until the generation changes', async () => {
    const { actuator, pads, rumble } = primed();
    actuator.lastPlay().result.reject(undefined);
    await flush();
    const p = pads.slots[0] ?? null;
    pads.slots = [null];
    rumble.observe();
    pads.slots = [p];
    rumble.observe();
    expect(rumble.sink(0)).toBeDefined();
  });

  test('a synchronous throw from playEffect is caught and treated like a rejection', () => {
    const actuator = new FakeActuator();
    actuator.throwOnPlay = true;
    const { rumble } = setup([pad(actuator)]);
    rumble.observe();
    const sink = rumble.sink(0);
    expect(() => sink?.send(LEVEL, 600)).not.toThrow();
    expect(rumble.sink(0)).toBeUndefined();
    rumble.retry();
    expect(rumble.sink(0)).toBe(sink);
  });

  test('a synchronous throw from reset() in stop is caught', () => {
    const actuator = new FakeActuator();
    const { rumble } = setup([pad(actuator)]);
    rumble.observe();
    actuator.throwOnReset = true;
    expect(() => rumble.sink(0)?.stop()).not.toThrow();
  });

  test('a playEffect returning a non-promise does not throw', () => {
    const { rumble } = setup([pad({ playEffect: () => 42, reset: () => undefined })]);
    rumble.observe();
    expect(() => rumble.sink(0)?.send(LEVEL, 600)).not.toThrow();
  });

  test('a late result from an old generation does not refuse the new pad', async () => {
    const { actuator, pads, rumble } = primed();
    const p = pads.slots[0] ?? null;
    pads.slots = [null];
    rumble.observe();
    pads.slots = [p];
    rumble.observe();
    const fresh = rumble.sink(0);
    actuator.plays[0]?.result.resolve('invalid-parameter');
    await flush();
    expect(rumble.sink(0)).toBe(fresh);
    expect(warnings.length).toBe(0);
  });

  test('a late "complete" from an old generation does not call onExpired', async () => {
    const { actuator, pads, rumble, expired } = primed();
    const p = pads.slots[0] ?? null;
    pads.slots = [null];
    rumble.observe();
    pads.slots = [p];
    rumble.observe();
    actuator.plays[0]?.result.resolve('complete');
    await flush();
    expect(expired()).toBe(0);
  });

  test('"not-supported" never downgrades an "invalid-parameter" refusal', async () => {
    const actuator = new FakeActuator();
    const { rumble } = setup([pad(actuator)]);
    rumble.observe();
    const sink = rumble.sink(0);
    sink?.send(LEVEL, 600);
    sink?.send(LEVEL, 600);
    actuator.plays[0]?.result.resolve('invalid-parameter');
    actuator.plays[1]?.result.resolve('not-supported');
    await flush();
    rumble.retry();
    expect(rumble.sink(0)).toBeUndefined();
  });
});

describe('GamepadRumble.supported', () => {
  test('true only when GamepadHapticActuator.prototype.playEffect is a function', () => {
    const scope = (value: unknown): typeof globalThis => value as typeof globalThis;
    class Chromium {
      playEffect(): void {}
    }
    class FirefoxLike {
      pulse(): void {}
    }
    expect(GamepadRumble.supported(scope({ GamepadHapticActuator: Chromium }))).toBe(true);
    expect(GamepadRumble.supported(scope({ GamepadHapticActuator: FirefoxLike }))).toBe(false);
    expect(GamepadRumble.supported(scope({}))).toBe(false);
    expect(GamepadRumble.supported(scope({ GamepadHapticActuator: null }))).toBe(false);
    const hostile = {};
    Object.defineProperty(hostile, 'GamepadHapticActuator', {
      get() {
        throw new Error('blocked');
      },
    });
    expect(GamepadRumble.supported(scope(hostile))).toBe(false);
  });

  test('the headless runtime reports unsupported without throwing', () => {
    expect(() => GamepadRumble.supported()).not.toThrow();
  });
});

describe('GamepadRumble with HapticOutput', () => {
  test('an expired effect is re-written by the next update, never from the promise', async () => {
    const actuator = new FakeActuator();
    const { rumble } = setup([pad(actuator)]);
    const clock = { t: 0 };
    const output = new HapticOutput({ now: () => clock.t });
    rumble.observe();
    output.update(LEVEL, rumble.sink(0));
    expect(actuator.plays.length).toBe(1);
    actuator.lastPlay().result.resolve('complete');
    await flush();
    // The promise settled; nothing was written from inside it.
    expect(actuator.plays.length).toBe(1);
    // An expiry skips the 250 ms refresh wait but not the 50 ms write floor.
    clock.t += 1;
    rumble.observe();
    output.update(LEVEL, rumble.sink(0));
    expect(actuator.plays.length).toBe(1);
    clock.t += 49;
    rumble.observe();
    output.update(LEVEL, rumble.sink(0));
    expect(actuator.plays.length).toBe(2);
  });

  test('a hold stopped from outside is re-written at the write floor, not a refresh later', async () => {
    // Blink's deferred reset (or another page driving the same pad) resolves
    // the CURRENT effect "preempted" and leaves the motor off. Waiting the
    // full 250 ms refresh would be a felt hole in a held level.
    const actuator = new FakeActuator();
    const { rumble } = setup([pad(actuator)]);
    const clock = { t: 0 };
    const output = new HapticOutput({ now: () => clock.t });
    rumble.observe();
    output.update(LEVEL, rumble.sink(0));
    actuator.lastPlay().result.resolve('preempted');
    await flush();
    expect(actuator.plays.length).toBe(1);
    clock.t += 50;
    rumble.observe();
    output.update(LEVEL, rumble.sink(0));
    expect(actuator.plays.length).toBe(2);
  });

  test('a preemption the driver caused itself never earns an extra write', async () => {
    const actuator = new FakeActuator();
    const { rumble } = setup([pad(actuator)]);
    const clock = { t: 0 };
    const output = new HapticOutput({ now: () => clock.t });
    rumble.observe();
    output.update(LEVEL, rumble.sink(0));
    const first = actuator.lastPlay();
    clock.t += 50;
    output.update({ strong: 0.5, weak: 0.5 }, rumble.sink(0));
    expect(actuator.plays.length).toBe(2);
    // The browser reports the first effect preempted by our own second write.
    first.result.resolve('preempted');
    await flush();
    clock.t += 50;
    output.update({ strong: 0.5, weak: 0.5 }, rumble.sink(0));
    expect(actuator.plays.length).toBe(2);
  });

  test('a pad that disappears is stopped and dropped by the driver', async () => {
    const actuator = new FakeActuator();
    const { pads, rumble } = setup([pad(actuator)]);
    const clock = { t: 0 };
    const output = new HapticOutput({ now: () => clock.t });
    rumble.observe();
    output.update(LEVEL, rumble.sink(0));
    actuator.lastPlay().result.reject(undefined);
    await flush();
    clock.t += 16;
    rumble.observe();
    const sink = rumble.sink(0);
    expect(sink).toBeUndefined();
    output.update(LEVEL, sink);
    // observe() reset + the driver stopping the old sink on the switch.
    expect(actuator.resets.length).toBe(2);
    pads.slots = [null];
    expect(() => {
      rumble.observe();
      output.update(LEVEL, rumble.sink(0));
    }).not.toThrow();
  });
});
