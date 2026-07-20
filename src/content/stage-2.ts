/**
 * Stage 2 — a full stage authored entirely from the registries.
 *
 * Nothing in this file edits an engine module. The cast is registered with
 * `defineEnemy`, the two fights with `defineBoss`, the script with
 * `defineStage`, and every bullet reaches for the motion behaviours in
 * `./behaviours` by name. That is the claim the file exists to prove: new
 * content is a new file.
 *
 * ## Why the side-effect imports
 *
 * `./behaviours` registers `homing`, `waver`, `orbit` and `accelerate-to`.
 * Nothing else in the app imports it, and `MoveVector.init` throws on an
 * unknown behaviour name — so a bullet spec here naming `homing` would
 * detonate on the tick it first spawned if this import were dropped. It is
 * load-bearing, not tidiness. `./patterns` arrives transitively through
 * `sim/enemy`, but is named explicitly because this file resolves pattern
 * names and should not depend on someone else's import graph to do it.
 *
 * ## Tuning was measured, not guessed
 *
 * Boss health here is sized against the damage a full-power `scout` actually
 * lands on a boss: **0.56 per tick**, measured by driving `Run` with a probe
 * that tracks its target's x and holds Shot (~34 damage a second). A phase of
 * 100 hp is therefore about three seconds of sustained fire.
 *
 * That number is worth stating because `sentinel` in `sim/boss.ts` is tuned
 * far above it — 4100 hp across its three phases needs 7300 ticks at this
 * rate, so **every one of its phases times out rather than draining**, and the
 * fight runs its full 125 seconds regardless of how well it is played. The
 * numbers below are deliberately not copied from it. See the report in
 * `stage-2.test.ts`, which pins the budget so a retune cannot silently blow
 * past it.
 *
 * ## The stage clock pauses for the midboss
 *
 * `WaveEntry` can name an enemy and nothing else, so a midboss cannot be put
 * in the schedule (see `STAGE_2_MIDBOSS` below). The script's `at` values
 * after tick 1140 are therefore *script* ticks, not wall ticks: a conductor
 * stops stepping the `StageRunner` while the midboss is up and resumes after.
 * That is the same contract the runner already has — it counts its own ticks
 * and nobody else's.
 */

import { defineBoss } from '../sim/boss';
import type { BulletSpec } from '../sim/bullet';
import { defineEnemy } from '../sim/enemy';
import './behaviours';
import './patterns';
import { defineStage } from './stage';

/* ------------------------------------------------------------------ */
/* Ammunition                                                          */
/* ------------------------------------------------------------------ */

/**
 * The stage's plain shot. It wavers by twelve degrees on a roughly one-second
 * cycle, which is not enough to dodge around and is exactly enough to stop a
 * fan from reading as a set of straight lanes the player can stand between.
 *
 * `duration` is a whole number of periods, so the accumulated deviation
 * telescopes back to zero and the bullet leaves on the heading it was fired
 * on — see the `waver` note in `./behaviours`.
 */
const SPARK: BulletSpec = {
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
 * The seeker. Eighteen ticks of committed flight, then a little over a second
 * of tracking at 2.2°/tick, then it is a straight bullet again.
 *
 * The delay is the whole design. A shot that steers from the muzzle can be
 * walked away from forever; one that flies straight first has already chosen a
 * lane by the time it starts correcting, so the dodge is *when* you move, not
 * whether. 2.2°/tick over 64 ticks is 140° of authority — enough to catch a
 * player who stands still, not enough to catch one who commits early.
 */
const SEEKER: BulletSpec = {
  style: { sprite: 'kunai', r: 0.55, g: 1, b: 0.82, orientToHeading: true },
  radius: 3,
  motion: {
    r: 2,
    theta: 90,
    behaviour: 'homing',
    options: { turnRate: 2.2, delay: 18, duration: 64 },
  },
};

/**
 * The beam. `r: 0`, so the muzzle stays where it was fired and the bullet is
 * purely its own length — the whole point of the laser hitbox.
 *
 * Growth and warmup are matched on purpose: 40px plus 28 ticks at 22px/tick is
 * 656, past the 600 cap, so the beam finishes drawing itself out at almost
 * exactly the tick it becomes lethal. The player watches a line reach across
 * the field and then it is live. `life: 64` leaves 36 lethal ticks after the
 * telegraph — long enough to have to move through, short enough that standing
 * still is never the answer.
 */
const LANCE: BulletSpec = {
  style: { sprite: 'needle', r: 1, g: 0.45, b: 0.6, width: 7, additive: true, orientToHeading: true },
  radius: 4,
  motion: { r: 0, theta: 90 },
  laser: { length: 40, growth: 22, maxLength: 600, warmup: 28 },
  life: 64,
};

/** The boss's beam: slower to draw, longer lived, so a ring of them is a room. */
const COLUMN: BulletSpec = {
  style: { sprite: 'needle', r: 0.7, g: 0.6, b: 1, width: 9, additive: true, orientToHeading: true },
  radius: 5,
  motion: { r: 0, theta: 90 },
  laser: { length: 24, growth: 14, maxLength: 620, warmup: 44 },
  life: 108,
};

/**
 * The gathered ember. Fired outward from wherever the emitter is, then pulled
 * onto a fixed 66px ring about the field's upper centre and walked around it
 * at 4°/tick for two and a half seconds — after which the behaviour simply
 * stops and leaves the last chord in place, which is the tangent.
 *
 * The centre is a literal because behaviour options are numbers, so it cannot
 * follow a moving emitter. That is a constraint worth leaning into rather than
 * around: a fixed mill in the middle of the field is a landmark, and both the
 * censer and the midboss feed the same one.
 */
const EMBER_CENTRE_X = 240;
const EMBER_CENTRE_Y = 190;

const EMBER: BulletSpec = {
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
 * The hang-then-snap shell. Crawls for 40 ticks at 0.4px/tick, then eases to
 * 4.2px/tick over 24.
 *
 * A ring of these hangs in the air as a readable shape for two thirds of a
 * second and then all of it leaves at once. The dodge is authored during the
 * hang, which is the opposite of a fan — and it is why this is the wall
 * enemy's ammunition rather than the skirmisher's.
 */
const SHELL: BulletSpec = {
  style: { sprite: 'scale', r: 0.7, g: 0.82, b: 1, orientToHeading: true },
  radius: 4,
  motion: {
    r: 0.4,
    theta: 90,
    behaviour: 'accelerate-to',
    options: { speed: 4.2, delay: 40, duration: 24 },
  },
};

/* ------------------------------------------------------------------ */
/* Cast                                                                */
/* ------------------------------------------------------------------ */

/**
 * The chaff. Falls straight, fires a narrow wavering three-fan after half a
 * second of silence — the same grace period `grunt` takes, for the same
 * reason: a wave that spawns on top of the player must be readable before it
 * is dangerous.
 */
defineEnemy('drifter', {
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
    },
  ],
  drops: { power: 1, score: 100 },
  scoreValue: 100,
  onHit: 'hit',
  onDeath: 'explosion',
});

/**
 * The beam platform. Dives in, plants itself for about three seconds, fires
 * two aimed beams, then leaves upward under its own power.
 *
 * It plants because a beam whose muzzle is moving is unreadable: the telegraph
 * only means anything if the line it draws is the line that will be live.
 * `stopAt: 190` is the last tick it may start a beam, and 190 + `LANCE.life`
 * is comfortably before the 200-tick departure, so it never leaves a live beam
 * behind a sprite that is no longer there.
 */
defineEnemy('lash', {
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
    },
  ],
  // It stands still well inside the field and then climbs back out the top,
  // so it needs to survive being above the field on the way out.
  despawnMargin: 80,
  drops: { power: 2, score: 400 },
  scoreValue: 400,
  onHit: 'hit',
  onDeath: 'explosion',
});

/**
 * The skirmisher. Dives, arcs across on a turning heading, leaves upward —
 * and throws seekers the whole time it is arcing.
 *
 * A moving source is what makes the seeker's delay legible: the bullets fan
 * out along the arc before any of them start correcting, so the player sees
 * the spread commit and then close. Standing under it is the mistake.
 */
defineEnemy('hunter', {
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
    },
  ],
  despawnMargin: 80,
  drops: { power: 2, score: 400 },
  scoreValue: 400,
  onHit: 'hit',
  onDeath: 'explosion',
});

/**
 * The mill. Crawls down the screen throwing rings of embers that are pulled
 * onto the fixed ring at (240, 190) and released outward together.
 *
 * Its own position barely matters — the danger is the landmark, not the
 * enemy — so it is slow, tanky and easy to ignore, which is the trap. Ignored,
 * it stacks a second gathered ring on top of the first.
 */
defineEnemy('censer', {
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
    },
  ],
  despawnMargin: 96,
  drops: { power: 3, score: 1000 },
  scoreValue: 1000,
  onHit: 'hit',
  onDeath: 'explosion',
});

/**
 * The wall. Barely moves, must be killed, and pays for it — the same role
 * `turret` plays in stage 1, with the hang-then-snap ring in place of a plain
 * one, plus a scatter that starts late so the two never arrive as a single
 * undifferentiated mess.
 */
defineEnemy('bastion', {
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
    },
    {
      pattern: 'spray',
      options: { spec: SPARK, count: 2, period: 34, spread: 64 },
      startAt: 150,
    },
  ],
  despawnMargin: 110,
  drops: { power: 3, score: 1500 },
  scoreValue: 1500,
  onHit: 'hit',
  onDeath: 'death.big',
});

/* ------------------------------------------------------------------ */
/* Midboss                                                             */
/* ------------------------------------------------------------------ */

/**
 * The warden. Three phases, one per mechanic the back half of the stage will
 * then use against the player at the same time:
 *
 *   0. aimed pressure from a pacing source — the warm-up, and the only phase
 *      that is not a card;
 *   1. beams, fired in a rotating cross rather than aimed, so the lesson is
 *      "read the telegraph and pick a wedge" rather than "sidestep";
 *   2. the mill, fed by the boss instead of by a censer, so the player meets
 *      the gather-and-release with a health bar on screen before meeting two
 *      censers at once at script tick 1200.
 *
 * Health is sized at roughly 0.56 damage/tick (see the file header): 60 + 70 +
 * 75 is about 370 ticks of sustained fire, and the measured fight — entry
 * included — is 433. Time limits sit near twice each phase's health, so a
 * player who cannot drain a card still gets through it in a bounded time
 * rather than stalling — a timeout is a clear, per `sim/boss.ts`.
 */
defineBoss('warden', {
  sprite: 'ring',
  radius: 18,
  width: 52,
  height: 52,
  tint: { r: 1, g: 0.6, b: 0.72 },
  entry: { x: 240, y: 120, ticks: 70 },
  onDeath: 'death.big',
  phases: [
    {
      name: 'Patrol',
      hp: 60,
      timeLimit: 260,
      isSpell: false,
      // Paces left, then right, then loops. Aimed fire from a source that is
      // already moving is the entire content of the phase.
      timeline: [
        { count: 0, motion: { r: 1.1, theta: 0 } },
        { count: 80, motion: { r: 1.1, theta: 180 } },
        { count: 160, jump: 0 },
      ],
      patterns: [
        { pattern: 'aimed-fan', options: { spec: SPARK, count: 5, spread: 32, period: 46 } },
        { pattern: 'spray', options: { spec: SPARK, count: 2, period: 32, spread: 72 }, startAt: 70 },
      ],
    },
    {
      name: 'Beam Sign "Picket Line"',
      hp: 70,
      timeLimit: 300,
      isSpell: true,
      bonus: 120000,
      background: 'surge',
      // Stationary. A beam's telegraph is a promise about where the line will
      // be, and a moving muzzle breaks it.
      motion: { r: 0 },
      patterns: [
        // Four beams at 90°, rotating 21° a volley, so the safe wedges walk
        // around the boss instead of standing still.
        { pattern: 'ring', options: { spec: COLUMN, count: 4, period: 120, rotation: 21 } },
        // Seekers between beams: standing in a wedge must not be free.
        { pattern: 'aimed-fan', options: { spec: SEEKER, count: 3, spread: 28, period: 84 }, startAt: 60 },
      ],
    },
    {
      name: 'Gather Sign "Censer Mill"',
      hp: 75,
      timeLimit: 300,
      isSpell: true,
      bonus: 200000,
      background: 'surge',
      // Drifts slowly so the mill's centre stays put while its feeder does not.
      timeline: [
        { count: 0, motion: { r: 0.8, theta: 0, w: 2.6 } },
        { count: 170, jump: 0 },
      ],
      patterns: [
        { pattern: 'ring', options: { spec: EMBER, count: 12, period: 66, rotation: 17 } },
        // The shells arrive late and hang while the ring is still gathering,
        // so the release and the snap land close together.
        { pattern: 'ring', options: { spec: SHELL, count: 10, period: 96, rotation: -14 }, startAt: 120 },
      ],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Boss                                                                */
/* ------------------------------------------------------------------ */

/**
 * The magistrate. Four phases: the same three ideas the stage has been
 * teaching, then all of them at once.
 *
 *   0. arraignment — aimed and spiral pressure, no card, establishes the
 *      station and the rhythm;
 *   1. seekers as the subject rather than the garnish: rings of them, so the
 *      delay window matters in every direction at once;
 *   2. beams as architecture — six columns and a slow rotation, read as a room
 *      with doors rather than as shots;
 *   3. beams, seekers, the mill and the shells together, on the tightest
 *      clock in the stage.
 *
 * 70 + 95 + 110 + 125 is about 715 ticks of sustained fire at the measured
 * rate; the fight measures 803 with the 90-tick entry. Phase 3's time limit is
 * the tightest relative to its health, deliberately: the last card should be
 * survivable, but not by standing still and waiting it out.
 */
defineBoss('magistrate', {
  sprite: 'halo',
  radius: 21,
  width: 60,
  height: 60,
  tint: { r: 0.72, g: 0.68, b: 1 },
  entry: { x: 240, y: 150, ticks: 90 },
  onDeath: 'death.big',
  phases: [
    {
      name: 'Arraignment',
      hp: 70,
      timeLimit: 260,
      isSpell: false,
      timeline: [
        { count: 0, motion: { r: 1.3, theta: 0 } },
        { count: 70, motion: { r: 1.3, theta: 180 } },
        { count: 140, jump: 0 },
      ],
      patterns: [
        { pattern: 'aimed-fan', options: { spec: SPARK, count: 5, spread: 36, period: 44 } },
        { pattern: 'spiral', options: { spec: SPARK, arms: 3, step: 14, period: 6 }, startAt: 90 },
        // The stage's only other scatter. A non-spell phase is where
        // randomness belongs: the cards below are shapes to be read, and a
        // card that differed run to run could not be learned.
        { pattern: 'spray', options: { spec: SPARK, count: 2, period: 30, spread: 70 }, startAt: 40 },
      ],
    },
    {
      name: 'Seeker Sign "Writ of Pursuit"',
      hp: 95,
      timeLimit: 360,
      isSpell: true,
      bonus: 150000,
      background: 'surge',
      motion: { r: 0 },
      patterns: [
        // A ring of seekers: every bullet flies straight for 18 ticks and then
        // all of them turn inward together. The dodge is a commitment made
        // before the turn, not a reaction to it.
        { pattern: 'ring', options: { spec: SEEKER, count: 14, period: 78, rotation: 13 } },
        // Wavering chaff so the gaps between seeker volleys are not empty.
        { pattern: 'aimed-fan', options: { spec: SPARK, count: 3, spread: 22, period: 54 }, startAt: 40 },
      ],
    },
    {
      name: 'Beam Sign "Colonnade"',
      hp: 110,
      timeLimit: 360,
      isSpell: true,
      bonus: 250000,
      background: 'surge',
      // Stationary, for the same reason 'Picket Line' is.
      motion: { r: 0 },
      patterns: [
        // Six columns, 17° a volley. `COLUMN.life` is 108 and the period is
        // 132, so exactly one set is live at a time and the room genuinely
        // reconfigures rather than filling in.
        { pattern: 'ring', options: { spec: COLUMN, count: 6, period: 132, rotation: 17 } },
        // Shells during the gap between colonnades: the hang covers the beams'
        // dead time, so there is no tick worth standing still on.
        { pattern: 'ring', options: { spec: SHELL, count: 12, period: 132, rotation: 9 }, startAt: 66 },
      ],
    },
    {
      name: 'Last Word "Assize"',
      hp: 125,
      timeLimit: 420,
      isSpell: true,
      bonus: 600000,
      background: 'surge',
      // Sways through the top of the field so the spiral's origin moves and
      // its arms cannot be memorised as fixed lanes — but slowly, because
      // beams are also in the air.
      timeline: [
        { count: 0, motion: { r: 0.9, theta: 0, w: 2.4 } },
        { count: 150, jump: 0 },
      ],
      patterns: [
        { pattern: 'spiral', options: { spec: SPARK, arms: 4, step: 12, period: 5 } },
        { pattern: 'ring', options: { spec: EMBER, count: 10, period: 90, rotation: 19 }, startAt: 30 },
        // Four columns rather than six: the field already has a spiral and a
        // mill in it, and the beams are the thing that must stay readable.
        { pattern: 'ring', options: { spec: COLUMN, count: 4, period: 150, rotation: 26 }, startAt: 120 },
        { pattern: 'aimed-fan', options: { spec: SEEKER, count: 3, spread: 30, period: 96 }, startAt: 240 },
      ],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Script                                                              */
/* ------------------------------------------------------------------ */

/**
 * Where the midboss belongs, and the reason it is an export rather than a wave.
 *
 * `WaveEntry` names an `enemy` and nothing else, and `RunConfig` carries a
 * single `boss` that `Run.#sendBoss` releases only once the whole script is
 * spent and the field is clear. Between them there is no way to say "at this
 * point in the script, fight this boss" — so the cue is data this module
 * exports and a conductor honours: stop stepping the `StageRunner` at
 * `at`, spawn the boss, resume when it is defeated.
 *
 * The script's own clock therefore pauses, which is why every `at` after 1140
 * is a script tick rather than a wall tick. That is not a workaround being
 * papered over; it is the reading the runner already supports, since it counts
 * its own ticks and consults nothing else. But the schema gap is real and
 * belongs in `StageSpec`.
 */
/** Where the midboss enters. Referenced by the boss wave in the schedule. */
export const STAGE_2_MIDBOSS = { boss: 'warden', at: 1140, x: 240, y: -60 } as const;

/** The boss this stage ends on — `RunConfig.boss` for a run of `stage-2`. */
export const STAGE_2_BOSS = 'magistrate';

const LEFT = 90;
const CENTRE = 240;
const RIGHT = 390;

/** Above the field by more than the tallest sprite's half-height. */
const ENTRY_Y = -24;
const HEAVY_ENTRY_Y = -60;

/**
 * Stage 2 — roughly a minute of play, in five movements.
 *
 * ```
 *    0   drifters            read a wavering fan, move sideways      teach
 *  300   first lash          one beam, alone, nothing else on screen teach
 *  480   lash under fire     the telegraph with chaff on top         apply
 *  700   first hunter        seekers commit, then close              teach
 *  860   hunters + drifters  two arcs crossing a falling column      apply
 * 1000   first censer        the mill gathers and lets go            teach
 * 1140   MIDBOSS (warden)    the three lessons, with a health bar    check
 * 1200   two censers         two mills stacked on one landmark
 * 1320   bastion             the wall — hang, then everything snaps
 * 1420   lashes flanking     beams across a field you cannot leave
 * 1600   the squeeze         censer + hunters + drifters together
 * 1720   climax              two bastions and a lash
 * 1840   last spawn
 * 1931   finished            (90-tick outro)
 * ```
 *
 * Two facts about the cast shaped the placement, both worth knowing before
 * moving anything:
 *
 * - `hunter` arcs **right** (its middle segment is `theta: 0` with `w: 2.4`)
 *   and has no mirrored twin, so hunters are authored left of where they
 *   should end up and never hard right.
 * - `bastion` descends at 0.32px/tick behind a 110px despawn margin, so it
 *   will not leave on its own inside this stage. Like `turret` in stage 1 it
 *   is a wall: the player kills it or fights the next movement with it still
 *   firing.
 */
defineStage('stage-2', {
  name: 'stage-2',
  seed: 0x2b0f91,
  outro: 90,
  background: 'undertow',
  boss: STAGE_2_BOSS,
  waves: [
    /* Opening. Two offset columns, then a diagonal — the same grammar stage 1
       opens on, so a player arriving here already knows how to read it, and
       the only new thing is the waver on the shot. */
    { at: 0, enemy: 'drifter', x: LEFT + 40, y: ENTRY_Y, count: 5, interval: 22 },
    { at: 40, enemy: 'drifter', x: RIGHT - 40, y: ENTRY_Y, count: 5, interval: 22 },
    {
      at: 190,
      enemy: 'drifter',
      x: 140,
      y: ENTRY_Y,
      count: 5,
      interval: 0,
      stepX: 50,
      stepY: -18,
    },

    /* First beam, deliberately alone. Nothing else is on screen for its whole
       three-second stand, because a telegraph the player has never seen must be
       taught against an empty field or it is just a death. */
    { at: 300, enemy: 'lash', x: CENTRE, y: ENTRY_Y },

    /* The same beam with chaff underneath it. This is the first tick where the
       player has to choose which threat to answer. */
    { at: 480, enemy: 'lash', x: 170, y: ENTRY_Y },
    { at: 500, enemy: 'drifter', x: 360, y: ENTRY_Y, count: 4, interval: 26 },
    { at: 620, enemy: 'lash', x: 330, y: ENTRY_Y },

    /* First seeker. Also alone: the delay-then-turn is only legible if there is
       nothing else in the air to confuse it with. */
    { at: 700, enemy: 'hunter', x: 120, y: -30 },
    { at: 790, enemy: 'drifter', x: CENTRE, y: ENTRY_Y, count: 4, interval: 24 },

    /* Two arcs crossing a falling column. The hunters sweep right through the
       space the drifters are dropping into, so the safe ground moves. */
    { at: 860, enemy: 'hunter', x: 100, y: -30, count: 2, interval: 46, stepX: 90 },
    { at: 900, enemy: 'drifter', x: 300, y: ENTRY_Y, count: 6, interval: 16, stepX: -14 },

    /* First mill. The censer is slow and ignorable and that is the trap —
       killing it early is the difference between one gathered ring and two. */
    { at: 1000, enemy: 'censer', x: CENTRE, y: HEAVY_ENTRY_Y },
    { at: 1060, enemy: 'drifter', x: 70, y: ENTRY_Y, count: 3, interval: 30 },

    /* ---- MIDBOSS ----
     * A boss wave holds the schedule until it is defeated, so everything
     * authored below is timed from the fight ending rather than from the
     * wall. Moving this line moves the fight without retiming the rest. */
    { at: STAGE_2_MIDBOSS.at, boss: STAGE_2_MIDBOSS.boss,
      x: STAGE_2_MIDBOSS.x, y: STAGE_2_MIDBOSS.y },


    /* Two mills feeding one landmark. This is the midboss's third card handed
       back to the player without a health bar to hide behind, and it is the
       reason that card exists. */
    { at: 1200, enemy: 'censer', x: 160, y: HEAVY_ENTRY_Y },
    { at: 1200, enemy: 'censer', x: 320, y: HEAVY_ENTRY_Y },
    { at: 1250, enemy: 'hunter', x: 110, y: -30 },

    /* The wall. Its ring hangs for two thirds of a second and then all fourteen
       shells leave at once, so the player must be moving before the snap, not
       after it. */
    { at: 1320, enemy: 'bastion', x: CENTRE, y: HEAVY_ENTRY_Y },
    { at: 1380, enemy: 'drifter', x: 60, y: ENTRY_Y, count: 4, interval: 34 },

    /* Beams from both flanks while the wall is still up. The bastion denies the
       centre, the lashes deny two aimed lines through it. */
    { at: 1420, enemy: 'lash', x: 120, y: ENTRY_Y },
    { at: 1420, enemy: 'lash', x: 360, y: ENTRY_Y },
    { at: 1500, enemy: 'hunter', x: 150, y: -30 },

    /* The squeeze: a mill, two arcs and a drifting column that walks across the
       field as it falls. Everything the stage has taught, at once, with no boss
       to structure it. */
    { at: 1600, enemy: 'censer', x: 200, y: HEAVY_ENTRY_Y },
    { at: 1640, enemy: 'hunter', x: 90, y: -30, count: 2, interval: 44, stepX: 120 },
    {
      at: 1690,
      enemy: 'drifter',
      x: 380,
      y: ENTRY_Y,
      count: 8,
      interval: 14,
      stepX: -22,
    },

    /* Climax. Two walls on one tick, their rings interfering, and a beam
       platform between them — the gaps are the only safe ground and they close
       on a clock. */
    { at: 1720, enemy: 'bastion', x: 150, y: HEAVY_ENTRY_Y },
    { at: 1720, enemy: 'bastion', x: 330, y: HEAVY_ENTRY_Y },
    { at: 1780, enemy: 'lash', x: CENTRE, y: ENTRY_Y },
    { at: 1800, enemy: 'drifter', x: 60, y: ENTRY_Y, count: 6, interval: 8, stepX: 72 },
  ],
});
