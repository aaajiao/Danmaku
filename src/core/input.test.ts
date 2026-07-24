import { afterEach, describe, expect, test } from 'bun:test';
import {
  Button,
  Input,
  type Buttons,
  type DigitalInputSource,
} from './input';

/** Minimal stand-in for a KeyboardEvent — only the fields Input reads. */
function keyEvent(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  const e = new Event(type);
  Object.assign(e, { code, repeat });
  return e;
}

function harness(sources: readonly DigitalInputSource[] = []) {
  const target = new EventTarget();
  const input = new Input(sources);
  input.attach(target);
  return {
    input,
    down: (code: string, repeat = false) =>
      target.dispatchEvent(keyEvent('keydown', code, repeat)),
    up: (code: string) => target.dispatchEvent(keyEvent('keyup', code)),
  };
}

const realGetGamepads = navigator.getGamepads;

afterEach(() => {
  if (realGetGamepads) {
    navigator.getGamepads = realGetGamepads;
  } else {
    delete (navigator as { getGamepads?: unknown }).getGamepads;
  }
});

/** Build a gamepad-shaped object with the given pressed indices and axes. */
function pad(pressed: number[], axes: number[] = [0, 0]): Gamepad {
  const buttons = Array.from({ length: 16 }, (_, i) => ({
    pressed: pressed.includes(i),
    touched: false,
    value: 0,
  }));
  return { connected: true, buttons, axes } as unknown as Gamepad;
}

function stubPads(...pads: Gamepad[]): void {
  navigator.getGamepads = () => pads;
}

describe('keyboard', () => {
  test('a held key stays set across ticks', () => {
    const { input, down } = harness();
    down('ArrowLeft');

    expect(input.sample() & Button.Left).toBeTruthy();
    expect(input.sample() & Button.Left).toBeTruthy();
  });

  test('release clears the bit on the next sample', () => {
    const { input, down, up } = harness();
    down('ArrowLeft');
    input.sample();

    up('ArrowLeft');
    expect(input.sample() & Button.Left).toBeFalsy();
  });

  // The reason #latched exists: a press and release that both land between two
  // ticks must still reach the simulation, or taps get silently dropped.
  test('a tap entirely between two ticks is still seen for one tick', () => {
    const { input, down, up } = harness();
    input.sample();

    down('KeyX');
    up('KeyX');

    expect(input.sample() & Button.Bomb).toBeTruthy();
    expect(input.sample() & Button.Bomb).toBeFalsy();
  });

  test('a latched tap reports as pressed exactly once', () => {
    const { input, down, up } = harness();
    input.sample();

    down('KeyZ');
    up('KeyZ');

    input.sample();
    expect(input.pressed(Button.Shot)).toBe(true);
    input.sample();
    expect(input.pressed(Button.Shot)).toBe(false);
  });

  test('OS auto-repeat does not re-latch a held key', () => {
    const { input, down, up } = harness();
    down('KeyZ');
    input.sample();

    // Auto-repeat fires while held, then the key is genuinely released.
    down('KeyZ', true);
    up('KeyZ');

    // Released before the next sample, so it must read as up — the repeat
    // events must not have latched it back on.
    expect(input.sample() & Button.Shot).toBeFalsy();
  });

  test('unmapped keys are ignored', () => {
    const { input, down } = harness();
    down('KeyQ');
    expect(input.sample()).toBe(0);
  });
});

describe('gamepad', () => {
  test('no gamepad API is not an error', () => {
    delete (navigator as { getGamepads?: unknown }).getGamepads;
    const { input } = harness();
    expect(input.sample()).toBe(0);
  });

  test('disconnected and null slots are skipped', () => {
    navigator.getGamepads = () =>
      [null, { connected: false, buttons: [], axes: [] }] as unknown as Gamepad[];
    const { input } = harness();
    expect(input.sample()).toBe(0);
  });

  test('d-pad maps to directions', () => {
    stubPads(pad([12, 15]));
    const { input } = harness();
    const b = input.sample();
    expect(b & Button.Up).toBeTruthy();
    expect(b & Button.Right).toBeTruthy();
    expect(b & Button.Down).toBeFalsy();
  });

  test('face buttons map to shot and bomb', () => {
    stubPads(pad([0, 1]));
    const { input } = harness();
    const b = input.sample();
    expect(b & Button.Shot).toBeTruthy();
    expect(b & Button.Bomb).toBeTruthy();
  });

  // Analog values must never reach the sim; they are quantized here so the
  // same physical input always yields the same mask.
  test('stick inside the deadzone reads as centred', () => {
    stubPads(pad([], [0.49, -0.49]));
    const { input } = harness();
    expect(input.sample()).toBe(0);
  });

  test('stick past the deadzone quantizes to a direction', () => {
    stubPads(pad([], [-0.8, 0.9]));
    const { input } = harness();
    const b = input.sample();
    expect(b & Button.Left).toBeTruthy();
    expect(b & Button.Down).toBeTruthy();
  });

  test('deadzone boundary is inclusive and stable', () => {
    stubPads(pad([], [0.5, 0]));
    const { input } = harness();
    expect(input.sample() & Button.Right).toBeTruthy();
  });

  test('keyboard and gamepad combine', () => {
    stubPads(pad([0]));
    const { input, down } = harness();
    down('ArrowLeft');
    const b = input.sample();
    expect(b & Button.Shot).toBeTruthy();
    expect(b & Button.Left).toBeTruthy();
  });
});

describe('event-fed digital sources', () => {
  function source(buttons: Buttons) {
    let current = buttons;
    let consumes = 0;
    let resets = 0;
    const digital: DigitalInputSource = {
      consume() {
        consumes++;
        return current;
      },
      reset() {
        resets++;
        current = 0;
      },
    };
    return {
      digital,
      set: (next: Buttons) => { current = next; },
      consumes: () => consumes,
      resets: () => resets,
    };
  }

  test('keyboard, standard gamepad, and an event-fed source combine', () => {
    stubPads(pad([0]));
    const external = source(Button.Bomb);
    const { input, down } = harness([external.digital]);
    down('ArrowLeft');

    const buttons = input.sample();
    expect(buttons & Button.Left).toBeTruthy();
    expect(buttons & Button.Shot).toBeTruthy();
    expect(buttons & Button.Bomb).toBeTruthy();
  });

  test('each source is consumed exactly once per tick', () => {
    const first = source(Button.Left);
    const second = source(Button.Right);
    const { input } = harness([first.digital, second.digital]);

    input.sample();
    input.sample();

    expect(first.consumes()).toBe(2);
    expect(second.consumes()).toBe(2);
  });

  test('reset clears every source before the next sample', () => {
    const external = source(Button.Bomb);
    const { input } = harness([external.digital]);
    expect(input.sample() & Button.Bomb).toBeTruthy();

    input.reset();

    expect(external.resets()).toBe(1);
    expect(input.sample() & Button.Bomb).toBeFalsy();
  });
});

describe('reset', () => {
  // The reset this guards: a latched tap held into game over must not survive
  // into tick 0 of the next run.
  test('a latched tap does not survive a reset', () => {
    const { input, down, up } = harness();
    input.sample();

    down('KeyX');
    up('KeyX');
    input.reset();

    expect(input.sample() & Button.Bomb).toBeFalsy();
  });

  test('a held key does not survive a reset', () => {
    const { input, down } = harness();
    down('ArrowLeft');
    input.sample();

    input.reset();

    expect(input.sample() & Button.Left).toBeFalsy();
  });

  // #previous must be cleared too, or the tick after a reset can compute a
  // pressed/released edge against state from before the reset rather than
  // against genuine silence.
  test('edge detection does not fire spuriously on the tick after a reset', () => {
    const { input, down } = harness();
    down('ArrowUp');
    input.sample();
    input.sample();

    input.reset();

    input.sample();
    expect(input.pressed(Button.Up)).toBe(false);
    expect(input.released(Button.Up)).toBe(false);
  });

  test('a genuine press after a reset is still detected as pressed', () => {
    const { input, down } = harness();
    down('ArrowUp');
    input.sample();
    input.reset();

    down('ArrowRight');
    input.sample();
    expect(input.pressed(Button.Right)).toBe(true);
  });
});

describe('replay override', () => {
  test('override replaces live input', () => {
    const { input, down } = harness();
    down('ArrowLeft');

    input.override(Button.Right);
    expect(input.held(Button.Right)).toBe(true);
    expect(input.held(Button.Left)).toBe(false);
  });

  test('override preserves edge detection across ticks', () => {
    const { input } = harness();
    input.override(0);
    input.override(Button.Bomb);
    expect(input.pressed(Button.Bomb)).toBe(true);
    input.override(Button.Bomb);
    expect(input.pressed(Button.Bomb)).toBe(false);
    input.override(0);
    expect(input.released(Button.Bomb)).toBe(true);
  });
});
