# Extending the engine

How to add content without editing the engine. Every extension point is a
registry: you write a file, register a named thing, and import it.

Read [`CLAUDE.md`](../CLAUDE.md) first — the hard rules there are not style
preferences, and §16 of this document lists the ones you can break silently.

| You want to add | Call | In |
|---|---|---|
| A bullet | (no registry — a `BulletSpec` value) | `src/sim/bullet.ts` |
| A danmaku pattern | `definePattern` | `src/content/patterns.ts` |
| Motion the polar model cannot express | `defineBehaviour` | `src/sim/motion.ts` |
| An enemy | `defineEnemy` | `src/sim/enemy.ts` |
| A boss | `defineBoss` | `src/sim/boss.ts` |
| A stage | `defineStage` | `src/content/stage.ts` |
| A player weapon | `defineShot` | `src/content/shots.ts` |
| An option loadout | `defineOptions` | `src/sim/option.ts` |
| A bomb | `defineBomb` | `src/sim/bomb.ts` |
| A pickup | `defineItem` | `src/sim/item.ts` |
| A particle effect | `defineEffect` | `src/sim/effects.ts` |
| A sound | `defineSound` | `src/audio/index.ts` |
| A music track | `defineMusic` | `src/audio/music.ts` |
| A background scene | `defineBackground` | `src/render/background.ts` |
| A dialogue portrait | `definePortrait` | `src/render/portrait.ts` |
| A sprite region | `Atlas.define` / `Atlas.defineGrid` | `src/render/atlas.ts` |
| A render layer | a `Layer` constant | `src/render/stage.ts` |

Two facts about registries that will bite you before anything else does:

- **They throw on duplicate names.** `definePattern({ name: 'ring' })` twice is
  an error at import time, not a silent overwrite. A silent overwrite would mean
  the entry a spec resolves to depends on module load order, which is the
  load-order dependence `patterns.ts` was written to avoid, and it would rebind
  content nobody touched. Tests that register their own entries must namespace
  them — see the `NS` constant in `src/content/patterns.test.ts`. `defineSound`
  is the deliberate exception, and §10 says why.
- **Registration happens on import.** A `BulletSpec` naming
  `behaviour: 'homing'` throws at *spawn* time if nothing imported the module
  that registered it. `src/content/shots.ts:24-28` carries that import with a
  comment explaining that it is load-bearing rather than tidiness. Import content
  modules for their side effects from wherever you assemble a stage.

Content is referenced **by name, never by index**, so repacking an atlas or
reordering a table cannot repoint at the wrong thing.

### Where files go

`src/sim/` and `src/content/` must not import a *value* from `src/render/`;
`import type` is exempt because it erases. `src/architecture.test.ts` enforces
this, and §15 covers what it checks and how to get a renderer thing across the
line when you need one.

---

## 1. Adding a bullet type

A bullet is a plain `BulletSpec` value. There is no registry — you export the
const and reference it from patterns.

```ts
import type { BulletSpec } from '../sim/bullet';

export const iceOrb: BulletSpec = {
  style: { sprite: 'orb.medium', r: 0.45, g: 0.75, b: 1 },
  radius: 4,
  motion: { r: 1.6, theta: 90 },
};
```

`style.sprite` is an atlas cell name (§11). `r/g/b/a` are a per-instance tint in
0..1, multiplied with the texel — the sheet is white, so this is where colour
comes from.

### Hitbox radius is not sprite size

This is the single most important number in the file, and it is deliberately
unrelated to how big the bullet looks:

| | Typical value |
|---|---|
| Sprite cell | **32 × 32** px |
| Drawn size | 16–30 px |
| `radius` (lethal) | **3–4** px |
| Player `radius` | **2.5** px |

The gap *is* the genre. The player reads the bright core and threads gaps that
look impossible, and a `radius` set to half the sprite width turns a fair
pattern into an unreadable one. Set `radius` from the visual core, not the
silhouette. `style.width` / `style.height` change the drawn size and nothing
else; collision never reads them.

### Orientation and spin

```ts
export const emberNeedle: BulletSpec = {
  style: {
    sprite: 'needle',
    r: 1, g: 0.5, b: 0.25,
    additive: true,
    orientToHeading: true,
    width: 30,
    height: 10,
  },
  radius: 3,
  motion: { r: 3.2 },
  life: 240,
  damage: 1,
};
```

`orientToHeading` rotates the sprite to match `vector.theta`, and heading 0° is
**+x**, so the art must point right (CLAUDE.md rule 7). `spin` adds a constant
rotation in radians/tick instead. They are mutually exclusive — `BulletSystem.step`
takes `orientToHeading` first and ignores `spin` when both are set.

**`style.additive` is a declaration, not a mechanism.** Blending is a material
property, so it is decided by *which batch* the bullet is drawn into. The
current render loop in `src/main.ts` routes on `faction` and never reads
`style.additive`. A bullet that must glow needs an additive batch and a renderer
that sends it there — see §13.

### Lifetime

A bullet despawns when any of these is true: `life` ticks elapse (omit for
"until offscreen"), it leaves the field by more than `bounds.margin`, or
`bounceCount` exceeds `maxBounces`.

```ts
export const ricochet: BulletSpec = {
  style: { sprite: 'kunai', r: 0.6, g: 1, b: 0.8, orientToHeading: true },
  radius: 3,
  motion: { r: 2.6 },
  bounce: true,
  maxBounces: 3,
};
```

### Beams: a bullet that is a line

`laser` makes a bullet a segment rather than a point. Its `x`/`y` is the
**muzzle**, not the centre, and the body reaches `length` px from there along
`vector.theta`.

```ts
export const lance: BulletSpec = {
  style: {
    sprite: 'needle',
    r: 1, g: 0.45, b: 0.6,
    width: 7,
    additive: true,
    orientToHeading: true,
  },
  radius: 4,
  motion: { r: 0, theta: 90 },
  laser: { length: 40, growth: 22, maxLength: 600, warmup: 28 },
  life: 64,
};
```

`LaserSpec` is four numbers (`src/sim/bullet.ts:54-62`): `length` at spawn, plus
optional `growth` per tick, `maxLength`, and `warmup`. `r: 0` is the usual
choice — the muzzle stays where it was fired and the entire motion of the thing
is its own extension.

Anchoring the hitbox at the muzzle is what lets the origin stay put while the
beam extends, which is the whole shape of the effect. A renderer drawing a
centred quad has to offset it by half the length itself.

**`warmup` is the telegraph, and it gates the hit test, not the tint.**
`Bullet.lethal` stays false until `age >= warmup`, and `bulletHitsCircle` returns
false for a bullet that is not lethal (`src/sim/bullet.ts:528`). A laser that is
lethal on the tick it appears is not a pattern, it is a coin flip — there is no
information in the field before it kills. The gate lives inside the hit test
rather than at the call sites so that every present and future collision path
inherits it, which is the argument rule 8 makes about `alive`.

Collision switches to a capsule: the closest point between the segment and the
target circle, widened by `radius`. So on a beam `radius` is a half-width, not a
blob around the muzzle. Tested against a circle at its stored position instead, a
300px beam reads as 300px away from the thing that is killing you.

**The offscreen cull widens with the beam.** A point bullet is culled at
`bounds.margin`; a laser is culled at `margin + length`
(`src/sim/bullet.ts:371`), because the muzzle does not bound it. Without that,
an emitter parked above the field firing down has its beam deleted on the tick it
spawns while most of the body — and all of the hitbox — is on screen.

Growth and warmup want tuning together. The base pack's stage-2 lance (`LANCE`,
now JSON ammo in `base-pack.json`, authored in `tools/make-base-pack.ts`) is 40px
plus 28 ticks at 22px/tick, which is 656 against a 600 cap, so the beam finishes
drawing itself out at almost exactly the tick it becomes lethal: the player
watches a line reach across the field, and then it is live.

### Blades: a bullet that is a line, but carried

`blade: { length }` (`src/sim/bullet.ts:80-96`) makes a bullet a segment like
`laser` does — but **centred on the bullet and moving with it**, where a laser's
segment grows forward from a fixed muzzle. A blade is for a spinning shard or a
sword that sweeps through space; a laser is for a planted beam.

```ts
export const cleaver: BulletSpec = {
  style: { sprite: 'shard', orientToHeading: true },
  radius: 2,          // half-thickness once `blade` is set, not a blob radius
  motion: { r: 3, theta: 0, spin: 6 },
  blade: { length: 26 },
};
```

The one trap is `radius`. On a plain bullet it is the whole hitbox; on a blade,
as on a beam, it becomes the capsule's **half-thickness** — so the 3–4px the
"Hitbox radius is not sprite size" table above prescribes is wrong for a blade,
which wants 2 or less. `Bullet.bladeHalf` holds `length / 2`, and collision uses
the same capsule test as a laser (`src/sim/bullet.ts:548`). Point a blade **+x**,
like everything with `orientToHeading` (rule 7).

### Piercing: a shot that is not spent on the first thing it hits

`pierce: true` (`src/sim/bullet.ts:97-105`) stops a player bullet being removed
the moment it damages something, so a beam or a blade cuts through a whole column
rather than dying on the front rank. Without it `Run.#resolvePlayerShots`
despawns the bullet on its first hit — correct for an ordinary shot, wrong for a
weapon whose entire point is reach. `laser` sets it; a plain `spread` bolt does
not. It is read only on the player-fire path; enemy fire has no equivalent.

### Timelines

`timeline` overrides `motion` after the first segment falls due. Counts are
ticks measured from the start of the timeline (or from the last `jump`).

```ts
/** Fires outward, brakes, then falls straight down. */
export const hesitantScale: BulletSpec = {
  style: { sprite: 'scale', r: 0.85, g: 0.8, b: 1, spin: 0.05 },
  radius: 4,
  motion: { r: 3 },
  timeline: [
    { count: 24, motion: { r: 0.15, theta: 90 } },
    { count: 60, motion: { r: 0.4, ra: 0.05, theta: 90, rrange: { max: 3.5 } } },
  ],
};
```

**A segment re-initialises the vector; it does not patch it.** `MotionTimeline`
calls `MoveVector.init(segment.motion)`, which resets every field to its default
before applying the params. Omitting `theta` does not preserve the current
heading — it snaps to the default **90 (down)**. That is often exactly what you
want, as above, but it is never what you expected the first time. Restate
`theta` in every segment where the heading matters.

`{ count, jump }` loops the timeline back to a segment index. The runner has a
64-iteration guard per tick, so a zero-length loop stalls rather than hangs.

---

## 2. Adding a danmaku pattern

A pattern is a factory. `create(options)` runs once when an emitter is built and
returns a closure called once per tick. Return `false` to retire the emitter;
anything else keeps it alive.

```ts
// src/content/lattice.ts
import { definePattern, fan, aimAngle } from './patterns';
import type { BulletSpec } from '../sim/bullet';

interface LatticeOptions {
  spec: BulletSpec;
  count?: number;
  period?: number;
  jitter?: number;
  growth?: number;
  duration?: number;
}

definePattern({
  name: 'lattice',
  description: 'Aimed fan with a jittered centre and a spread that widens each volley.',
  create(options?: Readonly<Partial<LatticeOptions>>) {
    // `spec` is the one option with no sensible default — there is no bullet
    // shape a pattern could safely assume in its place — so it fails loudly and
    // by name rather than defaulting like every other field.
    const spec = options?.spec;
    if (spec === undefined) {
      throw new Error('pattern "lattice" requires a "spec" option');
    }

    const count = options?.count ?? 7;
    const period = options?.period ?? 40;
    const jitter = options?.jitter ?? 6;
    const growth = options?.growth ?? 6;
    const duration = options?.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;

      const centre = aimAngle(context) + context.rng.range(-jitter, jitter);
      fan(context, spec, count, centre, 20 + volley * growth);
      volley++;
      return true;
    };
  },
});
```

Per-tick state (`volley`) lives in the closure, so two emitters running the same
pattern never share it.

**A pattern never reads the difficulty tier.** `create(options)` is handed the
options **already merged** for the run's tier — the sim does the merge when it
builds the emitter, one level up — so a pattern is written once against a single
`options` shape and is oblivious to which tier it runs on. Authoring a tier's
variation is the firing *slot's* job, on the enemy (§4) or boss (§5) that names
the pattern, never the factory's.

**Type the parameter; do not cast it.** `PatternDefinition.create` declares
`options?: Readonly<Record<string, unknown>>` (`src/content/patterns.ts:40`)
because the registry cannot know your shape — but `create` is written as a
method, and TypeScript compares method parameters bivariantly, so narrowing it to
your own `Readonly<Partial<T>>` is accepted. That is what all four built-ins do
(`src/content/patterns.ts:165, 196, 235, 264`), and nothing outside the tests
casts through `unknown`. A cast buys the same field access and gives up every
check on the way to it.

`Partial`, not the bare interface: an options object is authored in stage data,
where any field may be missing, and pretending otherwise only moves the
`undefined` somewhere the compiler has stopped looking. The built-ins funnel the
one field that cannot be defaulted through `requireSpec`
(`src/content/patterns.ts:143-151`). That helper is module-private, so a pattern
defined in another file writes the two lines above by hand.

### The EmitContext

| Field | Meaning |
|---|---|
| `age` | Ticks since the emitter started. Your clock — never `Date.now()`. |
| `x`, `y` | Emitter position. |
| `targetX`, `targetY` | Who to aim at. |
| `bullets` | The `BulletSystem` to spawn into. |
| `rng` | **The generator to draw from.** |
| `faction` | `'player'` or `'enemy'`. |

### Primitives, and spawning by hand

`ring(context, spec, count, offsetDeg)` and
`fan(context, spec, count, centreDeg, spreadDeg)` cover most cases.
`aimAngle(context)` gives the angle to the target in degrees.

When you need per-bullet control, spawn directly and set the vector:

```ts
definePattern({
  name: 'whip',
  description: 'A single lash of bullets whose speed ramps along the arc.',
  create(options?: Readonly<Partial<{ spec: BulletSpec; length: number; arc: number }>>) {
    const spec = options?.spec;
    if (spec === undefined) throw new Error('pattern "whip" requires a "spec" option');
    const length = options?.length ?? 24;
    const arc = options?.arc ?? 90;

    return (context) => {
      if (context.age >= length) return false;

      const bullet = context.bullets.spawn(
        context.x, context.y, spec, context.faction, context.rng,
      );
      if (!bullet) return true;   // pool at its ceiling — never assume a spawn

      const t = context.age / length;
      bullet.vector.theta = aimAngle(context) - arc / 2 + arc * t;
      bullet.vector.r *= 0.6 + t * 0.8;
      return true;
    };
  },
});
```

`spawn` returns `undefined` when the pool is capped, and it increments
`droppedSpawns`. Handle it. `ring` and `fan` already bail out on the first
refusal.

### Why patterns must draw only from `context.rng`

Not "should" — must, for two separate reasons.

1. **`Math.random()` cannot be seeded**, so one call anywhere in the sim makes
   every replay worthless. `src/core/random.test.ts` traps `Math.random` and
   fails if the generator reaches for it; nothing traps *your* file, so this one
   is on you.
2. **The module-level `sim` import is not the same thing as `context.rng`.**
   Emitters are handed a generator, and tests hand them a private `Random` so a
   pattern can be exercised in isolation. A pattern that closes over `sim`
   still runs, still looks deterministic, and quietly couples itself to global
   state — it will drift the moment anything else draws.

RNG *call order* is part of the contract. Adding a draw, or moving one across a
spawn, changes every subsequent value even at the same seed. Note that
`BulletSpec.motion` with `rrandom` / `trandom` / `wrandom` consumes draws at
spawn time, in exactly that order, before your pattern's next call.

Pin it down with a test:

```ts
import { test, expect } from 'bun:test';
import { Random } from '../core/random';
import { BulletSystem } from '../sim/bullet';
import { Emitter } from './patterns';
import { iceOrb } from './bullets';
import './lattice';   // load-bearing: nothing else registers the pattern

function run(seed: number): string {
  const rng = new Random(seed);
  const bullets = new BulletSystem({
    bounds: { width: 480, height: 640, margin: 48 },
    initial: 512,
    max: 512,
  });
  const emitter = new Emitter('lattice', 240, 90, 'enemy', { spec: iceOrb });

  for (let tick = 0; tick < 180; tick++) {
    emitter.step(bullets, 240, 400, rng);
    bullets.step(240, 400, rng);
  }
  return bullets.bullets.map((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)}`).join('|');
}

test('lattice is reproducible from its seed', () => {
  expect(run(12345)).toBe(run(12345));
  expect(run(12345)).not.toBe(run(54321));
});
```

That side-effect import is the trap the preamble describes, and this test is where
it is easiest to drop: `Emitter` resolves the name through `createPattern`, which
throws `unknown pattern "lattice"` (`src/content/patterns.ts:57`) — a failure about
the import graph, reported from a test about determinism.

---

## 3. Adding a motion behaviour

`MotionParams` covers polar velocity with two derivatives, clamps, gravity and
reflection. When a motion cannot be written that way — homing, splines, noise
fields — register a behaviour. It runs at the end of every `MoveVector.step`,
after the derivatives and clamps have been applied.

**Pick a name nobody has taken.** `defineBehaviour` throws
`motion behaviour "x" is already defined` (`src/sim/motion.ts:107-111`), at
import time, and the four already registered are `homing`, `waver`,
`accelerate-to` and `orbit` (`src/content/behaviours.ts:81, 114, 146, 190`).
`behaviourNames()` lists them at runtime. The registry refuses rather than
overwrites for the reason every registry here does: an overwrite would make the
behaviour a spec resolves to a function of module load order, and it would
silently rebind bullets in content nobody edited.

```ts
import { atan2Deg, deltaDeg } from '../core/trig';
import { defineBehaviour } from '../sim/motion';

defineBehaviour('intercept', (vector, context) => {
  const turnRate = vector.options['turnRate'] ?? 2.5;
  const delay = vector.options['delay'] ?? 20;
  const duration = vector.options['duration'] ?? 90;

  // A bullet that steers forever is unavoidable, not hard. The window is the
  // dodge. `vector.age`, not `context.age` — see below.
  const age = vector.age;
  if (age < delay || age >= delay + duration) return;

  const dx = context.targetX - context.x;
  const dy = context.targetY - context.y;
  // Sitting exactly on the target has no heading to seek. `atan2Deg` answers 0
  // there, which would snap the bullet east for no reason the player can read.
  if (dx === 0 && dy === 0) return;

  // Shortest signed turn, wrapped into (-180, 180]. `theta` accumulates without
  // bound when `w` is set, so a naive difference can be thousands of degrees.
  const delta = deltaDeg(vector.theta, atan2Deg(dy, dx));
  const step = Math.min(Math.abs(delta), Math.abs(turnRate));
  vector.theta += delta < 0 ? -step : step;
});
```

**`atan2Deg` and `deltaDeg`, never `Math.atan2` and never `* 180 / Math.PI`.**
A behaviour lives in `src/sim` or `src/content`, both of which
`src/determinism.test.ts` scans, so an approximated `Math` call here does not
merely risk a divergence — it fails the suite. The reason it is banned is in
`src/sim/motion.ts:12-29`: this value is integrated into position, a 1-ULP
disagreement between engines drifts a bullet across a hitbox edge, the flipped
hit changes how many draws come off the `sim` stream, and from the next draw
onward the two runs are unrelated rather than close. `Math.abs`, `min`, `max` and
`sqrt` are exactly specified and are fine.

Used from a spec:

```ts
export const seeker: BulletSpec = {
  style: { sprite: 'kunai', r: 1, g: 0.6, b: 0.2, orientToHeading: true },
  radius: 3,
  motion: {
    r: 2.2,
    behaviour: 'intercept',
    options: { turnRate: 2, delay: 24, duration: 120 },
  },
  life: 420,
};
```

Notes that are easy to get wrong:

- **`options` is `Readonly<Record<string, number>>`** (`src/sim/motion.ts:76` on
  the spec, `:227` on the vector), and reads come back `number | undefined` under
  `noUncheckedIndexedAccess`. The `?? default` is not optional politeness; it is
  how the code compiles. `Readonly` is the other half: a behaviour cannot stash a
  value back into `options` between ticks, which is deliberate, because the
  object is shared by every bullet spawned from that spec.
- **Unknown option names are ignored in silence.** The bag is numbers keyed by
  string, checked against nothing, so a spec that writes `rate` where the
  behaviour reads `turnRate` does not fail — it runs entirely on defaults and
  looks like a behaviour that does not work. Read the option names off the
  behaviour, not off memory.
- **`context.age` is the *bullet's* age; `vector.age` is the *segment's*.**
  `BulletSystem.step` assigns `context.age = b.age`
  (`src/sim/bullet.ts:336`), which no timeline segment resets, while
  `MoveVector.init` zeroes `vector.age` (`src/sim/motion.ts:186`) every time a
  segment falls due. A window gated on `context.age` is therefore already expired
  if a `MotionTimeline` hands the vector a steering segment at tick 200. Every
  shipped behaviour gates on `vector.age` (`src/content/behaviours.ts:85, 118,
  150, 194`) and the module states the distinction at `:21-29`. Behaviours run
  before `step()` increments it, so a segment's first invocation sees age 0.
- **`context.targetX/targetY` are the target for *this bullet's faction*,
  chosen before the behaviour runs.** `BulletSystem.step` takes two aim points
  and selects by faction (`src/sim/bullet.ts:339-347`): enemy fire steers at the
  player, player fire steers at the enemy it was aimed at. So a tracking
  behaviour does the right thing on a player shot without knowing it is on one —
  a homing weapon chases enemies, not the ship. It used to take one field-wide
  target, and a tracking shot put on the player therefore steered *at the
  player*; that was an engine change to fix, not a content one, and it has been
  made. A behaviour still does not get to look anything up — it reads the target
  it is handed. Player aim of `undefined` means the bullet keeps its heading
  (`src/sim/bullet.ts:313-315`).
- **Behaviours are looked up at `init`, by name, and throw if unknown**
  (`src/sim/motion.ts:196-199`). That is on the tick the first bullet spawns, not
  at definition, so import the module that registers them from wherever you
  assemble the content that names them.
- **`turnRate` is degrees per tick**, like everything else. Never per second.

The third argument is the generator, for behaviours that need randomness:

```ts
defineBehaviour('jitter', (vector, context, rng) => {
  const amount = vector.options['amount'] ?? 1.5;
  const period = Math.max(1, vector.options['period'] ?? 8);
  if (vector.age % period !== 0) return;
  vector.theta += rng.range(-amount, amount);
});
```

This is the sim stream. Every draw shifts the sequence for everything after it,
so a behaviour that draws every tick on every bullet is a determinism hazard
even though it is perfectly reproducible — gate it on a period, as above.

The four shipped behaviours draw nothing at all, and
`src/content/behaviours.ts:31-40` says so on purpose: it is a property content
depends on. Because they perturb no stream, *attaching* one to an existing
pattern cannot move any other bullet in the run, which is what makes them safe to
add to a pattern that already has fixtures. A behaviour that draws is understood
as changing every fixture that runs alongside it.

---

## 4. Adding an enemy

An enemy is a hitbox that moves along the motion DSL and owns a set of running
patterns. Everything specific to one lives in its `EnemySpec`, so a stage adds
new opposition by writing a file.

`sprite`, `hp` and `radius` are required; `width`, `height`, `motion`,
`timeline`, `tint`, `patterns`, `spoils`, `scoreValue`, `onHit`, `onDeath` and
`despawnMargin` are not (`src/sim/enemy.ts:39-71`).

```ts
import { defineEnemy } from '../sim/enemy';

const DART_SHOT = {
  style: { sprite: 'orb.small', r: 1, g: 0.6, b: 0.4 },
  radius: 3,
  motion: { r: 2.8, theta: 90 },
};

defineEnemy('skirmisher', {
  sprite: 'orb.large',
  hp: 18,
  radius: 11,
  tint: { r: 1, g: 0.85, b: 0.7 },
  timeline: [
    { count: 0, motion: { r: 2.6, theta: 90 } },
    { count: 50, motion: { r: 1.4, theta: 20 } },
  ],
  patterns: [
    {
      pattern: 'aimed-fan',
      options: { spec: DART_SHOT, count: 3, spread: 26, period: 45 },
      startAt: 30,
      stopAt: 300,
    },
  ],
  spoils: [['power', 1]],
  scoreValue: 150,
  onHit: 'hit',
  onDeath: 'explosion',
});
```

`scoreValue` is the kill's **immediate** points; `spoils` is what it scatters
for the player to collect, a `[name, count]` list over the item registry. Most
trash drops only `power`, so `[['power', 1]]` — but the list can name any
registered item, and the base campaign uses that: one trash type per stage (the
tanky wall the player has to engage — `turret`, `bastion`, `assessor`) carries a
`bomb` in its spoils, so a stage hands back 2-4 mid-stage bombs and a spent bomb
is not gone for the rest of the stage. That is the whole of the drop economy — it
is pure spoils data, no new rule (see "The drop economy" below). It used to be
`drops: { power, score }`: two fixed fields, only `power` ever read, and `score`
dead because it duplicated `scoreValue`. A boss uses the same `Spoils` shape (§5),
so the two drop through one code path.

#### The drop economy

Bombs recover through play rather than being gone for the stage once spent, and it
is entirely spoils data — nothing in `Run` learns a new rule. Two doctrines:

- **Every stage fields a mid-stage bomb carrier.** One trash type per stage — a
  wall the player must fight, not an edge-skimmer — carries `['bomb', 1]` in its
  spoils, sized against how often it spawns so the stage yields 2-4 bombs on every
  tier (spawn counts are not tier-scaled). `tools/make-base-pack.test.ts` asserts
  this invariant over the shipped pack, so re-authoring a wave set cannot silently
  drop the carrier and regress the economy to boss-only bombs.
- **Bosses declare their spoils explicitly.** The shipped bosses each name their
  own `spoils` rather than fall through `DEFAULT_BOSS_SPOILS`. That default stays,
  unchanged — it is the reward rule for a **guest pack** that declares none — but
  the base campaign spells its own economy out so a change to the fallback cannot
  silently retune the game we ship. Lives stay rare: only `magistrate` and
  `chancellor` hand one back directly, two across the whole campaign.

`startAt` and `stopAt` are **ticks since this enemy spawned**, not since the
stage began (`src/sim/enemy.ts:26-36`). An enemy's script must not depend on when
the stage happened to release it, or moving one wave retimes another.

A slot that stops is retired, never restarted (`src/sim/enemy.ts:196-201`). A
finite pattern reports completion by returning `false`, and without the retire
flag the next tick would build a fresh emitter and run it again from age zero.

### Difficulty: per-tier option overrides

A pattern slot may carry a `difficulty` block, and it is the whole of how the
tier axis reaches the field. `options` is the **Normal** truth; each tier that
differs names only the fields it changes, and the sim shallow-merges them over
`options` when it builds the emitter (`EnemyPattern.difficulty`,
`src/sim/enemy.ts:41`; the merge is `mergeOptions`, `src/sim/difficulty.ts`).

```ts
{
  pattern: 'ring',
  options: { spec: EMBER_SHOT, count: 12, period: 90 },   // Normal
  difficulty: {
    easy:    { count: 8 },
    hard:    { count: 16, period: 75 },
    lunatic: { count: 24, period: 60 },
  },
}
```

- **One level deep, and a deep value is replaced whole.** A tier field overwrites
  the base field entirely — it is not merged into it. A tier that wants a
  different bullet writes the whole `spec`; a nested object or array is replaced
  whole, never patched key-by-key or concatenated index-by-index. This is the
  documented, tested rule (`src/sim/difficulty.test.ts`).
- **A tier absent from the block fires `options` unchanged.** Normal is always the
  base, so a pattern that plays the same on every tier carries no block, and
  Normal itself never needs one. The no-override path returns the base object by
  identity, so an untiered pattern draws the exact same RNG it did before
  difficulty existed.
- **Density is the axis, not a multiplier.** A global "bullets ×1.5" is
  deliberately not how this works: the negative space between bullets is authored,
  not scaled, so every tier is hand-written. `docs/assets.md`'s readability budget
  still binds — a Lunatic curtain must keep negative space a player can thread, and
  that gap is the craft, not a by-product of a scale factor.
- **RNG order differs across tiers, and that is correct.** A larger `count` fires
  more bullets and pulls more draws from the `sim` stream, so two tiers from one
  seed are two different runs — which is why the run's tier is recorded in replay
  meta and checked strictly on playback (`RunConfig.difficulty`, `src/game/run.ts`,
  a strict `expectMeta` beside `packsData`). Rule 2 forbids reordering the draws
  *of one run*, not two runs from the same seed diverging because they are not the
  same run.

A boss phase's pattern slot takes the identical block (`PhasePattern.difficulty`,
`src/sim/boss.ts:66`); §5 adds the one thing a boss has beyond it — a card that
exists only on some tiers.

### Difficulty also scales score

Density is the tier's first axis; the score multiplier is its second. Every award
passes one choke point, `Run.#award(points)`, which prices `points` through
`scaleScore(points, difficulty)` — `floor(points * num / den)` from a per-tier
rational in `SCORE_MULTIPLIER` (`src/game/run.ts`):

| Tier | Rational | A 1000-point kill pays |
|---|---|---|
| easy | ×1/2 | 500 |
| normal | ×1/1 | 1000 |
| hard | ×3/2 | 1500 |
| lunatic | ×2/1 | 2000 |

Two properties are load-bearing. **Normal is the identity** (`1/1`), so every
Normal award is byte-identical to the pre-multiplier arithmetic — that is what
keeps the Normal gate traces frozen while the Lunatic ones move. And the rational
is **integer-exact**: no float accumulates across a run, because the floor is
applied per award, not to a running total. A content author writes nothing for
this — the tier is already recorded in replay meta (the difficulty block above),
so a replay stays honest with no new field. The rationals are engine constants for now; a pack that
tuned its own economy would carry the table the way a pattern already carries its
per-tier density.

**Leaving the field is not a death.** The cull is silent: no score, no drop, no
death effect (`src/sim/enemy.ts:290-296`). Only `damage` records one, and it
guards on `alive` first, because two player bullets can land on the same enemy in
one collision sweep and the second would otherwise pay its score twice
(`src/sim/enemy.ts:304-307`).

**Nothing in this file spends what it records.** `spoils`, `scoreValue`,
`onHit` and `onDeath` are names and numbers handed to the game layer through
`drainDeaths`; what a `['power', 1]` is worth is not a question `sim/enemy.ts`
can answer. Deaths are recorded rather than dispatched for the reason given at
`src/sim/enemy.ts:12-17` — `damage` runs inside a caller's collision sweep, and a
callback firing there would run arbitrary game code while the live list is being
rewritten.

`despawnMargin` defaults to the field's own margin. Raise it for something that
dives off the edge and is meant to come back: the base-pack `turret` carries 96
because it crawls in from well above the field. The cull also refuses to fire
until the enemy has been inside the field once (`Enemy.entered`,
`src/sim/enemy.ts:127-134`), or every authored entrance would be deleted on the
tick it was created. The cost of that is real and worth knowing: an enemy that
spawns outside and travels further out is never culled at all. It is a content
bug, and only the pool ceiling bounds it.

`src/sim/enemy.ts` holds only the mechanism and its registry now — no cast. The
base game's enemies (`grunt`, `weaver`, `turret`, stage-2's five, stage-3's four
and stage-4's three) moved into
the bundled base pack, authored as JSON in `tools/make-base-pack.ts` and
registered through the injector at boot (`docs/packs.md` §9.7). Adding
an enemy to the base campaign is a generator edit, not an inline `defineEnemy`;
the `defineEnemy` surface remains for engine-registered content and for the tests
that fixture their own. Nothing in the system above knows any enemy exists.

**Or ship it in a pack.** An enemy is also expressible as pack data: a
`content.enemies.<name>` in a pack's `pack.json` is this same `EnemySpec` written
as JSON, injected under a namespaced name with no engine edit. The pack path adds
a check this code path lacks — every name inside (sprite, pattern, behaviour,
spoils item) is resolved against the registries at inject time, and an enemy no
wave spawns is rejected — so it is the safer way to ship an enemy that a stage
you also author will fire. See [`docs/packs.md`](./packs.md) §9.

---

## 5. Adding a boss

A boss is an enemy with a script: a sequence of `SpellCard` phases, each with its
own health, clock, movement and fire.

`BossSpec` is `sprite`, `radius` and `phases`, plus optional `width`, `height`,
`tint`, `entry`, `onDeath`, `music`, `dialogue`, `dialogueFor` and `spoils`
(`src/sim/boss.ts:135-198`). A `SpellCard` requires `name`, `hp`, `timeLimit`
and `patterns`, and takes optional `difficulties`, `motion`, `timeline`,
`bonus`, `isSpell`, `background` and `music` (`src/sim/boss.ts:71-122`).

`music` names the theme this fight is scored to, by registered track name. It is
**boss-level by default** — a fight enters with one theme and holds it across its
cards — but a single card may override it: `SpellCard.music` overrides
`BossSpec.music` for that card's duration, exactly as `SpellCard.background`
overrides the scene. Both are strings resolved by the audio layer and never
validated here (the music registry is audio-side; importing it would cross the
same import boundary that keeps `background` a string, §15). `Run.music`
reports the precedence live: **the current card's `music` if it declares one, else
this boss's, else the stage's**, mirroring `Run.scene` hop for hop. A Lunatic-only
card that names its own track is the shipped example — `sentinel`'s fourth card —
so a fight's theme can change on the card the pattern changes on.

`spoils` is the item shower dropped on death — the same `[name, count]` list an
enemy carries (§4), over the item registry. Omit it and the boss drops the game
layer's default shower (`big-power ×4`, `score ×12`, `bomb ×1`); declare it and
this boss rewards differently. It was a single hardcoded table in `Run` applied
to every boss, so a spec is where a boss's own payout belongs.

```ts
import { defineBoss } from '../sim/boss';
import type { BulletSpec } from '../sim/bullet';

const SHARD: BulletSpec = {
  style: { sprite: 'scale', r: 0.6, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 2.2, theta: 90 },
};

const PETAL: BulletSpec = {
  style: { sprite: 'petal', r: 1, g: 0.55, b: 0.8 },
  radius: 4,
  motion: { r: 4, theta: 90, ra: -0.06, rrange: { min: 0.5 } },
};

defineBoss('herald', {
  sprite: 'halo',
  radius: 20,
  width: 56,
  height: 56,
  tint: { r: 1, g: 0.85, b: 0.9 },
  entry: { x: 240, y: 140, ticks: 90 },
  onDeath: 'death.big',
  phases: [
    {
      name: 'Advance',
      hp: 650,
      timeLimit: 60 * 30,
      isSpell: false,
      timeline: [
        { count: 0, motion: { r: 0.9, theta: 0 } },
        { count: 90, motion: { r: 0.9, theta: 180 } },
        { count: 180, jump: 0 },
      ],
      patterns: [
        { pattern: 'aimed-fan', options: { spec: SHARD, count: 5, spread: 34, period: 48 } },
      ],
    },
    {
      name: 'Sign "Lantern Tide"',
      hp: 880,
      timeLimit: 60 * 45,
      isSpell: true,
      bonus: 200000,
      background: 'surge',
      motion: { r: 0 },
      patterns: [
        { pattern: 'ring', options: { spec: PETAL, count: 18, period: 42, rotation: 9 } },
        { pattern: 'ring', options: { spec: PETAL, count: 18, period: 42, rotation: -14 }, startAt: 21 },
      ],
    },
  ],
});
```

`startAt` and `stopAt` here are ticks since the **phase** began, not since the
boss spawned, so a card's script reads the same whether it is the first or the
fifth (`src/sim/boss.ts:44-48`).

**`defineBoss` validates as the file loads.** A phaseless boss throws — it would
otherwise spawn, enter, and be instantly defeated, which looks like a working
fight until someone plays it (`src/sim/boss.ts:108-112`). Every pattern name in
every phase is then checked against `patternNames()`
(`src/sim/boss.ts:114-133`), because a pattern name is otherwise resolved on the
tick its `startAt` falls due — for a late slot in a late phase, minutes into a
fight the player had to earn. The check is **membership, not construction**:
`create` is content code and may draw from a stream, so calling it here to see
whether it throws would move that stream before the run that actually uses the
pattern. The cost is that a boss naming a pattern from another module must import
that module first, which is an explicit dependency and the right shape for one
anyway.

**Cards can be tier-gated.** A `SpellCard.difficulties` list names the tiers a
card exists on; absent, it exists on all of them. `['lunatic']` is how the genre
ships a Lunatic-only card, and a boss then fights a different phase sequence per
tier (`src/sim/boss.ts:95`, resolved by `activePhaseIndices` in
`src/sim/difficulty.ts`). `defineBoss` enforces the floor this opens up: **every
tier must keep at least one phase**, or a boss whose every card is gated off a
tier would spawn and be instantly defeated there — the phaseless-boss bug one
level down. A tier left with no phase throws at definition:
`boss "<name>" has no phase on difficulty "<tier>" — every tier must keep at least one`
(`src/sim/boss.ts:167-173`). The gate and the per-slot `difficulty` block (§4) do
different jobs: the gate decides *whether* a card runs on a tier, the block decides
*how dense* it is when it does. Neither `hp` nor `timeLimit` varies by tier in v1
— player damage is constant, so density is the axis, not health, and a future
tier-scaled `hp` is noted but not built (`src/sim/boss.ts:73-88`).

**Entry is not phase 0.** The boss flies in invulnerable and phase 0 begins only
once it settles. Folding the two together gives you either a health bar draining
before the card is announced, or a card whose first seconds cannot be damaged —
both are the entry animation leaking into the fight (`src/sim/boss.ts:19-24`).

**A phase has exactly one exit.** Drained or expired, it leaves through
`#endPhase`. Two exits with two bodies is how a boss ends up stuck in a phase
that neither drains, because the timer path forgot to advance, nor expires,
because the damage path forgot to re-arm the clock — and a stuck boss is
unwinnable (`src/sim/boss.ts:10-17`). `timeLimit <= 0` means no limit at all, and
timing a phase out is a *clear*: the fight continues and only what the game pays
for it differs. Overkill is discarded rather than carried into the next phase,
or one well-timed bomb would delete a card the player never saw
(`src/sim/boss.ts:505-508`).

Transitions are announced, not enacted. Clearing the field between cards is a
game decision — erase the fire, convert it to score, leave it — so this system
emits the event and reaches into nothing.

### A pre-fight exchange: `BossSpec.dialogue`

A boss may carry `dialogue?: readonly DialogueLine[]`
(`src/sim/boss.ts:120-169`), a list of `{ speaker, text }` lines shown before it
spawns. `speaker` is a **portrait name** — an opaque registry string, resolved by
the render layer exactly as `background` and `music` are — and the simulation
never learns portraits exist (§15). `text` is plain.

```ts
defineBoss('herald', {
  sprite: 'halo',
  radius: 20,
  dialogue: [
    { speaker: 'herald', text: 'You climbed the tide for this.' },
    { speaker: 'player', text: 'For the quiet after it.' },
  ],
  phases: [ /* … */ ],
});
```

**Dialogue is simulation, not presentation, and that is the whole reason it lives
on the spec rather than in the shell.** When a boss carrying a non-empty
`dialogue` comes due, `Run` enters a dialogue phase *before* the boss spawns: the
field is cleared, spawning stops, the player still moves but cannot shoot or bomb,
and each **fresh Shot press** (a tap, not a hold — the latched taps of rule 4
exist for this) advances one line; after the last, the boss enters exactly as it
would have. Advancing a line is an input and the exchange delays the fight, so it
changes the run's timeline — which means it must be inside the tick-and-mask
world, or a replay of the fight would not line up. A replay reproduces the whole
exchange from the input log with **zero new meta**: the taps are already in the
frame-indexed mask. `Run.dialogue` exposes a read-only `{ speaker, text, index,
count } | undefined` the shell renders, declared state like `Run.scene` and
`Run.music`, never an event.

The interposition wraps **both** boss-spawn paths — the midboss cue and the
end-of-stage boss — so a boss reached only as a midboss (like `warden`) still
gets its exchange; a dialogue registered but never advanced would be the empty
wire this repo keeps finding, so the built-in bosses each carry a short one and
`reachability.test.ts` advances dialogue to reach them.

`dialogue` is the line every character hears. A boss may also carry
`dialogueFor?: Record<characterName, readonly DialogueLine[]>` — a per-character
override, keyed by the flying character's name. `Run` picks
`dialogueFor[characterName] ?? dialogue` at the moment the exchange begins, pure
data selection off a field the replay already pins (a run records its character,
so the branch is reproducible with no new meta). A variant may run a different
line count — that changes only that character's timeline, which is exactly why the
character is pinned. `sentinel` carries a two-line `spire` variant beside its
default. A variant is authored in the same sparse voice as the default, and every
`speaker` still names a portrait (§12).

The portrait a `speaker` names is registered on the render side with
`definePortrait` (§12) — but the boss author never touches it: a speaker name that
has no portrait still draws, as a procedural silhouette, which is what lets a boss
be written with dialogue before any face is drawn.

### Tuning phase hp, which has been got wrong here before

Do not type hp or a clock as a literal. Ask for a phase in the units a designer
thinks in, and let the model convert:

```ts
import { phaseHp, phaseClock } from '../sim/boss';

const hp = phaseHp(10);        // health a good player spends in 10 seconds
const timeLimit = phaseClock(hp);  // the timer that health earns
```

`phaseHp(seconds)` is `REFERENCE_DPS × seconds × 60` rounded to a multiple of
10, and `REFERENCE_DPS` is **1.125** damage per tick — the rate a competent
player sustains, measured by driving the real `Run`, not guessed.
`phaseClock(hp)` is twice what that rate needs to spend the health
(`CLOCK_MARGIN = 2`), rounded up to a multiple of 10, so a good player finishes
at the half-way mark and a weaker one times out; both are clears, and the gap
between them is the difficulty curve. Timing out pays a quarter of the card's
bonus, so outlasting a phase is a worse clear rather than a free one.

**Every number here is derived, and a test holds it there.**
`src/balance.test.ts` re-measures `REFERENCE_DPS` from every character ×
power tier × focus state and fails if player damage moves for any reason — a
weapon tier, an option layout, a hitbox. When it fails, the boss content is what
has to be revisited, because the constant it was sized from just changed. That
coupling is the whole point: the number used to be a `0.56` literal typed into a
test and repeated in three comments, and each of its three readers was wrong in
a different direction — `sentinel` sized above it into phases no loadout could
drain inside their own clocks, while stage-2 read the same literal, judged it
far too generous, and sized a midboss below two trash enemies.

Do **not** size a clock as `hp / FLOOR_DPS`. `FLOOR_DPS` (0.4) is the
drainability floor — the weakest loadout a player *arrives* with — and sizing
the timer so that loadout only just drains it lets a good player time out a
third of the way in and makes never firing a 183-second exit. `phaseClock`
exists precisely so this cannot be done by hand; `src/sim/boss.ts`'s
`CLOCK_MARGIN` comment argues it in full.

**Adding a boss to the base campaign is a generator edit.** `sentinel`, `warden`,
`magistrate`, `chancellor` and `regent` are no longer engine `defineBoss` calls —
they are JSON in `base-pack.json`, authored in `tools/make-base-pack.ts`, where a card states its
health as `hpSeconds` (the same `phaseHp` seconds, reconverted by the injector)
rather than calling `phaseHp` in TypeScript. The `defineBoss` surface documented
above stays for engine-registered content and for a guest pack's injector path;
the base game's bosses ride the pack pipeline (`docs/packs.md` §9.7).

---

## 6. Adding a stage

A stage is a list of waves, and a wave is "at this tick, put this enemy here".
Everything else belongs to the `EnemySpec`. That split is the point: a stage is a
score, not a script, so retuning an enemy retunes it everywhere without touching
a stage file.

`StageSpec` is `name` and `waves`, plus optional `seed`, `outro`, `boss`, `next`,
`background` and `music` (`src/content/stage.ts:78-141`). An `EnemyWave` is `at`, `enemy`,
`x`, `y` with optional `count`, `interval`, `stepX`, `stepY`
(`src/content/stage.ts:28-40`); a `BossWave` is `at` and `boss`, with optional
`x` and `y` (`src/content/stage.ts:55-61`).

```ts
import { defineStage } from './stage';

defineStage('stage-demo', {
  name: 'stage-demo',
  seed: 0x5747a1,
  outro: 180,
  background: 'expanse',
  waves: [
    { at: 0, enemy: 'grunt', x: 120, y: -24, count: 5, interval: 20 },
    // `interval: 0` puts all five on one tick; `stepX`/`stepY` stagger them in
    // space instead of in time, so they arrive as a diagonal wall.
    { at: 200, enemy: 'grunt', x: 150, y: -24, count: 5, interval: 0, stepX: 45, stepY: -18 },
    { at: 360, enemy: 'weaver', x: 140, y: -30 },
    { at: 760, boss: 'sentinel', x: 240, y: -60 },
    { at: 900, enemy: 'turret', x: 240, y: -60 },
  ],
});
```

The registry key and `spec.name` must match, or `defineStage` throws
(`src/content/stage.ts:139-146`). Tooling shows one and lookups use the other, so
a half-finished rename would surface far from its cause.

Waves are sorted by `at` at definition and **copied**, so they may be authored in
whatever order reads best — grouped by role, by lane — and an author mutating
their own array afterwards cannot change a registered stage
(`src/content/stage.ts:148-153`). The sort is stable, which is load-bearing:
two waves sharing an `at` spawn in the order they were written, and spawn order
is draw order in `EnemySystem`.

`validate` rejects only whole-tick arithmetic, not taste
(`src/content/stage.ts:175-214`). `at: 12.5` is never reached by a counter that
moves in whole steps, and a fractional `interval` puts a wave's repeats on ticks
that are neither evenly spaced nor the ones written down. Both produce a stage
that looks authored and plays wrong.

Repeat `k` of a wave lands at `at + k * interval`, offset by `k` steps — so
`count: 1` is the wave and nothing more, and `interval: 0` puts the whole group
on one tick, which is how a formation is written
(`src/content/stage.ts:227-263`).

**A boss wave holds the schedule.** Reaching one stops the runner advancing
entirely — the tick counter included — until `resume()` is called, so the waves
authored after it do not pour in during the fight
(`src/content/stage.ts:42-54`, `:343-369`). That is why every `at` is a *script*
tick rather than a wall-clock one, and why a midboss can be moved without
retiming everything after it. The runner reports the cue through
`drainBossCues()` rather than a callback, since a callback would run the caller's
boss-spawning code inside this loop.

`StageRunner`'s constructor resolves every enemy name, every boss name, and every
pattern name those enemy specs reference (`src/content/stage.ts:290-333`).
`EnemySystem.spawn` would throw on a typo anyway — forty seconds in, from a wave
the player was about to meet — and a *pattern* typo is worse, because it is not
read until the slot's `startAt` falls due and detonates from inside
`EnemySystem.step` an arbitrary number of ticks after the enemy appeared. This is
deliberately not done in `defineStage`: a content file defining its own enemies
would then have to be imported in the right order, which is the load-order trap
`patterns.ts` was written to avoid.

**`boss` and `next` are how a stage joins the game.** `boss` names the fight sent
once the script is spent and the field is clear; `next` names the stage that
follows, and leaving it unset is what declares this the last one. Both are
**strings**, for the same reason `background` is — a stage naming its sibling by
import would put the two files in a cycle, and `states.ts` is the right place to
resolve it.

Omitting them is not a small thing. `RunConfig.boss` used to be the only way a
run learned it had a boss at all, and nothing in the shipped shell ever set it,
so three bosses, ten phases and seven spell cards sat registered, imported and
unit-tested in a game where no player could reach any of them. A stage without
`next` likewise ends the game rather than continuing it. `reachability.test.ts`
now fails the build on either — see the CLAUDE.md section of that name.

`seed` is data, not an action. The runner does not apply it — reseeding `sim`
mid-run would stomp a stream the replay system owns — so whoever starts the run
calls `seedRun(spec.seed)` once, from `core/random`
(`src/content/stage.ts:80-87`).

`outro` counts ticks after the tick that spawned the last wave, so `outro: 0`
finishes the moment that spawn happens. Survivors are not consulted: whether the
player still has enemies to clear is a question about the field, not about the
script (`src/content/stage.ts:398-411`).

`background` names a registered scene as a **string** — see §12 and §15 for why
it cannot be an import. `music` names the stage's theme the same way — a
registered track name resolved by the audio layer, never imported, so
`src/content` stays runnable with no audio context (the identical boundary
argument, §15). `Run.music` mirrors `Run.scene`: the live card's theme if it
declares one, else the boss's, else this stage's, else undefined (leave what plays).
The theme is authored for a pack the same way a scene is — see
[`docs/audio.md`](./audio.md) §4 and [`docs/packs.md`](./packs.md) §6.5a.

**Or ship it in a pack.** A stage is also pack data: a `content.stages.<name>`
in a `pack.json` is this same `StageSpec` as JSON (minus `name`, which the key
supplies) plus `entry: true` to make it a selectable campaign and a nullable
`next`. Its waves may name the pack's own enemies or built-in ones, and it ends
on a built-in boss named by string — the injector resolves all of it and the
title menu grows a row per entry, so a pack stage is reachable without touching
`states.ts`. See [`docs/packs.md`](./packs.md) §9.

**The base game's own stages are that pack data.** `stage-1`, `stage-2`,
`stage-3` and `stage-4` are no longer `defineStage` calls in `src/content/stage.ts`
— that file keeps only the machinery. They are JSON in `base-pack.json`, authored
in `tools/make-base-pack.ts`, and injected bare (no campaign row: the entry stage
takes the plain START row). So extending the base campaign — a new stage, or a
new wave in an existing one — is a generator edit; `docs/packs.md` §9.7
covers how it round-trips byte-for-byte and the drift test that holds it.
The worked example is **`stage-3`** (`tools/make-base-pack.ts:1619`): its
wave arc and its `boss: 'chancellor'` handoff are the same `StageSpec` fields
above, authored in the generator's JSON rather than through `defineStage`. It is
no longer the campaign's last stage — its `next` names `stage-4`, whose own
`boss: 'regent'` and `next: null` are what close the campaign now. Clearing a
stage whose `next` is `null` raises the ending screen before the results screen
(§9 above and `docs/packs.md` §9.7 note the same behaviour); the closing stage
is content, the ending screen it triggers is not.

---

## 7. Adding a weapon, an option loadout, a bomb, or a character

Three registries the player's side is assembled from. None of them owns any of
the player's counters; each hands data to the game layer and stops.

**The base game's own player side is generator-authored, exactly like its
enemies and stages.** `scout`, `lance`, `hound`, `spire` and `maw` — and the five
shots, four option sets and two bombs they fly — are no longer inline `define*` calls in
`src/content/shots.ts`, `src/sim/option.ts`, `src/sim/bomb.ts` or `src/game/run.ts`;
those files keep only the registries, the systems and the runtime constants they
read (`FORWARD` and `DEFAULT_FOLLOW_SPEED` stay in `option.ts` — the option system
reads them every tick). The five characters and their loadouts are JSON in
`base-pack.json`, authored in `tools/make-base-pack.ts` and injected at boot
(`docs/packs.md` §9.7). So adding a ship to the **base** roster is a generator
edit; the `define*` surfaces below stay for engine-registered content, for a guest
pack's injector path, and for the tests that fixture their own. The subsections
document the shapes those all share.

### `defineShot` — a weapon, by power tier

A `ShotType` is `name`, `levels`, and an optional `description`
(`src/content/shots.ts:30-35`), where each level is a `ShotSpec` of `spec`,
`offsets` and `period` (`src/sim/player.ts:21-27`). As with `defineStage`, the
key and the `name` field must agree or it throws
(`src/content/shots.ts:44-49`) — content is referenced by name everywhere, and a
type whose own name disagreed with its key would report the wrong weapon in every
diagnostic that read it back.

```ts
import { defineShot } from './shots';

/** Straight up. The whole cast fires toward the top of the screen. */
const FORWARD = 270;

const BOLT = {
  style: { sprite: 'glow.small', r: 0.7, g: 0.95, b: 1 },
  radius: 4,
  motion: { r: 9, theta: FORWARD },
  damage: 1,
};

defineShot('lance', {
  name: 'lance',
  description: 'one heavy column; no spread at any tier',
  levels: [
    { spec: BOLT, offsets: [{ x: 0, y: -12, angle: FORWARD }], period: 6 },
    { spec: BOLT, offsets: [{ x: -5, y: -12, angle: FORWARD }, { x: 5, y: -12, angle: FORWARD }], period: 6 },
  ],
});
```

`levels[n]` is the weapon at power tier `n`, indexed exactly as
`OptionSpec.levels` is, and `Player.#shot` clamps the index — so a table shorter
than the power ceiling keeps its strongest entry rather than disarming the ship.
Tier 0 is never empty, unlike options, because a ship that cannot shoot until its
first pickup has no way to earn one (`src/content/shots.ts:11-16`).

The shipped `spread` weapon buys **coverage, not damage**: every tier fires the
same bullet and the upgrade is more of them across a wider arc. A tier that
raised `damage` instead would make the same fight easier without changing how it
is played (`src/content/shots.ts:71-83`).

A bullet's `life` on a **player** shot is a range cap, and a weapon can be built
around it as a deliberate idiom rather than a housekeeping detail. `life: n` on a
spec that moves at `r` px/tick expires the bullet after `n` ticks, so it travels
`r*n` px and vanishes: full damage inside that radius, nothing past it. (This is
the same `life` field the §1 *Lifetime* section documents for despawn timing —
here it is spent on purpose to shape reach.) The base game's `maw` is authored
entirely on it: its `scatter` gun fires `r: 8, life: 18` pellets that reach
`8*18 = 144px` and die, and its `clinch` options fire `r: 9, life: 20` bullets
that reach `~180px` — so a boss stationed at the top of the field (~240px from the
pilot's usual station) takes **no** damage until `maw` flies up into the pocket,
which is the whole character. A leash like this is pure data, priced by the
balance wall like any other weapon: the shorter the reach, the higher the
up-close rate it can carry (`scatter` in `tools/make-base-pack.ts`). No engine
mechanism is involved — `life` already expires bullets; a player weapon just gets
to choose the number as a design axis, the inverse of `laser` buying range back
per tier.

A tracking weapon steers at enemies, not at the ship, and that is now true —
`hound` flies `homing`. It was once a standing warning here that `homing` must
not be put on a character: `BulletSystem.step` took one aim target for the whole
field, the player's position, and a player bullet carrying `homing` read it and
curved *back toward the ship that fired it*, landing 12 damage on a stationary
target in 400 ticks where `spread` landed 306. That was an engine defect, and
the warning said fixing it was an engine change rather than a content one. It
was — `step` now takes two targets and selects by faction (see §3 and
`src/sim/bullet.ts:339-347`) — so the weapon is shippable and shipped. The
lesson worth keeping is the shape: a registered weapon no character equipped was
invisible to every unit test, because a unit test aims the bullet itself.

**Or ship it in a pack.** A weapon is also pack data: a `content.shots.<name>` is
this `ShotType` as JSON (minus `name`, which the key supplies), equipped by a pack
character that names it. The injector resolves every sprite and behaviour the
bullets name, and a shot no pack character fires is rejected as dead content. See
[`docs/packs.md`](./packs.md) §9.

### `defineOptions` — the satellites

`OptionSpec` is `sprite`, `shot`, `period` and `levels`, plus optional
`followSpeed` and `tint` (`src/sim/option.ts:44-54`). Each `OptionSlot` carries
`x`, `y`, `focusX`, `focusY` and an optional `angle`
(`src/sim/option.ts:30-42`).

```ts
import { defineOptions } from '../sim/option';

defineOptions('wide', {
  sprite: 'orb.medium',
  shot: { style: { sprite: 'glow.small', r: 1, g: 0.9, b: 0.7 }, radius: 3, motion: { r: 8, theta: 270 } },
  period: 5,
  followSpeed: 1.6,
  levels: [
    [],
    [
      { x: -26, y: 6, focusX: -11, focusY: -10, angle: 270 },
      { x: 26, y: 6, focusX: 11, focusY: -10, angle: 270 },
    ],
  ],
});
```

`levels[0]` is empty in both shipped loadouts: there are no options until the
first power tier buys one. Omitting `angle` means "aim at the nearest enemy",
which arrives as a parameter rather than being looked up — this file must not
know `EnemySystem` exists.

**The lag is the mechanic.** An option has a target offset from the ship and a
speed at which it chases; the unfocused layout is wide, the focused one a tight
column, and the transition between them is not an animation but the same chase
running against a different target. Snap them to their slots and the ship stops
feeling like it is dragging anything (`src/sim/option.ts:1-12`). `followSpeed`
defaults to 1.4 px/tick, roughly a third of a ship.

`Option.angle` is **degrees** in [0, 360), matching the motion DSL — not the
radians `Bullet.angle` carries, which is a render value converted at the edge
(`src/sim/option.ts:85-89`).

**Or ship it in a pack.** An option loadout is also pack data: a
`content.options.<name>` is this `OptionSpec` as JSON, equipped by a pack character
that names it; its sprite and its bullet's sprite/behaviours are resolved at inject
time, and an option set no pack character equips is rejected. See
[`docs/packs.md`](./packs.md) §9.

### `defineBomb` — the panic button

`BombSpec` is `duration`, `invulnTicks` and `damagePerTick`, plus optional
`radius`, `convertBullets` and `effect` (`src/sim/bomb.ts:31-48`).

```ts
import { defineBomb } from '../sim/bomb';

defineBomb('cascade', {
  duration: 120,
  invulnTicks: 180,
  damagePerTick: 1.5,
  convertBullets: true,
  effect: 'death.big',
});
```

Damage is **per tick, not a lump**, which is what makes bomb timing against a
boss a skill rather than a button: a bomb fired into the last two seconds of a
phase is worth less than the same bomb fired earlier, and the player can feel the
difference (`src/sim/bomb.ts:6-11`).

Three things the system deliberately does not do. It does not decrement the
player's stock — `fire` reports whether a bomb started and the game decrements,
because a system that decremented would have to know about lives, extends and
continues to know when *not* to. It does not administer `invulnTicks`; that is
data on the spec for the game to read, and the player owns its own timer. And it
does not decide what a cleared bullet becomes: it reports the positions it
cleared and stops, because deleting bullets is a get-out-of-jail card while
converting them into score is a decision, and the answer changes as the scoring
does (`src/sim/bomb.ts:1-23`).

`fire` refuses while one is burning; it never queues. A queued bomb spends a
resource the player cannot see being spent and lands at a moment they did not
choose (`src/sim/bomb.ts:102-109`). `duration` is floored at one tick, since a
zero-duration bomb would consume a stock and do nothing, which reads as a dropped
input.

**Or ship it in a pack.** A bomb is also pack data: a `content.bombs.<name>` is
this `BombSpec` as JSON, its `effect` resolved pack-first (a pack bomb may throw a
pack effect), equipped by a pack character that names it; a bomb no pack character
equips is rejected. See [`docs/packs.md`](./packs.md) §9.

### `defineCharacter` — the ship that makes all three reachable

Everything above this line is unreachable on its own. A weapon, an option
loadout and a bomb are all consumed **exclusively** through a `CharacterSpec` —
nothing in a running game reads `getShot`, `getOptionSpec` or `getBombSpec`
except a character that names them. Register the `cascade` bomb by itself and it
is a bomb no ship can fire; the section you just read is only half of adding one.
This is the project's central lesson written into the guide: registration is not
reachability, and the wire that closes the gap is a character.

```ts
import { defineCharacter } from '../game/run';
import { getShot } from '../content/shots';

defineCharacter('ranger', {
  label: 'RANGER',              // shown on the select screen, uppercase
  blurb: 'wide fire, panic bomb', // one lowercase line under it
  sprite: 'ship',               // atlas region; 'ship' is the only one so far
  options: 'wide',              // a registered defineOptions name
  bomb: 'cascade',              // a registered defineBomb name
  player: {
    x: 240, y: 408,             // spawn; the run overrides bounds, not these
    speed: 3.4, focusSpeed: 1.4,
    radius: 2.5,                // the lethal hitbox — the genre's ratio, keep it
    grazeRadius: 22,
    lives: 3, bombs: 3, invulnTicks: 90,
    shots: getShot('spread').levels,  // a registered defineShot's ladder
  },
});
```

The select screen is data-driven from `characterNames()`, so a registered ship
appears on it with nothing told about it, in registration order. Four things are
worth knowing:

- **`sprite` is the ship's art, by name** (§11), exactly as `EnemySpec` and the
  rest name theirs. Every shipped ship names `'ship'` because that is the only
  region the placeholder generator paints; the field is what lets a real second
  silhouette drop in without editing the shell. `width`/`height` default to 40.
- **The three loadout fields are strings and a ladder.** `options` and `bomb`
  are registry *names*, checked when the run is built; `shots` is the resolved
  `getShot(name).levels` array. Give a ship a weapon no one else flies and you
  have covered a seam that two ships cannot — see below.
- **`radius` is the one number not to tune for advantage.** It is the lethal
  hitbox against a 40px sprite, and `balance.test.ts` measures damage *dealt*
  and never damage *taken*, so a smaller radius is a strictly-better ship no test
  can see. Leave it at 2.5.
- **Adding a ship changes the balance envelope, and a test holds it.**
  `balance.test.ts` drives the real `Run` across every character × power tier ×
  focus and asserts the spread between the strongest and weakest loadout in the
  whole game stays under 5×. A ship whose numbers are hand-waved fails it; reason
  about the DPS numerically, the way `scout` and the rest argue every field
  against an existing one. And `reachability.test.ts` now flies **every**
  registered character, so a ship that is registered but somehow unreachable, or
  a weapon only it carries, fails the build.

`defineCharacter` lives in `src/game/run.ts` rather than in a `src/content`
file, which is the one exception to "a new registry entry is a new file". It is
deliberate: a character names shots, options and bombs, and a `content/`
character file importing `game/run` for `defineCharacter` while `run` imports
`content/shots` would close a module cycle. The starter roster therefore sits
beside the registry, the same way `sim/option.ts` and `sim/bomb.ts` hold their
own starter sets.

**Or ship it in a pack.** A character is also pack data: a
`content.characters.<name>` mirrors `CharacterSpec` but **names** its `shot`
(pack-first, then built-in) rather than carrying the ladder inline — the injector
resolves it into `player.shots` — and names its `options`/`bomb` the same way. A
pack character appears on the SELECT screen exactly as a built-in does, and because
its pack shot, option and bomb change the simulation, a replay flown with one
records the owning pack's identity strictly, even off the plain START row. See
[`docs/packs.md`](./packs.md) §9.

---

## 8. Adding a pickup

An item is a hitbox that cannot hurt anything: no faction, no damage, no bounce.
`ItemSpec` requires `sprite`, `radius`, `value` and `kind`
(`'power' | 'score' | 'life' | 'bomb'`), and takes optional `motion`, `tint` and
`magnetSpeed` (`src/sim/item.ts:39-56`).

```ts
import { defineItem } from '../sim/item';

defineItem('fragment', {
  sprite: 'shard',
  radius: 13,
  value: 0.05,
  kind: 'power',
  tint: { r: 1, g: 0.3, b: 0.35 },
});
```

**The radius is generous on purpose**, and it is the one place in this engine
where that is true. Shipped items sit at 13–18px against a bullet's 3–4
(`src/sim/item.ts:406-451`): a drop the player earned but grazed past feels like
the game cheating, where a bullet whose hitbox matched its sprite would only be
unfair.

`motion` defaults to `{ r: 1.7, theta: 270, ra: -0.09, rrange: { min: -2.3 } }`
(`src/sim/item.ts:58-72`), which is the genre's drop arc written as one polar
segment. `theta: 270` is up, and `r` decays through zero into negative, which
reverses travel along the same heading — so the item rises, stalls and falls back
without a second segment or a gravity vector, and `rrange.min` is a terminal
velocity for free that a cartesian gravity term could not give without an
accumulator clamp `MoveVector` does not have.

**Magnetism latches and is never cleared while the item lives.** An item that
re-entered its own motion every time the player stepped a pixel away would
oscillate at the edge of the radius, and that reads as the game fighting you
(`src/sim/item.ts:16-22`).

Nothing here writes to the player. `value` and `kind` are read by the game layer
through `drainCollected`, on the same contract as `EnemySystem.drainDeaths` and
for the same reason: `step` rewrites the live list in place, and a collection
callback firing mid-sweep would run arbitrary game code — awarding power,
spawning an effect, possibly spawning more items — against a half-rewritten list,
skipping the entity in the slot being written (`src/sim/item.ts:24-31`).

**Or ship it in a pack.** A pickup is also pack data: a `content.items.<name>` is
this `ItemSpec` as JSON, made droppable by being named in a pack enemy's or boss's
`spoils` (pack-first). `kind` is restricted to the existing union — a new kind is a
new game rule, not pack data, and an unfamiliar one is refused by name. An item
nothing drops is rejected. See [`docs/packs.md`](./packs.md) §9.

---

## 9. Adding a particle effect

Effects are pure decoration: they never collide, never score, never feed back
into the simulation.

`ParticleSpec` requires `sprite`, `count`, `speed` and `life`; `spread`,
`direction`, `drag`, `gravity`, `scale`, `alpha`, `spin`, `tint` and `additive`
are optional (`src/sim/effects.ts:29-56`). `count`, `speed` and `life` each take
a number or a `{ min, max }` drawn per particle.

```ts
import { defineEffect } from '../sim/effects';

defineEffect('shatter', {
  sprite: 'shard',
  count: { min: 8, max: 14 },
  speed: { min: 1.2, max: 3.4 },
  life: { min: 14, max: 24 },
  drag: 0.9,
  scale: { from: 0.9, to: 0.15 },
  alpha: { from: 1, to: 0 },
  spin: 0.08,
  tint: { r: 0.7, g: 0.9, b: 1 },
  additive: true,
});
```

**This module draws from `fx` and structurally cannot draw from `sim`.**
`EffectSystem` takes no generator argument anywhere in its API, so there is no
parameter through which a caller could hand it the simulation stream — the only
reachable source of randomness in the file is the module-level `fx` import. That
defence is structural rather than disciplinary because upstream made the opposite
choice: it scattered damage particles from its single global generator, so adding
one particle shifted every subsequent bullet and desynced every replay
(`src/sim/effects.ts:1-20`, CLAUDE.md rule 2).

Interpolating `scale` and `alpha` on `age / life` is fine *here* in a way it
would not be in the sim, for exactly one reason: nothing downstream reads these
values back.

`direction` is degrees on the motion DSL's convention — 0 right, 90 down. The
built-in `muzzle` effect uses `-90` because the player's gun points up the screen
(`src/sim/effects.ts:300-311`). `emit` takes an override, for directional bursts
like graze sparks.

`life` is floored at one tick: a range that rounds to zero would emit a particle
that dies before it is ever drawn, and divide `t` by zero. Particles refused at
the pool ceiling are counted in `droppedParticles` and that is all — losing
decoration costs nothing the player can lose a run to, so it is telemetry, not an
error path.

The starter set is registered through a private `defineSprite` helper that types
`sprite` against `BulletCell`, so a renamed or repacked atlas cell fails the
build instead of silently drawing the wrong shape
(`src/sim/effects.ts:237-249`). The import that makes that possible is
`import type` — effects must stay testable without a canvas. See §15.

**Or ship it in a pack.** An effect is also pack data: a `content.effects.<name>`
is this `ParticleSpec` as JSON. The `BulletCell`-typed `sprite` seam above becomes
a **runtime** check for a pack — a pack has no compiler at author time, so its
`sprite` is validated against the atlas cell set at inject time — and an effect
nothing (enemy, boss or bomb) triggers is rejected. See
[`docs/packs.md`](./packs.md) §9.

---

## 10. Adding a sound

`SoundSpec` is four optional fields: `url`, `volume`, `polyphony`, `throttleMs`
(`src/audio/index.ts:30-38`). Omit `url` and the engine synthesises a
placeholder; give one and the file is loaded instead.

```ts
import { defineSound } from '../audio';

defineSound('shield', { volume: 0.4, polyphony: 2, throttleMs: 80 });
```

**Registering a sound does not make it play.** A sound is played by a *cue*, and
there are two cue channels (`src/game/cues.ts`), not one: a gameplay sound is
named by a `RunEventType` in `EVENT_SOUNDS`, which the shell reads off `Run`;
a menu/shell sound is named in `SHELL_CUES` instead, since pause, dialogue
advance and menu navigation are shell state with no `RunEventType` to attach
to — `main.ts` reads those off a transient `.cue` field and two shell
reconciles (`docs/audio.md` §1, §3). Add a `defineSound` and nothing else, and
you have a sound the game never reaches — the same registration-is-not-reachability
gap that leaves a bomb no ship can fire (§7). To make a gameplay sound audible,
either repoint an existing `EVENT_SOUNDS` row at your new name, or map a new
event to it — and note that a *new* event also has to be raised by `Run`, or the
cue never fires; a menu sound instead joins `SHELL_CUES` and needs a shell edge
to set `.cue`. `reachability.test.ts` holds both channels the same way: every
registered sound must be named by one of the two, and every name in either must
resolve to a registered sound — an unplayed sound and an unplayable cue both
fail the build, and the UI channel is also driven by a scripted menu pilot so a
registered-but-never-reached `ui-*` name fails too.

**Replacing a sound with a real file is the `url`, and nothing else.** But get
the `url` from a bundler import, not a bare path:

```ts
import ROAR_URL from '../assets/boss-roar.ogg';
defineSound('explosion', { url: ROAR_URL, volume: 0.6 });
```

A bare `url: '/audio/roar.ogg'` does **not** work under the dev server for the
same reason `new URL(..., import.meta.url)` fails for art — the route returns the
entry HTML — and audio fails *silently* where art now fails loudly, because
`Audio.#load` swallows every error so `play` can never throw into the loop. So a
wrong `url` is no console error and no crash, just a cue that never sounds. The
full authoring guide — mono, zero-amplitude edges, the `peak`-versus-`volume`
split, the swap and its traps — is [`docs/audio.md`](./audio.md).

**This is the one registry that does not throw on a duplicate name**
(`src/audio/index.ts:62-79`), because replacing a placeholder from a content file
has to be possible without editing the engine. `defineSound` overwrites,
deliberately, and it is the exception the rest of this document's "registries
throw" rule is stated against. The cost: a typo registers a new unplayed sound
rather than replacing the one you meant.

`volume` is clamped to 0..1 and `polyphony` floored at 1 — a sound with zero
voices can never play, which is a typo rather than an intent. `throttleMs` is
**milliseconds**, the one clock in this project that is wall time on purpose:
audio has no tick (`src/audio/index.ts:185-188`). Synthesis noise comes from
`fx`, never `sim`. `Audio.unlock()` must be called from a user gesture; calling
it where WebAudio does not exist is harmless.

---

## 11. Adding art

[`docs/assets.md`](./assets.md) is the full specification. The parts that matter
when you are writing code:

### Bullet art is white, tinted per instance

One greyscale shape serves every colour in the game:

```ts
{ sprite: 'orb.medium', r: 0.45, g: 0.75, b: 1 }   // ice blue
{ sprite: 'orb.medium', r: 1, g: 0.4, b: 0.35 }    // ember red
```

Upstream baked each colour into its own cell and never used its per-vertex
colour channel as a tint at all — ten enemy bullet types were ten separately
coloured cells. Tinting means a designer retunes a whole pattern's palette
without asking for new art, and it is why the sheet is 256×64 rather than
1024×512. Draw with **luminance and alpha only**; a bullet drawn blue can never
be made red.

### The grid convention

`src/render/procedural.ts` generates the placeholder sheet and *is* the
reference implementation: 32×32 cells, 8 columns × 2 rows, row-major, ≥2px
transparent margin inside every cell.

To add a cell, add its name to `BULLET_CELLS` and a painter to `PAINTERS`.
`PAINTERS` is typed `Record<BulletCell, …>`, so adding the name without the
painter fails the build:

```ts
// in src/render/procedural.ts
function teardrop(ctx: Ctx, cx: number, cy: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx + 13, cy);
  ctx.quadraticCurveTo(cx - 4, cy - 9, cx - 13, cy);
  ctx.quadraticCurveTo(cx - 4, cy + 9, cx + 13, cy);
  ctx.fill();
}
```

Adding a 17th name overflows the 8×2 sheet — bump `BULLET_ROWS` with it.

### Named regions, for anything not on the grid

```ts
export const PROP_GRID: GridSpec = { cellW: 48, cellH: 48, gapX: 2, gapY: 2 };

export function definePropAtlas(texture: THREE.Texture): Atlas {
  const atlas = new Atlas(texture, 256, 128, PROP_GRID);
  atlas.defineGrid(['turret.idle', 'turret.fire', 'pod.idle', 'pod.fire']);
  atlas.define('banner', { x: 0, y: 96, w: 200, h: 24 });
  return atlas;
}
```

`defineGrid` names cells in row-major order and an empty string skips one.
`Atlas.get` throws on an unknown name, so a typo fails loudly at the draw call
rather than sampling garbage.

Swapping the generated sheet for a real PNG changes one line:

```ts
const atlas = await loadAtlas(
  new URL('../assets/bullets.png', import.meta.url).href,
  BULLET_GRID,
);
atlas.defineGrid([...BULLET_CELLS]);
```

`loadTexture` sets `NEAREST` filtering, right for pixel art; the procedural
atlas overrides to `LINEAR` because generated gradients are smooth. `LINEAR` is
what makes the 2px cell padding non-negotiable.

**There is no pivot field.** A `Region` is `x`, `y`, `w`, `h` and nothing else
(`src/render/atlas.ts:16-22`), so writing `pivotX` into one is a TS2353 excess
property error rather than a setting that quietly does nothing.

A pivot did live there once and was deleted unread. `SpriteBatch` always centres
the quad and the vertex shader rotates about that centre, which made the field a
promise nothing kept — and a field that looks like configuration but is inert is
worse than its absence, because it will be believed. The note left at
`src/render/atlas.ts:24-28` records what putting one back would actually cost:
widening an instance attribute to carry the offset, and applying it before
rotation. Worth doing when a sprite genuinely needs an off-centre origin, and not
before. Until then, offset the draw call.

---

## 12. Adding a background scene

A background is a full-screen fragment shader. `src/render/background.ts` owns
only the shared part — a quad at `Layer.Background`, a fixed set of uniforms, and
a cross-fade — and knows the name of no scene at all. The scenes live one per
file in `src/render/backgrounds/`.

`BackgroundSpec` is `fragment`, plus optional `uniforms` and `scrollSpeed`
(`src/render/background.ts:138-145`). The shader body must define the entry
point `vec3 background(vec2 uv)`, where `uv` is 0..1 across the field with **y
increasing downward**, matching the space content is authored in. Return linear
colour; the wrapper applies `uIntensity` and the cross-fade alpha.

```ts
// src/render/backgrounds/ashfall.ts
import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('ashfall', {
  scrollSpeed: 0.5,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    vec3 background(vec2 uv) {
      float drift = bgFbm(vec2(uv.x * 3.0, uv.y * 3.0 - uScroll * 0.02));
      float depth = smoothstep(0.0, 1.0, uv.y);
      return vec3(0.03, 0.035, 0.05) * (0.4 + drift)
           + vec3(0.01, 0.012, 0.02) * depth;
    }
  `,
});
```

Then add `import './ashfall';` to `src/render/backgrounds/index.ts`.
`index.test.ts` reads the directory and fails when a file is missing from that
list — because a background module nothing imports never calls
`defineBackground`, so the scene does not exist at runtime and
`getBackgroundSpec` throws the first time a stage names it. That failure has
already happened once in this repository, to content rather than to backgrounds.

Every scene is compiled against `uTick`, `uScroll`, `uRes` and `uIntensity`
whether it reads them or not; a spec's own uniforms are merged over that set, per
instance, so two `Background` objects never share a uniform object.
`BACKGROUND_NOISE_GLSL` supplies the value-noise helpers the shipped scenes use —
three octaves, not four, because the fourth lands at a spatial frequency close to
a bullet's.

### How a scene reaches the screen

A stage names its scene as a string on `StageSpec.background`, and a spell card
may override it for the length of that card with `SpellCard.background`. A string
because `src/content` may not import `src/render` at all (§15) — the shader
cannot live next to the stage that uses it, and the name is resolved by whoever
is drawing.

`Run.scene` reports what the run currently wants, preferring the live card's
background over the stage's (`src/game/run.ts:1074-1080`), and `src/main.ts`
reconciles it against the live quad each tick, cross-fading when it and
`background.name` disagree (`src/main.ts:226-228`).

**That is declared state, not an event, and the distinction is load-bearing.**
Everything else the presentation layer reacts to arrives through `drainEvents`,
which is the right shape for something that happened once — a hit, a pickup, a
card starting. Which place we are in is not an occurrence, it is a condition, and
pushing conditions through an event queue is how presentation drifts out of sync
with the run: miss one event, or drain it in a state that is not drawing, and the
screen stays wrong until something unrelated corrects it. Reconciliation is
idempotent, so a run that is paused, replayed or restarted needs no separate
resynchronisation path (`src/game/run.ts:1053-1059`).

### Three constraints, and the one that is not obvious

**`uTick` only.** It advances in `step()` and nowhere else, and there is no
`performance.now` in `background.ts` — there must never be one. A background
driven by a wall clock drifts with frame rate, which means a replay played back
on a 144Hz display does not look like the recording, and "a replay looks the same
twice" is the whole product (rule 1). The interpolated view layer may smooth
sprite positions; a background does not get that licence, because it has no
previous state to interpolate from. Call `background.step()` from the fixed-tick
callback, never from render.

GLSL `sin` and `cos` are used freely here, and that does not contradict rule 3.
The rule bans the approximated `Math` functions from `sim`, `content`, `core` and
`game` because their results integrate into positions and eventually flip a hit test.
These values reach the framebuffer and stop.

**Dark and smooth.** The play field has to stay readable on top, which in
practice means peak luminance around 0.1 and no detail fine enough to be confused
with a bullet. `expanse` peaks near 0.09 and `undertow` near 0.07. If you find
yourself losing a bullet against a background, the shader is too bright or too
detailed — the sprite is not the problem.

**Perspective scenes alias into fake bullets.** This is the one that catches
people. A projection that runs to infinity — `depth = SCALE / (uv.y - HORIZON)`
in `expanse`, `SCALE / r` in `undertow` — makes adjacent pixels land arbitrarily
far apart in world space as they approach the vanishing line. Noise sampled there
aliases into exactly the fine speckle that reads as sparse bullets, in the top of
the screen, which is where enemies enter and where the densest patterns form. So
both shipped perspective scenes decay their *structured* terms much faster than
their brightness: what survives near the horizon is a smooth gradient with
nothing left to alias.

Read `src/render/backgrounds/expanse.ts` and `undertow.ts` before writing one.
They carry the reasoning at length — including why `undertow` has exactly six
flutes, which is a genuine seam problem with a non-obvious fix — and it is not
worth repeating here.

### A family of scenes sharing one cell: the seal idiom

Not every new scene should be a scene written from nothing. The five boss
scenes — `signet`, `cordon`, `intaglio`, `sable`, `regnum` — and the two
Lunatic-only 出神 scenes — `umbra`, `decree` — are one shared GLSL cell,
`SEAL_GLSL` (`src/render/background.ts`, exported beside
`BACKGROUND_NOISE_GLSL` for the same reason: a shape reused by several scenes
lives once, or the copies drift), stamped through thin per-scene registrations.
This is the visual counterpart of `defineMusic` composing a track from one
`CELL_*` motif and a root: identity lives in the shared cell, individuality is
one filter plus one hue.

The cell itself is a bounding ring enclosing an integer-spoke rosette — the
signet the game's own fiction already carries (`tools/make-base-pack.ts`) — flat
and centred, with no perspective divide, so it never opens the run-to-infinity
aliasing a perspective scene has to fight, at the one moment (a boss's spell
card) where the screen is most crowded. Each per-boss file is a handful of lines:
import `SEAL_GLSL` and `BACKGROUND_NOISE_GLSL`, declare a `BASE`/`GLOW` pair, and
call `sealField(...)` with the parameters that pick the filter — an `arcHalf`
that truncates the ring into a broken arc, an `invert` that swaps figure and
ground, a `fill` that lights the rosette's rest, a smaller `ringRadius` and
slower rotation that read as a darkened, compressed press, or a full ring with
`fill` at its ceiling that reads as resolved. Five filters — stated, truncated,
inverted, darkened, resolved — five thin registrations, one cell.

The two 出神 scenes are the same cell **unmoored**: the seal's centre drifts and
precesses (`sin`/`cos` of `uScroll`, never a wall clock — rule 1 binds this file
exactly as it binds every other), and a second ring detuned only along `r` (never
across the angular wrap, so the integer-spoke seam stays safe even undetuned)
beats against the first into a slow radial moiré. The hard rule for a 出神 scene
is that the crossing is never a brightness change: `umbra` and `decree` both
multiply their structure down from the seal they came from and must not measure
brighter at the crest. Breaking legibility at the fullest screen in the game to
signal "this card is different" would cost more than the signal is worth: the
same reason `expanse`/`undertow` decay their *structured* terms near the horizon
rather than dimming — losing a bullet is worse than losing a flourish.

If you are adding a new *family* of scenes — several thin variations on one
shape, rather than one more standalone place — this is the pattern: one shared
cell exported as a string constant from `background.ts` or its own sibling
module, a fixed vocabulary of filter parameters, and one file per member that
sets those parameters and a palette. Reserve it for that case; a stage scene like
`expanse` or `stratum` is one place and stays one file.

### Dialogue portraits: `definePortrait`, a sibling render registry

A portrait is the face drawn beside a boss's pre-fight dialogue line (§5). It is
a **render-side** registry for the same reason a background is: the name lives in
the sim (a `DialogueLine.speaker`), the pixels live in the shell, and the two
meet where `main.ts` draws the dialogue box. `definePortrait(name, spec)`
(`src/render/portrait.ts`) mirrors `defineBackground` — it throws
`portrait "<name>" is already defined` on a duplicate — and a `PortraitSpec` is a
`tint?` and an optional `image?: CanvasImageSource`.

```ts
import { definePortrait } from '../render/portrait';

definePortrait('herald', { tint: { r: 1, g: 0.85, b: 0.9 } });
```

The load-bearing property is that **it never blocks a boss author on art.**
`portraitImage(name)` returns a drawable for *any* string and never throws:
supplied art when a portrait was registered with an `image`, otherwise a
procedural silhouette — a dark tinted panel with the name — painted from the
declared `tint`, or a deterministic hash-seeded one (FNV-1a over the name, no RNG
and no trig, `fx`-side presentation) when none was declared. So a boss can name a
speaker that has no registered portrait and still draw a legible exchange, exactly
as an unskinned bullet still draws. `PORTRAIT_SIZE` (96) is the one square a
supplied image must be; a pack registers its portrait through the same `image`
seam, dimension-checked at load (`docs/packs.md` §5.5).

The five built-in bosses' speakers (`sentinel`, `warden`, `magistrate`,
`chancellor`, `regent`) and `player` are pre-registered, tinted to read as that fight. The painted result
needs a DOM, so `bun test` proves only the registry and the tint arithmetic; the
drawn box is judged in `bun run dev`.

---

## 13. Adding a render layer

Depth testing is off for sprites, because the play field is coplanar. Draw order
is therefore explicit, and lives in `src/render/stage.ts`:

```ts
export const Layer = {
  Background: 0,
  BackgroundProps: 100,
  Enemies: 200,
  Items: 300,
  Player: 400,
  PlayerShots: 500,
  EnemyShots: 600,
  Effects: 700,
  Foreground: 800,
  Overlay: 900,
} as const;
```

Values are spaced by 100 so a new layer slots in without renumbering. Upstream
got its ordering implicitly, from the sequence of calls inside
`StageState._displayElements` — which works right up until you want to insert
something, and then the ordering lives in the middle of a method nobody wants to
touch.

Three ways to place an object, all equivalent:

```ts
stage.add(mesh, 'Effects');                    // named layer
stage.add(mesh, 'Overlay', 10);                // named layer + offset
stage.add(mesh, Layer.EnemyShots - 50);        // raw order, between two layers
```

To insert permanently, add a constant. Between `PlayerShots` (500) and
`EnemyShots` (600):

```ts
export const TRAIL_ORDER = Layer.EnemyShots - 50;

export function addTrailBatch(stage: Stage, atlas: Atlas): SpriteBatch {
  const trails = new SpriteBatch(atlas, {
    capacity: 2048,
    blending: 'additive',
    renderOrder: TRAIL_ORDER,
  });
  stage.add(trails.mesh, TRAIL_ORDER);
  return trails;
}
```

`stage.add` writes `renderOrder` onto the mesh, so it is the authority — the
`renderOrder` in `SpriteBatchOptions` only matters for a mesh you add to the
scene yourself. Passing both, as above, keeps the two from drifting. Passing
neither leaves the mesh at 0, drawing behind the background.

Two constraints on batching:

- **One `SpriteBatch` per layer *and* blend mode.** Each batch is one instanced
  draw call, and blending is a material property — additive and normal sprites
  in one batch is not expressible.
- **`renderer.sortObjects` must stay `true`.** `renderOrder` is read only by
  three.js's render-list comparators, which `sortObjects = false` skips
  entirely. Turn sorting off and draw order silently degrades to scene-graph
  insertion order, making every `Layer` value decorative. This does not
  reintroduce depth sorting: `renderOrder` is the comparators' first key, so z
  is only ever a tie-break within a layer.

Do not add `depthTest` to a sprite material to fix an ordering problem. Fix the
order.

---

## 14. Adding 3D content

This is where the project is going, and it is the reason the renderer is
three.js rather than the raw WebGL it came from. `Stage` already carries a
perspective camera set up in the same space as the sprites.

### The 3D coordinate space

`Stage.camera3D` is deliberately aligned with the sprite field, so you can
position 3D objects in the same numbers content is authored in:

| | |
|---|---|
| FOV | 60° |
| Position | `(width / 2, height / 2, -600)` |
| `up` | `(0, -1, 0)` — y-down, matching sprite space |
| Looks at | `(width / 2, height / 2, 0)` |
| near / far | 1 / 2000 |

Consequences worth internalising:

- **+y is down**, for meshes too. A mesh at `y = stage.height` sits at the
  bottom edge of the field.
- **+z recedes.** The camera sits at `z = -600` looking toward `+z`. Sprites are
  drawn at `z = 0`, so scenery *behind* the play field has `z > 0` and anything
  meant to pass in front has `z < 0` (down to `-599`, where near clipping
  starts).
- **The y-flip reverses triangle winding.** Every custom material must set
  `side: THREE.DoubleSide` or its front faces are culled. This presented once as
  a completely black field with no console error, and it will again
  (CLAUDE.md rule 6).

### Keeping 3D and sprites apart

`Stage` holds one scene and `render(perspective)` picks one camera for all of
it. Sprites need the orthographic camera; a ground plane needs the perspective
one. The mechanism that separates them is three.js's **camera layer channels** —
`Object3D.layers`, a 32-bit visibility mask tested per camera in
`WebGLRenderer.projectObject`.

> **Naming trap.** `Object3D.layers` (three.js visibility) and our `Layer`
> constants (draw order) are unrelated concepts that share a word. Objects
> default to channel 0 and cameras to channel 0, which is why everything works
> today without anyone touching either.

```ts
/** three.js camera channel. Unrelated to `Layer` — that is draw order, this is visibility. */
export const SCENERY_CHANNEL = 1;

export function addGroundPlane(stage: Stage): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(2000, 4000, 20, 40);
  const material = new THREE.MeshBasicMaterial({
    color: 0x1b2a4a,
    wireframe: true,
    side: THREE.DoubleSide,   // y-down reverses winding — rule 6
    depthTest: true,
    depthWrite: true,
  });

  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = Math.PI / 2;                          // lie flat in XZ
  ground.position.set(stage.width / 2, stage.height + 140, 900);
  ground.layers.set(SCENERY_CHANNEL);                       // ortho camera stops seeing it

  stage.camera3D.layers.set(SCENERY_CHANNEL);               // and it stops seeing sprites
  stage.add(ground, 'Background');
  return ground;
}
```

Those position numbers are a starting point, not a result. Framing a perspective
plane is not something you can typecheck — run `bun run dev` and tune it.

### The two-pass render

```ts
export function renderWithScenery(stage: Stage): void {
  const { renderer } = stage;

  renderer.autoClear = false;
  renderer.clear();

  stage.depthEnabled = true;
  stage.render(true);          // perspective pass: scenery only

  renderer.clearDepth();       // sprites must not be occluded by the floor
  stage.depthEnabled = false;
  stage.render(false);         // orthographic pass: sprites over the top
}
```

`autoClear = false` is what stops the second pass wiping the first.
`clearDepth()` between passes is what stops a ground plane at `z = 900` from
depth-rejecting sprites at `z = 0`.

**`stage.depthEnabled` is intent, not enforcement.** It flips the shared GL
depth state, but three.js re-applies `material.depthTest` and `material.depthWrite`
per material inside `setMaterial` on every draw. What actually governs is the
material: sprite materials hard-code `depthTest: false`, so sprites composite by
`renderOrder` no matter what the flag says, and your mesh occludes other meshes
only if *it* sets `depthTest: true`. Set both.

### Lights

Lights are `Object3D`s and are filtered by the same channel mask
(`object.isLight && object.layers.test(camera.layers)`). A light left on the
default channel contributes nothing to a perspective pass whose camera is on
channel 1 — the mesh renders black and there is no warning.

```ts
export function addLitProp(stage: Stage, mesh: THREE.Mesh): void {
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(0, -400, -300);
  light.layers.set(SCENERY_CHANNEL);   // or the perspective pass cannot see it
  mesh.layers.set(SCENERY_CHANNEL);
  stage.scene.add(light);
  stage.add(mesh, 'BackgroundProps');
}
```

`MeshBasicMaterial` needs no lights and is the right default for scenery that is
only ever a backdrop.

### Animating 3D content

3D scenery is view-only, so it is one of the few places `alpha` belongs — but
its clock is still the tick count, never wall time:

```ts
export function scrollGround(ground: THREE.Mesh, tick: number, alpha: number): void {
  const material = ground.material as THREE.MeshBasicMaterial;
  const map = material.map;
  if (map) map.offset.y = ((tick + alpha) * 0.004) % 1;
}
```

`Loop.render(alpha)` supplies the interpolation factor and `Loop.count` the
tick. Driving scenery from `performance.now()` instead makes the background
speed vary with refresh rate — the exact bug the fixed-timestep loop exists to
prevent, showing up in the one layer where nobody thinks to look for it.

**If 3D content ever feeds back into gameplay** — a mesh that occludes a
hitbox, a camera shake that moves the player — it stops being scenery and the
rules change. It must then run in `tick()`, draw from `sim`, and take no `alpha`.

---

## 15. The import boundary

`src/sim/` and `src/content/` must not import a **value** from `src/render/`.
`src/architecture.test.ts` enforces it; until that file existed the rule was
written down, obeyed by hand for the life of the project, and one careless import
away from being false with every test still green — because the thing it protects
is not correctness. It is the ability to run the simulation at all without a GL
context, and that only fails once someone tries.

**`import type` is exempt, and the distinction is the whole point.** A type-only
import erases completely: no runtime edge, no three.js dragged into a headless
run, no `WebGLRenderingContext` pulled into a test process. `src/sim/effects.ts`
uses one to borrow `BulletCell` — a string union naming atlas cells — and
borrowing that name beats duplicating it, because two copies of a list of sprite
names drift apart in silence.

What the scanner counts as a runtime edge:

- `import { Layer } from '../render/stage'` — an offence.
- `import type { BulletCell } from '../render/procedural'` — fine.
- `import { type BulletCell } from '../render/procedural'` — fine; every
  specifier is marked.
- `import { type BulletCell, Atlas } from '../render/atlas'` — an offence, not
  pro-rated. Half of it survives erasure, so it emits a real require.
- `import './x'` — the most runtime-y import there is; it exists purely for its
  side effects.

**Test files are scanned too, deliberately.** Exempting them is tempting, since a
test importing the renderer cannot break a production build. But the only value
import that ever survived in this repository was in a test —
`content/index.test.ts` pulled in `backgroundNames` — and it survived precisely
because it looked harmless. `bun test` *is* the headless run, so a test that
drags three.js in has already spent the thing the rule was buying.

**The escape hatch, when you need a value.** Name it as a string in the content
layer and resolve it in the shell. `StageSpec.background` is exactly that
pattern: the stage says `'expanse'`, `src/main.ts` imports
`./render/backgrounds` for its side effects, and the two halves meet in the one
module that is allowed to know both. If that shape does not fit what you are
doing, the design is wrong rather than the rule — which is what the repository
layout section means when it says so.

The scanner covers `sim`, `content` and `game` (`src/architecture.test.ts:45`).
`src/game/` was a convention there for a while and is now enforced with the other
two — it passes with no renderer import of any kind, type-only included.

---

## 16. Invariants you can break without noticing

None of these produce an error. Each produces a game that is subtly, silently
wrong, usually on someone else's machine.

**No delta-time in the simulation.** Every speed is px/tick, every rate is
per-tick. `tick()` is not handed a delta and must never derive one. A pattern
that reaches for `performance.now()` or scales by a frame time runs at a
different speed on a 144Hz display, and its replays stop reproducing. The only
legal use of real time is `alpha`, in `render()`, in the view layer.

**Seeded RNG only, in call order.** `Math.random()` must not appear anywhere in
`src/sim/` or `src/content/`. Draw from `context.rng` (patterns) or the passed
generator (behaviours), never the module-level `sim` import — a pattern that
closes over `sim` cannot be tested in isolation and couples to global state.
Adding, removing or reordering a draw changes every subsequent value at the same
seed. Remember that `rrandom` / `trandom` / `wrandom` on a spec consume draws at
spawn time, in that fixed order.

**Cosmetics come from `fx`, never `sim`.** Particles, screen shake, debris
scatter. Upstream drew effect scatter from its one global generator, so adding a
single particle shifted every subsequent bullet and desynced every replay. The
defence here is structural — `EffectSystem` exposes no parameter through which a
caller could hand it the sim stream — but a new system you write has no such
protection unless you build it in. If a value can be seen but not collided with,
it belongs on `fx`.

**Draw order is explicit.** Sprites keep `depthTest: false` and composite by
`renderOrder`. Do not fix a layering problem by enabling depth on a sprite
material, and do not set `renderer.sortObjects = false` — that silently reduces
every `Layer` constant to decoration.

**Content references names, not indices.** Atlas cells, patterns, behaviours,
enemies, effects. An index survives a repack and points at the wrong art; a name
throws.

**Rotating art points +x.** Anything with `orientToHeading` is rotated to match
its heading and 0° is east. Art ported from upstream, which pointed up, needs a
90° rotation.

**`side: THREE.DoubleSide` on every custom material.** The y-down projection has
a negative Y scale and reverses winding. Front faces get culled and you get a
black screen with a clean console.

---

## 17. Before you call it done

```
bun run typecheck     # tsc --noEmit
bun test
bun run build
```

Green means you ran it and saw it. Additionally:

- **Touched the sim, motion DSL, RNG, input or content data?** Run the replay
  regression. A change that alters replay output is either a bug or a deliberate
  divergence — say which in the commit message.
- **Touched rendering?** `bun run dev` and confirm the field actually draws. All
  three rendering bugs found so far — reversed winding, an inert `renderOrder`,
  and a spatial-hash collision — passed the type checker and logged nothing.
- **Added bullet art?** Look at 500 of them on screen at once. Art that reads
  beautifully in isolation turns into soup at real density, and that is the only
  test that catches it.
