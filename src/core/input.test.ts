import { afterEach, describe, expect, test } from 'bun:test';
import {
  Button,
  Input,
  PAD_HANDOVER_SAMPLES,
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

/**
 * Install a pad list. `null` entries make a sparse array, exactly as the
 * Gamepad API reports empty slots. Fixtures carry no `index`: Input must take
 * a pad's slot from its array position.
 */
function stubPads(...pads: (Gamepad | null)[]): void {
  navigator.getGamepads = () => pads;
}

/** A slot whose pad has gone away but whose object is still reported. */
function unplugged(): Gamepad {
  return { connected: false, buttons: [], axes: [] } as unknown as Gamepad;
}

/** An event-fed source whose per-tick mask the test sets directly. */
function scriptedSource(isGamepad?: boolean) {
  let current: Buttons = 0;
  let consumes = 0;
  const base = {
    consume(): Buttons {
      consumes++;
      return current;
    },
    reset(): void {
      current = 0;
    },
  };
  const digital: DigitalInputSource = isGamepad === undefined
    ? base
    : Object.assign(base, { isGamepad });
  return {
    digital,
    set: (next: Buttons) => { current = next; },
    consumes: () => consumes,
  };
}

const ALL_BUTTONS: readonly number[] = Object.values(Button);

/** Every button's `pressed` / `released` edge folded into two masks. */
function edgeMasks(input: Input): readonly [Buttons, Buttons] {
  let pressed = 0;
  let released = 0;
  for (const bit of ALL_BUTTONS) {
    if (input.pressed(bit)) pressed |= bit;
    if (input.released(bit)) released |= bit;
  }
  return [pressed, released];
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

// The mask `sample()` returns is the replay contract (CLAUDE.md, rule 4). Rumble
// targeting was added inside `sample()`; this table pins that the mask, the
// latch and the pressed/released edges are bit-identical to the logic before
// it. Columns 1–3 were computed BY HAND from the pre-change `sample()` /
// `#pollPads()` (Left 1, Right 2, Up 4, Down 8, Shot 16, Bomb 32, Slow 64,
// Start 128) and are written literally — never regenerate them from the code
// under test. Columns 4–5 are the new presentation-only getters.
describe('sample() is unchanged by pad tracking (differential)', () => {
  test('a scripted run reproduces the pre-change masks and edges exactly', () => {
    let polls = 0;
    const install = (...pads: (Gamepad | null)[]) => {
      navigator.getGamepads = () => {
        polls++;
        return pads;
      };
    };
    const offPad = scriptedSource(); // pointer/touch-like: no isGamepad
    const mirror = scriptedSource(true); // the WebHID mirror
    const { input, down, up } = harness([offPad.digital, mirror.digital]);

    const steps: readonly (() => void)[] = [
      // 1. API present, no pads at all.
      () => install(),
      // 2. Sparse array: slot 0 empty, slot 1 holds A.
      () => install(null, pad([0])),
      // 3. Keyboard + two pads in one sample (slot 2's stick past the deadzone).
      () => {
        down('ArrowLeft');
        install(null, pad([0]), pad([], [0.6, 0]));
      },
      // 4. A tap shorter than a sample, while slot 1 disconnects mid-run.
      () => {
        down('KeyX');
        up('KeyX');
        install(null, unplugged(), pad([13]));
      },
      // 5. Non-pad source joins; slot 1 now reported as null.
      () => {
        offPad.set(Button.Slow);
        install(null, null, pad([13]));
      },
      // 6. WebHID mirror joins; keyboard released.
      () => {
        mirror.set(Button.Start);
        up('ArrowLeft');
      },
      // 7. The Gamepad API vanishes entirely.
      () => {
        delete (navigator as { getGamepads?: unknown }).getGamepads;
      },
      // 8. Double tap + auto-repeat between samples; stick exactly on the deadzone.
      () => {
        offPad.set(0);
        mirror.set(0);
        down('ArrowUp');
        up('ArrowUp');
        down('ArrowUp');
        up('ArrowUp');
        down('Space');
        down('Space', true);
        install(pad([], [0.49, -0.5]));
      },
      // 9. Everything released; the pad stays connected but idle.
      () => {
        up('Space');
        install(pad([], [0, 0]));
      },
      // 10. Keyboard and a source press the same bit the pad holds.
      () => {
        down('KeyZ');
        offPad.set(Button.Shot);
        install(pad([0]));
      },
      // 11. reset() between samples (key still physically down).
      () => input.reset(),
      // 12. Two pads again, with a gap; stick diagonal on the later one.
      () => install(pad([1]), null, pad([], [-0.7, 0.7])),
      // 13. The array shrinks; both sources contribute.
      () => {
        mirror.set(Button.Up);
        offPad.set(Button.Right);
        install(pad([1]));
      },
    ];

    const got = steps.map((step) => {
      step();
      const mask = input.sample();
      const [pressed, released] = edgeMasks(input);
      return [mask, pressed, released, input.lastGamepad, input.activeGamepad];
    });

    //   mask  pressed  released  lastGamepad  activeGamepad
    expect(got).toEqual([
      [0, 0, 0, undefined, undefined],
      [16, 16, 0, 1, 1],
      [19, 3, 0, 2, 2],
      [41, 40, 18, 2, 2],
      [73, 64, 32, 2, 2],
      [200, 128, 1, 2, 2],
      [192, 0, 8, undefined, undefined],
      [132, 4, 64, 0, 0],
      [0, 0, 132, 0, 0],
      [16, 16, 0, 0, 0],
      [16, 16, 0, 0, 0],
      [41, 41, 16, 2, 2],
      [38, 6, 9, 0, 0],
    ]);
    // Exactly one consume() per source and one getGamepads() per sample
    // (step 7 had no API to call).
    expect(offPad.consumes()).toBe(13);
    expect(mirror.consumes()).toBe(13);
    expect(polls).toBe(12);
  });
});

describe('lastGamepad', () => {
  test('is the array position of the contributing pad, not a pad.index', () => {
    stubPads(null, null, pad([0]));
    const { input } = harness();
    expect(input.lastGamepad).toBeUndefined();
    input.sample();
    expect(input.lastGamepad).toBe(2);
  });

  test('a stick past the deadzone counts as contributing', () => {
    stubPads(null, pad([], [0, -0.9]));
    const { input } = harness();
    input.sample();
    expect(input.lastGamepad).toBe(1);
  });

  test('a connected pad at rest contributes nothing and claims nothing', () => {
    stubPads(pad([]), pad([], [0.49, 0.49]));
    const { input } = harness();
    input.sample();
    expect(input.lastGamepad).toBeUndefined();
  });

  test('when two pads contribute in one sample the later slot wins', () => {
    stubPads(pad([0]), null, pad([1]));
    const { input } = harness();
    input.sample();
    expect(input.lastGamepad).toBe(2);
  });

  test('survives the pad going idle while still connected', () => {
    stubPads(null, pad([0]));
    const { input } = harness();
    input.sample();
    stubPads(null, pad([]));
    for (let i = 0; i < 100; i++) input.sample();
    expect(input.lastGamepad).toBe(1);
  });

  test('is cleared when its slot becomes null', () => {
    stubPads(null, pad([0]));
    const { input } = harness();
    input.sample();
    stubPads(null, null);
    input.sample();
    expect(input.lastGamepad).toBeUndefined();
  });

  test('is cleared when its slot reports disconnected', () => {
    stubPads(pad([0]));
    const { input } = harness();
    input.sample();
    stubPads(unplugged());
    input.sample();
    expect(input.lastGamepad).toBeUndefined();
  });

  test('is cleared when the array shrinks past its slot or the API vanishes', () => {
    stubPads(null, pad([0]));
    const { input } = harness();
    input.sample();
    stubPads(pad([]));
    input.sample();
    expect(input.lastGamepad).toBeUndefined();

    stubPads(pad([0]));
    input.sample();
    expect(input.lastGamepad).toBe(0);
    delete (navigator as { getGamepads?: unknown }).getGamepads;
    input.sample();
    expect(input.lastGamepad).toBeUndefined();
  });

  test('another pad disconnecting does not clear it', () => {
    stubPads(pad([0]), pad([]));
    const { input } = harness();
    input.sample();
    stubPads(pad([]), unplugged());
    input.sample();
    expect(input.lastGamepad).toBe(0);
  });

  test('moves to whichever pad contributes next', () => {
    stubPads(pad([0]), pad([]));
    const { input } = harness();
    input.sample();
    stubPads(pad([]), pad([12]));
    input.sample();
    expect(input.lastGamepad).toBe(1);
  });
});

describe('activeGamepad handover', () => {
  /** Pad 1 contributes once, then stays connected but at rest. */
  function playedPad(sources: readonly DigitalInputSource[] = []) {
    stubPads(null, pad([0]));
    const h = harness(sources);
    h.input.sample();
    stubPads(null, pad([]));
    return h;
  }

  test('follows lastGamepad while the player is on the pad', () => {
    const { input } = playedPad();
    expect(input.activeGamepad).toBe(1);
    for (let i = 0; i < 200; i++) input.sample();
    expect(input.activeGamepad).toBe(1);
  });

  test('keyboard hands it away only after the pad has idled PAD_HANDOVER_SAMPLES', () => {
    const { input, down } = playedPad();
    down('ArrowLeft');
    for (let i = 1; i < PAD_HANDOVER_SAMPLES; i++) {
      input.sample();
      expect(input.activeGamepad).toBe(1);
    }
    input.sample(); // the PAD_HANDOVER_SAMPLES-th idle sample
    expect(input.activeGamepad).toBeUndefined();
    // lastGamepad is untouched: the pad is still there to fall back on.
    expect(input.lastGamepad).toBe(1);
  });

  test('a stray tap inside the window does not hand it away later', () => {
    const { input, down, up } = playedPad();
    input.sample();
    down('KeyZ');
    up('KeyZ');
    input.sample();
    for (let i = 0; i < 3 * PAD_HANDOVER_SAMPLES; i++) input.sample();
    expect(input.activeGamepad).toBe(1);
  });

  test('keyboard and pad in the same sample keep it on the pad', () => {
    stubPads(null, pad([0]));
    const { input, down } = harness();
    down('ArrowLeft');
    for (let i = 0; i < 3 * PAD_HANDOVER_SAMPLES; i++) input.sample();
    expect(input.activeGamepad).toBe(1);
  });

  test('returns to the pad the next time any pad contributes', () => {
    const { input, down } = playedPad();
    down('ArrowLeft');
    for (let i = 0; i < PAD_HANDOVER_SAMPLES; i++) input.sample();
    expect(input.activeGamepad).toBeUndefined();

    stubPads(null, pad([], [0.8, 0]));
    input.sample();
    expect(input.activeGamepad).toBe(1);

    // ...and to a different pad, if that one is the one now in use.
    stubPads(null, pad([]));
    for (let i = 0; i < PAD_HANDOVER_SAMPLES; i++) input.sample();
    expect(input.activeGamepad).toBeUndefined();
    stubPads(pad([9]), pad([]));
    input.sample();
    expect(input.activeGamepad).toBe(0);
  });

  test('a non-gamepad source (pointer, touch) hands it away like the keyboard', () => {
    const offPad = scriptedSource();
    const { input } = playedPad([offPad.digital]);
    offPad.set(Button.Right);
    for (let i = 1; i < PAD_HANDOVER_SAMPLES; i++) input.sample();
    expect(input.activeGamepad).toBe(1);
    input.sample();
    expect(input.activeGamepad).toBeUndefined();
  });

  // The guarantee the WebHID flag exists for: the same pad mirrored through
  // WebHID keeps producing input while the standard path is idle, and must
  // never be read as the player's hands having left the pad.
  test('an isGamepad source never hands it away', () => {
    const mirror = scriptedSource(true);
    const { input } = playedPad([mirror.digital]);
    mirror.set(Button.Shot | Button.Left);
    for (let i = 0; i < 10 * PAD_HANDOVER_SAMPLES; i++) {
      input.sample();
      expect(input.activeGamepad).toBe(1);
    }
  });

  // Detector for the test above: the same script without the flag DOES hand
  // over, so that test passes because of `isGamepad`, not because the
  // handover never fires.
  test('the same source without the flag does hand it away', () => {
    const unflagged = scriptedSource(false);
    const { input } = playedPad([unflagged.digital]);
    unflagged.set(Button.Shot | Button.Left);
    for (let i = 0; i < 10 * PAD_HANDOVER_SAMPLES; i++) input.sample();
    expect(input.activeGamepad).toBeUndefined();
  });

  test('reset() clears neither getter; override() touches neither', () => {
    const { input, down } = playedPad();
    input.reset();
    expect(input.lastGamepad).toBe(1);
    expect(input.activeGamepad).toBe(1);

    down('ArrowLeft');
    for (let i = 0; i < PAD_HANDOVER_SAMPLES; i++) input.sample();
    expect(input.activeGamepad).toBeUndefined();
    input.reset();
    expect(input.activeGamepad).toBeUndefined();
    expect(input.lastGamepad).toBe(1);

    stubPads(null, pad([0]));
    input.sample();
    input.override(0);
    input.override(Button.Bomb);
    expect(input.activeGamepad).toBe(1);
    expect(input.lastGamepad).toBe(1);
  });
});
