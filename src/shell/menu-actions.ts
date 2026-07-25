import { v4MenuRowGeometry } from '../render/v4-ui';

export interface MenuActionChrome {
  readonly container: HTMLElement;
  readonly buttons: HTMLButtonElement[];
  readonly currentState: () => string | undefined;
  readonly openReplayImport: () => void;
  readonly queueSelection: (
    selected: number,
    target: number,
    count: number,
  ) => void;
  readonly unlockAudio: () => void;
}

export interface MenuActionLayout {
  readonly state: string;
  readonly entries: readonly string[];
  readonly selected: number;
  readonly count: number;
  readonly x: number;
  readonly firstBaseline: number;
  readonly width: number;
  readonly step: number;
  readonly indexOffset?: number;
  readonly actions?: readonly (string | undefined)[];
}

const stopControllerKey = (event: Event): void => event.stopPropagation();

function menuActionButton(
  chrome: MenuActionChrome,
  index: number,
): HTMLButtonElement {
  const existing = chrome.buttons[index];
  if (existing !== undefined) return existing;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-action';
  button.addEventListener('keydown', stopControllerKey);
  button.addEventListener('keyup', stopControllerKey);
  button.addEventListener('click', () => {
    if (button.dataset.state !== chrome.currentState()) return;

    // File pickers must open synchronously inside the real click. Do not queue
    // this through the fixed-tick menu mask, where user activation has expired.
    if (button.dataset.action === 'import-replay') {
      chrome.openReplayImport();
      button.blur();
      chrome.unlockAudio();
      return;
    }

    const selected = Number(button.dataset.selected);
    const target = Number(button.dataset.target);
    const count = Number(button.dataset.count);
    chrome.queueSelection(selected, target, count);
    button.blur();
    // A direct row click is also the browser gesture that permits audio.
    chrome.unlockAudio();
  });
  chrome.container.append(button);
  chrome.buttons.push(button);
  return button;
}

export function hideMenuClickTargets(chrome: MenuActionChrome): void {
  chrome.container.hidden = true;
  for (const button of chrome.buttons) button.hidden = true;
}

/**
 * Lay transparent DOM buttons over the rows the canvas just authored.
 * Clicking one queues ordinary edge-separated direction/Shot masks; it never
 * mutates a MenuState cursor directly (CLAUDE.md, rule 4).
 */
export function layoutMenuClickTargets(
  chrome: MenuActionChrome,
  layout: MenuActionLayout,
): void {
  const {
    state,
    entries,
    selected,
    count,
    x,
    firstBaseline,
    width,
    step,
    indexOffset = 0,
    actions,
  } = layout;
  chrome.container.hidden = entries.length === 0;
  entries.forEach((entry, visibleIndex) => {
    const button = menuActionButton(chrome, visibleIndex);
    const target = indexOffset + visibleIndex;
    const row = v4MenuRowGeometry(
      firstBaseline + visibleIndex * step,
      step,
    );
    button.hidden = false;
    button.textContent = entry;
    button.setAttribute('aria-label', entry);
    if (target === selected) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
    button.dataset.state = state;
    button.dataset.selected = `${selected}`;
    button.dataset.target = `${target}`;
    button.dataset.count = `${count}`;
    const action = actions?.[target];
    if (action === undefined) delete button.dataset.action;
    else button.dataset.action = action;
    button.style.left = `${x}px`;
    button.style.top = `${row.top}px`;
    button.style.width = `${width}px`;
    button.style.height = `${row.height}px`;
  });

  for (let index = entries.length; index < chrome.buttons.length; index++) {
    chrome.buttons[index]!.hidden = true;
  }
}

export function stopControllerActivationKey(event: Event): void {
  event.stopPropagation();
}

export function stopTouchButtonActivationKey(event: KeyboardEvent): void {
  if (event.code === 'Space' || event.code === 'Enter') {
    event.stopPropagation();
  }
}
