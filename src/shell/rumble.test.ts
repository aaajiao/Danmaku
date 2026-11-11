import { describe, expect, test } from 'bun:test';

import { getHaptic } from '../haptics';
import { HapticMixer } from '../haptics/mixer';
import { HapticOutput } from '../haptics/output';
import type { HapticLevel, HapticSink } from '../haptics/types';
import type { RumbleSetting } from '../game/haptic-cues';
import { Rumble, rumbleTarget, type RumbleFrame, type RumblePads } from './rumble';

/** One pad's motors, as the driver left them. */
class FakeSink implements HapticSink {
  level: HapticLevel = { strong: 0, weak: 0 };
  sends = 0;
  stops = 0;

  send(level: HapticLevel): void {
    this.level = { strong: level.strong, weak: level.weak };
    this.sends++;
  }

  stop(): void {
    this.level = { strong: 0, weak: 0 };
    this.stops++;
  }

  get on(): boolean {
    return this.level.strong > 0 || this.level.weak > 0;
  }
}

class FakePads implements RumblePads {
  readonly sinks = new Map<number, FakeSink>([[0, new FakeSink()], [1, new FakeSink()]]);
  seenCapable = true;
  observed = 0;
  retried = 0;
  throwOnObserve = false;

  observe(): void {
    if (this.throwOnObserve) throw new Error('getter misbehaved');
    this.observed++;
  }

  sink(index: number | undefined): HapticSink | undefined {
    return index === undefined ? undefined : this.sinks.get(index);
  }

  retry(): void {
    this.retried++;
  }

  pad(index: number): FakeSink {
    const sink = this.sinks.get(index);
    if (!sink) throw new Error(`no fake pad ${index}`);
    return sink;
  }
}

const TICK_MS = 1000 / 60;

function setup(options: { setting?: RumbleSetting; supported?: boolean } = {}) {
  const clock = { t: 0 };
  const pads = new FakePads();
  const mixer = new HapticMixer();
  const warnings: unknown[] = [];
  const rumble = new Rumble({
    mixer,
    output: new HapticOutput({ now: () => clock.t }),
    pads,
    supported: options.supported ?? true,
    setting: options.setting ?? 'full',
    warn: (_message, error) => warnings.push(error),
  });
  const run = { name: 'the run being flown' };
  const base: RumbleFrame = {
    liveRun: run,
    paused: false,
    hidden: false,
    activePad: 0,
    lastPad: 0,
  };
  /** Advance `ticks` fixed ticks of wall time, one `step()` each. */
  const tick = (frame: Partial<RumbleFrame> = {}, ticks = 1): void => {
    for (let i = 0; i < ticks; i++) {
      clock.t += TICK_MS;
      rumble.step({ ...base, ...frame });
    }
  };
  return { clock, pads, mixer, rumble, run, tick, warnings };
}

function ticksOf(cue: string): number {
  const spec = getHaptic(cue);
  if (!spec) throw new Error(`cue ${cue} is not registered`);
  return spec.ticks;
}

describe('rumbleTarget', () => {
  test('the active pad wins, live or not', () => {
    expect(rumbleTarget(1, 0, true)).toBe(1);
    expect(rumbleTarget(1, 0, false)).toBe(1);
  });

  test('during live play a pad nobody is holding does not rumble', () => {
    // Keyboard player, idle pad on the desk: `activePad` is undefined.
    expect(rumbleTarget(undefined, 0, true)).toBeUndefined();
  });

  test('on menus the last pad used is enough', () => {
    expect(rumbleTarget(undefined, 0, false)).toBe(0);
    expect(rumbleTarget(undefined, undefined, false)).toBeUndefined();
  });
});

describe('Rumble: which pad', () => {
  test('a cue reaches the active pad and only that pad', () => {
    const { pads, rumble, tick } = setup();
    rumble.play('death');
    tick({ activePad: 1, lastPad: 1 });
    expect(pads.pad(1).on).toBe(true);
    expect(pads.pad(0).sends).toBe(0);
  });

  test('live play with hands off the pad drives nothing', () => {
    const { pads, rumble, tick } = setup();
    rumble.play('death');
    tick({ activePad: undefined, lastPad: 0 }, 10);
    expect(pads.pad(0).sends).toBe(0);
  });

  test('on a menu the test pulse reaches the last pad used', () => {
    const { pads, rumble, tick } = setup({ setting: 'low' });
    rumble.change('full');
    tick({ liveRun: undefined, activePad: undefined, lastPad: 0 });
    expect(pads.pad(0).on).toBe(true);
    expect(pads.retried).toBe(1);
  });

  test('a handover mid-cue stops the old pad and continues on the new one', () => {
    const { pads, rumble, tick } = setup();
    rumble.play('death');
    tick({ activePad: 0 }, 4);
    expect(pads.pad(0).on).toBe(true);
    tick({ activePad: 1, lastPad: 1 }, 4);
    expect(pads.pad(0).on).toBe(false);
    expect(pads.pad(1).on).toBe(true);
  });
});

describe('Rumble: pause freezes the envelope', () => {
  test('pausing stops the motor on that tick', () => {
    const { pads, rumble, tick } = setup();
    rumble.play('death');
    tick({}, 3);
    expect(pads.pad(0).on).toBe(true);
    tick({ paused: true });
    expect(pads.pad(0).on).toBe(false);
    tick({ paused: true }, 120);
    expect(pads.pad(0).on).toBe(false);
    expect(pads.pad(0).stops).toBe(1);
  });

  test('resuming the same run plays the REST of the cue, and no more', () => {
    const { mixer, pads, rumble, tick } = setup();
    const total = ticksOf('death');
    rumble.play('death');
    tick({}, 10);
    tick({ paused: true }, 200);
    // Frozen, not dropped: far longer than the cue, and it is still there.
    expect(mixer.active).toBe(true);
    tick({}, 4);
    expect(pads.pad(0).on).toBe(true);
    tick({}, total - 14);
    // The cue's last tick has been played; the tick after it is the zero.
    expect(mixer.active).toBe(false);
    tick();
    expect(pads.pad(0).on).toBe(false);
  });

  test('QUIT from pause: the run is gone, so its frozen cues are dropped', () => {
    const { mixer, pads, rumble, tick } = setup();
    rumble.play('death');
    tick({}, 5);
    tick({ paused: true }, 30);
    tick({ liveRun: undefined, activePad: 0 }, 10);
    expect(mixer.active).toBe(false);
    expect(pads.pad(0).on).toBe(false);
  });

  test('RETRY from pause: a different run comes back, and starts silent', () => {
    const { mixer, pads, rumble, tick } = setup();
    rumble.play('death');
    tick({}, 5);
    tick({ paused: true }, 30);
    tick({ liveRun: { name: 'the retried run' } }, 10);
    expect(mixer.active).toBe(false);
    expect(pads.pad(0).on).toBe(false);
  });

  test('pausing a replay and leaving it clears nothing it should not', () => {
    // No live run on either side of the pause: the menu pulse survives.
    const { mixer, rumble, tick } = setup();
    tick({ liveRun: undefined, paused: true }, 5);
    rumble.change('low');
    tick({ liveRun: undefined }, 1);
    expect(mixer.active).toBe(true);
  });
});

describe('Rumble: a hidden page', () => {
  test('silence() stops the motor at once and keeps the cue', () => {
    const { mixer, pads, rumble, tick } = setup();
    rumble.play('death');
    tick({}, 3);
    rumble.silence();
    expect(pads.pad(0).on).toBe(false);
    expect(mixer.active).toBe(true);
  });

  test('a tick that still runs while hidden does not re-write the level', () => {
    const { pads, rumble, tick } = setup();
    rumble.play('death');
    tick({}, 3);
    rumble.silence();
    const sends = pads.pad(0).sends;
    tick({ hidden: true }, 10);
    expect(pads.pad(0).sends).toBe(sends);
    expect(pads.pad(0).on).toBe(false);
  });

  test('back in view, the rest of the cue plays', () => {
    const { pads, rumble, tick } = setup();
    rumble.play('death');
    tick({}, 3);
    rumble.silence();
    tick({ hidden: true }, 2);
    tick({}, 4);
    expect(pads.pad(0).on).toBe(true);
  });
});

describe('Rumble: the setting', () => {
  test('off: cues do not start, and nothing is driven', () => {
    const { mixer, pads, rumble, tick } = setup({ setting: 'off' });
    expect(rumble.enabled).toBe(false);
    rumble.play('death');
    tick({}, 5);
    expect(mixer.active).toBe(false);
    expect(pads.pad(0).sends).toBe(0);
  });

  test('switching off mid-cue stops the motor once and drops the cue', () => {
    const { mixer, pads, rumble, tick } = setup();
    rumble.play('death');
    tick({}, 3);
    rumble.change('off');
    expect(pads.pad(0).on).toBe(false);
    expect(mixer.active).toBe(false);
    tick({}, 5);
    expect(pads.pad(0).stops).toBe(1);
    expect(rumble.setting).toBe('off');
  });

  test('low halves what full sends', () => {
    const full = setup({ setting: 'full' });
    full.rumble.play('ui-test');
    full.tick();
    const low = setup({ setting: 'low' });
    low.rumble.play('ui-test');
    low.tick();
    expect(low.pads.pad(0).level.strong).toBeCloseTo(full.pads.pad(0).level.strong / 2, 2);
    expect(low.pads.pad(0).level.weak).toBeCloseTo(full.pads.pad(0).level.weak / 2, 2);
  });

  test('the stored setting applies from construction, with no pulse', () => {
    const { mixer, rumble } = setup({ setting: 'low' });
    expect(rumble.setting).toBe('low');
    expect(mixer.gain).toBe(0.5);
    expect(mixer.active).toBe(false);
  });

  test('pads are observed whatever the setting: the crash-recovery reset must run', () => {
    const { pads, tick } = setup({ setting: 'off' });
    tick({}, 3);
    expect(pads.observed).toBe(3);
  });
});

describe('Rumble: surface and failure', () => {
  test('surface follows whether a capable pad has been seen', () => {
    const { pads, rumble } = setup();
    pads.seenCapable = false;
    expect(rumble.surface).toBe(false);
    pads.seenCapable = true;
    expect(rumble.surface).toBe(true);
  });

  test('unsupported: nothing is ever called', () => {
    const { mixer, pads, rumble, tick } = setup({ supported: false });
    expect(rumble.enabled).toBe(false);
    expect(rumble.surface).toBe(false);
    rumble.play('death');
    rumble.change('low');
    rumble.silence();
    tick({}, 3);
    expect(pads.observed).toBe(0);
    expect(mixer.active).toBe(false);
  });

  test('a throw at the device boundary disables rumble, warns once, and never escapes', () => {
    const { pads, rumble, tick, warnings } = setup();
    rumble.play('death');
    tick({}, 2);
    pads.throwOnObserve = true;
    expect(() => tick({}, 3)).not.toThrow();
    expect(warnings.length).toBe(1);
    expect(rumble.enabled).toBe(false);
    expect(rumble.surface).toBe(false);
    expect(pads.pad(0).on).toBe(false);
    // Stays off even when the device recovers: one failure is the session's.
    pads.throwOnObserve = false;
    rumble.play('death');
    tick({}, 3);
    expect(pads.pad(0).on).toBe(false);
  });
});
