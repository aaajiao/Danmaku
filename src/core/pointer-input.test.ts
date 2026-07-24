import { describe, expect, test } from 'bun:test';
import { Button, Input } from './input';
import {
  MenuPointerInput,
  POINTER_TARGET_DEADZONE,
  PointerPositionInput,
  menuPointerSequence,
  type PointerSurface,
} from './pointer-input';

class Surface extends EventTarget implements PointerSurface {
  getBoundingClientRect() {
    return { left: 100, top: 50, width: 960, height: 1280 };
  }

  move(clientX: number, clientY: number, pointerType = 'mouse'): void {
    const event = new Event('pointermove');
    Object.assign(event, { clientX, clientY, pointerType });
    this.dispatchEvent(event);
  }
}

function keyEvent(type: 'keydown' | 'keyup', code: string): Event {
  const event = new Event(type);
  Object.assign(event, { code, repeat: false });
  return event;
}

describe('pointer position steering', () => {
  test('transforms a scaled stage point and emits only digital directions', () => {
    const surface = new Surface();
    const pointer = new PointerPositionInput(480, 640);
    pointer.attach(surface);
    // Logical target (360, 160).
    surface.move(820, 370);
    pointer.setOrigin(240, 320);

    const buttons = pointer.consume();
    expect(buttons & Button.Right).toBeTruthy();
    expect(buttons & Button.Up).toBeTruthy();
    expect(buttons & Button.Left).toBeFalsy();
    expect(buttons & Button.Down).toBeFalsy();
  });

  test('uses a fixed inclusive deadzone and does not oscillate near target', () => {
    const surface = new Surface();
    const pointer = new PointerPositionInput(480, 640);
    pointer.attach(surface);
    // Logical target (240, 320).
    surface.move(580, 690);

    pointer.setOrigin(
      240 - POINTER_TARGET_DEADZONE,
      320 + POINTER_TARGET_DEADZONE,
    );
    expect(pointer.consume()).toBe(0);

    pointer.setOrigin(
      240 - POINTER_TARGET_DEADZONE - 0.01,
      320 + POINTER_TARGET_DEADZONE + 0.01,
    );
    expect(pointer.consume() & Button.Right).toBeTruthy();
    expect(pointer.consume() & Button.Up).toBeTruthy();
  });

  test('clearing the origin disables menus without discarding a future target', () => {
    const surface = new Surface();
    const pointer = new PointerPositionInput(480, 640);
    pointer.attach(surface);
    surface.move(820, 690);
    pointer.setOrigin(240, 320);
    expect(pointer.consume() & Button.Right).toBeTruthy();

    pointer.clearOrigin();
    expect(pointer.consume()).toBe(0);

    pointer.setOrigin(240, 320);
    expect(pointer.consume() & Button.Right).toBeTruthy();
  });

  test('a new state can require a fresh mouse move', () => {
    const surface = new Surface();
    const pointer = new PointerPositionInput(480, 640);
    pointer.attach(surface);
    surface.move(820, 690);
    pointer.setOrigin(240, 320);
    expect(pointer.consume()).not.toBe(0);

    pointer.clearTarget();
    pointer.setOrigin(240, 320);
    expect(pointer.consume()).toBe(0);
  });

  test('non-mouse pointers are ignored and leaving or detaching clears steering', () => {
    const surface = new Surface();
    const pointer = new PointerPositionInput(480, 640);
    pointer.attach(surface);
    surface.move(820, 690, 'touch');
    pointer.setOrigin(240, 320);
    expect(pointer.consume()).toBe(0);

    surface.move(820, 690);
    expect(pointer.consume()).not.toBe(0);
    surface.dispatchEvent(new Event('pointerleave'));
    expect(pointer.consume()).toBe(0);

    surface.move(820, 690);
    expect(pointer.consume()).not.toBe(0);
    pointer.detach();
    expect(pointer.consume()).toBe(0);
  });

  test('keyboard actions merge with mouse position and mouse clicks add no action', () => {
    const surface = new Surface();
    const keyboardTarget = new EventTarget();
    const pointer = new PointerPositionInput(480, 640);
    pointer.attach(surface);
    const input = new Input([pointer]);
    input.attach(keyboardTarget);

    surface.move(820, 690);
    pointer.setOrigin(240, 320);
    keyboardTarget.dispatchEvent(keyEvent('keydown', 'KeyZ'));
    surface.dispatchEvent(new Event('pointerdown'));

    const buttons = input.sample();
    expect(buttons & Button.Right).toBeTruthy();
    expect(buttons & Button.Shot).toBeTruthy();
    expect(buttons & Button.Bomb).toBeFalsy();
  });
});

describe('menu pointer queue', () => {
  test('clicking the selected row confirms directly', () => {
    expect(menuPointerSequence(2, 2, 5)).toEqual([Button.Shot]);
  });

  test('uses the shortest wrapping path with neutral edge separators', () => {
    expect(menuPointerSequence(0, 3, 5)).toEqual([
      Button.Up,
      0,
      Button.Up,
      0,
      Button.Shot,
    ]);
    expect(menuPointerSequence(0, 2, 4)).toEqual([
      Button.Down,
      0,
      Button.Down,
      0,
      Button.Shot,
    ]);
  });

  test('rejects stale or invalid row metadata', () => {
    expect(menuPointerSequence(0, 1, 0)).toEqual([]);
    expect(menuPointerSequence(4, 0, 4)).toEqual([]);
    expect(menuPointerSequence(0, -1, 4)).toEqual([]);
  });

  test('contributes exactly one queued mask per tick and a new click replaces it', () => {
    const menu = new MenuPointerInput();
    menu.queueSelection(0, 2, 4);
    expect(menu.consume()).toBe(Button.Down);
    expect(menu.consume()).toBe(0);

    menu.queueSelection(1, 1, 4);
    expect(menu.consume()).toBe(Button.Shot);
    expect(menu.consume()).toBe(0);
  });

  test('reset discards a click sequence before it reaches another state', () => {
    const menu = new MenuPointerInput();
    menu.queueSelection(0, 2, 4);
    menu.reset();
    expect(menu.consume()).toBe(0);
  });
});
