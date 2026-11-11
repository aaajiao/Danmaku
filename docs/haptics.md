# Haptics — gamepad rumble

The tactile counterpart to [`docs/audio.md`](./audio.md). The game drives the
two motors of a dual-rumble controller from the same drained run events that
trigger sound. This document is what you need to tune a cue, add one, or reason
about why rumble is allowed to fail without anyone noticing.

§1–§2 say what rumble is and who owns what. §3 is the event table, §4 the cue
vocabulary, §5 which pad rumbles, §6 the setting. §7 is how to extend it, §8
verification, §9 the limits nobody has been able to remove.

Every number below was read from the code. If one disagrees with the source,
the source is right and this page is stale.

## 1. What rumble is, and what it is not

Rumble is **presentation only**. It is mapped from `RunEvent`s in the shell,
beside audio, and it never goes the other way:

- it is not read by the simulation, and nothing in `src/sim`, `src/content`,
  `src/game`, `src/v4/gameplay` or `src/core` imports it (`architecture.test.ts`
  bans the import — type-only, multi-line and dynamic forms included — because
  `GameContext` carries the setting as a plain value instead);
- it draws from neither RNG stream — a cue is a table of numbers, not a
  distribution (CLAUDE.md, rule 2 is about cosmetics drawn from `sim`; rumble
  does not draw at all);
- it never feeds the input mask (CLAUDE.md, rule 4). The one place it reads a
  pad, `GamepadRumble.observe()`, is output-side: it never reaches `sample()`;
- a replay neither records nor reproduces it. A recording made on a machine with
  no controller is the same run as one made with rumble on, and replay playback
  and video export never rumble at all.

That last point is the whole safety argument. Because nothing downstream reads
rumble, a bug in it can feel wrong but cannot desynchronise a replay, and the
shell is built so that a thrown exception at the device boundary can only
switch rumble off for the session (§2).

### Two clocks

Deliberately separate, and the reason the pieces below are split the way they
are:

- **The tick clock** decides *what is felt*. Cue envelopes are authored in
  fixed ticks (60 Hz) and advanced only by `HapticMixer.step()`, once per
  simulation tick — the "step() and nowhere else" discipline the background
  engine keeps for `uTick`. A cue on a wall clock would drift against the run it
  describes while every test stayed green.
- **The wall clock** decides *when a write may leave*. Only `HapticOutput`
  reads it (`performance.now()`), and only to pace hardware writes. It can
  delay a write or repeat one; it cannot invent a level the mixer did not
  produce.

## 2. Modules and owners

```
src/haptics/types.ts           contract: HapticLevel, HapticSegment, HapticSpec, HapticSink
src/haptics/index.ts           registry (defineHaptic) and the generic floor cues, defined at its bottom
src/haptics/mixer.ts           HapticMixer: voices folded to one level per tick
src/haptics/output.ts          HapticOutput: paces writes onto a sink
src/haptics/gamepad-rumble.ts  GamepadRumble: sinks over the Gamepad API's actuator
src/game/haptic-cues.ts        EVENT_HAPTICS, SHELL_HAPTICS, the graze gate, RumbleSetting helpers
src/v4/haptics/index.ts        the five per-bomb cues and v4EventHaptic
src/shell/rumble.ts            Rumble: the shell's controller — which pad, pause, hidden page, failure
src/shell/settings.ts          localStorage-backed string settings (RUMBLE_SETTING_KEY)
src/core/input.ts              activeGamepad / lastGamepad, PAD_HANDOVER_SAMPLES
src/game/states.ts             GameContext.rumble / onRumbleChange, the title-menu row
src/main.ts                    composition: builds the controller and hands it one frame of facts per tick
test/visual/haptics.*          the manual tuning page
```

- **`src/haptics/index.ts`** is the registry. `defineHaptic` sanitises rather
  than throws, because a spec may come from a content file: a non-finite number
  becomes 0, magnitudes clamp to 0..1, `ticks` is floored and a segment under
  one tick is dropped, `throttleTicks` is floored at 0, and the total length is
  capped at `MAX_HAPTIC_TICKS` (600, ten seconds) by truncating the tail. A
  duplicate name **replaces**, like `defineSound`. The floor cues are defined at
  the bottom of the same module, not in a sibling: an `import './cues'` from
  the top would be hoisted and evaluated before the registry `Map` exists.
- **`HapticMixer`** holds eight voices (the OLDEST is stolen when full — the
  newest event is the one the player just caused) and folds them with a
  per-channel **max**, not a sum: two cues together should feel like the
  stronger of the two, and a sum would clip and flatten both. `gain` is the
  master level. `step()` allocates nothing and returns a reused object, so a
  caller must not retain it. `clear()` drops every voice but keeps the throttle
  clocks, so a cue cannot re-fire the instant after one.
- **`HapticOutput`** quantises each channel to integer percent before comparing
  (float noise never costs a write), writes a changed level no more often than
  every 50 ms (the newest level wins; nothing queues), asks the device to hold
  each write for 600 ms and re-writes an unchanged non-zero level every 250 ms
  to stay ahead of that hold. A zero level stops the sink at once, not delayed
  by the 50 ms floor. The 50 ms is an IPC-hygiene and perceptual floor, not a
  hardware limit; `Loop` can run up to five catch-up ticks in one frame, and
  five `update()` calls in the same millisecond produce at most one write. Every
  write leaves from `update()` or `silence()`; the sink's `onExpired` callback
  only raises a flag the next `update()` reads, and that flag skips the 250 ms
  refresh wait but never the 50 ms floor. There are no promises in this class.
  `onExpired` fires when a hold ran out **or was stopped by something other
  than this driver** (§9); a preemption the driver caused itself is always
  stale by the time it settles, because every send and stop advances a serial
  first.
- **`GamepadRumble`** adapts the Gamepad API. It tracks a slot's *generation*
  (it increments each time a slot goes from empty to a connected pad) and keys
  sinks and refusals on `(index, generation)` — never on `id`, which cannot tell
  two identical pads apart on macOS, and never on object identity. It re-reads
  `navigator.getGamepads()` at every `send` and `stop` and never retains a
  `Gamepad`. Nothing in it throws to the caller.
- **`Rumble`** (`src/shell/rumble.ts`) is the shell's controller, and the only
  thing `main.ts` talks to. Each tick `main.ts` hands it one plain
  `RumbleFrame` — the live run (or none), whether a pause menu is up, whether
  the page is hidden, and `Input`'s two pad answers — and it decides the rest.
  It exists as a module because `main.ts` cannot be imported by a test: an
  earlier version kept these decisions inline, and a review removed six of them
  at once with the whole suite still green. `rumble.test.ts` now runs them
  against the real mixer and driver, and `main-render-contract.test.ts` pins
  the facts `main.ts` hands over.

  `Loop` has no `try/catch` around `tick()`, so an exception escaping the
  device boundary would stop the game drawing, for a feature the game does not
  need. Every call into the mixer, the driver or the pads goes through one
  guard: a throw clears the mixer, silences the output, warns once, and rumble
  stays off for the session.

### Pause, a hidden page, and OFF

Three different stops, deliberately not the same one:

- **Pause freezes.** While a pause menu is the top state the mixer is not
  stepped and the device is told zero. On resume the envelope continues where
  the simulation does: a 120-tick bomb paused at tick 30 still has 90 ticks of
  rumble under 90 ticks of bomb. If the run that comes back is not the run that
  was paused — QUIT, RETRY — the frozen cues belonged to a run that no longer
  exists and are dropped.
- **A hidden page is silenced, not cleared.** `visibilitychange` to hidden and
  `pagehide` stop the motors synchronously (`Rumble.silence()`), and the frame's
  `hidden` flag keeps any tick that still runs from re-writing the level. The
  cues stay: ticks do not run on a hidden page, so the envelope waits with the
  simulation.
- **OFF drops everything.** Switching the setting to OFF clears the mixer and
  stops the motors once.

`Rumble.step` runs exactly once per tick, after that tick's events have been
played.

## 3. The event table

`EVENT_HAPTICS` in `src/game/haptic-cues.ts` is a **total** record over
`RunEventType`: every one of the seventeen types has a row, and the row is
either a cue name or an explicit `null`. `EVENT_SOUNDS` is a `Partial`, which
lets a new event arrive silently unmapped; here an eighteenth event fails to
compile until someone decides whether it is felt. A `null` is a decision.

| Event | Cue | Why |
|---|---|---|
| `shot` | silent | Every player volley. At 10–20 Hz for a whole run it is a constant buzz that masks every cue that means something. |
| `shot-hit` | silent | As dense as `shot`, and it reports the player's success, not a threat. |
| `enemy-killed` | silent | Trash dies in clusters; a pulse per kill saturates the motor in a wave. |
| `boss-hit` | silent | Fires on every damaging tick of a boss fight — the same saturation. |
| `pickup` | silent | Pickups arrive in showers on every kill and bomb conversion. |
| `boss-entered` | silent | Reports the fly-in settling. `boss-arriving` already carried the swell across the approach and `boss-phase` declares the card; a third cue would cut the swell short. |
| `boss-cleared` | silent | Ends every card, so it lands beside `boss-break` or `boss-defeated`, each with its own cue, and ahead of the next `boss-phase`. A cue of its own would double them. |
| `failed` | silent | Always lands on the same tick as the final `player-death` and would be hidden under, or preempt, that cue. |
| `graze` | `graze` | Gated, see below. |
| `player-death` | `death` | |
| `bomb` | `bomb` (floor), or a v4 per-bomb cue | `v4EventHaptic` is consulted first; the floor is what a guest pack's bomb gets. |
| `extend` | `extend` | |
| `boss-arriving` | `boss-arrive` | |
| `boss-phase` | `boss-phase` | |
| `boss-break` | `boss-break` | |
| `boss-defeated` | `boss-defeat` | |
| `cleared` | `clear` | |

The shell resolves a cue as `v4EventHaptic(event) ?? EVENT_HAPTICS[event.type]`,
the same shape as sound. A separate list, `SHELL_HAPTICS` (`['ui-test']`), names
the cues the shell plays that no run event raises.

**The graze gate.** `shouldPlayRunEventHaptic` holds back exactly one event type.
A `graze` does not play while the player is invulnerable (it reports nothing
to act on, and it would pile onto the bomb or death envelope already playing)
or in a drained batch that carries `boss-arriving` (so the swell starts clean).
Every other event plays whenever its row names a cue.

## 4. The cue vocabulary

A cue is a list of segments, each holding one `(strong, weak)` level for a
number of ticks, played in order and then silence. A zero segment is an authored
gap. These are the floor cues in `src/haptics/index.ts`; the length is the sum
of the tick counts.

| Cue | Segments (strong / weak × ticks) | Ticks | Throttle |
|---|---|---|---|
| `graze` | 0 / 0.18 × 5 | 5 | 20 |
| `death` | 1.0/0.8 × 8, 0.7/0.5 × 8, 0.4/0.25 × 10, 0.18/0.1 × 10 | 36 | 0 |
| `bomb` | 0.75/0.55 × 6, 0.5/0.35 × 14, 0.3/0.2 × 20 | 40 | 0 |
| `extend` | 0/0.5 × 4, 0/0 × 5, 0/0.5 × 4 | 13 | 0 |
| `boss-arrive` | a swell on strong: 0.12 → 0.22 → 0.32 → 0.4 → 0.22 → 0.1 | 66 | 0 |
| `boss-phase` | 0.2/0.35 × 4, 0.08/0.15 × 6 | 10 | 0 |
| `boss-break` | 0.3/0.6 × 5, 0.1/0.25 × 8 | 13 | 0 |
| `boss-defeat` | 1.0/1.0 × 10, 0.75/0.6 × 14, 0.5/0.35 × 18, 0.28/0.15 × 20, 0.12/0.05 × 18 | 80 | 0 |
| `clear` | 0.35/0.35 × 8, 0/0 × 4, 0.5/0.5 × 10, 0.2/0.2 × 10 | 32 | 0 |
| `ui-test` | 0.5/0.5 × 8 | 8 | 0 |

### The cap rule, and why the strong motor is the left grip

On a dual-rumble pad `strong` is the low-frequency motor in the **left** grip
and `weak` the high-frequency motor in the right. The left hand's thumb is on
the stick. A heavy low-frequency pulse there shakes the very thumb that is
dodging, which is the one input the player cannot afford to have disturbed.

So the rule: a cue that fires while the player is **still vulnerable and
dodging** — `graze`, `extend`, `boss-phase`, `boss-break` — keeps
`strong <= 0.35` and carries its energy on `weak`. A cue covered by
invulnerability or a cleared field — `death`, `bomb`, `boss-arrive`,
`boss-defeat`, `clear` — may use the strong motor freely. `index.test.ts` pins
the rule for the four capped cues. `boss-arrive` is on the free side because the
field is cleared for the entrance; its swell nevertheless peaks at 0.4 on
strong with almost nothing on weak, because it is meant to be felt as a rising
pressure, not a hit.

`graze` is sparse on purpose: a throttle of 20 ticks is at most three starts a
second, weak motor only. A first draft used a 6-tick throttle, which measured as
saturating into a 10 Hz, 50 percent duty buzz in dense play — a texture, not a
cue.

### The five v4 bomb cues

Each v4 character's bomb is a different verb on screen, so each has its own cue
in `src/v4/haptics/index.ts`, registered under `bomb.<name>` and selected by
`v4EventHaptic` from the `bomb` event's `name`. A bomb absent from
`V4_BOMB_HAPTICS` (any guest pack's) falls back to the generic `bomb`.

| Bomb | Cue | Ticks | Shape |
|---|---|---|---|
| `scout-tide` | `bomb.scout-tide` | 90 | a surge, a pull back, a second swell, draining out |
| `lance-pierce` | `bomb.lance-pierce` | 60 | one full-strength punch, then a hum carried on weak |
| `hound-pack` | `bomb.hound-pack` | 72 | six bites, each weaker, separated by equal gaps |
| `spire-field` | `bomb.spire-field` | 120 | a slam, a settle, then four slow breaths |
| `maw-devour` | `bomb.maw-devour` | 45 | three closing jaws, each softer |

Two rules each cue keeps, both pinned by `src/v4/haptics/index.test.ts`:

- **Its length is its bomb's `duration`.** The test, "each cue's total length
  equals its bomb's duration", re-derives the number from the registered bombs.
  Retune a bomb's duration and this fails until the cue follows. A cue that
  outlived the blast would be felt over a field the player can see is back; one
  that stopped early would fall silent mid-effect.
- **It opens on the strong motor (at least 0.6) within its first 3–8 ticks.** A
  bomb is a panic button and its answer is front-loaded. The cap rule allows it
  because each cue is no longer than its bomb's `invulnTicks` (also pinned:
  "the strong motor only runs while the bomb covers the player"), so the strong
  motor only shakes the thumb while the player cannot be hit.

## 5. Which pad rumbles

Only one pad rumbles: the one the player's hands are on. `Input` exposes two
getters, both derived solely from values `sample()` already computes, so they
add no `consume()` call, no extra `getGamepads()` and no reordering to the
replay-relevant path (CLAUDE.md, rule 4). The mask, the latch and the edges are
bit-identical to before they existed.

- **`lastGamepad`** is the `getGamepads()` array position of the standard pad
  that most recently contributed a non-zero mask. It is cleared only when that
  slot is empty or disconnected at a later sample. If two pads contribute in
  the same sample, the later slot wins.
- **`activeGamepad`** is `lastGamepad`, unless the player's hands have moved
  elsewhere: a keyboard key or a non-pad source (pointer, touch) contributed a
  non-zero mask in a sample where no standard pad had contributed for at least
  `PAD_HANDOVER_SAMPLES` (30) consecutive samples — half a second at 60 Hz. It
  returns to the pad the next time a pad contributes. The hysteresis exists so
  one stray mouse nudge or key brush mid-fight cannot hand rumble away.
- **The WebHID source never hands rumble away.** The same physical Xbox One S
  can arrive through both the standard Gamepad API and the WebHID reader
  (`src/core/xbox-webhid.ts`, which re-opens a previously granted device at
  boot). WebHID is declared `isGamepad = true`, so its bits are excluded from
  the "off-pad" input that triggers a handover; otherwise every press on that
  pad would count as the hands leaving it. Neither getter is cleared by
  `reset()`, and `override()` does not touch them: they are not simulation
  state, and the pad in the player's hands is the same after a restart.

`rumbleTarget` (`src/shell/rumble.ts`) picks the target as
`input.activeGamepad`, falling back on `input.lastGamepad` only when no live
run is on the stack. During play the
fallback is deliberately absent: a player on the keyboard should not have a
pad on the desk buzz. On menus the last pad is enough, so the RUMBLE row's test
pulse reaches the controller even if the row was confirmed with the mouse.

A "live run" is one the player is flying: a replay playback or a video export
(`run.playingBack`) never rumbles.

## 6. The setting

Three levels: **OFF / LOW / FULL**. `RUMBLE_GAIN` maps them to a master gain on
the mixer: 0, 0.5 and 1. The default is FULL.

- **Where it lives.** The title menu's last row, `RUMBLE  OFF|LOW|FULL`;
  confirming it cycles off → low → full → off. The value is stored under
  `danmaku.rumble` in `localStorage` through `src/shell/settings.ts`, the first
  persisted setting the project has. `loadSetting`/`saveSetting` swallow every
  failure (a sandboxed frame, blocked site data and a full quota can all throw,
  merely on *reading* the `localStorage` getter) and a stored value that is not
  exactly one of the three is replaced by the default. A setting that cannot be
  saved still works for the session.
- **It is not simulation state.** `GameContext.rumble` is a plain value; it
  never enters `RunConfig`, a replay, or the simulation. The row writes it back
  and calls `onRumbleChange`, which persists it and applies the gain. The state
  machine never learns a motor exists.
- **Every change to a non-OFF level plays a `ui-test` pulse**, and first calls
  `retry()` so a pad refused while it was away gets another chance. The pulse is
  the player's proof, in the installed PWA too, that rumble reaches the pad.
  Switching to OFF stops the motors at once.
- **The row appears once there is something to feel it on.** `ctx.rumble`
  starts `undefined`, and `TitleState` builds no row for it, the same way
  `replaySessions` hides REPLAYS. The shell sets it the first time
  `GamepadRumble` sees a connected pad with a callable `playEffect`
  (`seenCapable`), and it then stays for the session. So the row never shows in
  Firefox (no `playEffect`), nor on a phone played with the touch controls —
  `GamepadRumble.supported()` alone cannot tell those apart, since every
  Chromium build has the prototype method whether or not a pad exists. A switch
  that does nothing must not be offered. A browser lists a pad only after one
  of its buttons has been pressed, so on a fresh page the row arrives with the
  first press.
- **The stored setting applies from the first tick**, row or no row: the
  controller is built with it, so a player who chose LOW last week gets LOW
  before the menu has shown them the switch.
- Even with the setting OFF, `observe()` still runs every tick and still resets
  each newly seen pad (§9). The setting governs what is *sent*, not what is
  cleaned up.

## 7. Adding a cue

A registered cue plays nothing on its own, exactly as with sound: it needs a
name in something that gets played, and `reachability.test.ts` fails the build
for a cue nothing selects.

1. **Define it.** Generic cues go at the bottom of `src/haptics/index.ts`;
   edition cues go under `src/v4/haptics/` and are imported by the edition
   root (`src/v4/index.ts` imports `./haptics` after `./audio`):

   ```ts
   // illustrative: not a cue in the tree
   defineHaptic('boss-warning', {
     segments: [
       { strong: 0.1, weak: 0.2, ticks: 6 },
       { strong: 0, weak: 0, ticks: 4 },
       { strong: 0.1, weak: 0.2, ticks: 6 },
     ],
     throttleTicks: 30,
   });
   ```

   Apply the cap rule (§4) before choosing the numbers: will the player be
   vulnerable when this lands?
2. **Name it.** A cue for a run event goes in the right-hand column of
   `EVENT_HAPTICS` (or, if v4 owns the nuance, in `v4EventHaptic`). A cue the
   shell plays with no run event goes in `SHELL_HAPTICS`. Adding a new
   `RunEventType` fails to compile until it has a row.
3. **Make something reach it.** `reachability.test.ts` has a test, "every
   registered haptic cue, via an event something raises", which asserts both
   columns: every cue a table selects is registered, every registered cue is
   named by a table, and every non-exempt cue was actually selected during a real
   scripted playthrough, gated by `shouldPlayRunEventHaptic` as the shell gates
   it. Two names are exempt: the `SHELL_HAPTICS` list, and the floor `bomb`,
   whose exemption is itself asserted — the test fails if a v4 bomb ever falls
   through to it.

### Giving a new bomb its own cue

A new v4 bomb (see [`docs/extending.md`](./extending.md) §7) without a haptic
cue falls back to the floor `bomb`, which works but tells the player's hands it
did the same thing as every other bomb. To give it its own:

1. Add its registry name to `V4_BOMB_HAPTICS` and a spec to
   `V4_BOMB_HAPTIC_SPECS` in `src/v4/haptics/index.ts`.
2. **Make the cue exactly as long as the bomb's `duration`** — the length test
   re-derives it from the registered bomb and fails otherwise.
3. Open on the strong motor, at 0.6 or more within the first 3–8 ticks, and
   keep the cue no longer than the bomb's `invulnTicks` so that is safe.
4. A real playthrough must detonate the bomb. `reachability.test.ts` already
   demands that every registered bomb fire and, in the haptic test, that each
   registered non-exempt cue was selected. The floor `bomb` is exempt only
   while no v4 bomb falls through to it, so a v4 bomb you forget to add to
   `V4_BOMB_HAPTICS` fails that assertion by reaching the floor cue.

## 8. Verification

There are two acceptance surfaces, and they answer different questions.

- **`bun test`** covers everything that does not need hardware, against fakes:
  the registry's sanitising, the mixer's voices, throttle and gain, the output
  driver's pacing, refusal handling and sink switching, the input getters, the
  setting, the table and the reachability of every cue. It cannot say whether
  anything is *felt*.
- **The in-app RUMBLE row is the acceptance check for the installed PWA.**
  Changing it to LOW or FULL plays `ui-test` on the pad in your hands. If you
  feel it, the whole path — standard Gamepad API, `playEffect`, the browser's
  haptics stack, the pad — works in that origin and that shell. The tuning page
  below cannot test the installed app: the app is a different origin.
- **`bun run test:haptics`** (`http://localhost:3010`) is for tuning envelopes in
  a tab. It drives the real mixer on a fixed 60 Hz accumulator, the real output
  driver and the real Gamepad sinks, with a button per registered cue (the five
  bomb cues included), and shows each `playEffect` result. It needs a physical
  pad. It picks its target pad by the game's own rule — it samples a real
  `Input` each tick and calls `rumbleTarget` — because *which* pad rumbles is
  the part only hardware can test; the selector switches between the menu rule,
  the live-play rule and an explicit slot override, and the readout shows both
  `Input` getters. (The page does not attach `Input` to the keyboard, so the
  keyboard half of the handover is not exercised there.) It is output-only: the
  sampled mask is discarded, and it is not covered by `bun run typecheck`
  (tsconfig includes only `src`).

Also run, after any change here: `bun run typecheck`, `bun test`, and
`bun run build`.

## 9. Known limits

These are real, and some cannot be fixed from the page.

- **On Chromium the motor is stopped only from the page's own main thread.**
  Blink posts a task on the renderer's main thread when an effect completes;
  there is no browser-side stop. So "hold for N ms" protects only against *our*
  loop stopping while the renderer is alive. A **hung** renderer holds its
  level for the length of the hang. A **crashed** one can leave a motor running
  until something sends a new effect or a reset. That is why every newly seen
  pad is `reset()` exactly once per `(index, generation)`, whatever the
  setting: it is the only recovery available. Chromium can list a pad some
  ticks before it exposes the pad's actuator, so the reset stays owed until an
  actuator has actually taken it.
- **Blink's own deferred reset can stop an effect we just sent.** When an
  effect completes, Blink re-arms a posted reset; if that "complete" is handled
  *after* our next write (a main-thread stall of 600 ms or more does it), the
  reset zeroes the motor and resolves the newer effect `"preempted"`. Another
  page driving the same pad ends the same way. `GamepadRumble` therefore
  reports `"preempted"` exactly like `"complete"`, and `HapticOutput` re-writes
  the level at the next 50 ms floor instead of leaving a hole until the 250 ms
  refresh. Whether the first ordering actually occurs on a given machine has
  not been measured; the handling is the same either way.
- **The page-lifecycle stops are best effort.** `visibilitychange` to hidden
  and `pagehide` call `Rumble.silence()` synchronously, because
  `requestAnimationFrame` — and so the tick that would end a cue — stops while
  the page is hidden. They cannot help against a renderer that is already dead.
- **WebHID rumble for the Xbox One S (output report 3) was researched and
  deliberately not built.** The pad already arrives through the standard Gamepad
  API in the installed PWA (verified on the owner's device, Chrome 157, after
  Chromium's fix for the app-shim problem). A second writer to the same motors
  would have undefined interaction with the OS's GameController/CoreHaptics
  path, and the controller's firmware is flagged as buggy upstream. There is one
  device path and it is the standard API.
- **Firefox has no `playEffect`.** The row never appears there (§6) and the
  whole feature is inert. Desktop Safari has had it since 16.4 according to
  MDN's compatibility data; iOS Safari does not. Only Chromium has been run
  against this code.
- **The pause menu has no RUMBLE row yet.** The pause card shows four rows
  (RESUME, TAKE SCREENSHOT, RETRY/SAVE + RETRY, QUIT/SAVE + QUIT) and a fifth
  would not fit; the setting is reachable from the title menu only. Pausing
  still silences the pad (§2).
- **Real-device questions remain open.** Whether CoreHaptics rumbles behind the
  PWA app shim, and how each envelope actually feels — the bomb cues, the boss
  swell, whether `graze` reads as a tap or a tickle — cannot be answered by any
  test. They are answered on a pad, by the RUMBLE row and by
  `bun run test:haptics`.
- **Some failures are quiet by design.** The Gamepad API resolves
  `playEffect` with `"invalid-parameter"` or `"not-supported"` instead of
  rejecting, and rejects with an `undefined` reason when a pad is gone.
  `GamepadRumble` treats `"invalid-parameter"` as our own bug (it refuses that
  `(index, generation)` for good and warns once) and the others as a refusal
  that lasts until the slot's generation changes or `retry()` is called. A
  pad that cannot rumble is simply silent; nothing throws.
