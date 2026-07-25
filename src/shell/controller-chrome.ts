import type {
  XboxWebHidInput,
  XboxWebHidStatus,
} from '../core/xbox-webhid';

export interface ControllerStatusElements {
  readonly setup: HTMLElement;
  readonly connect: HTMLButtonElement;
  readonly status: HTMLOutputElement;
}

export function hasConnectedStandardController(): boolean {
  const pads = navigator.getGamepads?.() ?? [];
  return Array.from(pads).some((pad) => pad?.connected);
}

/**
 * Present WebHID status without owning it. The caller keeps the current status
 * and decides whether the panel can cover the active screen.
 */
export function presentControllerStatus(
  controllerStatus: XboxWebHidStatus,
  elements: ControllerStatusElements,
): void {
  elements.setup.dataset.phase = controllerStatus.phase;
  elements.connect.hidden = false;

  switch (controllerStatus.phase) {
    case 'idle':
      elements.connect.disabled = false;
      elements.connect.textContent = 'CONNECT CONTROLLER';
      elements.status.textContent = 'DIRECT INPUT FALLBACK';
      break;
    case 'selecting':
      elements.connect.disabled = true;
      elements.connect.textContent = 'SELECTING…';
      elements.status.textContent = 'SELECT A CONTROLLER IN THIS BROWSER';
      break;
    case 'opening':
      elements.connect.disabled = true;
      elements.connect.textContent = 'OPENING…';
      elements.status.textContent = 'OPENING CONTROLLER';
      break;
    case 'waiting':
      elements.connect.hidden = true;
      elements.status.textContent = 'PRESS A CONTROLLER BUTTON';
      break;
    case 'ready':
      elements.connect.hidden = true;
      elements.status.textContent = 'CONTROLLER READY';
      break;
    case 'disconnected':
      elements.connect.disabled = false;
      elements.connect.textContent = 'RECONNECT';
      elements.status.textContent = 'CONTROLLER DISCONNECTED';
      break;
    case 'error':
      elements.connect.disabled = false;
      elements.connect.textContent = 'RETRY';
      elements.status.textContent = (
        typeof controllerStatus.error === 'object'
        && controllerStatus.error !== null
        && 'name' in controllerStatus.error
        && (controllerStatus.error as { readonly name?: unknown }).name
          === 'NotAllowedError'
      )
        ? 'ALLOW THIS BROWSER IN INPUT MONITORING'
        : 'CAN’T OPEN CONTROLLER · CLOSE OTHER MAPPERS';
      break;
  }
}

export interface ControllerConnectActions {
  readonly controller: XboxWebHidInput;
  readonly unlockAudio: () => void;
}

export function installControllerConnect(
  button: HTMLButtonElement,
  actions: ControllerConnectActions,
): void {
  button.addEventListener('click', () => {
    // `requestDevice()` reaches Chrome's chooser synchronously before its first
    // await, preserving this click's required user activation.
    const request = actions.controller.requestDevice();
    button.blur();
    actions.unlockAudio();
    void request;
  });
}
