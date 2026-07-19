import type {Vec2} from "./types";

export interface InputFrame {
  move: Vec2;
  shoot: boolean;
  focus: boolean;
  /** Held application intent; mapped to an explicit gaze sample only by the Run adapter. */
  gazeIntent: boolean;
  overridePressed: boolean;
  overrideReleased: boolean;
  overrideHeld: boolean;
  /** Ordered aggregate-action edges; canonical main-loop code queues at most one per tick. */
  overrideEdges: readonly ("press" | "release")[];
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
  private readonly pointerTargets = new Map<number, Vec2>();
  private readonly pointerOrder: number[] = [];
  private primaryPointerId: number | null = null;
  private pointerTarget: Vec2 | null = null;
  private playerPosition: Vec2 = {x: 0, y: -220};
  private readonly overrideEdgeQueue: Array<"press" | "release"> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onGamepadChange: (label: string, connected: boolean) => void,
  ) {
    window.addEventListener("keydown", this.onKeyDown, {passive: false});
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("gamepadconnected", this.onGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.onGamepadDisconnected);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("lostpointercapture", this.onPointerUp);
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
    let gazeIntent = this.keys.has("KeyG");
    const overrideEdges = this.overrideEdgeQueue.splice(0);
    let pausePressed = false;
    let padOverrideHeld = false;
    const keyboardOverrideHeld = this.keys.has("KeyX");
    const padOverrideWasHeld = this.previousPadButtons.get(1) ?? false;

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
      gazeIntent ||= buttonPressed(gamepad, 3);
      padOverrideHeld = buttonPressed(gamepad, 1);
      this.queueOverrideTransition(
        keyboardOverrideHeld || padOverrideWasHeld,
        keyboardOverrideHeld || padOverrideHeld,
        overrideEdges,
      );
      pausePressed = this.edgePressed(gamepad, 9);
      this.rememberButtons(gamepad);
    } else if (padOverrideWasHeld) {
      // A missing disconnect event must not leave a held gameplay action
      // latched. The keyboard source can still keep the aggregate action held.
      this.queueOverrideTransition(true, keyboardOverrideHeld, overrideEdges);
      this.previousPadButtons.clear();
      this.activeGamepadIndex = null;
    }

    const touchMove = this.pointerMovement();
    gazeIntent ||= this.pointerTargets.size >= 2;
    const moveX = Math.abs(touchMove.x) > 0 ? touchMove.x : (keyboardX || padMove.x);
    const moveY = Math.abs(touchMove.y) > 0 ? touchMove.y : (keyboardY || padMove.y);
    const magnitude = Math.hypot(moveX, moveY);

    pausePressed ||= this.consumeKeyEdge("pause");
    const overrideHeld = keyboardOverrideHeld || padOverrideHeld;

    return {
      move: magnitude > 1 ? {x: moveX / magnitude, y: moveY / magnitude} : {x: moveX, y: moveY},
      shoot: shoot || this.pointerTargets.size > 0,
      focus,
      gazeIntent,
      overridePressed: overrideEdges.includes("press"),
      overrideReleased: overrideEdges.includes("release"),
      overrideHeld,
      overrideEdges: Object.freeze(overrideEdges.slice()),
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
    const overrideWasHeld = this.aggregateOverrideHeld();
    if (!event.repeat && event.code === "Space") this.keyEdges.add("pause");
    this.keys.add(event.code);
    if (!event.repeat && event.code === "KeyX") {
      this.queueOverrideTransition(overrideWasHeld, this.aggregateOverrideHeld());
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const overrideWasHeld = this.aggregateOverrideHeld();
    this.keys.delete(event.code);
    if (event.code === "KeyX") {
      this.queueOverrideTransition(overrideWasHeld, this.aggregateOverrideHeld());
    }
  };

  private readonly onBlur = (): void => {
    const overrideWasHeld = this.aggregateOverrideHeld();
    this.keys.clear();
    this.pointerTargets.clear();
    this.pointerOrder.length = 0;
    this.primaryPointerId = null;
    this.pointerTarget = null;
    this.queueOverrideTransition(overrideWasHeld, this.aggregateOverrideHeld());
  };

  private aggregateOverrideHeld(): boolean {
    return this.keys.has("KeyX") || (this.previousPadButtons.get(1) ?? false);
  }

  private queueOverrideTransition(
    wasHeld: boolean,
    isHeld: boolean,
    target: Array<"press" | "release"> = this.overrideEdgeQueue,
  ): void {
    if (isHeld !== wasHeld) target.push(isHeld ? "press" : "release");
  }

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
    const previousIndex = this.activeGamepadIndex;
    const overrideWasHeld = this.aggregateOverrideHeld();
    const fallback = Array.from(pads).find((pad): pad is Gamepad => Boolean(pad?.connected));
    this.activeGamepadIndex = null;
    this.previousPadButtons.clear();
    if (fallback) {
      this.activeGamepadIndex = fallback.index;
      this.rememberButtons(fallback);
      this.queueOverrideTransition(
        overrideWasHeld,
        this.keys.has("KeyX") || buttonPressed(fallback, 1),
      );
      this.onGamepadChange(fallback.id || "STANDARD GAMEPAD", true);
      return fallback;
    }
    this.queueOverrideTransition(overrideWasHeld, this.keys.has("KeyX"));
    if (previousIndex !== null) this.onGamepadChange("GAMEPAD", false);
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
    const pads = navigator.getGamepads?.() ?? [];
    const active = this.activeGamepadIndex === null ? null : pads[this.activeGamepadIndex];
    // A newly connected secondary device cannot steal gameplay action
    // ownership or reset the held history of a still-connected active pad.
    if (active?.connected) return;
    const overrideWasHeld = this.aggregateOverrideHeld();
    this.activeGamepadIndex = event.gamepad.index;
    this.previousPadButtons.clear();
    this.rememberButtons(event.gamepad);
    this.queueOverrideTransition(
      overrideWasHeld,
      this.keys.has("KeyX") || buttonPressed(event.gamepad, 1),
    );
    this.onGamepadChange(event.gamepad.id || "STANDARD GAMEPAD", true);
  };

  private readonly onGamepadDisconnected = (event: GamepadEvent): void => {
    // A secondary pad is not an authority source. Its disconnect must not
    // mutate active button history or report the active device as absent.
    if (event.gamepad.index !== this.activeGamepadIndex) return;
    const overrideWasHeld = this.aggregateOverrideHeld();
    this.activeGamepadIndex = null;
    this.previousPadButtons.clear();
    const pads = navigator.getGamepads?.() ?? [];
    const fallback = Array.from(pads).find((pad): pad is Gamepad => (
      Boolean(pad?.connected) && pad?.index !== event.gamepad.index
    ));
    if (fallback) {
      this.activeGamepadIndex = fallback.index;
      this.rememberButtons(fallback);
      this.queueOverrideTransition(
        overrideWasHeld,
        this.keys.has("KeyX") || buttonPressed(fallback, 1),
      );
      this.onGamepadChange(fallback.id || "STANDARD GAMEPAD", true);
    } else {
      this.queueOverrideTransition(overrideWasHeld, this.keys.has("KeyX"));
      this.onGamepadChange("GAMEPAD", false);
    }
  };

  private pointerToWorld(event: PointerEvent): Vec2 {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 360,
      y: (0.5 - (event.clientY - bounds.top) / bounds.height) * 640,
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const target = this.pointerToWorld(event);
    if (!this.pointerTargets.has(event.pointerId)) this.pointerOrder.push(event.pointerId);
    this.pointerTargets.set(event.pointerId, target);
    if (this.primaryPointerId === null) {
      this.primaryPointerId = event.pointerId;
      this.pointerTarget = target;
    } else if (event.pointerId === this.primaryPointerId) {
      this.pointerTarget = target;
    }
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerTargets.has(event.pointerId)) return;
    const target = this.pointerToWorld(event);
    this.pointerTargets.set(event.pointerId, target);
    if (event.pointerId === this.primaryPointerId) this.pointerTarget = target;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerTargets.delete(event.pointerId)) return;
    const orderIndex = this.pointerOrder.indexOf(event.pointerId);
    if (orderIndex >= 0) this.pointerOrder.splice(orderIndex, 1);
    if (event.pointerId !== this.primaryPointerId) return;
    const nextPointerId = this.pointerOrder[0] ?? null;
    this.primaryPointerId = nextPointerId;
    this.pointerTarget = nextPointerId === null
      ? null
      : this.pointerTargets.get(nextPointerId) ?? null;
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
