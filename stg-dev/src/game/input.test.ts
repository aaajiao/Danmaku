import {afterEach, describe, expect, it, vi} from "vitest";
import {applyDeadZone, InputManager} from "./input";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gamepad axis dead zone", () => {
  it("removes center drift", () => {
    expect(applyDeadZone(0.08, -0.06)).toEqual({x: 0, y: 0});
  });

  it("preserves direction and clamps magnitude", () => {
    const value = applyDeadZone(0.8, 0.6);
    expect(Math.hypot(value.x, value.y)).toBeCloseTo(1);
    expect(value.x).toBeGreaterThan(0);
    expect(value.y).toBeGreaterThan(0);
  });
});

describe("gamepad action edges", () => {
  it("reports pause and Override once per physical press", () => {
    const buttons = Array.from({length: 16}, () => ({pressed: false}));
    const gamepad = {
      axes: [0, 0],
      buttons,
      connected: true,
      id: "TEST STANDARD PAD",
      index: 0,
    } as unknown as Gamepad;
    vi.stubGlobal("window", {addEventListener: vi.fn()});
    vi.stubGlobal("navigator", {getGamepads: () => [gamepad]});
    const canvas = {
      addEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(),
      setPointerCapture: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const manager = new InputManager(canvas, vi.fn());

    expect(manager.poll()).toMatchObject({pausePressed: false, overridePressed: false});
    buttons[9]!.pressed = true;
    buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({pausePressed: true, overridePressed: true});
    expect(manager.poll()).toMatchObject({pausePressed: false, overridePressed: false});

    buttons[9]!.pressed = false;
    buttons[1]!.pressed = false;
    expect(manager.poll()).toMatchObject({pausePressed: false, overridePressed: false});
    buttons[9]!.pressed = true;
    buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({pausePressed: true, overridePressed: true});
  });
});
