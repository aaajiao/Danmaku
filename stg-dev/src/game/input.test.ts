import {afterEach, describe, expect, it, vi} from "vitest";
import {applyDeadZone, InputManager} from "./input";

afterEach(() => {
  vi.unstubAllGlobals();
});

type TestWindowEvent = "blur" | "gamepadconnected" | "gamepaddisconnected" | "keydown" | "keyup";

function createInputHarness(gamepads: Array<Gamepad | null> = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const canvasListeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    }),
  });
  vi.stubGlobal("navigator", {getGamepads: () => gamepads});
  const canvas = {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      canvasListeners.set(type, listener);
    }),
    getBoundingClientRect: vi.fn(() => ({left: 0, top: 0, width: 360, height: 640})),
    setPointerCapture: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const onGamepadChange = vi.fn();
  const manager = new InputManager(canvas, onGamepadChange);

  return {
    manager,
    onGamepadChange,
    dispatch(type: TestWindowEvent, event?: unknown): void {
      const listener = listeners.get(type);
      if (!listener) throw new Error(`No test listener registered for ${type}`);
      listener(event);
    },
    dispatchCanvas(type: string, event: unknown): void {
      const listener = canvasListeners.get(type);
      if (!listener) throw new Error(`No test canvas listener registered for ${type}`);
      listener(event);
    },
  };
}

function keyEvent(code: string, repeat = false): KeyboardEvent {
  return {code, repeat, preventDefault: vi.fn()} as unknown as KeyboardEvent;
}

function createMutableGamepad(index = 0, id = `TEST STANDARD PAD ${index}`) {
  const buttons = Array.from({length: 16}, () => ({pressed: false}));
  const value = {
    axes: [0, 0],
    buttons,
    connected: true,
    id,
    index,
  };
  return {buttons, value, gamepad: value as unknown as Gamepad};
}

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

describe("keyboard Override edges", () => {
  it("preserves physical press/release order when both arrive before a poll", () => {
    const {manager, dispatch} = createInputHarness();

    dispatch("keydown", keyEvent("KeyX"));
    dispatch("keyup", keyEvent("KeyX"));

    const frame = manager.poll();
    expect(frame).toMatchObject({
      overridePressed: true,
      overrideReleased: true,
      overrideHeld: false,
    });
    expect(frame.overrideEdges).toEqual(["press", "release"]);
    expect(Object.isFrozen(frame.overrideEdges)).toBe(true);
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: false,
      overrideEdges: [],
    });
  });

  it("reports held state between one press edge and one release edge", () => {
    const {manager, dispatch} = createInputHarness();

    dispatch("keydown", keyEvent("KeyX"));
    expect(manager.poll()).toMatchObject({
      overridePressed: true,
      overrideReleased: false,
      overrideHeld: true,
      overrideEdges: ["press"],
    });
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: true,
      overrideEdges: [],
    });

    dispatch("keyup", keyEvent("KeyX"));
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: true,
      overrideHeld: false,
      overrideEdges: ["release"],
    });
  });

  it("turns a held key into exactly one release edge on blur", () => {
    const {manager, dispatch} = createInputHarness();

    dispatch("keydown", keyEvent("KeyX"));
    expect(manager.poll()).toMatchObject({overridePressed: true, overrideHeld: true});

    dispatch("blur");
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: true,
      overrideHeld: false,
      overrideEdges: ["release"],
    });

    dispatch("blur");
    dispatch("keyup", keyEvent("KeyX"));
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: false,
      overrideEdges: [],
    });
  });
});

describe("pointer cancellation", () => {
  it("clears held movement and signal on lost capture and window blur", () => {
    const {manager, dispatch, dispatchCanvas} = createInputHarness();
    manager.setPlayerPosition({x: 0, y: 0});
    const pointer = {pointerId: 7, clientX: 300, clientY: 100} as PointerEvent;

    dispatchCanvas("pointerdown", pointer);
    expect(manager.poll()).toMatchObject({shoot: true});
    expect(manager.poll().move).not.toEqual({x: 0, y: 0});
    dispatchCanvas("lostpointercapture", pointer);
    expect(manager.poll()).toMatchObject({shoot: false, move: {x: 0, y: 0}});

    dispatchCanvas("pointerdown", pointer);
    expect(manager.poll()).toMatchObject({shoot: true});
    dispatch("blur");
    expect(manager.poll()).toMatchObject({shoot: false, move: {x: 0, y: 0}});
  });
});

describe("gamepad action edges", () => {
  it("reports pause once and emits ordered Override press/release edges", () => {
    const {buttons, gamepad} = createMutableGamepad();
    const {manager} = createInputHarness([gamepad]);

    expect(manager.poll()).toMatchObject({
      pausePressed: false,
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: false,
      overrideEdges: [],
    });
    buttons[9]!.pressed = true;
    buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({
      pausePressed: true,
      overridePressed: true,
      overrideReleased: false,
      overrideHeld: true,
      overrideEdges: ["press"],
    });
    expect(manager.poll()).toMatchObject({
      pausePressed: false,
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: true,
      overrideEdges: [],
    });

    buttons[9]!.pressed = false;
    buttons[1]!.pressed = false;
    expect(manager.poll()).toMatchObject({
      pausePressed: false,
      overridePressed: false,
      overrideReleased: true,
      overrideHeld: false,
      overrideEdges: ["release"],
    });
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: false,
      overrideEdges: [],
    });

    buttons[9]!.pressed = true;
    buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({
      pausePressed: true,
      overridePressed: true,
      overrideReleased: false,
      overrideHeld: true,
      overrideEdges: ["press"],
    });
  });

  it("emits one release edge when a held gamepad disconnects", () => {
    const {buttons, value, gamepad} = createMutableGamepad();
    const {manager, onGamepadChange, dispatch} = createInputHarness([gamepad]);

    expect(manager.poll().overrideEdges).toEqual([]);
    buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({
      overridePressed: true,
      overrideReleased: false,
      overrideHeld: true,
      overrideEdges: ["press"],
    });

    value.connected = false;
    dispatch("gamepaddisconnected", {gamepad});
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: true,
      overrideHeld: false,
      overrideEdges: ["release"],
    });
    expect(onGamepadChange).toHaveBeenLastCalledWith("GAMEPAD", false);

    dispatch("gamepaddisconnected", {gamepad});
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: false,
      overrideEdges: [],
    });
  });

  it("keeps the aggregate action held while keyboard and gamepad sources overlap", () => {
    const {buttons, gamepad} = createMutableGamepad();
    const {manager, dispatch} = createInputHarness([gamepad]);

    expect(manager.poll().overrideEdges).toEqual([]);
    dispatch("keydown", keyEvent("KeyX"));
    expect(manager.poll()).toMatchObject({overrideHeld: true, overrideEdges: ["press"]});

    buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({overrideHeld: true, overrideEdges: []});
    dispatch("keyup", keyEvent("KeyX"));
    expect(manager.poll()).toMatchObject({overrideHeld: true, overrideEdges: []});

    buttons[1]!.pressed = false;
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: true,
      overrideHeld: false,
      overrideEdges: ["release"],
    });
  });

  it("ignores a non-active pad disconnect without corrupting active held history", () => {
    const primary = createMutableGamepad(0, "PRIMARY PAD");
    const secondary = createMutableGamepad(1, "SECONDARY PAD");
    const pads: Array<Gamepad | null> = [primary.gamepad, secondary.gamepad];
    const {manager, onGamepadChange, dispatch} = createInputHarness(pads);

    expect(manager.poll().overrideEdges).toEqual([]);
    primary.buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({overrideHeld: true, overrideEdges: ["press"]});

    secondary.value.connected = false;
    pads[1] = null;
    dispatch("gamepaddisconnected", {gamepad: secondary.gamepad});
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: false,
      overrideHeld: true,
      overrideEdges: [],
    });
    expect(onGamepadChange).toHaveBeenCalledTimes(1);
    expect(onGamepadChange).toHaveBeenLastCalledWith("PRIMARY PAD", true);
  });

  it("does not let a newly connected secondary pad steal active action ownership", () => {
    const primary = createMutableGamepad(0, "PRIMARY PAD");
    const secondary = createMutableGamepad(1, "SECONDARY PAD");
    const pads: Array<Gamepad | null> = [primary.gamepad, null];
    const {manager, onGamepadChange, dispatch} = createInputHarness(pads);

    expect(manager.poll().overrideEdges).toEqual([]);
    primary.buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({overrideHeld: true, overrideEdges: ["press"]});

    pads[1] = secondary.gamepad;
    dispatch("gamepadconnected", {gamepad: secondary.gamepad});
    expect(manager.poll()).toMatchObject({overrideHeld: true, overrideEdges: []});
    expect(onGamepadChange).toHaveBeenCalledTimes(1);
    expect(onGamepadChange).toHaveBeenLastCalledWith("PRIMARY PAD", true);

    primary.buttons[1]!.pressed = false;
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: true,
      overrideHeld: false,
      overrideEdges: ["release"],
    });
  });

  it("reconciles once when the active pad disconnects into a connected fallback", () => {
    const primary = createMutableGamepad(0, "PRIMARY PAD");
    const fallback = createMutableGamepad(1, "FALLBACK PAD");
    const pads: Array<Gamepad | null> = [primary.gamepad, fallback.gamepad];
    const {manager, onGamepadChange, dispatch} = createInputHarness(pads);

    expect(manager.poll().overrideEdges).toEqual([]);
    primary.buttons[1]!.pressed = true;
    expect(manager.poll()).toMatchObject({overrideHeld: true, overrideEdges: ["press"]});

    primary.value.connected = false;
    pads[0] = null;
    dispatch("gamepaddisconnected", {gamepad: primary.gamepad});
    expect(manager.poll()).toMatchObject({
      overridePressed: false,
      overrideReleased: true,
      overrideHeld: false,
      overrideEdges: ["release"],
    });
    expect(onGamepadChange).toHaveBeenLastCalledWith("FALLBACK PAD", true);
    expect(manager.poll().overrideEdges).toEqual([]);
  });
});
