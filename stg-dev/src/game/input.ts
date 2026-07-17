import type {Vec2} from "./types";

export interface InputFrame {
  move: Vec2;
  shoot: boolean;
  focus: boolean;
  overridePressed: boolean;
  pausePressed: boolean;
}

type GamepadWithHaptics = Gamepad & {
  vibrationActuator?: {
    playEffect: (
      type: "dual-rumble",
      options: {duration: number; strongMagnitude: number; weakMagnitude: number},
    ) => Promise<unknown>;
  };
};

const DEAD_ZONE = 0.18;

function buttonPressed(gamepad: Gamepad, index: number): boolean {
  return gamepad.buttons[index]?.pressed ?? false;
}

export function applyDeadZone(x: number, y: number): Vec2 {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= DEAD_ZONE) return {x: 0, y: 0};
  const normalized = Math.min(1, (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE));
  return {x: x / magnitude * normalized, y: y / magnitude * normalized};
}

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly previousPadButtons = new Map<number, boolean>();
  private activeGamepadIndex: number | null = null;
  private pointerId: number | null = null;
  private pointerTarget: Vec2 | null = null;
  private playerPosition: Vec2 = {x: 0, y: -220};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onGamepadChange: (label: string, connected: boolean) => void,
  ) {
    window.addEventListener("keydown", this.onKeyDown, {passive: false});
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("gamepadconnected", this.onGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.onGamepadDisconnected);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  setPlayerPosition(position: Vec2): void {
    this.playerPosition = position;
  }

  poll(): InputFrame {
    const keyboardX = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight"))
      - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const keyboardY = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"))
      - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));

    const gamepad = this.getActiveGamepad();
    let padMove: Vec2 = {x: 0, y: 0};
    let shoot = this.keys.has("KeyZ");
    let focus = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    let overridePressed = false;
    let pausePressed = false;

    if (gamepad) {
      const stick = applyDeadZone(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0);
      const dpadX = Number(buttonPressed(gamepad, 15)) - Number(buttonPressed(gamepad, 14));
      const dpadY = Number(buttonPressed(gamepad, 12)) - Number(buttonPressed(gamepad, 13));
      padMove = {
        x: Math.abs(dpadX) > Math.abs(stick.x) ? dpadX : stick.x,
        y: Math.abs(dpadY) > Math.abs(stick.y) ? dpadY : -stick.y,
      };
      shoot ||= buttonPressed(gamepad, 0);
      focus ||= buttonPressed(gamepad, 4) || buttonPressed(gamepad, 5);
      overridePressed = this.edgePressed(gamepad, 1);
      pausePressed = this.edgePressed(gamepad, 9);
      this.rememberButtons(gamepad);
    }

    const touchMove = this.pointerMovement();
    const moveX = Math.abs(touchMove.x) > 0 ? touchMove.x : (keyboardX || padMove.x);
    const moveY = Math.abs(touchMove.y) > 0 ? touchMove.y : (keyboardY || padMove.y);
    const magnitude = Math.hypot(moveX, moveY);

    overridePressed ||= this.consumeKeyEdge("override");
    pausePressed ||= this.consumeKeyEdge("pause");

    return {
      move: magnitude > 1 ? {x: moveX / magnitude, y: moveY / magnitude} : {x: moveX, y: moveY},
      shoot: shoot || this.pointerId !== null,
      focus,
      overridePressed,
      pausePressed,
    };
  }

  async pulse(duration: number, strongMagnitude: number, weakMagnitude: number): Promise<void> {
    const gamepad = this.getActiveGamepad() as GamepadWithHaptics | null;
    if (!gamepad?.vibrationActuator) return;
    try {
      await gamepad.vibrationActuator.playEffect("dual-rumble", {
        duration,
        strongMagnitude,
        weakMagnitude,
      });
    } catch {
      // Haptics are optional and can be blocked by the platform.
    }
  }

  private keyEdges = new Set<string>();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat && event.code === "KeyX") this.keyEdges.add("override");
    if (!event.repeat && event.code === "Space") this.keyEdges.add("pause");
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private consumeKeyEdge(key: string): boolean {
    const present = this.keyEdges.has(key);
    this.keyEdges.delete(key);
    return present;
  }

  private getActiveGamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.activeGamepadIndex !== null) {
      const active = pads[this.activeGamepadIndex];
      if (active?.connected) return active;
    }
    const fallback = Array.from(pads).find((pad): pad is Gamepad => Boolean(pad?.connected));
    if (fallback) {
      this.activeGamepadIndex = fallback.index;
      this.onGamepadChange(fallback.id || "STANDARD GAMEPAD", true);
      return fallback;
    }
    return null;
  }

  private edgePressed(gamepad: Gamepad, index: number): boolean {
    const pressed = buttonPressed(gamepad, index);
    return pressed && !(this.previousPadButtons.get(index) ?? false);
  }

  private rememberButtons(gamepad: Gamepad): void {
    gamepad.buttons.forEach((button, index) => this.previousPadButtons.set(index, button.pressed));
  }

  private readonly onGamepadConnected = (event: GamepadEvent): void => {
    this.activeGamepadIndex = event.gamepad.index;
    this.previousPadButtons.clear();
    this.onGamepadChange(event.gamepad.id || "STANDARD GAMEPAD", true);
  };

  private readonly onGamepadDisconnected = (event: GamepadEvent): void => {
    if (event.gamepad.index === this.activeGamepadIndex) this.activeGamepadIndex = null;
    this.previousPadButtons.clear();
    this.onGamepadChange("GAMEPAD", false);
  };

  private pointerToWorld(event: PointerEvent): Vec2 {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 360,
      y: (0.5 - (event.clientY - bounds.top) / bounds.height) * 640,
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerId = event.pointerId;
    this.pointerTarget = this.pointerToWorld(event);
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.pointerTarget = this.pointerToWorld(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) {
      this.pointerId = null;
      this.pointerTarget = null;
    }
  };

  private pointerMovement(): Vec2 {
    if (!this.pointerTarget) return {x: 0, y: 0};
    const dx = this.pointerTarget.x - this.playerPosition.x;
    const dy = this.pointerTarget.y - this.playerPosition.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 3) return {x: 0, y: 0};
    return {x: dx / distance, y: dy / distance};
  }
}
