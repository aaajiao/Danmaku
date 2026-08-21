import { v4MenuRowGeometry } from '../render/v4-ui';
import { adjacentMenuTarget } from '../core/pointer-input';

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
  readonly queueNavigation: (
    selected: number,
    target: number,
    count: number,
  ) => void;
  readonly unlockAudio: () => void;
}

export interface MenuActionLayout {
  readonly state: string;
  /** Semantic page identity; rows from different Replay subpages never alias. */
  readonly scope?: string;
  readonly entries: readonly string[];
  readonly selected: number;
  readonly count: number;
  readonly x: number;
  readonly firstBaseline: number;
  readonly width: number;
  readonly step: number;
  readonly indexOffset?: number;
  readonly actions?: readonly (string | undefined)[];
  /** Replay libraries opt into wheel-driven selection through fixed-tick bits. */
  readonly wheelNavigation?: boolean;
}

const stopControllerKey = (event: Event): void => event.stopPropagation();
const pendingMenuFocus = new WeakMap<HTMLElement, {
  readonly scope: string;
  readonly target: number;
}>();

function menuActionButton(
  chrome: MenuActionChrome,
  scope: string,
  index: number,
): HTMLButtonElement {
  const existing = chrome.buttons.find(
    (candidate) => (
      candidate.dataset.layoutScope === scope
      && Number(candidate.dataset.menuIndex) === index
    ),
  );
  if (existing !== undefined) return existing;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-action';
  button.dataset.layoutScope = scope;
  button.dataset.menuIndex = `${index}`;
  button.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Enter Space');
  button.addEventListener('keydown', (event) => {
    if (
      (event.code !== 'ArrowUp' && event.code !== 'ArrowDown')
      || button.dataset.state !== chrome.currentState()
    ) {
      return;
    }
    const selected = Number(button.dataset.selected);
    const focusedTarget = Number(button.dataset.target);
    const count = Number(button.dataset.count);
    if (
      !Number.isInteger(selected)
      || !Number.isInteger(focusedTarget)
      || !Number.isInteger(count)
      || count <= 0
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = adjacentMenuTarget(
      focusedTarget,
      count,
      event.code === 'ArrowDown' ? 1 : -1,
    );
    if (target === undefined) return;
    pendingMenuFocus.set(chrome.container, { scope, target });
    chrome.queueNavigation(selected, target, count);
  });
  button.addEventListener('keydown', stopControllerKey);
  button.addEventListener('keyup', stopControllerKey);
  button.addEventListener('focus', () => {
    if (button.dataset.state !== chrome.currentState()) return;
    const selected = Number(button.dataset.selected);
    const target = Number(button.dataset.target);
    const count = Number(button.dataset.count);
    if (selected === target) return;
    chrome.queueNavigation(selected, target, count);
  });
  button.addEventListener('wheel', (event) => {
    if (
      button.dataset.state !== chrome.currentState()
      || button.dataset.wheelNavigation !== 'true'
      || event.deltaY === 0
    ) {
      return;
    }
    const selected = Number(button.dataset.selected);
    const count = Number(button.dataset.count);
    const visibleCount = Number(button.dataset.visibleCount);
    const distance = Math.max(1, visibleCount - 1);
    const target = Math.max(
      0,
      Math.min(count - 1, selected + (event.deltaY > 0 ? distance : -distance)),
    );
    if (target === selected) return;
    event.preventDefault();
    // Wheel paging can slide the selected row outside the current eight-row
    // DOM window. Remember the absolute target just like Arrow navigation so
    // the newly authored row receives focus after fixed-tick selection catches
    // up, instead of leaving focus on the row that is about to be hidden.
    pendingMenuFocus.set(chrome.container, { scope, target });
    chrome.queueNavigation(selected, target, count);
  }, { passive: false });
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
  // Start a layout transaction without removing focused elements from the
  // accessibility tree. `finishMenuClickTargets` hides only rows not authored
  // by this completed frame, so Tab focus survives ordinary redraws.
  for (const button of chrome.buttons) delete button.dataset.layoutPresent;
}

export function finishMenuClickTargets(chrome: MenuActionChrome): void {
  let present = 0;
  for (const button of chrome.buttons) {
    if (button.dataset.layoutPresent === 'true') {
      present++;
      continue;
    }
    button.hidden = true;
  }
  chrome.container.hidden = present === 0;
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
    scope = state,
    entries,
    selected,
    count,
    x,
    firstBaseline,
    width,
    step,
    indexOffset = 0,
    actions,
    wheelNavigation = false,
  } = layout;
  if (entries.length > 0) chrome.container.hidden = false;
  entries.forEach((entry, visibleIndex) => {
    const target = indexOffset + visibleIndex;
    // The absolute state-menu index is the DOM identity. Sliding a Replay
    // window therefore does not silently turn the focused row into another
    // session merely because it occupies the same visible slot.
    const button = menuActionButton(chrome, scope, target);
    const row = v4MenuRowGeometry(
      firstBaseline + visibleIndex * step,
      step,
    );
    button.hidden = false;
    button.dataset.layoutPresent = 'true';
    button.textContent = entry;
    button.setAttribute('aria-label', entry);
    if (target === selected) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
    button.dataset.state = state;
    button.dataset.layoutScope = scope;
    button.dataset.selected = `${selected}`;
    button.dataset.target = `${target}`;
    button.dataset.count = `${count}`;
    button.dataset.visibleCount = `${entries.length}`;
    button.dataset.wheelNavigation = `${wheelNavigation}`;
    button.setAttribute('aria-posinset', `${target + 1}`);
    button.setAttribute('aria-setsize', `${count}`);
    const action = actions?.[target];
    if (action === undefined) delete button.dataset.action;
    else button.dataset.action = action;
    button.style.left = `${x}px`;
    button.style.top = `${row.top}px`;
    button.style.width = `${width}px`;
    button.style.height = `${row.height}px`;

    const pending = pendingMenuFocus.get(chrome.container);
    if (
      pending?.scope === scope
      && pending.target === selected
      && target === selected
    ) {
      pendingMenuFocus.delete(chrome.container);
      button.focus({ preventScroll: true });
    }
  });
}

export function stopControllerActivationKey(event: Event): void {
  event.stopPropagation();
}

export function stopTouchButtonActivationKey(event: KeyboardEvent): void {
  if (event.code === 'Space' || event.code === 'Enter') {
    event.stopPropagation();
  }
}
