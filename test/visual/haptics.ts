/**
 * Manual tuning page for gamepad rumble.
 *
 * ## Why this is not a unit test
 *
 * Every guarantee that can be checked without hardware is checked in
 * `src/haptics/*.test.ts` against fakes. What no fake can answer is how an
 * envelope FEELS, and whether the real browser accepts what we send. This page
 * drives the real modules (the mixer on a fixed 60 Hz accumulator, the output
 * driver, the Gamepad API sinks) so a person with a pad can tune cues and watch
 * every `playEffect` result.
 *
 * It is output-only: `getGamepads()` is read for display and for the sink,
 * never for gameplay (CLAUDE.md, rule 4). The page does build a real `Input`
 * and sample it once per tick, for one reason: WHICH pad rumbles is the part
 * of the feature that only hardware can test, and the game decides it from
 * `Input.activeGamepad` / `lastGamepad`. A page that picked "the first
 * connected slot" instead could pass on a desk where the game stays silent.
 * The mask `sample()` returns is discarded.
 *
 * ## Running it
 *
 *     bun run test:haptics     # http://localhost:3010
 *
 * It is not covered by `bun run typecheck` (tsconfig includes only `src`).
 * It cannot test the installed PWA: that is a different origin, and the in-app
 * RUMBLE row is the acceptance check there.
 */

import { hapticNames } from '../../src/haptics';
import { GamepadRumble } from '../../src/haptics/gamepad-rumble';
import { HapticMixer } from '../../src/haptics/mixer';
import { HapticOutput } from '../../src/haptics/output';
import { RUMBLE_GAIN, RUMBLE_SETTINGS, type RumbleSetting } from '../../src/game/haptic-cues';
import { Input } from '../../src/core/input';
import { rumbleTarget } from '../../src/shell/rumble';
// Registers the five per-bomb cues so they show up as buttons.
import '../../src/v4/haptics';

const TICK_MS = 1000 / 60;
const MAX_CATCH_UP = 5;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/** The parts of a Gamepad this page reads that lib.dom does not declare. */
interface ActuatorView {
  playEffect?: (type: string, params: unknown) => Promise<unknown>;
  effects?: readonly string[];
}

const mixer = new HapticMixer();
const output = new HapticOutput({ now: () => performance.now() });
const patched = new WeakSet<object>();
const logLines: string[] = [];

function log(line: string): void {
  logLines.push(`${(performance.now() / 1000).toFixed(2).padStart(8)}  ${line}`);
  if (logLines.length > 200) logLines.shift();
  const box = el('log');
  box.textContent = logLines.join('\n');
  box.scrollTop = box.scrollHeight;
}

/** Pads, with each actuator's playEffect wrapped once so results are logged. */
function pads(): readonly (Gamepad | null)[] {
  const list = navigator.getGamepads?.() ?? [];
  for (const pad of list) {
    const actuator = pad?.vibrationActuator as unknown as ActuatorView | null | undefined;
    if (!actuator || typeof actuator.playEffect !== 'function' || patched.has(actuator)) continue;
    patched.add(actuator);
    const original = actuator.playEffect.bind(actuator);
    actuator.playEffect = (type: string, params: unknown) => {
      const text = JSON.stringify(params);
      let promise: Promise<unknown>;
      try {
        promise = original(type, params);
      } catch (error) {
        log(`playEffect ${text} THREW ${String(error)}`);
        throw error;
      }
      promise.then(
        (result) => log(`playEffect ${text} -> ${String(result)}`),
        (reason) => log(`playEffect ${text} REJECTED ${String(reason)}`),
      );
      return promise;
    };
  }
  return list;
}

const rumble = new GamepadRumble(pads);
let setting: RumbleSetting = 'full';
/**
 * How the target pad is chosen. `menu` and `live` are the game's own rule
 * (`rumbleTarget`) for its two situations; a number is an explicit override.
 */
type TargetMode = 'menu' | 'live' | 'none' | number;
let targetMode: TargetMode = 'menu';
let target: number | undefined;
// Not attached to the keyboard: `Input` swallows the arrow keys, which the
// sliders below need. So the keyboard half of the handover rule is not
// exercised here; the pad half (which slot contributed, and when) is.
const input = new Input();

function resolveTarget(): number | undefined {
  if (typeof targetMode === 'number') return targetMode;
  if (targetMode === 'none') return undefined;
  return rumbleTarget(input.activeGamepad, input.lastGamepad, targetMode === 'live');
}
/** While a raw send is holding, the tick loop leaves the sink alone. */
let rawUntil = 0;
let lastLevel = { strong: 0, weak: 0 };

function tick(): void {
  // Once per tick, as the game does; only the pad bookkeeping is used.
  input.sample();
  const next = resolveTarget();
  if (next !== target) {
    target = next;
    log(`target pad -> ${target === undefined ? 'none' : target}`);
  }
  rumble.observe();
  lastLevel = { ...mixer.step() };
  if (performance.now() < rawUntil) return;
  output.update(lastLevel, setting === 'off' ? undefined : rumble.sink(target));
}

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(now - last, 250);
  last = now;
  let n = 0;
  while (acc >= TICK_MS && n < MAX_CATCH_UP) {
    tick();
    acc -= TICK_MS;
    n++;
  }
  if (n === MAX_CATCH_UP) acc = 0;
  requestAnimationFrame(frame);
}

function stopAll(): void {
  mixer.clear();
  rawUntil = 0;
  output.silence();
  log('stop');
}

function setSetting(next: RumbleSetting): void {
  setting = next;
  mixer.gain = RUMBLE_GAIN[next];
  if (next === 'off') stopAll();
  else {
    rumble.retry();
    mixer.play('ui-test');
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gains button')) {
    b.classList.toggle('on', b.dataset['s'] === next);
  }
}

// --- UI ---------------------------------------------------------------------

for (const s of RUMBLE_SETTINGS) {
  const b = document.createElement('button');
  b.textContent = s.toUpperCase();
  b.dataset['s'] = s;
  b.addEventListener('click', () => setSetting(s));
  el('gains').append(b);
}
for (const name of hapticNames()) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => {
    const ok = mixer.play(name);
    log(`cue ${name} ${ok ? 'started' : 'refused (throttled or empty)'}`);
  });
  el('cues').append(b);
}

for (const id of ['rawStrong', 'rawWeak', 'rawDur']) {
  const input = el<HTMLInputElement>(id);
  const show = () => (el(`${id}V`).textContent = input.value);
  input.addEventListener('input', show);
  show();
}

el('rawSend').addEventListener('click', () => {
  const sink = rumble.sink(target);
  if (!sink) {
    log('raw send: no sink for the target pad');
    return;
  }
  const dur = Number(el<HTMLInputElement>('rawDur').value);
  mixer.clear();
  rawUntil = performance.now() + dur;
  sink.send(
    { strong: Number(el<HTMLInputElement>('rawStrong').value), weak: Number(el<HTMLInputElement>('rawWeak').value) },
    dur,
    () => log('raw send expired'),
  );
});

el('stop').addEventListener('click', stopAll);

el('block').addEventListener('click', () => {
  log('blocking main thread for 3 s');
  // Let the log line paint first, then spin.
  setTimeout(() => {
    const end = performance.now() + 3000;
    while (performance.now() < end) {
      /* busy wait: the motor should hold its level, then stop after the hang */
    }
    log('main thread released');
  }, 50);
});

el<HTMLSelectElement>('target').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  stopAll();
  targetMode = v === 'menu' || v === 'live' || v === 'none' ? v : Number(v);
});

function refreshPads(): void {
  const list = pads();
  const lines: string[] = [];
  const select = el<HTMLSelectElement>('target');
  const options: string[] = ['menu', 'live', 'none'];
  list.forEach((pad, i) => {
    if (!pad || !pad.connected) return;
    const actuator = pad.vibrationActuator as unknown as ActuatorView | null | undefined;
    const has = actuator ? typeof actuator.playEffect === 'function' : false;
    const effects = actuator?.effects ? actuator.effects.join(',') : 'n/a';
    lines.push(`[${i}] ${pad.id}\n    vibrationActuator: ${actuator ? 'yes' : 'no'}  playEffect: ${has ? 'yes' : 'no'}  effects: ${effects}`);
    options.push(String(i));
  });
  el('pads').textContent = lines.length ? lines.join('\n') : 'no pads (press a button on the pad)';
  if (options.join() !== Array.from(select.options, (o) => o.value).join()) {
    select.replaceChildren(
      ...options.map((v) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent =
          v === 'menu' ? 'game rule: on a menu (active, else last used)'
          : v === 'live' ? 'game rule: live play (active pad only)'
          : v === 'none' ? '(none)'
          : `override: slot ${v}`;
        return o;
      }),
    );
    // A pad that vanished takes an override on it back to the game's rule.
    if (typeof targetMode === 'number' && !options.includes(String(targetMode))) targetMode = 'menu';
    select.value = String(targetMode);
  }
  const show = (slot: number | undefined): string => (slot === undefined ? '-' : String(slot));
  el('level').textContent =
    `strong ${lastLevel.strong.toFixed(2)}   weak ${lastLevel.weak.toFixed(2)}   gain ${mixer.gain}   mixer active: ${mixer.active}   supported: ${GamepadRumble.supported()}\n` +
    `target ${show(target)}   Input.activeGamepad ${show(input.activeGamepad)}   Input.lastGamepad ${show(input.lastGamepad)}   seenCapable ${rumble.seenCapable}`;
}

setInterval(refreshPads, 250);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAll();
});
addEventListener('pagehide', () => {
  mixer.clear();
  output.silence();
});

setSetting('full');
mixer.clear(); // no startup pulse on load; the first non-off change plays ui-test
requestAnimationFrame(frame);
