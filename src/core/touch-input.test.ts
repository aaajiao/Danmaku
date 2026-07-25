import { describe, expect, test } from 'bun:test';
import { Button, Input } from './input';
import {
  TOUCH_STICK_DEADZONE,
  TouchInput,
  type TouchStickSurface,
} from './touch-input';

interface PointerInit {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly button?: number;
  readonly pointerType?: string;
}

interface TouchInit {
  readonly identifier: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

class Surface extends EventTarget implements TouchStickSurface {
  readonly captures = new Set<number>();
  readonly captureCalls: number[] = [];
  readonly releaseCalls: number[] = [];
  captureFails = false;
  rect = { left: 100, top: 50, width: 200, height: 200 };

  getBoundingClientRect() {
    return this.rect;
  }

  setPointerCapture(pointerId: number): void {
    if (this.captureFails) throw new Error('capture unavailable');
    this.captureCalls.push(pointerId);
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.releaseCalls.push(pointerId);
    this.captures.delete(pointerId);
  }

  pointer(
    type: 'pointerdown'
      | 'pointermove'
      | 'pointerup'
      | 'pointercancel'
      | 'lostpointercapture',
    pointerId: number,
    init: PointerInit = {},
  ): Event {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      pointerId,
      clientX: init.clientX ?? 200,
      clientY: init.clientY ?? 150,
      button: init.button ?? 0,
      pointerType: init.pointerType ?? '',
    });
    this.dispatchEvent(event);
    if (
      type === 'pointerup'
      || type === 'pointercancel'
      || type === 'lostpointercapture'
    ) {
      this.captures.delete(pointerId);
    }
    return event;
  }

  touch(
    type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
    touches: readonly TouchInit[],
  ): Event {
    const event = new Event(type, { cancelable: true });
    const changed = touches.map((touch) => ({
      identifier: touch.identifier,
      clientX: touch.clientX ?? 200,
      clientY: touch.clientY ?? 150,
    }));
    Object.assign(event, {
      changedTouches: {
        length: changed.length,
        item: (index: number) => changed[index] ?? null,
      },
    });
    this.dispatchEvent(event);
    return event;
  }

  click(detail: number): Event {
    const event = new Event('click', { cancelable: true });
    Object.assign(event, { detail });
    this.dispatchEvent(event);
    return event;
  }
}

function stickPoint(x: number, y: number): PointerInit {
  return { clientX: 100 + x * 200, clientY: 50 + y * 200 };
}

describe('touch stick', () => {
  test('quantizes cardinal and diagonal sectors into digital directions', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 1, stickPoint(0.95, 0.5));
    expect(touch.consume()).toBe(Button.Right);

    surface.pointer('pointermove', 1, stickPoint(0.95, 0.05));
    expect(touch.consume()).toBe(Button.Right | Button.Up);

    surface.pointer('pointermove', 1, stickPoint(0.5, 0.05));
    expect(touch.consume()).toBe(Button.Up);
  });

  test('uses a fixed central deadzone on a scaled surface', () => {
    const surface = new Surface();
    surface.rect = { left: 10, top: 20, width: 400, height: 100 };
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 1, {
      clientX: 10 + 200 + 200 * TOUCH_STICK_DEADZONE,
      clientY: 20 + 50,
    });
    expect(touch.consume()).toBe(0);

    surface.pointer('pointermove', 1, {
      clientX: 10 + 200 + 200 * (TOUCH_STICK_DEADZONE + 0.001),
      clientY: 20 + 50,
    });
    expect(touch.consume()).toBe(Button.Right);
  });

  test('overwrites a travelled direction instead of OR-latching the route', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 7, stickPoint(0.05, 0.5));
    surface.pointer('pointermove', 7, stickPoint(0.95, 0.5));
    surface.pointer('pointerup', 7);

    expect(touch.consume()).toBe(Button.Right);
    expect(touch.consume()).toBe(0);
  });

  test('latches a sub-tick direction tap once for menu navigation', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 4, stickPoint(0.5, 0.05));
    surface.pointer('pointerup', 4);

    expect(touch.consume()).toBe(Button.Up);
    expect(touch.consume()).toBe(0);
  });

  test('returning to centre cancels an unsampled direction', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 4, stickPoint(0.5, 0.05));
    surface.pointer('pointermove', 4, stickPoint(0.5, 0.5));
    surface.pointer('pointerup', 4);

    expect(touch.consume()).toBe(0);
  });

  test('a sampled held direction persists but release does not re-latch it', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 2, stickPoint(0.5, 0.95));
    expect(touch.consume()).toBe(Button.Down);
    expect(touch.consume()).toBe(Button.Down);

    surface.pointer('pointerup', 2);
    expect(touch.consume()).toBe(0);
  });

  test('the latest stick pointer owns the current direction', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 1, stickPoint(0.05, 0.5));
    expect(touch.consume()).toBe(Button.Left);
    surface.pointer('pointerdown', 2, stickPoint(0.95, 0.5));
    expect(touch.consume()).toBe(Button.Right);

    surface.pointer('pointerup', 2);
    expect(touch.consume()).toBe(Button.Left);
    surface.pointer('pointerup', 1);
    expect(touch.consume()).toBe(0);
  });

  test('invalid geometry and secondary mouse presses do not claim the stick', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.rect.width = 0;
    surface.pointer('pointerdown', 1, stickPoint(0.95, 0.5));
    surface.rect.width = 200;
    surface.pointer('pointerdown', 2, {
      ...stickPoint(0.95, 0.5),
      button: 2,
    });

    expect(touch.consume()).toBe(0);
    expect(surface.captureCalls).toEqual([]);
  });

  test('legacy Touch Events steer and release without Pointer Events', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    const down = surface.touch('touchstart', [
      { identifier: 4, ...stickPoint(0.95, 0.05) },
    ]);
    expect(down.defaultPrevented).toBe(true);
    expect(touch.consume()).toBe(Button.Right | Button.Up);
    expect(touch.consume()).toBe(Button.Right | Button.Up);

    surface.touch('touchmove', [
      { identifier: 4, ...stickPoint(0.5, 0.95) },
    ]);
    expect(touch.consume()).toBe(Button.Down);
    surface.touch('touchend', [{ identifier: 4 }]);
    expect(touch.consume()).toBe(0);
  });

  test('either end stream releases a dual pointer/touch contact', () => {
    const surface = new Surface();
    const touch = new TouchInput();
    touch.attachStick(surface);

    surface.pointer('pointerdown', 10, {
      ...stickPoint(0.95, 0.5),
      pointerType: 'touch',
    });
    surface.touch('touchstart', [
      { identifier: 10, ...stickPoint(0.95, 0.5) },
    ]);
    expect(touch.consume()).toBe(Button.Right);
    surface.touch('touchend', [{ identifier: 10 }]);
    expect(touch.consume()).toBe(0);

    surface.pointer('pointerdown', 11, {
      ...stickPoint(0.05, 0.5),
      pointerType: 'touch',
    });
    surface.touch('touchstart', [
      { identifier: 11, ...stickPoint(0.05, 0.5) },
    ]);
    expect(touch.consume()).toBe(Button.Left);
    surface.pointer('pointerup', 11, { pointerType: 'touch' });
    expect(touch.consume()).toBe(0);
  });
});

describe('touch actions', () => {
  test('A, B, and Start merge as held digital action bits', () => {
    const a = new Surface();
    const b = new Surface();
    const start = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);
    touch.attachAction(b, Button.Bomb);
    touch.attachAction(start, Button.Start);

    a.pointer('pointerdown', 10);
    b.pointer('pointerdown', 11);
    start.pointer('pointerdown', 12);
    expect(touch.consume()).toBe(Button.Shot | Button.Bomb | Button.Start);
    expect(touch.consume()).toBe(Button.Shot | Button.Bomb | Button.Start);

    a.pointer('pointerup', 10);
    b.pointer('pointerup', 11);
    start.pointer('pointerup', 12);
    expect(touch.consume()).toBe(0);
  });

  test('a press and release between ticks is latched exactly once', () => {
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);

    const down = a.pointer('pointerdown', 3);
    a.pointer('pointerup', 3);

    expect(down.defaultPrevented).toBe(true);
    expect(a.captureCalls).toEqual([3]);
    expect(a.releaseCalls).toEqual([3]);
    expect(touch.consume()).toBe(Button.Shot);
    expect(touch.consume()).toBe(0);
  });

  test('multiple pointers holding the same bit use reference semantics', () => {
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);

    a.pointer('pointerdown', 1);
    expect(touch.consume()).toBe(Button.Shot);
    a.pointer('pointerdown', 2);
    expect(touch.consume()).toBe(Button.Shot);

    a.pointer('pointerup', 1);
    expect(touch.consume()).toBe(Button.Shot);
    a.pointer('pointerup', 2);
    expect(touch.consume()).toBe(0);
  });

  test('two surfaces mapped to the same bit do not release each other', () => {
    const first = new Surface();
    const second = new Surface();
    const touch = new TouchInput();
    touch.attachAction(first, Button.Bomb);
    touch.attachAction(second, Button.Bomb);

    first.pointer('pointerdown', 1);
    second.pointer('pointerdown', 2);
    expect(touch.consume()).toBe(Button.Bomb);
    first.pointer('pointerup', 1);
    expect(touch.consume()).toBe(Button.Bomb);
    second.pointer('pointerup', 2);
    expect(touch.consume()).toBe(0);
  });

  test('pointercancel and lost capture clear held actions without losing taps', () => {
    const a = new Surface();
    const b = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);
    touch.attachAction(b, Button.Bomb);

    a.pointer('pointerdown', 1);
    a.pointer('pointercancel', 1);
    expect(touch.consume()).toBe(Button.Shot);
    expect(touch.consume()).toBe(0);

    b.pointer('pointerdown', 2);
    expect(touch.consume()).toBe(Button.Bomb);
    b.pointer('lostpointercapture', 2);
    expect(touch.consume()).toBe(0);
  });

  test('ordinary pointer click does not double-latch, but detail-zero click does', () => {
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);

    a.pointer('pointerdown', 1);
    a.pointer('pointerup', 1);
    a.click(1);
    expect(touch.consume()).toBe(Button.Shot);
    expect(touch.consume()).toBe(0);

    const accessibleClick = a.click(0);
    expect(accessibleClick.defaultPrevented).toBe(true);
    expect(touch.consume()).toBe(Button.Shot);
    expect(touch.consume()).toBe(0);
  });

  test('legacy Touch Events latch and hold an action', () => {
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);

    const down = a.touch('touchstart', [{ identifier: 8 }]);
    expect(down.defaultPrevented).toBe(true);
    expect(touch.consume()).toBe(Button.Shot);
    expect(touch.consume()).toBe(Button.Shot);

    a.touch('touchend', [{ identifier: 8 }]);
    expect(touch.consume()).toBe(0);
  });

  test('a browser emitting both touch and pointer events still latches once', () => {
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);

    a.pointer('pointerdown', 1, { pointerType: 'touch' });
    a.touch('touchstart', [{ identifier: 1 }]);
    a.pointer('pointerup', 1);
    a.touch('touchend', [{ identifier: 1 }]);

    expect(touch.consume()).toBe(Button.Shot);
    expect(touch.consume()).toBe(0);
  });

  test('either end stream releases a dual action contact', () => {
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachAction(a, Button.Shot);

    a.pointer('pointerdown', 2, { pointerType: 'touch' });
    a.touch('touchstart', [{ identifier: 2 }]);
    expect(touch.consume()).toBe(Button.Shot);
    a.touch('touchend', [{ identifier: 2 }]);
    expect(touch.consume()).toBe(0);

    a.pointer('pointerdown', 3, { pointerType: 'touch' });
    a.touch('touchstart', [{ identifier: 3 }]);
    expect(touch.consume()).toBe(Button.Shot);
    a.pointer('pointerup', 3, { pointerType: 'touch' });
    expect(touch.consume()).toBe(0);
  });

  test('rejects every non-action bit at the runtime boundary', () => {
    const surface = new Surface();
    const touch = new TouchInput();

    expect(() => {
      touch.attachAction(
        surface,
        0 as unknown as typeof Button.Shot,
      );
    }).toThrow(RangeError);
    expect(() => {
      touch.attachAction(
        surface,
        Button.Slow as unknown as typeof Button.Shot,
      );
    }).toThrow(RangeError);
  });
});

describe('touch source lifecycle', () => {
  test('the window end target clears a pointer when capture is unavailable', () => {
    const endTarget = new EventTarget();
    const a = new Surface();
    a.captureFails = true;
    const touch = new TouchInput(endTarget);
    touch.attachAction(a, Button.Shot);

    a.pointer('pointerdown', 17);
    expect(touch.consume()).toBe(Button.Shot);

    const up = new Event('pointerup', { cancelable: true });
    Object.assign(up, { pointerId: 17 });
    endTarget.dispatchEvent(up);
    expect(touch.consume()).toBe(0);
  });

  test('stick and actions merge through Input.sample()', () => {
    const stick = new Surface();
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachStick(stick);
    touch.attachAction(a, Button.Shot);
    const input = new Input([touch]);

    stick.pointer('pointerdown', 1, stickPoint(0.05, 0.05));
    a.pointer('pointerdown', 2);
    expect(input.sample()).toBe(Button.Left | Button.Up | Button.Shot);
  });

  test('reset clears held and latched state and releases every capture', () => {
    const stick = new Surface();
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachStick(stick);
    touch.attachAction(a, Button.Shot);

    stick.pointer('pointerdown', 1, stickPoint(0.95, 0.5));
    a.pointer('pointerdown', 2);
    touch.reset();

    expect(touch.consume()).toBe(0);
    expect(stick.releaseCalls).toEqual([1]);
    expect(a.releaseCalls).toEqual([2]);
    expect(stick.captures.size).toBe(0);
    expect(a.captures.size).toBe(0);
  });

  test('detach removes listeners as well as clearing state', () => {
    const stick = new Surface();
    const a = new Surface();
    const touch = new TouchInput();
    touch.attachStick(stick);
    touch.attachAction(a, Button.Shot);
    touch.detach();

    stick.pointer('pointerdown', 1, stickPoint(0.95, 0.5));
    a.pointer('pointerdown', 2);
    a.click(0);
    expect(touch.consume()).toBe(0);
  });
});
