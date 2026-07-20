/**
 * Generate `src/packs/base-pack.json` — the built-in campaign as pack data.
 *
 * The game's own stage-1 and stage-2, their eight trash enemies and three
 * bosses used to live in `src/sim/enemy.ts`, `src/sim/boss.ts`,
 * `src/content/stage.ts` and `src/content/stage-2.ts` as engine TypeScript.
 * decisions-basepack.md moves them into a **bundled pack**: pack-format JSON
 * injected through the same validate+inject pipeline as any fetched pack. This
 * is the format eating the game's own content — the final proof the pack
 * surface is complete.
 *
 * This file is the authoring source. The design commentary that used to sit
 * beside the specs in those four modules survives here as comments (a pack's
 * JSON cannot carry them), and the file emits `src/packs/base-pack.json`
 * deterministically — stable key order, `JSON.stringify(..., null, 2)`. A drift
 * test (`tools/make-base-pack.test.ts`) regenerates and byte-diffs against
 * the checked-in file, so the JSON can never drift from this source
 * unnoticed — the make-example-pack idiom, one layer up: authoring-time code
 * may generate data; data never carries code.
 *
 * ## hpSeconds, not hp
 *
 * A pack spell card declares `hpSeconds` — the seconds a competent player needs
 * to drain the phase — and the injector computes `hp = phaseHp(hpSeconds)` and
 * defaults `timeLimit` to `phaseClock(hp)`. The engine's own bosses were sized
 * with exactly those functions (`phaseHp(6)`, `phaseClock(phaseHp(6))`…), so
 * writing the same seconds here and omitting `timeLimit` reproduces the former
 * numbers to the ULP — proved when the port landed, and held behaviourally ever
 * since by the replay traces in `src/base-content.golden.test.ts`.
 *
 * ## What a pack can never carry
 *
 * Patterns, motion behaviours, background shaders and sim rules stay engine
 * code, joined to this pack only by name. The base pack references the
 * built-in bullet-sheet sprites, the `expanse`/`undertow`/`surge` scenes, the
 * `nemesis`/`vigil`/`descent` tracks and the `sentinel`/`warden`/`magistrate`/
 * `player` portraits by name — it declares no assets of its own.
 *
 * Run with `bun tools/make-base-pack.ts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateManifest, type PackContent, type PackManifest } from '../src/packs/manifest';

/* ================================================================== */
/* Ammunition — the bullet specs enemies and bosses fire.             */
/*                                                                    */
/* Each is a BulletSpec inlined at a pattern slot's `options.spec`.    */
/* The sprite names are bullet-sheet cells; the behaviour names        */
/* (`waver`, `homing`, `orbit`, `accelerate-to`) are engine code the   */
/* pattern resolves by name — a pack never ships them.                 */
/* ================================================================== */

/** Stage-1's plain shot. */
const ENEMY_SHOT = {
  style: { sprite: 'orb.small', r: 1, g: 0.45, b: 0.75 },
  radius: 3,
  motion: { r: 2.4, theta: 90 },
};

/** Stage-1's heavier turret shot. */
const HEAVY_SHOT = {
  style: { sprite: 'scale', r: 0.55, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 1.8, theta: 90 },
};

const SHARD = {
  style: { sprite: 'scale', r: 0.6, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 2.2, theta: 90 },
};

const PETAL = {
  style: { sprite: 'petal', r: 1, g: 0.55, b: 0.8 },
  radius: 4,
  // Thrown out fast and braked to a crawl, so the ring hangs in the air long
  // enough to be read before the next one lands on top of it.
  motion: { r: 4, theta: 90, ra: -0.06, rrange: { min: 0.5 } },
};

const NEEDLE = {
  style: { sprite: 'needle', r: 1, g: 0.9, b: 0.5, orientToHeading: true, additive: true },
  // Half the painted thickness, with the length carried by `blade` — the shape
  // the sprite has always drawn.
  radius: 2,
  motion: { r: 3.4, theta: 90 },
  blade: { length: 26 },
};

/**
 * Stage-2's plain shot. It wavers by twelve degrees on a roughly one-second
 * cycle — not enough to dodge around, exactly enough to stop a fan from reading
 * as a set of straight lanes. `duration` is a whole number of periods, so the
 * deviation telescopes back to zero and the bullet leaves on its fired heading.
 */
const SPARK = {
  style: { sprite: 'orb.small', r: 1, g: 0.72, b: 0.42 },
  radius: 3,
  motion: {
    r: 2.3,
    theta: 90,
    behaviour: 'waver',
    options: { amplitude: 12, period: 64, duration: 640 },
  },
};

/**
 * The seeker. Eighteen ticks of committed flight, then a little over a second of
 * tracking at 2.2°/tick, then a straight bullet again. The delay is the design:
 * a shot that flies straight first has already chosen a lane by the time it
 * corrects, so the dodge is *when* you move, not whether.
 */
const SEEKER = {
  style: { sprite: 'kunai', r: 0.55, g: 1, b: 0.82, orientToHeading: true },
  // A capsule, because the art is a blade: `kunai` paints 26x6, so the lethal
  // shape is a 26px segment of half-thickness 3.
  radius: 3,
  blade: { length: 26 },
  motion: {
    r: 2,
    theta: 90,
    behaviour: 'homing',
    options: { turnRate: 2.2, delay: 18, duration: 64 },
  },
};

/**
 * The beam. `r: 0`, so the muzzle stays put and the bullet is purely its own
 * length. Growth and warmup are matched so the beam finishes drawing itself out
 * almost exactly the tick it becomes lethal; `life: 64` leaves 36 lethal ticks.
 */
const LANCE = {
  style: {
    sprite: 'needle', r: 1, g: 0.45, b: 0.6,
    width: 7, height: 7, additive: true, orientToHeading: true,
  },
  radius: 4,
  motion: { r: 0, theta: 90 },
  laser: { length: 40, growth: 22, maxLength: 600, warmup: 28 },
  life: 64,
};

/** The boss's beam: slower to draw, longer lived, so a ring of them is a room. */
const COLUMN = {
  style: {
    sprite: 'needle', r: 0.7, g: 0.6, b: 1,
    width: 9, height: 9, additive: true, orientToHeading: true,
  },
  radius: 5,
  motion: { r: 0, theta: 90 },
  laser: { length: 24, growth: 14, maxLength: 620, warmup: 44 },
  life: 108,
};

/**
 * The gathered ember. Fired outward, pulled onto a fixed 66px ring about the
 * field's upper centre and walked around it for two and a half seconds. The
 * centre is a literal because behaviour options are numbers — a fixed mill in
 * the middle of the field is a landmark both the censer and the midboss feed.
 */
const EMBER_CENTRE_X = 240;
const EMBER_CENTRE_Y = 190;

const EMBER = {
  style: { sprite: 'petal', r: 1, g: 0.85, b: 0.5 },
  radius: 3,
  motion: {
    r: 1.6,
    theta: 90,
    behaviour: 'orbit',
    options: {
      centerX: EMBER_CENTRE_X,
      centerY: EMBER_CENTRE_Y,
      radius: 66,
      angularSpeed: 4,
      duration: 150,
    },
  },
};

/**
 * The hang-then-snap shell. Crawls for 40 ticks, then eases to 4.2px/tick over
 * 24. A ring hangs as a readable shape for two thirds of a second and then all
 * of it leaves at once — the dodge is authored during the hang.
 */
const SHELL = {
  style: { sprite: 'scale', r: 0.7, g: 0.82, b: 1, orientToHeading: true },
  radius: 4,
  motion: {
    r: 0.4,
    theta: 90,
    behaviour: 'accelerate-to',
    options: { speed: 4.2, delay: 40, duration: 24 },
  },
};

/* ================================================================== */
/* Enemies                                                            */
/* ================================================================== */

const enemies: PackContent['enemies'] = {
  /* ---- stage-1 cast ---- */

  grunt: {
    sprite: 'orb.large',
    hp: 12,
    radius: 11,
    tint: { r: 1, g: 0.8, b: 0.85 },
    motion: { r: 1.6, theta: 90 },
    // Silent for its first half-second, so a wave that spawns on top of the
    // player is readable before it starts shooting.
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: ENEMY_SHOT, count: 3, spread: 24, period: 50 },
        startAt: 30,
        // The opening's chaff, and so the stage's difficulty axis before any
        // boss: Easy thins the fan and slows it, Lunatic widens and quickens it.
        difficulty: {
          easy: { count: 2, period: 62 },
          hard: { count: 4, spread: 30, period: 42 },
          lunatic: { count: 5, spread: 36, period: 36 },
        },
      },
    ],
    spoils: [['power', 1]],
    scoreValue: 100,
    onHit: 'hit',
    onDeath: 'explosion',
  },

  weaver: {
    sprite: 'ring',
    hp: 24,
    radius: 14,
    tint: { r: 0.7, g: 1, b: 0.85 },
    // Dives in, sweeps across while firing, then leaves under its own power.
    timeline: [
      { count: 0, motion: { r: 3, theta: 90 } },
      { count: 40, motion: { r: 2, theta: 0, w: 3 } },
      { count: 90, motion: { r: 3.5, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'spiral',
        options: { spec: ENEMY_SHOT, arms: 2, step: 17, period: 5 },
        startAt: 40,
        stopAt: 90,
        difficulty: {
          easy: { arms: 1, period: 7 },
          hard: { arms: 3, period: 4 },
          lunatic: { arms: 4, period: 4 },
        },
      },
    ],
    spoils: [['power', 2]],
    scoreValue: 300,
    onHit: 'hit',
    onDeath: 'explosion',
  },

  turret: {
    sprite: 'halo',
    hp: 60,
    radius: 18,
    width: 40,
    height: 40,
    tint: { r: 0.85, g: 0.9, b: 1 },
    motion: { r: 0.4, theta: 90 },
    patterns: [
      {
        pattern: 'ring',
        options: { spec: HEAVY_SHOT, count: 12, period: 70, rotation: 9 },
        startAt: 20,
        // The wall, and stage-1's densest single pattern — the wave the tier axis
        // must visibly move. Easy opens the ring's gaps, Lunatic closes them.
        difficulty: {
          easy: { count: 8 },
          hard: { count: 16, period: 60 },
          lunatic: { count: 20, period: 54 },
        },
      },
      {
        pattern: 'spray',
        options: { spec: ENEMY_SHOT, count: 2, period: 24, spread: 50 },
        startAt: 120,
        difficulty: {
          easy: { count: 1, period: 32 },
          hard: { count: 3, period: 20 },
          lunatic: { count: 4, period: 18 },
        },
      },
    ],
    // It crawls in from well above the field and is meant to survive the trip.
    despawnMargin: 96,
    spoils: [['power', 3]],
    scoreValue: 1000,
    onHit: 'hit',
    // The heaviest thing in the cast, so it gets the heaviest death.
    onDeath: 'death.big',
  },

  /* ---- stage-2 cast ---- */

  /**
   * The chaff. Falls straight, fires a narrow wavering three-fan after half a
   * second of silence — the same grace period `grunt` takes.
   */
  drifter: {
    sprite: 'orb.medium',
    hp: 14,
    radius: 10,
    tint: { r: 1, g: 0.86, b: 0.62 },
    motion: { r: 1.7, theta: 90 },
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: SPARK, count: 3, spread: 26, period: 52 },
        startAt: 30,
        // Stage-2's chaff carries its trash-phase density the way grunt does
        // stage-1's: Easy thins the fan, Lunatic widens and quickens it.
        difficulty: {
          easy: { count: 2, period: 64 },
          hard: { count: 4, spread: 32, period: 44 },
          lunatic: { count: 5, spread: 38, period: 38 },
        },
      },
    ],
    spoils: [['power', 1]],
    scoreValue: 100,
    onHit: 'hit',
    onDeath: 'explosion',
  },

  /**
   * The beam platform. Dives in, plants itself for about three seconds, fires two
   * aimed beams, then leaves upward. It plants because a beam whose muzzle is
   * moving is unreadable. `stopAt: 190` is the last tick it may start a beam, and
   * 190 + LANCE.life is comfortably before the 200-tick departure.
   */
  lash: {
    sprite: 'ring',
    hp: 30,
    radius: 12,
    tint: { r: 1, g: 0.58, b: 0.7 },
    timeline: [
      { count: 0, motion: { r: 3.2, theta: 90 } },
      { count: 34, motion: { r: 0 } },
      { count: 200, motion: { r: 3.4, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: LANCE, count: 2, spread: 26, period: 96 },
        startAt: 40,
        stopAt: 190,
        // Beams are lethal lines, so the tier moves their count in ones, not the
        // fistfuls a plain-shot fan can take.
        difficulty: {
          easy: { count: 1 },
          hard: { count: 3, spread: 32 },
          lunatic: { count: 3, spread: 38, period: 84 },
        },
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2]],
    scoreValue: 400,
    onHit: 'hit',
    onDeath: 'explosion',
  },

  /**
   * The skirmisher. Dives, arcs across on a turning heading, leaves upward — and
   * throws seekers the whole time it is arcing. A moving source is what makes the
   * seeker's delay legible.
   */
  hunter: {
    sprite: 'star',
    hp: 22,
    radius: 11,
    tint: { r: 0.62, g: 1, b: 0.86 },
    timeline: [
      { count: 0, motion: { r: 3.4, theta: 90 } },
      { count: 30, motion: { r: 1.2, theta: 0, w: 2.4 } },
      { count: 156, motion: { r: 3.4, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: SEEKER, count: 2, spread: 34, period: 44 },
        startAt: 34,
        stopAt: 156,
        difficulty: {
          easy: { count: 1 },
          hard: { count: 3, spread: 40 },
          lunatic: { count: 4, spread: 46, period: 38 },
        },
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2]],
    scoreValue: 400,
    onHit: 'hit',
    onDeath: 'explosion',
  },

  /**
   * The mill. Crawls down throwing rings of embers pulled onto the fixed ring at
   * (240, 190) and released outward together. Its own position barely matters —
   * the danger is the landmark — so it is slow, tanky and easy to ignore, which
   * is the trap.
   */
  censer: {
    sprite: 'halo',
    hp: 45,
    radius: 16,
    width: 36,
    height: 36,
    tint: { r: 1, g: 0.8, b: 0.55 },
    motion: { r: 0.5, theta: 90 },
    patterns: [
      {
        pattern: 'ring',
        options: { spec: EMBER, count: 10, period: 84, rotation: 13 },
        startAt: 24,
        // Easy leaves the gathered ring threadable, Lunatic packs it.
        difficulty: {
          easy: { count: 7 },
          hard: { count: 14, period: 74 },
          lunatic: { count: 18, period: 68 },
        },
      },
    ],
    despawnMargin: 96,
    spoils: [['power', 3]],
    scoreValue: 1000,
    onHit: 'hit',
    onDeath: 'explosion',
  },

  /**
   * The wall. Barely moves, must be killed, and pays for it — stage-2's `turret`,
   * with the hang-then-snap ring in place of a plain one, plus a scatter that
   * starts late so the two never arrive as a single undifferentiated mess.
   */
  bastion: {
    sprite: 'shard',
    hp: 70,
    radius: 18,
    width: 44,
    height: 44,
    tint: { r: 0.78, g: 0.86, b: 1 },
    motion: { r: 0.32, theta: 90 },
    patterns: [
      {
        pattern: 'ring',
        options: { spec: SHELL, count: 14, period: 84, rotation: 12 },
        startAt: 30,
        // Stage-2's densest trash pattern. Easy opens the hanging ring, Lunatic
        // closes it.
        difficulty: {
          easy: { count: 10 },
          hard: { count: 18, period: 74 },
          lunatic: { count: 22, period: 68 },
        },
      },
      {
        pattern: 'spray',
        options: { spec: SPARK, count: 2, period: 34, spread: 64 },
        startAt: 150,
        difficulty: {
          easy: { count: 1, period: 44 },
          hard: { count: 3, period: 26 },
          lunatic: { count: 4, period: 22 },
        },
      },
    ],
    despawnMargin: 110,
    spoils: [['power', 3]],
    scoreValue: 1500,
    onHit: 'hit',
    onDeath: 'death.big',
  },
};

/* ================================================================== */
/* Bosses                                                             */
/*                                                                    */
/* Phase health is `hpSeconds` — the seconds a competent player needs  */
/* to drain it — and the injector turns it into hp via `phaseHp` and   */
/* defaults `timeLimit` to `phaseClock(hp)`, twice the reference drain. */
/* The engine's REFERENCE_DPS is measured by src/balance.test.ts, so    */
/* these seconds re-derive to concrete numbers that move when the       */
/* player's damage does. Write seconds; let the arithmetic size it.     */
/* ================================================================== */

const bosses: PackContent['bosses'] = {
  /**
   * The stage-1 boss. Three phases are the three jobs a fight does: a non-spell
   * wave (aimed pressure, teaches the player to move), a spell card (a static
   * shape read rather than dodged), and a final spell (the two stacked, on a
   * clock tight enough that outliving it is not the answer) — plus a fourth card
   * only Lunatic fights. Every signature card varies by tier: `options` is the
   * Normal truth, each `difficulty` block a sparse shallow merge over it. The
   * counts stay inside the readability budget — a Lunatic curtain is denser but
   * keeps negative space, which is why Lunatic tightens rather than saturates.
   */
  sentinel: {
    sprite: 'halo',
    radius: 20,
    width: 56,
    height: 56,
    tint: { r: 0.8, g: 0.9, b: 1 },
    // Drops in from above the field to the usual upper-third station.
    entry: { x: 240, y: 140, ticks: 90 },
    music: 'nemesis',
    onDeath: 'death.big',
    // Speakers are portrait names: the boss's own, and 'player' for the ship.
    dialogue: [
      { speaker: 'sentinel', text: 'Far enough.' },
      { speaker: 'player', text: 'The gate is behind you.' },
      { speaker: 'sentinel', text: 'The gate is me.' },
    ],
    phases: [
      {
        name: 'Approach',
        // Six seconds: an opener, not a wall.
        hpSeconds: 6,
        isSpell: false,
        // A slow horizontal drift, reversed by the timeline so it paces rather
        // than leaves. Aimed fire from a moving source is the whole lesson.
        timeline: [
          { count: 0, motion: { r: 0.9, theta: 0 } },
          { count: 90, motion: { r: 0.9, theta: 180 } },
          { count: 180, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'aimed-fan',
            options: { spec: SHARD, count: 5, spread: 34, period: 48 },
            difficulty: {
              easy: { count: 3, period: 60 },
              hard: { count: 7, spread: 40, period: 40 },
              lunatic: { count: 9, spread: 46, period: 36 },
            },
          },
          {
            pattern: 'spray',
            options: { spec: SHARD, count: 2, period: 30, spread: 70 },
            startAt: 120,
            difficulty: {
              easy: { count: 1, period: 40 },
              hard: { count: 3, period: 24 },
              lunatic: { count: 4, period: 20 },
            },
          },
        ],
      },
      {
        name: 'Sign "Tidal Corolla"',
        hpSeconds: 10,
        isSpell: true,
        bonus: 200000,
        // 'surge' is the registered spell-card background.
        background: 'surge',
        // Stationary: the card is a shape to be read, and a moving source would
        // smear it into noise.
        motion: { r: 0 },
        patterns: [
          // Two counter-rotating rings. Their offsets drift apart at different
          // rates, so the safe gaps sweep instead of standing still.
          {
            pattern: 'ring',
            options: { spec: PETAL, count: 18, period: 42, rotation: 9 },
            difficulty: {
              easy: { count: 12 },
              hard: { count: 22, period: 36 },
              lunatic: { count: 26, period: 33 },
            },
          },
          {
            pattern: 'ring',
            options: { spec: PETAL, count: 18, period: 42, rotation: -14 },
            startAt: 21,
            difficulty: {
              easy: { count: 12 },
              hard: { count: 22, period: 36 },
              lunatic: { count: 26, period: 33 },
            },
          },
          // One aimed volley per cycle, so standing in a gap is not free.
          {
            pattern: 'aimed-fan',
            options: { spec: NEEDLE, count: 3, spread: 18, period: 96 },
            startAt: 60,
            difficulty: {
              easy: { count: 1 },
              hard: { count: 5, spread: 24 },
              lunatic: { count: 7, spread: 30, period: 84 },
            },
          },
        ],
      },
      {
        name: 'Last Sign "Vigil Unbroken"',
        hpSeconds: 12,
        isSpell: true,
        bonus: 500000,
        // Sways through the top of the field, so the spiral's origin moves and
        // its arms cannot be memorised as fixed lanes.
        timeline: [
          { count: 0, motion: { r: 1.4, theta: 0, w: 2.2 } },
          { count: 160, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'spiral',
            options: { spec: NEEDLE, arms: 4, step: 13, period: 4 },
            difficulty: {
              easy: { arms: 2, period: 6 },
              hard: { arms: 5, period: 3 },
              lunatic: { arms: 6, period: 3 },
            },
          },
          // Ring pressure arrives late, once the player has settled into reading
          // the spiral, and is what actually makes the timer matter.
          {
            pattern: 'ring',
            options: { spec: PETAL, count: 20, period: 90, rotation: 11 },
            startAt: 240,
            difficulty: {
              easy: { count: 14 },
              hard: { count: 26, period: 78 },
              lunatic: { count: 30, period: 72 },
            },
          },
          {
            pattern: 'aimed-fan',
            options: { spec: SHARD, count: 7, spread: 50, period: 75 },
            startAt: 420,
            difficulty: {
              easy: { count: 4 },
              hard: { count: 9, spread: 56 },
              lunatic: { count: 11, spread: 60, period: 66 },
            },
          },
        ],
      },
      {
        // Lunatic-only, the genre's extra card. `difficulties: ['lunatic']` gates
        // it off every other tier, so on Normal the fight ends after 'Vigil
        // Unbroken'. Sized ~13s so sentinel's full clock stays under the stage-2
        // boss's, and never fought at all on Normal.
        name: 'Lunatic "Total Eclipse"',
        hpSeconds: 13,
        isSpell: true,
        difficulties: ['lunatic'],
        bonus: 800000,
        background: 'surge',
        motion: { r: 0 },
        patterns: [
          { pattern: 'spiral', options: { spec: NEEDLE, arms: 6, step: 11, period: 3 } },
          { pattern: 'ring', options: { spec: PETAL, count: 24, period: 66, rotation: 15 }, startAt: 40 },
          { pattern: 'aimed-fan', options: { spec: SHARD, count: 7, spread: 44, period: 60 }, startAt: 90 },
        ],
      },
    ],
  },

  /**
   * The stage-2 midboss. Three phases, one per mechanic the back half of the
   * stage then uses against the player at once: aimed pressure from a pacing
   * source; beams fired in a rotating cross; the mill, fed by the boss. Short —
   * the shortest fight in the game, four/five/five seconds.
   */
  warden: {
    sprite: 'ring',
    radius: 18,
    width: 52,
    height: 52,
    tint: { r: 1, g: 0.6, b: 0.72 },
    entry: { x: 240, y: 120, ticks: 70 },
    music: 'nemesis',
    onDeath: 'death.big',
    dialogue: [
      { speaker: 'warden', text: 'This corridor is closed.' },
      { speaker: 'player', text: 'Open it.' },
      { speaker: 'warden', text: 'I open nothing. I only hold.' },
    ],
    phases: [
      {
        name: 'Patrol',
        hpSeconds: 4,
        isSpell: false,
        // Paces left, then right, then loops. Aimed fire from a source that is
        // already moving is the entire content of the phase.
        timeline: [
          { count: 0, motion: { r: 1.1, theta: 0 } },
          { count: 80, motion: { r: 1.1, theta: 180 } },
          { count: 160, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'aimed-fan',
            options: { spec: SPARK, count: 5, spread: 32, period: 46 },
            difficulty: {
              easy: { count: 3, period: 58 },
              hard: { count: 7, spread: 38, period: 40 },
              lunatic: { count: 9, spread: 44, period: 34 },
            },
          },
          {
            pattern: 'spray',
            options: { spec: SPARK, count: 2, period: 32, spread: 72 },
            startAt: 70,
            difficulty: {
              easy: { count: 1, period: 42 },
              hard: { count: 3, period: 26 },
              lunatic: { count: 4, period: 22 },
            },
          },
        ],
      },
      {
        name: 'Beam Sign "Picket Line"',
        hpSeconds: 5,
        isSpell: true,
        bonus: 120000,
        background: 'surge',
        // Stationary. A beam's telegraph is a promise about where the line will
        // be, and a moving muzzle breaks it.
        motion: { r: 0 },
        patterns: [
          // Four beams at 90°, rotating 21° a volley, so the safe wedges walk.
          {
            pattern: 'ring',
            options: { spec: COLUMN, count: 4, period: 120, rotation: 21 },
            difficulty: {
              easy: { count: 3 },
              hard: { count: 5 },
              lunatic: { count: 6, rotation: 26 },
            },
          },
          // Seekers between beams: standing in a wedge must not be free.
          {
            pattern: 'aimed-fan',
            options: { spec: SEEKER, count: 3, spread: 28, period: 84 },
            startAt: 60,
            difficulty: {
              easy: { count: 1 },
              hard: { count: 5, spread: 34 },
              lunatic: { count: 7, spread: 40, period: 72 },
            },
          },
        ],
      },
      {
        name: 'Gather Sign "Censer Mill"',
        hpSeconds: 5,
        isSpell: true,
        bonus: 200000,
        background: 'surge',
        // Drifts slowly so the mill's centre stays put while its feeder does not.
        timeline: [
          { count: 0, motion: { r: 0.8, theta: 0, w: 2.6 } },
          { count: 170, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'ring',
            options: { spec: EMBER, count: 12, period: 66, rotation: 17 },
            difficulty: {
              easy: { count: 8 },
              hard: { count: 16, period: 58 },
              lunatic: { count: 20, period: 52 },
            },
          },
          // The shells arrive late and hang while the ring is still gathering.
          {
            pattern: 'ring',
            options: { spec: SHELL, count: 10, period: 96, rotation: -14 },
            startAt: 120,
            difficulty: {
              easy: { count: 7 },
              hard: { count: 13, period: 84 },
              lunatic: { count: 16, period: 78 },
            },
          },
        ],
      },
    ],
  },

  /**
   * The stage-2 boss and the last fight in the game. Four phases: the same three
   * ideas the stage taught, then all at once. About fifty seconds, escalating
   * 7/12/14/17. Phase 3's clock is the tightest relative to its health — the last
   * card should be survivable, but not by standing still and waiting it out.
   */
  magistrate: {
    sprite: 'halo',
    radius: 21,
    width: 60,
    height: 60,
    tint: { r: 0.72, g: 0.68, b: 1 },
    entry: { x: 240, y: 150, ticks: 90 },
    music: 'nemesis',
    onDeath: 'death.big',
    dialogue: [
      { speaker: 'magistrate', text: 'You have come a long way to be sentenced.' },
      { speaker: 'player', text: 'Read the charge, then.' },
      { speaker: 'magistrate', text: 'Trespass. Persistence. The verdict is the same.' },
      { speaker: 'player', text: 'Then I appeal.' },
    ],
    phases: [
      {
        name: 'Arraignment',
        hpSeconds: 7,
        isSpell: false,
        timeline: [
          { count: 0, motion: { r: 1.3, theta: 0 } },
          { count: 70, motion: { r: 1.3, theta: 180 } },
          { count: 140, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'aimed-fan',
            options: { spec: SPARK, count: 5, spread: 36, period: 44 },
            difficulty: {
              easy: { count: 3, period: 56 },
              hard: { count: 7, spread: 42, period: 38 },
              lunatic: { count: 9, spread: 48, period: 32 },
            },
          },
          {
            pattern: 'spiral',
            options: { spec: SPARK, arms: 3, step: 14, period: 6 },
            startAt: 90,
            difficulty: {
              easy: { arms: 2, period: 8 },
              hard: { arms: 4, period: 5 },
              lunatic: { arms: 5, period: 4 },
            },
          },
          // The stage's only other scatter. A non-spell phase is where randomness
          // belongs: the cards below are shapes to be read.
          {
            pattern: 'spray',
            options: { spec: SPARK, count: 2, period: 30, spread: 70 },
            startAt: 40,
            difficulty: {
              easy: { count: 1, period: 40 },
              hard: { count: 3, period: 24 },
              lunatic: { count: 4, period: 20 },
            },
          },
        ],
      },
      {
        name: 'Seeker Sign "Writ of Pursuit"',
        hpSeconds: 12,
        isSpell: true,
        bonus: 150000,
        background: 'surge',
        motion: { r: 0 },
        patterns: [
          // A ring of seekers: every bullet flies straight for 18 ticks and then
          // all of them turn inward together.
          {
            pattern: 'ring',
            options: { spec: SEEKER, count: 14, period: 78, rotation: 13 },
            difficulty: {
              easy: { count: 9 },
              hard: { count: 18, period: 68 },
              lunatic: { count: 22, period: 62 },
            },
          },
          // Wavering chaff so the gaps between seeker volleys are not empty.
          {
            pattern: 'aimed-fan',
            options: { spec: SPARK, count: 3, spread: 22, period: 54 },
            startAt: 40,
            difficulty: {
              easy: { count: 1 },
              hard: { count: 5, spread: 28 },
              lunatic: { count: 7, spread: 32, period: 46 },
            },
          },
        ],
      },
      {
        name: 'Beam Sign "Colonnade"',
        hpSeconds: 14,
        isSpell: true,
        bonus: 250000,
        background: 'surge',
        // Stationary, for the same reason 'Picket Line' is.
        motion: { r: 0 },
        patterns: [
          // Six columns, 17° a volley. COLUMN.life is 108 and the period is 132,
          // so exactly one set is live at a time and the room reconfigures.
          {
            pattern: 'ring',
            options: { spec: COLUMN, count: 6, period: 132, rotation: 17 },
            difficulty: {
              easy: { count: 4 },
              hard: { count: 7 },
              lunatic: { count: 8, rotation: 21 },
            },
          },
          // Shells during the gap between colonnades: the hang covers the beams'
          // dead time.
          {
            pattern: 'ring',
            options: { spec: SHELL, count: 12, period: 132, rotation: 9 },
            startAt: 66,
            difficulty: {
              easy: { count: 8 },
              hard: { count: 16, period: 120 },
              lunatic: { count: 20, period: 112 },
            },
          },
        ],
      },
      {
        name: 'Last Word "Assize"',
        hpSeconds: 17,
        isSpell: true,
        bonus: 600000,
        background: 'surge',
        // Sways through the top of the field so the spiral's origin moves — but
        // slowly, because beams are also in the air.
        timeline: [
          { count: 0, motion: { r: 0.9, theta: 0, w: 2.4 } },
          { count: 150, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'spiral',
            options: { spec: SPARK, arms: 4, step: 12, period: 5 },
            difficulty: {
              easy: { arms: 2, period: 7 },
              hard: { arms: 5, period: 4 },
              lunatic: { arms: 6, period: 4 },
            },
          },
          {
            pattern: 'ring',
            options: { spec: EMBER, count: 10, period: 90, rotation: 19 },
            startAt: 30,
            difficulty: {
              easy: { count: 7 },
              hard: { count: 14, period: 80 },
              lunatic: { count: 18, period: 74 },
            },
          },
          // Four columns rather than six: the field already has a spiral and a
          // mill in it, and the beams are the thing that must stay readable.
          {
            pattern: 'ring',
            options: { spec: COLUMN, count: 4, period: 150, rotation: 26 },
            startAt: 120,
            difficulty: {
              easy: { count: 3 },
              hard: { count: 5 },
              lunatic: { count: 6 },
            },
          },
          {
            pattern: 'aimed-fan',
            options: { spec: SEEKER, count: 3, spread: 30, period: 96 },
            startAt: 240,
            difficulty: {
              easy: { count: 1 },
              hard: { count: 5, spread: 36 },
              lunatic: { count: 7, spread: 42, period: 84 },
            },
          },
        ],
      },
    ],
  },
};

/* ================================================================== */
/* Stages                                                             */
/*                                                                    */
/* A stage is a score, not a script: it says when things enter, never  */
/* how they behave. Every `y` is negative because enemies enter from    */
/* above and fly in — a wave is authored where it *starts*, offscreen.  */
/* Wave order below is the source order; `defineStage` sorts by `at`    */
/* (stably), so two waves sharing an `at` keep the order written here.  */
/* ================================================================== */

const LEFT = 90;
const CENTRE = 240;
const RIGHT = 390;

/** Above the field by more than the tallest sprite's half-height. */
const ENTRY_Y = -24;
const TURRET_ENTRY_Y = -60;
const HEAVY_ENTRY_Y = -60;

/** Where the stage-2 midboss enters — a boss wave, honoured mid-schedule. */
const MIDBOSS_AT = 1140;

const stages: PackContent['stages'] = {
  /**
   * Stage 1 — about thirty seconds of real play. Two facts about the cast shaped
   * the layout: `weaver` sweeps right (its middle segment is `theta: 0` w:3),
   * loops, then leaves upward around tick 90 — it has no mirrored twin, so weavers
   * are placed left of where they end up, never hard right; and `turret` descends
   * at 0.4px/tick behind a 96px margin, so it will not leave on its own inside the
   * stage — it is a wall the player kills or fights everything after it beside.
   */
  'stage-1': {
    entry: true,
    seed: 0x5747a1,
    outro: 180,
    background: 'expanse',
    music: 'vigil',
    boss: 'sentinel',
    next: 'stage-2',
    waves: [
      /* Opening: two columns, offset, so the player is taught to move sideways
         rather than to sit still and shoot. */
      { at: 0, enemy: 'grunt', x: LEFT + 30, y: ENTRY_Y, count: 5, interval: 20 },
      { at: 30, enemy: 'grunt', x: RIGHT - 30, y: ENTRY_Y, count: 5, interval: 20 },

      /* An echelon: `interval: 0` puts all five on one tick, and `stepY` staggers
         them in space instead of in time, so they arrive as a diagonal wall. */
      { at: 200, enemy: 'grunt', x: 150, y: ENTRY_Y, count: 5, interval: 0, stepX: 45, stepY: -18 },

      /* Weavers. They loop back through the space they just crossed, which is the
         first time aiming has to lead a target. */
      { at: 360, enemy: 'weaver', x: 140, y: -30 },
      { at: 380, enemy: 'weaver', x: 300, y: -30 },
      { at: 440, enemy: 'grunt', x: CENTRE, y: ENTRY_Y, count: 4, interval: 24 },
      { at: 560, enemy: 'weaver', x: 100, y: -30, count: 3, interval: 30, stepX: 70 },

      /* First turret. Its ring fire is slow and readable alone; the flanking
         columns are what make it a problem. */
      { at: 760, enemy: 'turret', x: CENTRE, y: TURRET_ENTRY_Y },
      { at: 820, enemy: 'grunt', x: 60, y: ENTRY_Y, count: 4, interval: 40 },
      { at: 840, enemy: 'grunt', x: 420, y: ENTRY_Y, count: 4, interval: 40 },
      { at: 1000, enemy: 'weaver', x: 180, y: -30 },

      /* The squeeze: a six-wide wall, then weavers from both edges, then a
         drifting centre stream that walks across the field as it falls. */
      { at: 1160, enemy: 'grunt', x: 90, y: ENTRY_Y, count: 6, interval: 0, stepX: 60, stepY: -20 },
      { at: 1240, enemy: 'weaver', x: 120, y: -30, count: 2, interval: 40, stepX: 200 },
      { at: 1320, enemy: 'grunt', x: 300, y: ENTRY_Y, count: 8, interval: 14, stepX: -18 },

      /* Climax: two turrets on the same tick. Their rings interfere, and the gaps
         between them are the only safe ground. */
      { at: 1500, enemy: 'turret', x: 140, y: TURRET_ENTRY_Y },
      { at: 1500, enemy: 'turret', x: 340, y: TURRET_ENTRY_Y },
      { at: 1560, enemy: 'weaver', x: CENTRE, y: -30, count: 2, interval: 50 },
      { at: 1620, enemy: 'grunt', x: 60, y: ENTRY_Y, count: 6, interval: 18, stepX: 72 },
    ],
  },

  /**
   * Stage 2 — roughly a minute of play, in five movements. Two facts about the
   * cast shaped the placement: `hunter` arcs right (middle segment `theta: 0`
   * w:2.4) and has no mirrored twin, so hunters are authored left of where they
   * end up and never hard right; and `bastion` descends at 0.32px/tick behind a
   * 110px margin, so like `turret` in stage 1 it is a wall.
   *
   * The midboss (`warden`) is a boss WAVE at 1140: it holds the schedule until it
   * is defeated, so every `at` after it is a script tick, not a wall tick —
   * moving the fight retimes nothing after it.
   */
  'stage-2': {
    entry: false,
    seed: 0x2b0f91,
    outro: 90,
    background: 'undertow',
    music: 'descent',
    boss: 'magistrate',
    next: null,
    waves: [
      /* Opening. Two offset columns, then a diagonal — the grammar stage 1 opens
         on, so the only new thing is the waver on the shot. */
      { at: 0, enemy: 'drifter', x: LEFT + 40, y: ENTRY_Y, count: 5, interval: 22 },
      { at: 40, enemy: 'drifter', x: RIGHT - 40, y: ENTRY_Y, count: 5, interval: 22 },
      { at: 190, enemy: 'drifter', x: 140, y: ENTRY_Y, count: 5, interval: 0, stepX: 50, stepY: -18 },

      /* First beam, deliberately alone — a telegraph the player has never seen
         must be taught against an empty field. */
      { at: 300, enemy: 'lash', x: CENTRE, y: ENTRY_Y },

      /* The same beam with chaff underneath. The first tick where the player has
         to choose which threat to answer. */
      { at: 480, enemy: 'lash', x: 170, y: ENTRY_Y },
      { at: 500, enemy: 'drifter', x: 360, y: ENTRY_Y, count: 4, interval: 26 },
      { at: 620, enemy: 'lash', x: 330, y: ENTRY_Y },

      /* First seeker. Also alone: delay-then-turn is only legible with nothing
         else in the air. */
      { at: 700, enemy: 'hunter', x: 120, y: -30 },
      { at: 790, enemy: 'drifter', x: CENTRE, y: ENTRY_Y, count: 4, interval: 24 },

      /* Two arcs crossing a falling column. The hunters sweep right through the
         space the drifters are dropping into, so the safe ground moves. */
      { at: 860, enemy: 'hunter', x: 100, y: -30, count: 2, interval: 46, stepX: 90 },
      { at: 900, enemy: 'drifter', x: 300, y: ENTRY_Y, count: 6, interval: 16, stepX: -14 },

      /* First mill. The censer is slow and ignorable and that is the trap —
         killing it early is one gathered ring instead of two. */
      { at: 1000, enemy: 'censer', x: CENTRE, y: HEAVY_ENTRY_Y },
      { at: 1060, enemy: 'drifter', x: 70, y: ENTRY_Y, count: 3, interval: 30 },

      /* ---- MIDBOSS ---- a boss wave holds the schedule until it is defeated, so
         everything below is timed from the fight ending, not from the wall. */
      { at: MIDBOSS_AT, boss: 'warden', x: 240, y: -60 },

      /* Two mills feeding one landmark — the midboss's third card handed back
         without a health bar. */
      { at: 1200, enemy: 'censer', x: 160, y: HEAVY_ENTRY_Y },
      { at: 1200, enemy: 'censer', x: 320, y: HEAVY_ENTRY_Y },
      { at: 1250, enemy: 'hunter', x: 110, y: -30 },

      /* The wall. Its ring hangs for two thirds of a second and then all fourteen
         shells leave at once. */
      { at: 1320, enemy: 'bastion', x: CENTRE, y: HEAVY_ENTRY_Y },
      { at: 1380, enemy: 'drifter', x: 60, y: ENTRY_Y, count: 4, interval: 34 },

      /* Beams from both flanks while the wall is still up. */
      { at: 1420, enemy: 'lash', x: 120, y: ENTRY_Y },
      { at: 1420, enemy: 'lash', x: 360, y: ENTRY_Y },
      { at: 1500, enemy: 'hunter', x: 150, y: -30 },

      /* The squeeze: a mill, two arcs and a drifting column that walks across the
         field as it falls — everything the stage taught, at once, with no boss. */
      { at: 1600, enemy: 'censer', x: 200, y: HEAVY_ENTRY_Y },
      { at: 1640, enemy: 'hunter', x: 90, y: -30, count: 2, interval: 44, stepX: 120 },
      { at: 1690, enemy: 'drifter', x: 380, y: ENTRY_Y, count: 8, interval: 14, stepX: -22 },

      /* Climax. Two walls on one tick, their rings interfering, and a beam
         platform between them — the gaps are the only safe ground, on a clock. */
      { at: 1720, enemy: 'bastion', x: 150, y: HEAVY_ENTRY_Y },
      { at: 1720, enemy: 'bastion', x: 330, y: HEAVY_ENTRY_Y },
      { at: 1780, enemy: 'lash', x: CENTRE, y: ENTRY_Y },
      { at: 1800, enemy: 'drifter', x: 60, y: ENTRY_Y, count: 6, interval: 8, stepX: 72 },
    ],
  },
};

/* ================================================================== */
/* Manifest assembly                                                  */
/* ================================================================== */

const CONTENT: PackContent = { enemies, bosses, stages };

/**
 * The bundled base pack. `name: "base"` is what the bundled injector self-checks
 * against and keys its idempotency ledger on; it registers its content
 * UNQUALIFIED (bare `grunt`, `sentinel`, `stage-1`) because it is not a guest
 * layering over the base game — it IS the base game (decisions-basepack.md
 * §"Bundled semantics"). It declares no assets: every sprite, scene, track and
 * portrait it names is a built-in referenced by name.
 */
const MANIFEST: PackManifest = {
  format: 1,
  name: 'base',
  version: '1.0.0',
  author: 'Danmaku',
  license: 'CC0-1.0',
  description: 'The built-in campaign: stage-1 and stage-2, their cast and bosses.',
  requires: ['content.enemies', 'content.stages', 'content.bosses'],
  content: CONTENT,
};

/**
 * The canonical JSON text of the base pack — the single source both the
 * generator (which writes it to disk) and the drift test (which byte-compares
 * it against the checked-in file) read, so they cannot disagree. Validated
 * through the real `validateManifest` first: this generator cannot emit a pack
 * its own validator would reject.
 */
export function buildBasePackJson(): string {
  const result = validateManifest(MANIFEST, MANIFEST.name);
  if ('errors' in result) {
    throw new Error(`make-base-pack: manifest is invalid:\n  ${result.errors.join('\n  ')}`);
  }
  return JSON.stringify(MANIFEST, null, 2) + '\n';
}

/** The checked-in path the generator writes and the drift test reads. */
export const BASE_PACK_PATH = fileURLToPath(new URL('../src/packs/base-pack.json', import.meta.url));

if (import.meta.main) {
  const text = buildBasePackJson();
  mkdirSync(fileURLToPath(new URL('../src/packs/', import.meta.url)), { recursive: true });
  writeFileSync(BASE_PACK_PATH, text);
  // eslint-disable-next-line no-console
  console.log(`wrote ${BASE_PACK_PATH} (${text.length} bytes)`);
}
