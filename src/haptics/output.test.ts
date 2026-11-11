import { describe, expect, test } from 'bun:test';

import { HapticOutput } from './output';
import type { HapticLevel, HapticSink } from './types';

type Call =
  | { readonly kind: 'send'; readonly strong: number; readonly weak: number; readonly holdMs: number }
  | { readonly kind: 'stop' };

/** Records every call; keeps each write's `onExpired` so a test can fire it. */
class FakeSink implements HapticSink {
  readonly calls: Call[] = [];
  readonly expiries: (() => void)[] = [];
  /** Misbehaviour switch: report expiry from inside `send` itself. */
  expireSynchronously = false;

  send(level: HapticLevel, holdMs: number, onExpired?: () => void): void {
    this.calls.push({ kind: 'send', strong: level.strong, weak: level.weak, holdMs });
    const expire = onExpired ?? ((): void => undefined);
    this.expiries.push(expire);
    if (this.expireSynchronously) expire();
  }

  stop(): void {
    this.calls.push({ kind: 'stop' });
  }

  get sends(): number {
    return this.calls.filter((c) => c.kind === 'send').length;
  }

  get stops(): number {
    return this.calls.filter((c) => c.kind === 'stop').length;
  }

  lastExpiry(): () => void {
    const fn = this.expiries[this.expiries.length - 1];
    if (!fn) throw new Error('no write yet');
    return fn;
  }
}

function setup(options: { minIntervalMs?: number; holdMs?: number; refreshMs?: number } = {}) {
  const clock = { t: 1000 };
  const output = new HapticOutput({ now: () => clock.t, ...options });
  return { clock, output };
}

const L = (strong: number, weak: number): HapticLevel => ({ strong, weak });
const ZERO = L(0, 0);

describe('HapticOutput', () => {
  test('first non-zero level is written at once, quantised, with the hold', () => {
    const { output } = setup();
    const sink = new FakeSink();
    output.update(L(0.5049, 0.123), sink);
    expect(sink.calls).toEqual([{ kind: 'send', strong: 0.5, weak: 0.12, holdMs: 600 }]);
  });

  test('float noise below one percent never causes a write', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.5, 0.2), sink);
    for (let i = 0; i < 10; i++) {
      clock.t += 16;
      output.update(L(0.5 + (i % 2 ? 0.004 : -0.004), 0.2 + 1e-9), sink);
    }
    // 160 ms elapsed: under refreshMs, and quantised the level never changed.
    expect(sink.sends).toBe(1);
  });

  test('a changed level waits for minIntervalMs, then the NEWEST level is written', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.2, 0.2), sink);
    clock.t += 16;
    output.update(L(0.4, 0.4), sink);
    clock.t += 16;
    output.update(L(0.6, 0.6), sink);
    expect(sink.sends).toBe(1);
    clock.t += 18; // exactly 50 ms after the first write
    output.update(L(0.7, 0.1), sink);
    expect(sink.sends).toBe(2);
    expect(sink.calls[1]).toEqual({ kind: 'send', strong: 0.7, weak: 0.1, holdMs: 600 });
  });

  test('an unchanged non-zero level is re-written every refreshMs', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.3, 0.3), sink);
    for (let ms = 16; ms < 250; ms += 16) {
      clock.t = 1000 + ms;
      output.update(L(0.3, 0.3), sink);
    }
    expect(sink.sends).toBe(1);
    clock.t = 1250;
    output.update(L(0.3, 0.3), sink);
    expect(sink.sends).toBe(2);
    clock.t = 1499;
    output.update(L(0.3, 0.3), sink);
    expect(sink.sends).toBe(2);
    clock.t = 1500;
    output.update(L(0.3, 0.3), sink);
    expect(sink.sends).toBe(3);
  });

  test('a zero level stops once and is not delayed by the write floor', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.5, 0.5), sink);
    clock.t += 1; // well inside minIntervalMs
    output.update(ZERO, sink);
    expect(sink.calls.at(-1)).toEqual({ kind: 'stop' });
    for (let i = 0; i < 5; i++) {
      clock.t += 300;
      output.update(ZERO, sink);
    }
    expect(sink.stops).toBe(1);
  });

  test('a zero level with nothing written sends nothing at all', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    for (let i = 0; i < 5; i++) {
      output.update(ZERO, sink);
      clock.t += 16;
    }
    expect(sink.calls).toEqual([]);
  });

  test('switching sink stops the old one and starts the new one clean', () => {
    const { clock, output } = setup();
    const a = new FakeSink();
    const b = new FakeSink();
    output.update(L(0.5, 0.5), a);
    clock.t += 100;
    output.update(L(0.5, 0.5), b);
    expect(a.calls.at(-1)).toEqual({ kind: 'stop' });
    // Same level, but nothing was ever sent to `b`: it is written.
    expect(b.calls).toEqual([{ kind: 'send', strong: 0.5, weak: 0.5, holdMs: 600 }]);
  });

  test('switching to undefined stops the old sink; switching back writes again', () => {
    const { clock, output } = setup();
    const a = new FakeSink();
    output.update(L(0.5, 0.5), a);
    clock.t += 16;
    output.update(L(0.5, 0.5), undefined);
    expect(a.stops).toBe(1);
    clock.t += 100;
    output.update(L(0.5, 0.5), a);
    expect(a.sends).toBe(2);
  });

  test('a sink already stopped by silence() is not stopped again when it is dropped', () => {
    // RUMBLE → OFF mid-cue: silence(), then the next tick passes no sink.
    const { clock, output } = setup();
    const a = new FakeSink();
    output.update(L(0.5, 0.5), a);
    output.silence();
    clock.t += 16;
    output.update(L(0.5, 0.5), undefined);
    expect(a.stops).toBe(1);
  });

  test('a sink that ended on a zero level is not stopped again when it is dropped', () => {
    const { clock, output } = setup();
    const a = new FakeSink();
    const b = new FakeSink();
    output.update(L(0.5, 0.5), a);
    clock.t += 16;
    output.update(ZERO, a);
    clock.t += 16;
    output.update(ZERO, b);
    expect(a.stops).toBe(1);
    expect(b.calls).toEqual([]);
  });

  test('the write floor spans sink switches: a flapping sink cannot flood writes', () => {
    const { clock, output } = setup();
    const a = new FakeSink();
    const b = new FakeSink();
    output.update(L(0.5, 0.5), a);
    clock.t += 16;
    output.update(L(0.5, 0.5), b);
    clock.t += 16;
    output.update(L(0.5, 0.5), a);
    expect(a.sends + b.sends).toBe(1);
    clock.t += 18;
    output.update(L(0.5, 0.5), a);
    expect(a.sends).toBe(2);
  });

  test('silence() stops synchronously, and the next non-zero update writes again', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.4, 0.4), sink);
    output.silence();
    expect(sink.calls.at(-1)).toEqual({ kind: 'stop' });
    clock.t += 60;
    output.update(L(0.4, 0.4), sink);
    expect(sink.calls.at(-1)).toEqual({ kind: 'send', strong: 0.4, weak: 0.4, holdMs: 600 });
  });

  test('silence() stops even when the driver believes the device is quiet', () => {
    const { output } = setup();
    const sink = new FakeSink();
    output.update(ZERO, sink);
    output.silence();
    output.silence();
    expect(sink.stops).toBe(2);
  });

  test('silence() with no sink yet is a no-op', () => {
    const { output } = setup();
    expect(() => output.silence()).not.toThrow();
  });

  test('five update() calls at the same clock value produce at most one write', () => {
    const { output } = setup();
    const sink = new FakeSink();
    // Catch-up ticks: same millisecond, a changing envelope, even dropping to
    // zero and back.
    output.update(L(0.2, 0.2), sink);
    output.update(L(0.4, 0.4), sink);
    output.update(ZERO, sink);
    output.update(L(0.8, 0.8), sink);
    output.update(L(0.9, 0.9), sink);
    expect(sink.sends).toBe(1);
  });

  test('five same-clock updates stay at one write even if the sink expires synchronously', () => {
    const { output } = setup();
    const sink = new FakeSink();
    sink.expireSynchronously = true;
    for (let i = 0; i < 5; i++) output.update(L(0.5, 0.5), sink);
    expect(sink.sends).toBe(1);
  });

  test('onExpired for the latest write forces a re-write on the next update', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.5, 0.5), sink);
    clock.t += 20;
    output.update(L(0.5, 0.5), sink);
    expect(sink.sends).toBe(1);
    sink.lastExpiry()();
    // Nothing is written from inside the callback.
    expect(sink.sends).toBe(1);
    // The write floor still applies: a browser that "completes" instantly must
    // not be able to earn a write per frame.
    clock.t += 1; // 21 ms since the write: inside minIntervalMs
    output.update(L(0.5, 0.5), sink);
    expect(sink.sends).toBe(1);
    clock.t += 29; // 50 ms: the floor opens, far inside refreshMs (250)
    output.update(L(0.5, 0.5), sink);
    expect(sink.sends).toBe(2);
    // The flag is consumed: the next update is paced normally again.
    clock.t += 1;
    output.update(L(0.5, 0.5), sink);
    expect(sink.sends).toBe(2);
  });

  test('a stale onExpired (an older write) is ignored', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.2, 0.2), sink);
    const stale = sink.lastExpiry();
    clock.t += 60;
    output.update(L(0.6, 0.6), sink);
    expect(sink.sends).toBe(2);
    stale();
    clock.t += 1;
    output.update(L(0.6, 0.6), sink);
    expect(sink.sends).toBe(2);
  });

  test('onExpired after a stop does not restart the motor', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.5, 0.5), sink);
    const expire = sink.lastExpiry();
    output.update(ZERO, sink);
    expire();
    clock.t += 1;
    output.update(ZERO, sink);
    expect(sink.calls.map((c) => c.kind)).toEqual(['send', 'stop']);
  });

  test('onExpired after silence() is ignored', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.5, 0.5), sink);
    const expire = sink.lastExpiry();
    output.silence();
    expire();
    clock.t += 60;
    output.update(ZERO, sink);
    expect(sink.sends).toBe(1);
  });

  test('a clock that jumps backwards cannot lock out writes', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    output.update(L(0.5, 0.5), sink);
    clock.t -= 100_000;
    output.update(L(0.5, 0.5), sink);
    clock.t += 250;
    output.update(L(0.5, 0.5), sink);
    expect(sink.sends).toBe(2);
  });

  test('non-finite and out-of-range levels are clamped before sending', () => {
    const { output } = setup();
    const sink = new FakeSink();
    output.update(L(Number.NaN, 7), sink);
    expect(sink.calls).toEqual([{ kind: 'send', strong: 0, weak: 1, holdMs: 600 }]);
  });

  test('option overrides reach the sink', () => {
    const { clock, output } = setup({ minIntervalMs: 10, holdMs: 400, refreshMs: 100 });
    const sink = new FakeSink();
    output.update(L(0.1, 0.1), sink);
    clock.t += 10;
    output.update(L(0.2, 0.2), sink);
    clock.t += 100;
    output.update(L(0.2, 0.2), sink);
    expect(sink.calls).toEqual([
      { kind: 'send', strong: 0.1, weak: 0.1, holdMs: 400 },
      { kind: 'send', strong: 0.2, weak: 0.2, holdMs: 400 },
      { kind: 'send', strong: 0.2, weak: 0.2, holdMs: 400 },
    ]);
  });

  test('sixty ticks of a moving envelope write at most once per 50 ms', () => {
    const { clock, output } = setup();
    const sink = new FakeSink();
    for (let tick = 0; tick < 60; tick++) {
      clock.t = 1000 + tick * (1000 / 60);
      output.update(L(((tick * 7) % 100) / 100 + 0.01, 0.3), sink);
    }
    // One second: the first write, then one per elapsed 50 ms window at most.
    expect(sink.sends).toBeLessThanOrEqual(21);
    expect(sink.sends).toBeGreaterThan(10);
  });
});
