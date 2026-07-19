import { describe, expect, test } from 'bun:test';

import { Button } from '../core/input';
import { Random } from '../core/random';
import { Emitter } from '../content/patterns';
import { BulletSystem, type BulletSpec, type FieldBounds } from './bullet';
import {
  deserialize,
  REPLAY_VERSION,
  ReplayPlayback,
  ReplayRecorder,
  serialize,
  type Replay,
} from './replay';

/** Record a whole mask sequence, one call per tick, and close it out. */
function recordAll(
  seed: number,
  masks: readonly number[],
  meta?: Record<string, string | number>,
): Replay {
  const recorder = new ReplayRecorder(seed);
  for (let tick = 0; tick < masks.length; tick++) {
    recorder.record(tick, masks[tick] as number);
  }
  return recorder.finish(masks.length, meta);
}

describe('recording', () => {
  test('a replay carries the version, seed and length', () => {
    const replay = recordAll(1234, [0, 0, 0]);

    expect(replay.version).toBe(REPLAY_VERSION);
    expect(replay.seed).toBe(1234);
    expect(replay.length).toBe(3);
  });

  test('only changes are stored, not one entry per tick', () => {
    const held = Button.Left;
    const replay = recordAll(1, [0, held, held, held, held, 0, 0]);

    expect(replay.inputs).toEqual([
      { tick: 1, buttons: held },
      { tick: 5, buttons: 0 },
    ]);
  });

  test('a run that starts with nothing held records nothing at tick 0', () => {
    expect(recordAll(1, [0, 0, 0]).inputs).toEqual([]);
  });

  test('a mask already live at tick 0 is recorded, since the implied prior is 0', () => {
    const replay = recordAll(1, [Button.Shot, Button.Shot]);
    expect(replay.inputs).toEqual([{ tick: 0, buttons: Button.Shot }]);
  });

  test('a mask that leaves and returns is recorded both times', () => {
    const replay = recordAll(1, [Button.Up, 0, Button.Up]);

    expect(replay.inputs).toEqual([
      { tick: 0, buttons: Button.Up },
      { tick: 1, buttons: 0 },
      { tick: 2, buttons: Button.Up },
    ]);
  });

  test('meta is copied, not aliased', () => {
    const meta = { stage: 'test', deaths: 0 };
    const replay = recordAll(1, [0], meta);

    meta.deaths = 99;
    expect(replay.meta).toEqual({ stage: 'test', deaths: 0 });
  });

  test('meta is absent, not undefined, when none was given', () => {
    expect('meta' in recordAll(1, [0])).toBe(false);
  });

  test('recording past finish does not mutate the replay already handed out', () => {
    const recorder = new ReplayRecorder(1);
    recorder.record(0, Button.Left);
    const replay = recorder.finish(1);

    recorder.record(1, Button.Right);
    expect(replay.inputs).toEqual([{ tick: 0, buttons: Button.Left }]);
  });

  test('a tick that does not advance is refused', () => {
    const recorder = new ReplayRecorder(1);
    recorder.record(7, Button.Left);

    expect(() => recorder.record(7, Button.Right)).toThrow(/must increase/);
    expect(() => recorder.record(3, Button.Right)).toThrow(/must increase/);
  });

  test('a non-integer or negative tick is refused', () => {
    const recorder = new ReplayRecorder(1);

    expect(() => recorder.record(1.5, 0)).toThrow(/non-negative integer/);
    expect(() => recorder.record(-1, 0)).toThrow(/non-negative integer/);
  });

  test('a length that would drop recorded input is refused', () => {
    const recorder = new ReplayRecorder(1);
    recorder.record(10, Button.Left);

    expect(() => recorder.finish(10)).toThrow(/would drop input/);
    expect(recorder.finish(11).length).toBe(11);
  });

  test('a negative length is refused', () => {
    expect(() => new ReplayRecorder(1).finish(-1)).toThrow(/non-negative integer/);
  });
});

describe('playback', () => {
  test('sequential access reproduces the recorded mask on every tick', () => {
    const masks = [0, 0, 1, 1, 1, 5, 5, 0, 128, 128, 128, 0];
    const playback = new ReplayPlayback(recordAll(1, masks));

    for (let tick = 0; tick < masks.length; tick++) {
      expect(playback.buttonsAt(tick)).toBe(masks[tick] as number);
    }
  });

  test('random access agrees with sequential access, in any order', () => {
    const masks = [0, 3, 3, 12, 12, 12, 0, 0, 64, 1, 1, 1, 1, 32];
    const replay = recordAll(1, masks);
    // Deterministic shuffle: test scaffolding, so any seeded stream will do.
    const order = [...masks.keys()];
    const shuffle = new Random(99);
    for (let i = order.length - 1; i > 0; i--) {
      const j = shuffle.int(0, i);
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }

    const playback = new ReplayPlayback(replay);
    for (const tick of order) {
      expect(playback.buttonsAt(tick as number)).toBe(masks[tick as number] as number);
    }
  });

  test('walking backwards is as correct as walking forwards', () => {
    const masks = [0, 0, 8, 8, 2, 2, 2, 0, 16];
    const playback = new ReplayPlayback(recordAll(1, masks));

    for (let tick = masks.length - 1; tick >= 0; tick--) {
      expect(playback.buttonsAt(tick)).toBe(masks[tick] as number);
    }
  });

  test('before the first entry the mask is 0', () => {
    const replay = recordAll(1, [0, 0, 0, Button.Bomb]);
    const playback = new ReplayPlayback(replay);

    expect(playback.buttonsAt(0)).toBe(0);
    expect(playback.buttonsAt(2)).toBe(0);
    // A tick before the run even began is still "nothing held".
    expect(playback.buttonsAt(-5)).toBe(0);
  });

  test('after the last entry the last mask holds', () => {
    const playback = new ReplayPlayback(recordAll(1, [0, Button.Slow, Button.Slow]));

    expect(playback.buttonsAt(2)).toBe(Button.Slow);
    expect(playback.buttonsAt(99)).toBe(Button.Slow);
    expect(playback.buttonsAt(1e6)).toBe(Button.Slow);
  });

  test('an empty input log reads as 0 everywhere', () => {
    const playback = new ReplayPlayback(recordAll(1, [0, 0, 0, 0]));

    expect(playback.buttonsAt(0)).toBe(0);
    expect(playback.buttonsAt(3)).toBe(0);
    expect(playback.buttonsAt(500)).toBe(0);
  });

  test('length is the recorded length', () => {
    expect(new ReplayPlayback(recordAll(1, new Array(60).fill(0))).length).toBe(60);
  });

  test('finished flips only once the last tick has been handed out', () => {
    const playback = new ReplayPlayback(recordAll(1, [0, 1, 1]));

    expect(playback.finished).toBe(false);
    playback.buttonsAt(0);
    expect(playback.finished).toBe(false);
    playback.buttonsAt(1);
    expect(playback.finished).toBe(false);
    playback.buttonsAt(2);
    expect(playback.finished).toBe(true);
  });

  test('the driving loop runs exactly `length` ticks', () => {
    const playback = new ReplayPlayback(recordAll(1, [0, 1, 1, 0, 2]));
    const seen: number[] = [];

    for (let tick = 0; !playback.finished; tick++) seen.push(playback.buttonsAt(tick));

    expect(seen).toEqual([0, 1, 1, 0, 2]);
  });

  test('a zero-length replay is finished before it starts', () => {
    expect(new ReplayPlayback(recordAll(1, [])).finished).toBe(true);
  });

  test('a replay of an unknown version is refused at construction', () => {
    const replay = { ...recordAll(1, [0]), version: REPLAY_VERSION + 1 };
    expect(() => new ReplayPlayback(replay)).toThrow(/version 2 is not supported/);
  });
});

describe('serialization', () => {
  test('round-trips exactly', () => {
    const replay = recordAll(0x5eed, [0, 1, 1, 9, 9, 0, 64], {
      stage: 'stage-1',
      build: 7,
    });
    const text = serialize(replay);
    const parsed = deserialize(text);

    expect(parsed).toEqual(replay);
    // Byte-identical too, so a fixture checked into the repo has a stable diff.
    expect(serialize(parsed)).toBe(text);
  });

  test('a round-tripped replay plays back identically', () => {
    const masks = [0, 4, 4, 4, 20, 20, 0, 1];
    const replay = recordAll(77, masks);
    const playback = new ReplayPlayback(deserialize(serialize(replay)));

    for (let tick = 0; tick < masks.length; tick++) {
      expect(playback.buttonsAt(tick)).toBe(masks[tick] as number);
    }
  });

  test('a replay with no meta round-trips without gaining one', () => {
    const parsed = deserialize(serialize(recordAll(1, [0, 1])));
    expect('meta' in parsed).toBe(false);
  });

  test('a negative seed survives the trip', () => {
    expect(deserialize(serialize(recordAll(-2147483648, [0, 1]))).seed).toBe(-2147483648);
  });

  test('malformed JSON is refused', () => {
    expect(() => deserialize('{ not json')).toThrow(/not valid JSON/);
  });

  test('a non-object payload is refused', () => {
    expect(() => deserialize('[]')).toThrow(/expected a JSON object/);
    expect(() => deserialize('null')).toThrow(/expected a JSON object/);
    expect(() => deserialize('42')).toThrow(/expected a JSON object/);
  });

  test('a version mismatch names both versions', () => {
    const text = serialize({ ...recordAll(1, [0]), version: 99 });
    expect(() => deserialize(text)).toThrow(/version 99 is not supported \(expected 1\)/);
  });

  test('a missing version is refused', () => {
    expect(() => deserialize('{"seed":1,"length":0,"inputs":[]}')).toThrow(
      /is not supported/,
    );
  });

  test('a non-integer seed is refused', () => {
    expect(() => deserialize('{"version":1,"seed":"x","length":0,"inputs":[]}')).toThrow(
      /seed must be an integer/,
    );
  });

  test('a bad length is refused', () => {
    expect(() => deserialize('{"version":1,"seed":1,"length":-1,"inputs":[]}')).toThrow(
      /length must be a non-negative integer/,
    );
    expect(() => deserialize('{"version":1,"seed":1,"length":1.5,"inputs":[]}')).toThrow(
      /length must be a non-negative integer/,
    );
  });

  test('inputs must be an array of well-formed entries', () => {
    const base = '{"version":1,"seed":1,"length":10,';

    expect(() => deserialize(`${base}"inputs":{}}`)).toThrow(/inputs must be an array/);
    expect(() => deserialize(`${base}"inputs":[3]}`)).toThrow(/inputs\[0\] must be an object/);
    expect(() => deserialize(`${base}"inputs":[{"buttons":1}]}`)).toThrow(
      /inputs\[0\]\.tick must be a non-negative integer/,
    );
    expect(() => deserialize(`${base}"inputs":[{"tick":-1,"buttons":1}]}`)).toThrow(
      /inputs\[0\]\.tick must be a non-negative integer/,
    );
    expect(() => deserialize(`${base}"inputs":[{"tick":0,"buttons":"a"}]}`)).toThrow(
      /inputs\[0\]\.buttons must be a non-negative integer/,
    );
  });

  test('out-of-order input entries are refused', () => {
    const text =
      '{"version":1,"seed":1,"length":10,"inputs":[{"tick":4,"buttons":1},{"tick":2,"buttons":0}]}';
    expect(() => deserialize(text)).toThrow(/does not follow 4 — ticks must increase/);
  });

  test('an input entry past the run length is refused', () => {
    const text = '{"version":1,"seed":1,"length":3,"inputs":[{"tick":3,"buttons":1}]}';
    expect(() => deserialize(text)).toThrow(/past the run length 3/);
  });

  test('meta must be a flat object of strings and numbers', () => {
    const base = '{"version":1,"seed":1,"length":1,"inputs":[],';

    expect(() => deserialize(`${base}"meta":[]}`)).toThrow(/meta must be an object/);
    expect(() => deserialize(`${base}"meta":{"a":{"b":1}}}`)).toThrow(
      /meta\.a must be a string or number/,
    );
    expect(deserialize(`${base}"meta":{"a":"x","b":2}}`).meta).toEqual({ a: 'x', b: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* The reason this module exists                                       */
/* ------------------------------------------------------------------ */

/**
 * A small but genuinely coupled scenario: the player moves and shoots, an
 * enemy emitter sprays at wherever the player is, and player shot draws its
 * own randomized heading from the sim stream.
 *
 * The coupling is the point. Holding Shot changes how many bullets are
 * spawned, which changes how many draws the sim stream has taken, which shifts
 * every enemy bullet fired afterwards. So a replay that reproduces this run is
 * proving the input log, the tick order and the RNG call order all survived —
 * not merely that arithmetic is repeatable.
 */

const FIELD: FieldBounds = { width: 384, height: 448, margin: 32 };
const PLAYER_SPEED = 4;
const SHOT_PERIOD = 4;

const PLAYER_SHOT: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 2,
  motion: { r: 9, trandom: { min: 265, max: 275 } },
};

const ENEMY_SPRAY: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 2, rrandom: { min: 1, max: 3 } },
};

/** Everything a diverging simulation would show up in. */
function digest(
  player: { x: number; y: number },
  bullets: BulletSystem,
  rng: Random,
): string {
  return JSON.stringify({
    player: [player.x, player.y],
    count: bullets.count,
    dropped: bullets.droppedSpawns,
    rng: rng.getState(),
    bullets: bullets.bullets.map((b) => [b.x, b.y, b.vector.r, b.vector.theta, b.faction]),
  });
}

function runScenario(replay: Replay): string {
  const rng = new Random(replay.seed);
  const bullets = new BulletSystem({ bounds: FIELD, initial: 256, max: 2048 });
  const emitter = new Emitter('spray', FIELD.width / 2, 60, 'enemy', {
    spec: ENEMY_SPRAY,
    count: 3,
    period: 5,
  });
  const player = { x: FIELD.width / 2, y: 360 };
  const playback = new ReplayPlayback(replay);

  for (let tick = 0; !playback.finished; tick++) {
    const buttons = playback.buttonsAt(tick);

    if (buttons & Button.Left) player.x -= PLAYER_SPEED;
    if (buttons & Button.Right) player.x += PLAYER_SPEED;
    if (buttons & Button.Up) player.y -= PLAYER_SPEED;
    if (buttons & Button.Down) player.y += PLAYER_SPEED;
    player.x = Math.max(0, Math.min(FIELD.width, player.x));
    player.y = Math.max(0, Math.min(FIELD.height, player.y));

    if (buttons & Button.Shot && tick % SHOT_PERIOD === 0) {
      bullets.spawn(player.x, player.y, PLAYER_SHOT, 'player', rng);
    }

    emitter.step(bullets, player.x, player.y, rng);
    bullets.step(player.x, player.y, rng);
  }

  return digest(player, bullets, rng);
}

/** A plausible run of held directions and shooting, from a seeded scratch stream. */
function improviseMasks(ticks: number, seed: number): number[] {
  const scratch = new Random(seed);
  const masks: number[] = [];
  let mask = 0;
  for (let tick = 0; tick < ticks; tick++) {
    // Change intent occasionally, so runs of held buttons are long enough for
    // the sparse encoding to actually be exercised.
    if (tick % 7 === 0) {
      mask = 0;
      if (scratch.random() < 0.6) mask |= scratch.random() < 0.5 ? Button.Left : Button.Right;
      if (scratch.random() < 0.4) mask |= scratch.random() < 0.5 ? Button.Up : Button.Down;
      if (scratch.random() < 0.7) mask |= Button.Shot;
      if (scratch.random() < 0.2) mask |= Button.Slow;
    }
    masks.push(mask);
  }
  return masks;
}

describe('a replay reproduces a real simulation', () => {
  const TICKS = 600;
  const SEED = 0x1234abcd | 0;
  const masks = improviseMasks(TICKS, 4242);

  test('the same seed and inputs produce byte-identical final state', () => {
    const replay = recordAll(SEED, masks);

    expect(runScenario(replay)).toBe(runScenario(replay));
  });

  test('it survives serialization — a replay off disk reproduces the run', () => {
    const replay = recordAll(SEED, masks);
    const fromDisk = deserialize(serialize(replay));

    expect(runScenario(fromDisk)).toBe(runScenario(replay));
  });

  test('the run really is worth recording — it spawns bullets and moves', () => {
    // A determinism assertion over an empty simulation proves nothing, so pin
    // that the scenario actually did work.
    const state = JSON.parse(runScenario(recordAll(SEED, masks))) as {
      count: number;
      bullets: unknown[];
      player: [number, number];
    };

    expect(state.count).toBeGreaterThan(20);
    expect(state.player).not.toEqual([FIELD.width / 2, 360]);
  });

  test('a different seed produces a different run', () => {
    expect(runScenario(recordAll(SEED, masks))).not.toBe(
      runScenario(recordAll(SEED + 1, masks)),
    );
  });

  test('one changed input tick produces a different run', () => {
    // The oracle is only useful if it is sensitive: flipping a single tick of
    // Shot changes the number of sim draws and must move everything after it.
    const altered = [...masks];
    altered[300] = (altered[300] as number) ^ Button.Shot;

    expect(runScenario(recordAll(SEED, masks))).not.toBe(
      runScenario(recordAll(SEED, altered)),
    );
  });

  test('the input log stays sparse — far fewer entries than ticks', () => {
    const replay = recordAll(SEED, masks);

    expect(replay.inputs.length).toBeLessThan(TICKS / 4);
    expect(replay.inputs.length).toBeGreaterThan(0);
  });
});
