import { describe, expect, test } from 'bun:test';
import { Random } from '../core/random';
import {
  defineItem,
  getItemSpec,
  Item,
  ItemSystem,
  itemNames,
  type ItemSpec,
  type ItemSystemOptions,
} from './item';

const BOUNDS = { width: 384, height: 448, margin: 32 };

// Test fixtures are namespaced: the registry is module-global and shared with
// the starter set, and `defineItem` throws on a duplicate name.
defineItem('t.plain', { sprite: 'mote', radius: 5, value: 1, kind: 'score' });
defineItem('t.fast', {
  sprite: 'star',
  radius: 5,
  value: 1,
  kind: 'power',
  magnetSpeed: 10,
});
/** Falls straight down at a known rate, so position assertions can be exact. */
defineItem('t.sinker', {
  sprite: 'mote',
  radius: 4,
  value: 1,
  kind: 'score',
  motion: { r: 2, theta: 90 },
});

function system(options: Omit<Partial<ItemSystemOptions>, 'bounds'> = {}): ItemSystem {
  return new ItemSystem({ bounds: BOUNDS, ...options });
}

/** Step with the player parked far away, so nothing magnetises or collects. */
function stepIdle(items: ItemSystem, ticks = 1): void {
  for (let i = 0; i < ticks; i++) items.step(-1000, -1000, 0, false);
}

describe('the registry', () => {
  test('resolves a defined spec by name', () => {
    expect(getItemSpec('t.plain').kind).toBe('score');
  });

  test('lists the starter set, so content can be enumerated', () => {
    const names = itemNames();
    for (const name of ['power', 'big-power', 'score', 'life', 'bomb']) {
      expect(names).toContain(name);
    }
  });

  test('refuses a duplicate name rather than silently replacing content', () => {
    expect(() => defineItem('t.plain', getItemSpec('t.plain'))).toThrow(/already defined/);
  });

  test('throws on an unknown name, so a typo in drop data cannot pass silently', () => {
    expect(() => getItemSpec('t.nope')).toThrow(/unknown item/);
    expect(() => system().spawn('t.nope', 0, 0)).toThrow(/unknown item/);
  });

  test('the starter power items are worth power and the score item points', () => {
    expect(getItemSpec('power').kind).toBe('power');
    expect(getItemSpec('big-power').kind).toBe('power');
    expect(getItemSpec('big-power').value).toBeGreaterThan(getItemSpec('power').value);
    expect(getItemSpec('score').kind).toBe('score');
    expect(getItemSpec('life').kind).toBe('life');
    expect(getItemSpec('bomb').kind).toBe('bomb');
  });
});

describe('spawning', () => {
  test('adds a live item at the requested position', () => {
    const items = system();
    const item = items.spawn('t.plain', 40, 60);
    expect(item).toBeDefined();
    expect(item?.alive).toBe(true);
    expect(item?.magnetised).toBe(false);
    expect([item?.x, item?.y]).toEqual([40, 60]);
    expect(items.count).toBe(1);
  });

  test('refuses and counts spawns once the pool is at its ceiling', () => {
    const items = system({ initial: 2, max: 2 });
    expect(items.spawn('t.plain', 0, 0)).toBeDefined();
    expect(items.spawn('t.plain', 0, 0)).toBeDefined();
    expect(items.spawn('t.plain', 0, 0)).toBeUndefined();
    expect(items.droppedSpawns).toBe(1);
    expect(items.count).toBe(2);
  });

  test('clear empties the field', () => {
    const items = system();
    items.spawn('t.plain', 10, 10);
    items.spawn('t.plain', 20, 20);
    items.clear();
    expect(items.count).toBe(0);
  });
});

describe('the default drop motion', () => {
  test('drifts up, stalls, then falls', () => {
    const items = system();
    const item = items.spawn('t.plain', 100, 300);
    expect(item).toBeDefined();

    const heights: number[] = [];
    for (let i = 0; i < 60; i++) {
      stepIdle(items);
      heights.push(item!.y);
    }

    // y is screen space, so rising means decreasing.
    const peak = Math.min(...heights);
    expect(peak).toBeLessThan(300);
    expect(heights[heights.length - 1]!).toBeGreaterThan(300);
  });

  test('falls at a terminal velocity rather than accelerating forever', () => {
    const items = system();
    const item = items.spawn('t.plain', 100, 100);
    stepIdle(items, 200);
    // Still live only because the field is tall enough; what matters is the
    // per-tick step having settled to the clamp rather than growing.
    const before = item!.y;
    items.step(-1000, -1000, 0, false);
    const stepSize = item!.y - before;
    expect(stepSize).toBeCloseTo(2.3, 6);
  });

  test('a spec-supplied motion replaces the default outright', () => {
    const items = system();
    const item = items.spawn('t.sinker', 100, 100);
    stepIdle(items, 3);
    expect(item!.y).toBeCloseTo(106, 6);
    expect(item!.x).toBeCloseTo(100, 6);
  });
});

describe('magnetism', () => {
  test('latches when the player first comes within the radius', () => {
    const items = system();
    const item = items.spawn('t.plain', 100, 300);

    items.step(100, 200, 50, false);
    expect(item!.magnetised).toBe(false);

    items.step(100, 340, 50, false);
    expect(item!.magnetised).toBe(true);
  });

  test('stays latched once the player leaves the radius again', () => {
    const items = system();
    const item = items.spawn('t.plain', 100, 300);
    items.step(100, 340, 50, false);
    expect(item!.magnetised).toBe(true);

    // The oscillation this guards against: without the latch the item would
    // drop back into its own motion here and chase the player in and out.
    for (let i = 0; i < 5; i++) items.step(100, 10, 50, false);
    expect(item!.magnetised).toBe(true);
    expect(item!.y).toBeLessThan(300);
  });

  test('flies at the spec magnet speed once latched', () => {
    const items = system();
    const item = items.spawn('t.fast', 100, 300);
    // Straight up: the flight is one axis, so the step size is the speed.
    items.step(100, 260, 50, false);
    expect(item!.magnetised).toBe(true);
    expect(item!.y).toBeCloseTo(290, 6);
  });

  test('re-aims at a moving player instead of committing to the latch point', () => {
    const items = system();
    const item = items.spawn('t.fast', 100, 300);
    items.step(100, 260, 50, false);
    // Player jumps sideways; the item must turn rather than keep flying up.
    items.step(200, 300, 50, false);
    expect(item!.x).toBeGreaterThan(100);
  });

  test('a burst drift is dropped on latching, so the flight is a straight line', () => {
    const items = system();
    items.burst('t.fast', 100, 300, 1, new Random(7));
    const item = items.items[0]!;
    expect(item.vector.driftX).not.toBe(0);

    items.step(100, 260, 50, false);
    expect(item.vector.driftX).toBe(0);
    expect(item.x).toBeCloseTo(100, 6);
  });

  test('never tunnels past a player it is faster than', () => {
    // t.fast covers 10px a tick against a 5px pickup window. Unclamped, it
    // steps over the player every tick and orbits forever, uncollectable.
    const items = system();
    items.spawn('t.fast', 100, 300);
    let collected = 0;
    for (let i = 0; i < 20; i++) {
      items.step(100, 260, 50, false);
      collected += items.drainCollected().length;
    }
    expect(collected).toBe(1);
    expect(items.count).toBe(0);
  });

  test('is never granted by a zero radius', () => {
    const items = system();
    const item = items.spawn('t.plain', 100, 300);
    items.step(100, 310, 0, false);
    expect(item!.magnetised).toBe(false);
    expect(items.count).toBe(1);
  });
});

describe('the auto-collect line', () => {
  test('the flag magnetises every item on screen regardless of distance', () => {
    const items = system({ autoCollectLine: 100 });
    items.spawn('t.plain', 10, 400);
    items.spawn('t.plain', 370, 40);

    items.step(200, 50, 0, true);
    for (const item of items.items) expect(item.magnetised).toBe(true);
  });

  test('the threshold is exposed so the caller does not keep its own copy', () => {
    const items = system({ autoCollectLine: 100 });
    expect(items.autoCollectLine).toBe(100);
    expect(items.isAboveCollectLine(80)).toBe(true);
    expect(items.isAboveCollectLine(100)).toBe(true);
    expect(items.isAboveCollectLine(120)).toBe(false);
  });

  test('a system with no line never reports the player above it', () => {
    const items = system();
    expect(items.autoCollectLine).toBeUndefined();
    expect(items.isAboveCollectLine(-500)).toBe(false);
  });

  test('the flag is honoured even without a configured line', () => {
    // A bomb claims the field from anywhere, which is why `step` takes a flag
    // rather than reading a position against the threshold itself.
    const items = system();
    items.spawn('t.plain', 10, 400);
    items.step(200, 300, 0, true);
    expect(items.items[0]!.magnetised).toBe(true);
  });
});

describe('collection', () => {
  test('is drained, and only reports each item once', () => {
    const items = system();
    items.spawn('t.plain', 100, 300);
    expect(items.drainCollected()).toEqual([]);

    items.step(100, 300, 0, false);
    const collected = items.drainCollected();
    expect(collected.length).toBe(1);
    expect(collected[0]!.name).toBe('t.plain');
    expect(collected[0]!.spec.kind).toBe('score');
    expect(items.count).toBe(0);

    expect(items.drainCollected()).toEqual([]);
  });

  test('uses the item radius, so the pickup window belongs to the reward', () => {
    const items = system();
    items.spawn('t.plain', 100, 300);
    // 8px away, outside the 5px pickup radius and outside any magnet reach.
    items.step(108, 300, 0, false);
    expect(items.drainCollected().length).toBe(0);
    expect(items.count).toBe(1);
  });

  test('collects a whole burst without skipping an entity mid-compaction', () => {
    // The reason collection is drained rather than dispatched: the live list is
    // rewritten in place, and every one of these is removed in a single sweep.
    const items = system();
    items.burst('t.plain', 100, 300, 12, new Random(3));
    items.step(100, 300, 0, false);
    expect(items.drainCollected().length).toBe(12);
    expect(items.count).toBe(0);
  });

  test('survivors are kept in order around a collected item', () => {
    const items = system();
    items.spawn('t.sinker', 0, 100);
    items.spawn('t.sinker', 100, 300);
    items.spawn('t.sinker', 200, 100);
    items.step(100, 302, 0, false);

    expect(items.drainCollected().length).toBe(1);
    expect(items.items.map((i) => i.x)).toEqual([0, 200]);
  });

  test('clear discards the field but not collections already owed', () => {
    const items = system();
    items.spawn('t.plain', 100, 300);
    items.spawn('t.plain', 10, 10);
    items.step(100, 300, 0, false);

    items.clear();
    expect(items.count).toBe(0);
    expect(items.drainCollected().length).toBe(1);
  });
});

describe('culling', () => {
  test('drops an item that falls off the bottom edge', () => {
    const items = system();
    items.spawn('t.sinker', 100, BOUNDS.height);
    stepIdle(items, 20);
    expect(items.count).toBe(0);
    expect(items.drainCollected().length).toBe(0);
  });

  test('never culls a magnetised item, however far out it strays', () => {
    // A burst at the bottom edge would otherwise lose drops the player had
    // already claimed by touching them.
    const items = system();
    const item = items.spawn('t.plain', 100, BOUNDS.height + BOUNDS.margin - 1);
    items.step(100, BOUNDS.height, 60, false);
    expect(item!.magnetised).toBe(true);

    // Player retreats upward; the item must chase, not be culled on the way.
    for (let i = 0; i < 10; i++) items.step(100, 0, 60, false);
    expect(items.count + items.drainCollected().length).toBe(1);
  });

  test('a cull is not a collection', () => {
    const items = system();
    items.spawn('t.sinker', 100, BOUNDS.height + BOUNDS.margin);
    stepIdle(items, 2);
    expect(items.count).toBe(0);
    expect(items.drainCollected()).toEqual([]);
  });
});

describe('burst', () => {
  test('spawns the requested count and scatters them', () => {
    const items = system();
    items.burst('t.plain', 100, 300, 8, new Random(11));
    expect(items.count).toBe(8);

    stepIdle(items, 10);
    const xs = new Set(items.items.map((i) => i.x));
    expect(xs.size).toBeGreaterThan(1);
  });

  test('does not spend more of the pool than it was asked for', () => {
    const items = system({ initial: 4, max: 4 });
    items.burst('t.plain', 100, 300, 10, new Random(1));
    expect(items.count).toBe(4);
    expect(items.droppedSpawns).toBe(6);
  });

  test('draws the same number of times whether or not the pool is exhausted', () => {
    // Otherwise a pool ceiling — a tuning constant, not a gameplay input —
    // would shift every subsequent draw and desync a replay.
    const roomy = new Random(5);
    system().burst('t.plain', 100, 300, 10, roomy);

    const cramped = new Random(5);
    system({ initial: 3, max: 3 }).burst('t.plain', 100, 300, 10, cramped);

    expect(cramped.getState()).toEqual(roomy.getState());
  });
});

describe('determinism', () => {
  /** A scripted run: burst, drift, magnetise, collect. */
  function run(seed: number): {
    positions: number[];
    collected: { name: string; x: number; y: number }[];
  } {
    const items = system();
    const rng = new Random(seed);
    const positions: number[] = [];
    const collected: { name: string; x: number; y: number }[] = [];

    for (let tick = 0; tick < 90; tick++) {
      if (tick % 30 === 0) items.burst('t.plain', 190, 120, 6, rng);
      if (tick % 30 === 15) items.burst('t.fast', 90, 200, 3, rng);

      // A player sweeping across the lower field, then rising into the line.
      const playerX = 100 + (tick % 40) * 4;
      const playerY = tick < 60 ? 380 : 60;
      items.step(playerX, playerY, 60, tick >= 60);

      for (const item of items.items) positions.push(item.x, item.y);
      for (const c of items.drainCollected()) {
        collected.push({ name: c.name, x: c.x, y: c.y });
      }
    }
    return { positions, collected };
  }

  test('the same seed reproduces the run exactly', () => {
    const a = run(1234);
    const b = run(1234);
    expect(b.positions).toEqual(a.positions);
    expect(b.collected).toEqual(a.collected);
    expect(a.collected.length).toBeGreaterThan(0);
  });

  test('a different seed produces a different run', () => {
    // Guards the test above from passing because the run is seed-independent.
    expect(run(4321).positions).not.toEqual(run(1234).positions);
  });

  test('burst draws exactly twice per item, in a fixed order', () => {
    // The draw count is the contract; pinning it here makes any change to the
    // scatter show up as a failing test rather than as a silently broken replay.
    const rng = new Random(99);
    system().burst('t.plain', 0, 0, 5, rng);

    const reference = new Random(99);
    for (let i = 0; i < 10; i++) reference.random();
    expect(rng.getState()).toEqual(reference.getState());
  });

  test('a pooled slot handed out again carries nothing from its last life', () => {
    const items = system({ initial: 1, max: 1 });
    const first = items.spawn('t.plain', 100, 300)!;
    items.step(100, 300, 0, false);
    items.drainCollected();

    const second = items.spawn('t.sinker', 50, 50)!;
    expect(second).toBe(first); // the pool is LIFO; this is the same slot
    expect(second.magnetised).toBe(false);
    expect(second.age).toBe(0);
    expect(second.name).toBe('t.sinker');
    expect(second.vector.driftX).toBe(0);
  });
});

describe('items are pure reward', () => {
  test('carry no damage, faction or collision surface of their own', () => {
    // The type is the guard, so this asserts on the shape rather than behaviour:
    // there is no field through which an item could hurt or block anything.
    const item = new Item();
    const shape = Object.keys(item);
    expect(shape).not.toContain('damage');
    expect(shape).not.toContain('faction');
    expect(shape).not.toContain('hp');
  });

  test('a spec cannot be authored into a hazard', () => {
    const spec: ItemSpec = getItemSpec('power');
    expect(Object.keys(spec)).not.toContain('damage');
    // Every starter pickup rewards; none is a trap dressed as one.
    for (const name of itemNames()) {
      expect(getItemSpec(name).value).toBeGreaterThan(0);
    }
  });
});
