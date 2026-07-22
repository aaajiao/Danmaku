/**
 * Generate `src/v4/content/campaign.json` — the v4 campaign as pack data.
 *
 * The game's four stages, sixteen enemy types, five bosses and complete player
 * side are authored here as a **bundled campaign**: pack-format JSON injected
 * through the same validate+inject pipeline as any fetched pack. This is the
 * format eating the game's own content — the final proof the data surface is
 * complete while executable edition design stays compiled under `src/v4`.
 *
 * This file is the authoring source. The design commentary that used to sit
 * beside the specs in those four modules survives here as comments (a pack's
 * JSON cannot carry them), and the file emits `src/v4/content/campaign.json`
 * deterministically — stable key order, `JSON.stringify(..., null, 2)`. A drift
 * test (`tools/make-v4-content.test.ts`) regenerates and byte-diffs against
 * the checked-in file, so the JSON can never drift from this source
 * unnoticed. The authoring rule is one-way: code may generate data; data never
 * carries code.
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
 * per-boss tracks (`nemesis`/`interdict`/`docket`/`sanction`/`interregnum`) and
 * the stage/card tracks (`vigil`/`descent`/`precedent`/`ordinance`/`zenith`/
 * `fiat`) and the `sentinel`/`warden`/`magistrate`/`player` portraits by name —
 * it declares no assets of its own.
 *
 * Run with `bun tools/make-v4-content.ts`.
 */

import { createHash } from 'node:crypto';
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
  style: { sprite: 'orb.small.chaff', r: 1, g: 0.45, b: 0.75 },
  radius: 3,
  motion: { r: 2.4, theta: 90 },
};

/** Stage-1's heavier turret shot. */
const HEAVY_SHOT = {
  style: { sprite: 'scale.heavy', r: 0.55, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 1.8, theta: 90 },
};

const SHARD = {
  style: { sprite: 'scale.shard', r: 0.6, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 2.2, theta: 90 },
};

const PETAL = {
  style: { sprite: 'petal.corolla', r: 1, g: 0.55, b: 0.8 },
  radius: 4,
  // Thrown out fast and braked to a crawl, so the ring hangs in the air long
  // enough to be read before the next one lands on top of it.
  motion: { r: 4, theta: 90, ra: -0.06, rrange: { min: 0.5 } },
};

const NEEDLE = {
  style: { sprite: 'needle.vigil', r: 1, g: 0.9, b: 0.5, orientToHeading: true, additive: true },
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
  style: { sprite: 'orb.small.spark', r: 1, g: 0.72, b: 0.42 },
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
  style: { sprite: 'kunai.seeker', r: 0.55, g: 1, b: 0.82, orientToHeading: true },
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
 *
 * `sprite` names a laser SKIN (`beam.v3`, `render/laser-skin.ts`), not a bullet
 * cell: a beam is drawn as a tiled/stretched body strip plus a tip cap, resolved
 * in the shell by name exactly as a stage names its scene. The name is the whole
 * reskin — the render layer resolves it to a body/cap on the laser atlas, and a
 * BulletPack laser strip replaces the pixels without the sim ever changing. The
 * `r/g/b` tint still colours the procedural floor until baked pixels load; the
 * beam is rose (`lash`'s colour) on the floor and its own art once reskinned.
 */
const LANCE = {
  style: {
    sprite: 'beam.v3', r: 1, g: 0.45, b: 0.6,
    width: 7, height: 7, additive: true, orientToHeading: true,
  },
  radius: 4,
  motion: { r: 0, theta: 90 },
  laser: { length: 40, growth: 22, maxLength: 600, warmup: 28 },
  life: 64,
};

/**
 * The boss's beam: slower to draw, longer lived, so a ring of them is a room.
 * One sim spec, three skins — the same beam wears a different laser skin per boss
 * so all three whole-beam BulletPack strips find a reachable firer (`beam.heavy`
 * warden, `beam.blue`/`beam.cyan` magistrate; the consumption map in the laser
 * round design §d). The variants override only `style` (sprite + floor tint),
 * which is presentation and never enters the golden trace, so the three fire the
 * byte-identical beam and differ only in what they are painted with.
 */
const COLUMN = {
  style: {
    sprite: 'needle.column', r: 0.7, g: 0.6, b: 1,
    width: 9, height: 9, additive: true, orientToHeading: true,
  },
  radius: 5,
  motion: { r: 0, theta: 90 },
  laser: { length: 24, growth: 14, maxLength: 620, warmup: 44 },
  life: 108,
};
/** warden's picket beam — the heavy green whole-beam strip (`beam.heavy`). */
const COLUMN_HEAVY = {
  ...COLUMN,
  style: { ...COLUMN.style, sprite: 'beam.heavy', r: 0.55, g: 1, b: 0.72 },
};
/** magistrate's colonnade beam — the blue whole-beam strip (`beam.blue`). */
const COLUMN_BLUE = {
  ...COLUMN,
  style: { ...COLUMN.style, sprite: 'beam.blue', r: 0.55, g: 0.72, b: 1 },
};
/** magistrate's assize beam — the cyan whole-beam strip (`beam.cyan`), shared with `spire`'s `GUN_BEAM`. */
const COLUMN_CYAN = {
  ...COLUMN,
  style: { ...COLUMN.style, sprite: 'beam.cyan', r: 0.55, g: 1, b: 1 },
};

/**
 * The swept beam — the ONE thing the laser round's new DSL verb makes sayable,
 * fired by the `ray` trash enemy (below) and so reached early and robustly in a
 * real playthrough rather than only inside a deep boss card (laser round design
 * §b.5, graft #3). It is aimed at the player through `aimed-fan`, holds that
 * heading through the whole telegraph, and only then rakes an arc: `beam-sweep`
 * adds `rate` deg/tick inside `[hold, hold+duration)`, the swing capped by `arc`.
 *
 * Two couplings the behaviour depends on, both stated here in the data:
 *  - `motion.w = 0` — `w` integrates from tick 0, so any `w` would sweep the beam
 *    DURING its own telegraph. The swing must come only from `beam-sweep`.
 *  - `options.hold === laser.warmup` — the sweep begins the instant the telegraph
 *    becomes lethal. `behaviours.test.ts` pins this over every base-pack sweep.
 * `cooldown` gives the beam an honest decay tail: it stops killing before it
 * visually retracts, so a fading beam never scores a kill.
 */
const RAY_BEAM = {
  style: {
    sprite: 'beam.slim', r: 0.5, g: 1, b: 0.66,
    width: 7, height: 7, additive: true, orientToHeading: true,
  },
  radius: 4,
  motion: {
    r: 0, theta: 90, w: 0,
    behaviour: 'beam-sweep',
    options: { hold: 30, rate: 1.6, duration: 120, arc: 60 },
  },
  laser: { length: 30, growth: 30, maxLength: 560, warmup: 30, cooldown: 18 },
  life: 190,
};

/**
 * chancellor's rake — the swept-beam showcase (laser round design §b.4). One
 * heavy warm beam, aimed at the player then raked across a 90° wedge about its
 * fixed muzzle. Same `beam-sweep` couplings as `RAY_BEAM`: `w = 0`, and
 * `hold` (34) `== warmup` (34), so the sweep opens the instant the telegraph
 * turns lethal. `cooldown: 22` is a long honest decay tail — the rake stops
 * killing well before it finishes retracting, so a fading beam never scores.
 */
const RAKE = {
  style: {
    sprite: 'beam.warm', r: 1, g: 0.78, b: 0.42,
    width: 11, height: 11, additive: true, orientToHeading: true,
  },
  radius: 6,
  motion: {
    r: 0, theta: 90, w: 0,
    behaviour: 'beam-sweep',
    options: { hold: 34, rate: 1.4, duration: 150, arc: 90 },
  },
  laser: { length: 30, growth: 40, maxLength: 640, warmup: 34, cooldown: 22 },
  life: 260,
};

/**
 * chancellor's stream wall — the wide vertical curtain (`beam.v3.stream`). Short
 * repeating beams fired as a rotating ring, a wall of streams that blinks on and
 * off behind the rake. No sweep; plain planted beams with a short decay tail.
 */
const STREAM_WALL = {
  style: {
    sprite: 'beam.v3.stream', r: 0.7, g: 0.62, b: 1,
    width: 9, height: 9, additive: true, orientToHeading: true,
  },
  radius: 5,
  motion: { r: 0, theta: 90 },
  laser: { length: 26, growth: 60, maxLength: 520, warmup: 30, cooldown: 16 },
  life: 96,
};

/**
 * chancellor's curtain stream — a light aimed spread of streams beneath the rake
 * (`beam.stream`), so the swept lane is one threat to read among a soft curtain
 * rather than the whole field.
 */
const STREAM = {
  style: {
    sprite: 'beam.stream', r: 0.6, g: 1, b: 0.68,
    width: 7, height: 7, additive: true, orientToHeading: true,
  },
  radius: 4,
  motion: { r: 0, theta: 90 },
  laser: { length: 22, growth: 50, maxLength: 460, warmup: 26, cooldown: 14 },
  life: 84,
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
  style: { sprite: 'petal.ember', r: 1, g: 0.85, b: 0.5 },
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
  style: { sprite: 'scale.shell', r: 0.7, g: 0.82, b: 1, orientToHeading: true },
  radius: 4,
  motion: {
    r: 0.4,
    theta: 90,
    behaviour: 'accelerate-to',
    options: { speed: 4.2, delay: 40, duration: 24 },
  },
};

/* ---- stage-3 ammunition ---- */

/**
 * The writ. Stage-3's plain aimed shot — fast, small, wan gold. Every aimed-fan
 * and every scatter in the stage fires this one bullet, so the stage's whole
 * "keep moving, it aims at you" pressure is a single readable colour.
 */
const WRIT = {
  style: { sprite: 'orb.small.writ', r: 0.95, g: 0.82, b: 0.6 },
  radius: 5,
  motion: { r: 2.6, theta: 90 },
};

/**
 * The slab. Deliberately slow at 1.5px/tick: a rotating ring of these leaves each
 * volley hanging in the air long enough that the next interlocks with it, and the
 * accumulation reads as a *standing lattice* with one slowly-rotating lane. The
 * slowness is the mechanism — a fast ring would be gone before the next arrived
 * and there would be no lattice to thread.
 */
const SLAB = {
  style: { sprite: 'orb.medium.slab', r: 0.55, g: 0.78, b: 0.68 },
  radius: 7,
  motion: { r: 1.5, theta: 90 },
};

/**
 * The subpoena — the needle that comes to find you. A short committed flight, then
 * a little under a second of homing at 2°/tick, then straight again: like the
 * stage-2 seeker, the dodge is *when* you move, not whether, but here the job is
 * to curve into whatever resting lane a wall of slabs left open. It is what makes
 * the wall unsittable. (Named apart from the stage-1/2 `NEEDLE` bullet above; this
 * one homes and carries no blade.)
 */
const SUBPOENA = {
  style: { sprite: 'needle.subpoena', r: 0.95, g: 0.82, b: 0.5, orientToHeading: true, additive: true },
  radius: 5,
  motion: {
    r: 3,
    theta: 90,
    behaviour: 'homing',
    options: { turnRate: 2, delay: 6, duration: 40 },
  },
};

/** The levy. Every spiral in the stage is built from these — additive spark, mid speed. */
const LEVY = {
  style: { sprite: 'spark.levy', r: 0.85, g: 0.75, b: 0.7, additive: true },
  radius: 5,
  motion: { r: 2.3, theta: 90 },
};

/** The decree. The boss's ring bullet: a plain medium orb, a hair slower than a writ, so a dense ring reads as a wall rather than a blur. */
const DECREE = {
  style: { sprite: 'orb.medium.decree', r: 0.95, g: 0.82, b: 0.5 },
  radius: 6,
  motion: { r: 2.2, theta: 90 },
};

/**
 * The seal. Fired outward, then eased onto a fixed 70px circle and walked around
 * it for a second and a half — the seal being pressed — before the window ends
 * and every bullet releases tangentially at once. The safe pocket the whole
 * "Wax and Witness" card is built around sits right at that rim: hug it through
 * the stalled window and it racks graze.
 *
 * `centerX`/`centerY` name the boss's own station (240, 96): behaviour centres
 * are literal numbers, and the design table omitted them, which would default the
 * circle to (0,0) — the top-left corner, mostly off the field — and detach the
 * seal from the fight. It is pressed where the fight is, exactly as the stage-2
 * mill's EMBER names a fixed field landmark rather than its firing origin.
 */
const SEAL_CENTRE_X = 240;
const SEAL_CENTRE_Y = 96;

const SEAL = {
  style: { sprite: 'halo.seal', r: 0.95, g: 0.82, b: 0.5, additive: true },
  radius: 8,
  motion: {
    r: 2,
    theta: 90,
    behaviour: 'orbit',
    options: {
      centerX: SEAL_CENTRE_X,
      centerY: SEAL_CENTRE_Y,
      radius: 70,
      angularSpeed: 3,
      duration: 90,
    },
  },
};

/* ---- stage-4 ammunition ---- */

/*
 * Stage 4 is the recapitulation — every card and every trash type quotes a prior
 * stage, and the ammunition follows suit. The regent's generic curtains REUSE the
 * chancellor's bullets (`WRIT` aimed/spray, `DECREE` ring, `LEVY` spiral): "the
 * decree returning at the source, harder" is the fiction, and reusing the exact
 * gold bullets is that fiction made literal — no new colour is introduced where
 * an old one already carries the meaning. The specs below exist only where a
 * behaviour the earlier bullets do not have is needed: the counter-rotating
 * orbit, the regent's seeker, and the slow wall bars the new trash lay.
 */

/**
 * The picket — the usher's aimed needle. Fast, thin, wan gold: a herder's shot
 * meant to close one lane at a time so a BANK of ushers sweeps the player off a
 * line, stage-1's sideways lesson restated in the gold. `blade` makes the lethal
 * shape the short capsule the needle art draws.
 */
const PICKET = {
  style: { sprite: 'needle.picket', r: 1, g: 0.86, b: 0.5, orientToHeading: true, additive: true },
  radius: 3,
  motion: { r: 3.2, theta: 90 },
  blade: { length: 22 },
};

/**
 * The bulwark — the marshal's ring-wall bar. Deliberately slow at 1.4px/tick so a
 * rotating ring hangs in the air and successive volleys interlock into a standing
 * wall with one slowly-turning lane — stage-2's wall lesson, the same mechanism
 * stage-3's `SLAB` used a hair faster. A fast bar would be gone before the next
 * arrived and there would be no wall to thread.
 */
const BULWARK = {
  style: { sprite: 'orb.medium.bulwark', r: 0.9, g: 0.78, b: 0.5 },
  radius: 6,
  motion: { r: 1.4, theta: 90 },
};

/**
 * The signet — the seal the notary presses. A halo, additive gold, fired in the
 * ring the notary stamps late in its plant. There is no death-trigger for enemy
 * bullets in the engine, so the "seal on death" of the fiction is authored as a
 * heavy ring laid on a late `startAt`: kill the notary first and you skip the
 * stamp, the reward for focusing it, exactly as stele/assessor's rings stop when
 * killed.
 */
const SIGNET = {
  style: { sprite: 'halo.signet', r: 0.95, g: 0.82, b: 0.5, additive: true },
  radius: 7,
  motion: { r: 2, theta: 90 },
};

/**
 * The crown — the regent's orbiting seal, and the whole of "Corolla Regnant".
 * `orbit` walks each fired ring onto a fixed circle about the regent's station;
 * two specs with OPPOSITE-sign `angularSpeed` and different radii give the two
 * counter-rotating rings the card is built on. The sentinel had ONE orbiting
 * seal (stage-1); here there are two, turning against each other — the lateral
 * dodge doubled. The centre is the regent's own station (behaviour centres are
 * literal numbers; omitting them defaults the circle to (0,0), off the field, as
 * the stage-3 SEAL comment records).
 */
const CROWN_CENTRE_X = 240;
const CROWN_CENTRE_Y = 96;

const CROWN_CW = {
  style: { sprite: 'halo.crown', r: 0.98, g: 0.85, b: 0.55, additive: true },
  radius: 7,
  motion: {
    r: 2,
    theta: 90,
    behaviour: 'orbit',
    options: {
      centerX: CROWN_CENTRE_X,
      centerY: CROWN_CENTRE_Y,
      radius: 58,
      angularSpeed: 4,
      duration: 150,
    },
  },
};

const CROWN_CCW = {
  style: { sprite: 'halo.diadem', r: 0.98, g: 0.72, b: 0.42, additive: true },
  radius: 7,
  motion: {
    r: 2,
    theta: 90,
    behaviour: 'orbit',
    options: {
      centerX: CROWN_CENTRE_X,
      centerY: CROWN_CENTRE_Y,
      radius: 94,
      angularSpeed: -4,
      duration: 150,
    },
  },
};

/**
 * The warrant — the regent's seeker, fired in a ring on "Attainder". Like the
 * stage-2 hunter and the stage-3 subpoena it commits to a lane before it
 * corrects, so the dodge is WHEN you move, not whether; laid over a static
 * aimed-fan colonnade that punishes standing still, it is the game's hardest
 * single read (magistrate's seekers and beam-walls at once).
 */
const WARRANT = {
  style: { sprite: 'needle.warrant', r: 0.98, g: 0.82, b: 0.5, orientToHeading: true, additive: true },
  radius: 4,
  blade: { length: 24 },
  motion: {
    r: 2.2,
    theta: 90,
    behaviour: 'homing',
    options: { turnRate: 2, delay: 12, duration: 60 },
  },
};

/**
 * The lattice bar — "Portcullis"'s wall. Slow like the bulwark but the regent's:
 * two rings of these at slightly different rotation form a lattice whose safe
 * lane slides, the stage-1 sideways read forced UNDER a stage-2 wall (warden's
 * picket, recapped as the graze card).
 */
const LATTICE = {
  style: { sprite: 'orb.medium.lattice', r: 0.95, g: 0.82, b: 0.5 },
  radius: 6,
  motion: { r: 1.6, theta: 90 },
};

/* ---- missiles (导弹轮): writs served ---- */

/*
 * A missile is the `Bullet` primitive with one new field — `missile:
 * { explosion }` — beside the `blade` capsule hitbox and (for homing ones) the
 * `homing` behaviour it already shipped: no new pattern, behaviour or entity
 * (design Decision 0). It differs from an ordinary bullet in exactly one way the
 * sim can see: it detonates a floored `missile.pop.*` airburst where it dies
 * (recorded AT removal, never a remove-flag — rule 8). The `sprite` names a strip
 * on the MISSILE atlas (`missile.0`…`missile.massive`, `render/procedural.ts`),
 * routed there by `b.missile !== undefined` in the shell — so the skin is just
 * the sprite name, no registry (design §c.1). `orientToHeading` points the body
 * along travel (rule 7 — the floor paints nose-EAST); `blade` is the lethal
 * capsule down that heading, sized to the visible body.
 *
 * Two kinds ship. A HOMING writ steers toward the player inside a bounded window
 * (`behaviour: 'homing'`, `core/trig`, zero RNG — the exact loop `SEEKER` fires):
 * `motion.w: 0` so homing owns `theta` cleanly, and `life > delay + duration` so
 * the seek window closes before the body self-destructs (the G3 honesty coupling,
 * `reachability.test.ts` — a missile that expired mid-seek would have dead
 * authored tracking). A DUMBFIRE writ (`SERVICE`, `DISTRAINT`) sets `missile` but
 * no `homing`, so it flies its polar heading and detonates on burn-out — "served
 * in person". Every spec is warm gold: a writ is a gilt legal document, and the
 * tint colours the procedural floor until the BulletPack pixels load (rule 9).
 * Enemy-fired throughout this round, so `REFERENCE_DPS`/`balance.test.ts` do not
 * move and no character gains a missile (design §e.6).
 */

/** turret's tutorial writ — one slow homing citation, long-baited: the first body a player sees curve (stage 1). */
const CITATION = {
  style: { sprite: 'missile.0', r: 1, g: 0.8, b: 0.55, orientToHeading: true },
  radius: 2,
  blade: { length: 14 },
  missile: { explosion: 'missile.pop.tiny' },
  life: 220, // > delay(20)+duration(40): finishes seeking before it expires (G3)
  motion: { r: 1.6, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.4, delay: 20, duration: 40 } },
};

/** weaver's notice — one lazy homing writ thrown between its arcs (stage 1). */
const NOTICE = {
  style: { sprite: 'missile.6', r: 1, g: 0.82, b: 0.55, orientToHeading: true },
  radius: 2,
  blade: { length: 20 },
  missile: { explosion: 'missile.pop.tiny' },
  life: 230,
  motion: { r: 1.7, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.3, delay: 24, duration: 44 } },
};

/** hunter's mandate — a homing pair from its kunai slot, reskinned as a missile (stage 2). */
const MANDATE = {
  style: { sprite: 'missile.1', r: 0.95, g: 0.82, b: 0.55, orientToHeading: true },
  radius: 2,
  blade: { length: 15 },
  missile: { explosion: 'missile.pop.tiny' },
  life: 240,
  motion: { r: 2, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.8, delay: 16, duration: 60 } },
};

/** drifter's service — a DUMBFIRE straight writ "served in person": no homing, detonates on burn-out (stage 2). */
const SERVICE = {
  style: { sprite: 'missile.2', r: 1, g: 0.84, b: 0.58, orientToHeading: true },
  radius: 2,
  blade: { length: 14 },
  missile: { explosion: 'missile.pop.tiny' },
  life: 180, // no seek window — sized to expire on-field so it puffs where it lands
  motion: { r: 2.2, theta: 90 },
};

/** lash's injunction — a single homing writ on a stopAt window, thrown while it is planted (stage 2). */
const INJUNCTION = {
  style: { sprite: 'missile.7', r: 1, g: 0.78, b: 0.52, orientToHeading: true },
  radius: 2,
  blade: { length: 20 },
  missile: { explosion: 'missile.pop.tiny' },
  life: 240,
  motion: { r: 1.9, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.6, delay: 18, duration: 56 } },
};

/** warden's mandamus — an aimed-fan homing wedge (stage-2 midboss). */
const MANDAMUS = {
  style: { sprite: 'missile.3', r: 1, g: 0.72, b: 0.5, orientToHeading: true },
  radius: 2,
  blade: { length: 16 },
  missile: { explosion: 'missile.pop.mid' },
  life: 260,
  motion: { r: 1.8, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.8, delay: 16, duration: 66 } },
};

/** magistrate's judgment — the "Summary Judgment" homing salvo (stage-2 boss, design §b.1). */
const JUDGMENT = {
  style: { sprite: 'missile.4', r: 1, g: 0.72, b: 0.5, orientToHeading: true },
  radius: 2,
  blade: { length: 18 },
  missile: { explosion: 'missile.pop.mid' },
  life: 260, // > delay(16)+duration(70) (G3)
  motion: { r: 1.4, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.8, delay: 16, duration: 70 } },
};

/** summons's process — its signature homing writ, service of process made literal (stage 3). */
const PROCESS = {
  style: { sprite: 'missile.5', r: 0.98, g: 0.82, b: 0.5, orientToHeading: true },
  radius: 2,
  blade: { length: 19 },
  missile: { explosion: 'missile.pop.mid' },
  life: 240,
  motion: { r: 2, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 2, delay: 14, duration: 60 } },
};

/** clerk's certiorari — a homing pair over its aimed fan (stage 3). */
const CERTIORARI = {
  style: { sprite: 'missile.8', r: 0.95, g: 0.82, b: 0.55, orientToHeading: true },
  radius: 2,
  blade: { length: 17 },
  missile: { explosion: 'missile.pop.mid' },
  life: 240,
  motion: { r: 1.9, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.9, delay: 16, duration: 58 } },
};

/** stele's distraint — a DUMBFIRE spread from the planted slab, no homing (stage 3). */
const DISTRAINT = {
  style: { sprite: 'missile.11', r: 0.85, g: 0.8, b: 0.6, orientToHeading: true },
  radius: 2,
  blade: { length: 12 },
  missile: { explosion: 'missile.pop.tiny' },
  life: 180,
  motion: { r: 2, theta: 90 },
};

/** chancellor's docket — a deep-card homing barrage; big detonations (stage-3 boss). */
const DOCKET = {
  style: { sprite: 'missile.9', r: 0.98, g: 0.8, b: 0.48, orientToHeading: true },
  radius: 2,
  blade: { length: 17 },
  missile: { explosion: 'missile.pop.big' },
  // Deliberately short-lived and slow: boss-fired, so no bomb clears it (bombs are
  // suppressed under a boss) and an invulnerable late-game player is never hit — the
  // detonation reachability rests on an on-field burn-out. From the boss's station
  // (y≈96) at r 1.4, life 150 expires near mid-field, well inside the 640-tall frame.
  life: 150, // > delay(18)+duration(70) (G3)
  motion: { r: 1.4, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 2, delay: 18, duration: 70 } },
};

/** marshal's execution — a homing salvo behind its ring-wall (stage 4). */
const EXECUTION = {
  style: { sprite: 'missile.10', r: 0.95, g: 0.8, b: 0.5, orientToHeading: true },
  radius: 2,
  blade: { length: 17 },
  missile: { explosion: 'missile.pop.mid' },
  life: 260,
  motion: { r: 1.9, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.9, delay: 16, duration: 62 } },
};

/**
 * regent's edict — the final boss's signature: one enormous slow homing writ per
 * volley, the massive 17-frame body. Big detonations. Same boss-fired on-field
 * burn-out reasoning as DOCKET: slow (r 1.0) and short-lived (life 180) so it
 * self-destructs near mid-field rather than flying off the edge, since no bomb or
 * player-hit will remove it under the final boss (stage-4 boss).
 */
const EDICT = {
  style: { sprite: 'missile.massive', r: 0.98, g: 0.78, b: 0.46, orientToHeading: true },
  radius: 4,
  blade: { length: 46 },
  missile: { explosion: 'missile.pop.big' },
  life: 180, // > delay(24)+duration(80) (G3)
  motion: { r: 1, theta: 90, w: 0, behaviour: 'homing', options: { turnRate: 1.1, delay: 24, duration: 80 } },
};

/* ---- enemy/boss GEM-COLOUR re-skins (战役扩容轮) ----
 * Each re-skins ONE fired sub-pattern of a boss (or elite) toward its gem
 * identity — sentinel green, warden yellow, magistrate cyan, chancellor pink,
 * regent purple; turret/bastion elite warm. Every one is the base spec with ONLY
 * `style.sprite` changed: radius, motion, blade and count are untouched, so the
 * sim reads identical numbers and the golden replay trace does NOT move (the sim
 * reads `radius`, never the cell). One sub-pattern is swapped per skin, so the
 * base bullet keeps firing its other sub-patterns — the curtain GROWS a gem hue
 * rather than losing its old skin. The BulletPack multi-hue sheets are sliced to
 * these names by explicit crop in `tools/bulletpack-map.json`; size-honesty (a
 * skin's painted extent ≈ 2·radius of the bullet it lands on) is enforced by that
 * placement, re-checked on `bun run test:density` (no automated honesty test). */
const SHARD_TITHE = { ...SHARD, style: { ...SHARD.style, sprite: 'needle.tithe' } };
const ENEMY_BEACON = { ...ENEMY_SHOT, style: { ...ENEMY_SHOT.style, sprite: 'orb.small.beacon' } };
const SEEKER_LIEN = { ...SEEKER, style: { ...SEEKER.style, sprite: 'needle.lien' } };
const SPARK_FEE = { ...SPARK, style: { ...SPARK.style, sprite: 'orb.small.fee' } };
const EMBER_PYRE = { ...EMBER, style: { ...EMBER.style, sprite: 'petal.pyre' } };
const SHELL_ASSAY = { ...SHELL, style: { ...SHELL.style, sprite: 'orb.small.assay' } };
const SEEKER_ESCROW = { ...SEEKER, style: { ...SEEKER.style, sprite: 'scale.escrow' } };
const WRIT_BRIEF = { ...WRIT, style: { ...WRIT.style, sprite: 'orb.small.brief' } };
const DECREE_LEDGER = { ...DECREE, style: { ...DECREE.style, sprite: 'orb.medium.ledger' } };
const SEAL_WITNESS = { ...SEAL, style: { ...SEAL.style, sprite: 'halo.witness' } };
const LEVY_DOCKET = { ...LEVY, style: { ...LEVY.style, sprite: 'spark.docket' } };
const LEVY_DUTY = { ...LEVY, style: { ...LEVY.style, sprite: 'spark.duty' } };
const LATTICE_TENURE = { ...LATTICE, style: { ...LATTICE.style, sprite: 'orb.medium.tenure' } };
const DECREE_MANDAMUS = { ...DECREE, style: { ...DECREE.style, sprite: 'orb.medium.mandamus' } };
const CROWN_MANDAMUS = { ...CROWN_CW, style: { ...CROWN_CW.style, sprite: 'halo.mandamus' } };

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
        pattern: 'alternating-fan',
        options: { spec: ENEMY_SHOT, count: 3, spread: 20, period: 50, swing: 12 },
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
    onHit: 'hit.surface',
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
        pattern: 'weave',
        options: { spec: ENEMY_SHOT, pairs: 1, step: 17, amplitude: 34, period: 5 },
        startAt: 40,
        stopAt: 90,
        difficulty: {
          easy: { pairs: 1, amplitude: 26, period: 7 },
          hard: { pairs: 2, amplitude: 38, period: 4 },
          lunatic: { pairs: 2, amplitude: 46, period: 4 },
        },
      },
      // One lazy homing writ between its arcs — the second place (after turret)
      // a stage-1 body is seen to curve. A single flat volley, so it adds the same
      // constant to every tier and the stage-1 opening's strict tier rise
      // (`difficulty-honesty.test.ts`) is untouched. Fired inside the 40–90 sweep
      // window, before the weaver leaves upward.
      {
        pattern: 'aimed-fan',
        options: { spec: NOTICE, count: 1, spread: 0, period: 200 },
        startAt: 50,
        stopAt: 90,
      },
    ],
    spoils: [['power', 2]],
    scoreValue: 300,
    onHit: 'hit.mycelium',
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
        options: { spec: ENEMY_BEACON, count: 2, period: 24, spread: 50 },
        startAt: 120,
        difficulty: {
          easy: { count: 1, period: 32 },
          hard: { count: 3, period: 20 },
          lunatic: { count: 4, period: 18 },
        },
      },
      // The TUTORIAL writ — one slow homing citation on a long period, the first
      // body in the whole game a player watches curve (design §b.2). Flat across
      // tiers (a single count-1 drip), so the stage-1 turret wall's density axis is
      // still carried entirely by its ring above. The turret crawls the length of
      // the stage behind a 96px margin, so this dribbles the writ out the whole time.
      {
        pattern: 'aimed-fan',
        options: { spec: CITATION, count: 1, spread: 0, period: 110 },
        startAt: 40,
      },
    ],
    // It crawls in from well above the field and is meant to survive the trip.
    despawnMargin: 96,
    // stage-1's bomb carrier. The wall is the one stage-1 enemy the player cannot
    // skim past — three of them fall across the stage (waves at 760, 1500×2), so a
    // player who spends a bomb clearing the ring earns roughly what they spent back
    // by the boss door. The bomb rides on the type every difficulty must engage, so
    // the mid-stage bomb count is the same 3 on Easy as on Lunatic (spawn counts are
    // not tier-scaled; only the ring's density is).
    spoils: [['power', 3], ['bomb', 1]],
    scoreValue: 1000,
    onHit: 'hit.skeleton',
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
      // A DUMBFIRE writ "served in person": `missile` set, no `homing`, so it flies
      // its aimed heading and detonates on burn-out — the first missile a player
      // sees that does NOT curve, so the homing ones read as a distinct threat. One
      // flat drip; stage-2's opening is not difficulty-honesty-measured, but a flat
      // slot keeps it honest anyway.
      {
        pattern: 'aimed-fan',
        options: { spec: SERVICE, count: 1, spread: 0, period: 110 },
        startAt: 46,
      },
    ],
    spoils: [['power', 1]],
    scoreValue: 100,
    onHit: 'hit.surface',
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
      // A single homing injunction on the plant window, thrown alongside the beams
      // so the lane a beam leaves is not a free rest. Flat, on the same stopAt the
      // beam obeys, so it fires only while planted (a homing writ from a moving
      // muzzle would be as unreadable as a moving beam).
      {
        pattern: 'aimed-fan',
        options: { spec: INJUNCTION, count: 1, spread: 0, period: 100 },
        startAt: 60,
        stopAt: 190,
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2]],
    scoreValue: 400,
    onHit: 'hit.skeleton',
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
      // A homing mandate pair from the kunai slot, reskinned as a missile — the
      // same moving-source arc that makes the seeker's delay legible now curves a
      // detonating body. Flat, on the same arc window.
      {
        pattern: 'aimed-fan',
        options: { spec: MANDATE, count: 2, spread: 30, period: 80 },
        startAt: 50,
        stopAt: 150,
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2]],
    scoreValue: 400,
    onHit: 'hit.mycelium',
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
        pattern: 'gap-ring',
        options: { spec: EMBER_PYRE, count: 10, period: 84, rotation: 13, gap: 54 },
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
    onHit: 'hit.heart',
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
        options: { spec: SHELL_ASSAY, count: 14, period: 84, rotation: 12 },
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
    // stage-2's bomb carrier, the same role turret plays in stage-1: the wall that
    // barely moves and must be killed. Three fall (waves at 1320, 1720×2), so the
    // stage hands back 3 bombs on every tier — inside the 2-4 the economy targets.
    spoils: [['power', 3], ['bomb', 1]],
    scoreValue: 1500,
    onHit: 'hit.skeleton',
    onDeath: 'death.big',
  },

  /* ---- stage-3 cast ---- */

  /**
   * The clerk — the aim-chaff, and so the stage's difficulty axis before any boss.
   * Falls straight, fires a narrow aimed three-fan after half a second. It exists
   * to re-state stage-3's first law, "this stage aims at you, so keep moving," and
   * it is the enemy the headless opening assertion measures: Easy thins and slows
   * the fan, Lunatic widens and quickens it.
   */
  clerk: {
    sprite: 'orb.small',
    hp: 10,
    radius: 9,
    tint: { r: 0.9, g: 0.82, b: 0.6 },
    motion: { r: 1.8, theta: 90 },
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: WRIT, count: 3, spread: 34, period: 48 },
        startAt: 30,
        difficulty: {
          easy: { count: 2, period: 60 },
          hard: { count: 4, spread: 40, period: 40 },
          lunatic: { count: 5, spread: 44, period: 34 },
        },
      },
      // A homing certiorari pair over the aimed fan — the writ that comes back for
      // you. Flat, so the stage-3 opening's strict tier rise
      // (`difficulty-honesty.test.ts`, which measures the clerk fan) is carried by
      // the fan above and this adds the same constant to every tier.
      {
        pattern: 'aimed-fan',
        options: { spec: CERTIORARI, count: 2, spread: 24, period: 90 },
        startAt: 45,
      },
    ],
    spoils: [['power', 1]],
    scoreValue: 100,
    onHit: 'hit.surface',
    onDeath: 'explosion',
  },

  /**
   * The stele — an upright inscribed slab, a standing record, the stage's wall.
   * Dives, plants for about three seconds, then leaves upward. While planted it
   * throws a slow rotating ring of slabs whose volleys interlock into a standing
   * lattice with one rotating lane; threading that lane is proximity the player
   * *chooses*, which is the wave's designed graze. Easy opens the lattice, Lunatic
   * packs it — the lane tightens but never closes.
   */
  stele: {
    sprite: 'scale',
    hp: 34,
    radius: 14,
    tint: { r: 0.45, g: 0.7, b: 0.6 },
    timeline: [
      { count: 0, motion: { r: 3, theta: 90 } },
      { count: 40, motion: { r: 0 } },
      { count: 230, motion: { r: 3.2, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'gap-ring',
        options: { spec: SLAB, count: 18, period: 40, rotation: 5, gap: 36 },
        startAt: 55,
        stopAt: 220,
        difficulty: {
          easy: { count: 14, period: 52, rotation: 4 },
          hard: { count: 22, period: 34, rotation: 6 },
          lunatic: { count: 24, period: 30, rotation: 7 },
        },
      },
      // A DUMBFIRE distraint spread off the planted slab — no homing, so it flies
      // straight down through the lattice lane and detonates on burn-out, a second
      // reason the resting spot inside the wall is not free. Flat, on the plant
      // window; the stage-3 opening's tier rise is carried by the slab ring above.
      {
        pattern: 'aimed-fan',
        options: { spec: DISTRAINT, count: 2, spread: 30, period: 90 },
        startAt: 70,
        stopAt: 210,
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2]],
    scoreValue: 350,
    onHit: 'hit.skeleton',
    onDeath: 'explosion',
  },

  /**
   * The summons — one comes to find you. Falls fast, throws a tight fan of homing
   * subpoenas. Its entire job is to make the stele wall unsittable: the wall gives
   * you a lane, the summons denies you the resting spot inside it, and wall +
   * can't-camp is stage-3's core combination made flesh.
   */
  summons: {
    sprite: 'needle',
    hp: 12,
    radius: 8,
    tint: { r: 0.95, g: 0.82, b: 0.5 },
    motion: { r: 2.2, theta: 90 },
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: SUBPOENA, count: 3, spread: 12, period: 30 },
        startAt: 24,
        difficulty: {
          easy: { count: 2, spread: 10, period: 40 },
          hard: { count: 3, spread: 16, period: 26 },
          lunatic: { count: 4, spread: 18, period: 22 },
        },
      },
      // Its signature homing writ — service of process made literal. A single flat
      // process alongside the subpoena fan, so the "one comes to find you" fiction
      // gains a detonating body that curves after you.
      {
        pattern: 'aimed-fan',
        options: { spec: PROCESS, count: 1, spread: 0, period: 60 },
        startAt: 36,
      },
    ],
    spoils: [['power', 1]],
    scoreValue: 200,
    onHit: 'hit.mycelium',
    onDeath: 'explosion',
  },

  /**
   * The assessor — one who assesses and levies. A heavy that dives, plants, and
   * pours an isotropic spiral that fills space in every direction and so punishes
   * standing still: a preview of the boss's squeeze, dropped into the pre-boss
   * pressure. Easy narrows the spiral, Lunatic adds an arm and quickens it.
   */
  assessor: {
    sprite: 'halo',
    hp: 40,
    radius: 13,
    tint: { r: 0.85, g: 0.75, b: 0.7 },
    timeline: [
      { count: 0, motion: { r: 2.6, theta: 90 } },
      { count: 40, motion: { r: 0 } },
      { count: 260, motion: { r: 2.8, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'spiral',
        options: { spec: LEVY_DUTY, arms: 3, step: 9, period: 3 },
        startAt: 50,
        stopAt: 250,
        difficulty: {
          easy: { arms: 2, step: 7 },
          hard: { arms: 3, step: 11 },
          lunatic: { arms: 4, step: 12, period: 2 },
        },
      },
    ],
    despawnMargin: 80,
    // stage-3's bomb carrier. The assessor plants centrally and pours an isotropic
    // spiral for ~4.3s — the enemy that "punishes standing still", so the player is
    // committed to fighting it, not skimming past. Three appear (waves at 1180×2,
    // 1400), giving the final stage its 3 mid-stage bombs on every tier. It keeps
    // its score row; the bomb rides alongside.
    spoils: [['power', 2], ['score', 1], ['bomb', 1]],
    scoreValue: 500,
    onHit: 'hit.surface',
    onDeath: 'explosion',
  },

  /**
   * The ray — stage-3's swept-beam platform, and the laser round's reach
   * guarantee for the new `beam-sweep` verb (design §b.5). It dives in, plants
   * itself (a beam whose muzzle moves is unreadable), telegraphs a beam aimed at
   * the player, then rakes it across a 60° wedge — aim, hold, sweep. It leaves
   * upward under its own power, so like `stele` it is a wall only for the few
   * seconds it holds. Because the swept lane is the whole threat, the tier moves
   * the beam count in ones, not fistfuls: one on Easy/Normal, a pair on
   * Hard/Lunatic. `RAY_BEAM` sets `w = 0` and `hold == warmup`, the two couplings
   * `beam-sweep` needs (see the spec).
   */
  ray: {
    sprite: 'star',
    hp: 50,
    radius: 12,
    tint: { r: 0.5, g: 0.9, b: 0.62 },
    timeline: [
      { count: 0, motion: { r: 3, theta: 90 } },
      { count: 30, motion: { r: 0 } },
      { count: 210, motion: { r: 3.2, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: RAY_BEAM, count: 1, spread: 0, period: 150 },
        startAt: 40,
        stopAt: 170,
        // A swept beam is a lethal moving line, so its count moves in ones.
        difficulty: {
          easy: { period: 190 },
          hard: { count: 2, spread: 34 },
          lunatic: { count: 2, spread: 42, period: 130 },
        },
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2]],
    scoreValue: 500,
    onHit: 'hit.skeleton',
    onDeath: 'explosion',
  },

  /* ---- stage-4 cast ---- */

  /*
   * Stage 4 fields three new trash types, each re-teaching one earlier stage's
   * lesson, plus reprises of one enemy per prior stage (`grunt`, `lash`,
   * `assessor`) — the final exam of trash. Names do not collide with the roster.
   */

  /**
   * The usher — the herder, and the stage's difficulty axis before the boss. Falls
   * fast and fires a tight aimed-fan of pickets that push the player off a line;
   * it is placed in BANKS from both flanks (the wave's own doing, so no mirrored
   * twin is needed — the sideways motion is the formation, not the enemy). Low hp,
   * cheap. It is the enemy the headless opening assertion measures: Easy thins and
   * slows the fan, Lunatic widens and quickens it, so the opening rises strictly.
   */
  usher: {
    sprite: 'needle',
    hp: 8,
    radius: 8,
    tint: { r: 0.98, g: 0.86, b: 0.5 },
    motion: { r: 2.6, theta: 90 },
    patterns: [
      {
        pattern: 'aimed-fan',
        options: { spec: PICKET, count: 3, spread: 26, period: 40 },
        startAt: 20,
        difficulty: {
          easy: { count: 2, spread: 20, period: 52 },
          hard: { count: 4, spread: 32, period: 34 },
          lunatic: { count: 5, spread: 38, period: 30 },
        },
      },
    ],
    spoils: [['power', 1]],
    scoreValue: 100,
    onHit: 'hit.mycelium',
    onDeath: 'explosion',
  },

  /**
   * The marshal — the stationary anchor the ushers sweep past. Slow and durable:
   * dives, plants for about three seconds, and lays a rotating ring-wall of slow
   * bulwark bars whose volleys interlock into a standing wall with one turning
   * lane, the stage-2 wall. Ring count rises per tier and Lunatic tightens the
   * gap — the lane narrows Easy->Lunatic but never closes.
   */
  marshal: {
    sprite: 'scale',
    hp: 40,
    radius: 15,
    tint: { r: 0.6, g: 0.55, b: 0.42 },
    timeline: [
      { count: 0, motion: { r: 3, theta: 90 } },
      { count: 44, motion: { r: 0 } },
      { count: 250, motion: { r: 3.2, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'lane-wall',
        options: { spec: BULWARK, columns: 9, gapColumn: 4, shift: 1, speed: 1.8, period: 44 },
        startAt: 60,
        stopAt: 240,
        difficulty: {
          easy: { columns: 7, period: 56, shift: 1 },
          hard: { columns: 11, period: 38, shift: 2 },
          lunatic: { columns: 13, period: 34, shift: 2 },
        },
      },
      // A homing execution salvo behind the ring-wall — the writ that follows once
      // the wall has pinned your lane. Flat, on the plant window; the stage-4
      // opening's strict tier rise (`difficulty-honesty.test.ts`, which measures
      // the marshal ring-wall) is carried by the ring above.
      {
        pattern: 'aimed-fan',
        options: { spec: EXECUTION, count: 2, spread: 28, period: 90 },
        startAt: 80,
        stopAt: 240,
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2]],
    scoreValue: 350,
    onHit: 'hit.skeleton',
    onDeath: 'explosion',
  },

  /**
   * The notary — the mid-stage bomb carrier, and stage-3's "both at once" made
   * flesh. A tanky official that dives on a timeline (like `assessor`), plants,
   * and pours a spiral (a rotating stream) while a late ring-stamp lays a
   * turning-gap wall over it — the sideways read under a rotating stream at once.
   * Lunatic adds an arm to the spiral and turns the stamp's gap harder.
   *
   * Its spoils include a bomb: it is the carrier the economy test now requires per
   * stage (`tools/make-v4-content.test.ts`), and the assessor reprise below is a
   * second, so the stage hands back bombs before the boss door on every tier.
   */
  notary: {
    sprite: 'halo',
    hp: 44,
    radius: 13,
    tint: { r: 0.95, g: 0.82, b: 0.5 },
    timeline: [
      { count: 0, motion: { r: 2.6, theta: 90 } },
      { count: 44, motion: { r: 0 } },
      { count: 260, motion: { r: 2.8, theta: 270 } },
    ],
    patterns: [
      {
        pattern: 'spiral',
        options: { spec: LEVY, arms: 3, step: 10, period: 3 },
        startAt: 50,
        stopAt: 210,
        difficulty: {
          easy: { arms: 2, step: 8 },
          hard: { arms: 3, step: 12 },
          lunatic: { arms: 4, step: 13, period: 2 },
        },
      },
      {
        // The seal it presses. A short late stamp — two or three interlocking
        // signet rings before the notary leaves, whose gap turns by `rotation`
        // between volleys. Lunatic turns it faster. (There is no death-trigger, so
        // this is a late `startAt`, not literally on death — see SIGNET.)
        pattern: 'gap-ring',
        options: { spec: SIGNET, count: 18, period: 46, rotation: 5, gap: 34 },
        startAt: 170,
        stopAt: 250,
        difficulty: {
          easy: { count: 14, rotation: 3 },
          hard: { count: 22, rotation: 6 },
          lunatic: { count: 26, rotation: 8 },
        },
      },
    ],
    despawnMargin: 80,
    spoils: [['power', 2], ['bomb', 1], ['score', 2]],
    scoreValue: 500,
    onHit: 'hit.heart',
    onDeath: 'explosion',
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
    // Shipped bosses declare their spoils rather than fall through DEFAULT_BOSS_SPOILS.
    // That default stays — it is the reward rule for a guest pack that names none —
    // but the base campaign spells its own economy out so a change to the fallback
    // cannot silently retune the game we ship. The pickup-variety round redenominates
    // the `score` component of every boss into native tiers, holding each boss's
    // score AGGREGATE exactly invariant. Sentinel introduces the ladder: three green
    // gems, its signature colour, worth 3×2000 = 6000 — the same 12×500 = 6000 the
    // old score chips paid. The `big-power`/`bomb` rows are untouched.
    spoils: [['big-power', 4], ['gem.green', 3], ['bomb', 1]],
    // Speakers are portrait names: the boss's own, and 'player' for the ship.
    dialogue: [
      { speaker: 'sentinel', text: 'Far enough.' },
      { speaker: 'player', text: 'The gate is behind you.' },
      { speaker: 'sentinel', text: 'The gate is me.' },
    ],
    // One per-character variant, for the built-in `spire`: the exchange keyed by
    // a character name is used in place of `dialogue` when that ship flies the
    // fight, every other character keeping the default above. Same sparse voice,
    // fewer lines — a variant may differ in count, which changes only spire's
    // timeline (why a replay pins the character).
    dialogueFor: {
      spire: [
        { speaker: 'sentinel', text: 'You climb without a summit.' },
        { speaker: 'player', text: 'The climb is the summit.' },
      ],
    },
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
        // 'signet' is sentinel's seal — the cell stated plainly, stamped over the
        // stage field when the first card lands (see src/v4/backgrounds/signet.ts).
        background: 'signet',
        // Stationary: the card is a shape to be read, and a moving source would
        // smear it into noise.
        motion: { r: 0 },
        patterns: [
          // Two counter-rotating rings. Their offsets drift apart at different
          // rates, so the safe gaps sweep instead of standing still.
          {
            pattern: 'gap-ring',
            options: { spec: PETAL, count: 18, period: 42, rotation: 9, gap: 44 },
            difficulty: {
              easy: { count: 12 },
              hard: { count: 22, period: 36 },
              lunatic: { count: 26, period: 33 },
            },
          },
          {
            pattern: 'gap-ring',
            options: { spec: PETAL, count: 18, period: 42, rotation: -14, gap: 44 },
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
        // Explicit 'signet', not undefined: an undefined background silently
        // reverts to the stage scene mid-fight (the R1 defect). Once the seal is
        // stamped on Tidal Corolla it stays down through Vigil Unbroken.
        background: 'signet',
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
        // 'umbra' — the seal unmoored: signet drifts off-station, a radial moiré
        // swims, never brighter (src/v4/backgrounds/umbra.ts). Lunatic-only.
        background: 'umbra',
        // The one per-card track in the game: this Lunatic-only card lifts to its
        // own theme for its duration, overriding sentinel's `nemesis` exactly as
        // `background` overrides the stage scene. Reached only on Lunatic.
        music: 'zenith',
        motion: { r: 0 },
        patterns: [
          { pattern: 'spiral', options: { spec: NEEDLE, arms: 6, step: 11, period: 3 } },
          { pattern: 'ring', options: { spec: PETAL, count: 24, period: 66, rotation: 15 }, startAt: 40 },
          { pattern: 'aimed-fan', options: { spec: SHARD_TITHE, count: 7, spread: 44, period: 60 }, startAt: 90 },
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
    music: 'interdict',
    onDeath: 'death.big',
    // Explicit, same aggregate as the retired fallback: three yellow gems, the
    // midboss's signature colour (3×2000 = 6000, holding the old 12×500 = 6000), plus
    // one bomb. The variety spike of stage 2: warden pays yellow, magistrate cyan.
    spoils: [['big-power', 4], ['gem.yellow', 3], ['bomb', 1]],
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
            options: { spec: SPARK_FEE, count: 5, spread: 32, period: 46 },
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
          // An aimed-fan homing wedge of mandamus writs from the pacing source —
          // the midboss's first missiles, mid-tier detonations. Flat; the phase's
          // density axis stays on the aimed fan and spray above.
          {
            pattern: 'aimed-fan',
            options: { spec: MANDAMUS, count: 2, spread: 30, period: 90 },
            startAt: 30,
          },
        ],
      },
      {
        name: 'Beam Sign "Picket Line"',
        hpSeconds: 5,
        isSpell: true,
        bonus: 120000,
        // 'cordon' — the seal truncated: a broken half-arc, a picket line
        // (src/v4/backgrounds/cordon.ts). Olive-brass over undertow's indigo.
        background: 'cordon',
        // Stationary. A beam's telegraph is a promise about where the line will
        // be, and a moving muzzle breaks it.
        motion: { r: 0 },
        patterns: [
          // Four beams at 90°, rotating 21° a volley, so the safe wedges walk.
          {
            pattern: 'gap-ring',
            options: { spec: COLUMN_HEAVY, count: 4, period: 120, rotation: 21, gap: 70 },
            difficulty: {
              easy: { count: 3 },
              hard: { count: 5 },
              lunatic: { count: 6, rotation: 26 },
            },
          },
          // Seekers between beams: standing in a wedge must not be free.
          {
            pattern: 'aimed-fan',
            options: { spec: SEEKER_LIEN, count: 3, spread: 28, period: 84 },
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
        // 'cordon' again — warden's truncated seal held across the fight.
        background: 'cordon',
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
   * The stage-2 boss and the last fight before the final stage. Four phases: the same three
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
    music: 'docket',
    onDeath: 'death.big',
    // The stage-2 boss out-rewards its midboss: three cyan gems (its signature) plus
    // one gold coin — 3×2000 + 1×1000 = 7000, holding the old 14×500 = 7000 exactly —
    // and, net new to this economy, one `life`, the second and only other direct
    // extend in the campaign beside chancellor's. The gold coin is the only place in
    // the campaign that denomination drops (exact conservation leaves it no trash
    // home). Two handed-back lives across the whole game keeps the extend genuinely
    // rare; the mid-stage bombs are the generous channel, lives are not.
    spoils: [['big-power', 4], ['gem.cyan', 3], ['coin.gold', 1], ['bomb', 1], ['life', 1]],
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
        // 'intaglio' — the seal inverted: the rosette is the cut void, the ground
        // the fill (src/v4/backgrounds/intaglio.ts). Bone over undertow's indigo.
        background: 'intaglio',
        motion: { r: 0 },
        patterns: [
          // A ring of seekers: every bullet flies straight for 18 ticks and then
          // all of them turn inward together.
          {
            pattern: 'gap-ring',
            options: { spec: SEEKER_ESCROW, count: 14, period: 78, rotation: 13, gap: 38 },
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
          // "Summary Judgment" — a homing salvo of judgment writs read against the
          // seeker ring and chaff, the missiles the boss's whole card is named for
          // (design §b.1). Mid-tier detonations; the seeker ring above still owns
          // the density axis, so this is a flat aimed-fan of three.
          {
            pattern: 'aimed-fan',
            options: { spec: JUDGMENT, count: 3, spread: 40, period: 74 },
            startAt: 24,
            difficulty: {
              easy: { count: 2, period: 92 },
              hard: { count: 4, spread: 48, period: 64 },
              lunatic: { count: 5, spread: 54, period: 56 },
            },
          },
        ],
      },
      {
        name: 'Beam Sign "Colonnade"',
        hpSeconds: 14,
        isSpell: true,
        bonus: 250000,
        // 'intaglio' again — magistrate's inverted seal held across the fight.
        background: 'intaglio',
        // Stationary, for the same reason 'Picket Line' is.
        motion: { r: 0 },
        patterns: [
          // Six columns, 17° a volley. COLUMN.life is 108 and the period is 132,
          // so exactly one set is live at a time and the room reconfigures.
          {
            pattern: 'ring',
            options: { spec: COLUMN_BLUE, count: 6, period: 132, rotation: 17 },
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
        // 'intaglio' — magistrate's inverted seal, held to the last word.
        background: 'intaglio',
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
            options: { spec: COLUMN_CYAN, count: 4, period: 150, rotation: 26 },
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

  /**
   * The stage-3 boss, and the mid-game peak — the chancellor who keeps the seal.
   * The magistrate ended with the player's "Then I appeal"; this is where the
   * appeal is heard, and filed. Six phases (Normal fights five; the sixth is
   * Lunatic-only), escalating 7/12/13/15/14/17 seconds — heavier than the
   * magistrate's four — and the law of every one of them is the stage's thesis:
   * hold a *moving* lane. So the tiers change the rate you must move to keep the
   * lane (aim speed, wall tightness, ring density, sweep rate), never whether the
   * lane exists. A Lunatic curtain is denser and never solid.
   *
   * Three of the cards demonstrate composition-over-a-new-pattern, the "prefer
   * composing the four before a fifth" resolution the round required: phase 2
   * lays `spiral` over `aimed-fan`, phase 3 lays `ring` over the `orbit`
   * behaviour, and phase 4 ("Sweeping Assay") lays a swept beam over a stream wall
   * and a curtain — the laser round's showcase card. No new *pattern* is authored;
   * the laser round adds exactly one new *behaviour* (`beam-sweep`), which this
   * card and the `ray` trash enemy fire.
   */
  chancellor: {
    sprite: 'halo',
    radius: 22,
    width: 64,
    height: 64,
    // Wan gold — gilt, seal-wax, age — against sentinel's ice, warden's rose and
    // magistrate's violet. The portrait tint in render/portrait.ts mirrors it.
    tint: { r: 0.95, g: 0.82, b: 0.5 },
    entry: { x: 240, y: 96, ticks: 90 },
    music: 'sanction',
    onDeath: 'death.big',
    // A `life` row rewards clearing the mid-game peak — the one enemy in the game
    // that hands back an extend directly rather than through the score threshold.
    // A fat pink-gem shower is its signature: 4×2000 = 8000, holding the old
    // 16×500 = 8000 exactly. `big-power`/`life`/`bomb` rows untouched.
    spoils: [['big-power', 4], ['life', 1], ['gem.pink', 4], ['bomb', 1]],
    dialogue: [
      { speaker: 'chancellor', text: 'Appeals are heard here.' },
      { speaker: 'player', text: 'I did not come to be heard.' },
      { speaker: 'chancellor', text: 'They are not granted.' },
      { speaker: 'chancellor', text: 'No. You came to be filed.' },
    ],
    // The per-character variant, for the built-in `spire`: estoppel bars you from
    // changing a stated position, and `spire` is the ship built to hold one — so
    // the line is mechanically true of how that ship fights and names the phase-4
    // card. `sentinel` already authors a spire variant, so this is precedent.
    dialogueFor: {
      spire: [
        { speaker: 'chancellor', text: 'You already stand still.' },
        { speaker: 'chancellor', text: 'You are half-filed. Estoppel does the rest.' },
      ],
    },
    phases: [
      {
        name: 'Appeal',
        // Seven seconds: the court hears you. An opener, not a wall.
        hpSeconds: 7,
        isSpell: false,
        // 'sable' — the seal darkened: pressed nearly shut, oxblood, the darkest
        // scene (src/v4/backgrounds/sable.ts). Against stratum's verdigris.
        background: 'sable',
        // A slow horizontal drift, reversed so it paces rather than leaves —
        // aimed streams you weave against, from a moving source.
        timeline: [
          { count: 0, motion: { r: 0.8, theta: 0 } },
          { count: 90, motion: { r: 0.8, theta: 180 } },
          { count: 180, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'aimed-fan',
            options: { spec: WRIT, count: 5, spread: 38, period: 52 },
            difficulty: {
              easy: { count: 3, period: 64 },
              hard: { count: 6, spread: 42, period: 44 },
              lunatic: { count: 7, spread: 46, period: 40 },
            },
          },
          {
            pattern: 'ring',
            options: { spec: DECREE_LEDGER, count: 12, period: 72, rotation: 6 },
            difficulty: {
              easy: { count: 10, period: 84 },
              hard: { count: 14, period: 60 },
              lunatic: { count: 16, period: 56 },
            },
          },
        ],
      },
      {
        // THE THESIS CARD: the escalation mandate as a single spell. `spiral`
        // punishes standing still; `aimed-fan` punishes the direction you flee —
        // so you weave against the rotation while the fan predicts the weave,
        // which is "weaving under aim," the reason the whole stage exists. It is
        // the card the headless honesty assertion targets. Composition #1.
        name: 'Sign "Binding Precedent"',
        hpSeconds: 12,
        isSpell: true,
        bonus: 250000,
        // 'sable' — chancellor's darkened seal held across the fight.
        background: 'sable',
        timeline: [
          { count: 0, motion: { r: 0.7, theta: 0 } },
          { count: 100, motion: { r: 0.7, theta: 180 } },
          { count: 200, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'spiral',
            options: { spec: LEVY_DOCKET, arms: 3, step: 9, period: 3 },
            difficulty: {
              easy: { arms: 2, step: 7 },
              hard: { arms: 4, step: 10 },
              lunatic: { arms: 4, step: 12, period: 2 },
            },
          },
          {
            pattern: 'aimed-fan',
            options: { spec: WRIT, count: 5, spread: 40, period: 50 },
            difficulty: {
              easy: { count: 3, period: 62 },
              hard: { count: 6, spread: 44, period: 44 },
              lunatic: { count: 7, spread: 48, period: 40 },
            },
          },
        ],
      },
      {
        // THE GRAZE CARD. The seal is pressed: a ring flies out, holds on a fixed
        // circle about the boss's station, and releases tangentially all at once.
        // The safe pocket sits at the seal's rim — hug it through the stalled
        // window and it racks graze; a light aimed-fan keeps you honest. Tiers
        // change ring *count* only, so the rim lane tightens Easy->Lunatic but
        // never closes. `ring` composed with the `orbit` behaviour — composition #2,
        // and no fifth pattern.
        name: 'Seal Sign "Wax and Witness"',
        hpSeconds: 13,
        isSpell: true,
        bonus: 300000,
        // 'sable' — chancellor's darkened seal.
        background: 'sable',
        patterns: [
          {
            pattern: 'gap-ring',
            options: { spec: SEAL_WITNESS, count: 16, period: 80, rotation: 0, gap: 42 },
            difficulty: {
              easy: { count: 12 },
              hard: { count: 20 },
              lunatic: { count: 24 },
            },
          },
          {
            pattern: 'aimed-fan',
            options: { spec: WRIT_BRIEF, count: 3, spread: 20, period: 64 },
            difficulty: {
              easy: { count: 2, period: 80 },
              hard: { count: 4, period: 54 },
              lunatic: { count: 5, period: 48 },
            },
          },
          // The docket barrage — a homing salvo that denies the free rim-hug the
          // graze card offers, so the seal is not only witnessed but served. These
          // are the game's BIG detonations, and — boss-fired, so no bomb clears them
          // and an invulnerable late player is never hit — the tier's reachability
          // rests on their on-field burn-out: DOCKET is slow and short-lived (life
          // 150) so it self-destructs near mid-field, well inside the 640-tall frame.
          {
            pattern: 'aimed-fan',
            options: { spec: DOCKET, count: 2, spread: 34, period: 96 },
            startAt: 30,
            difficulty: {
              easy: { count: 1, period: 120 },
              hard: { count: 3, spread: 40, period: 84 },
              lunatic: { count: 3, spread: 46, period: 76 },
            },
          },
        ],
      },
      {
        // THE BEAM CARD — the laser round's showcase (design §b.4). One warm beam,
        // aimed then raked across a 90° wedge (`beam-sweep`, the round's one new
        // verb), is the lane you read; a wide `beam.v3.stream` wall blinks behind
        // it and a light `beam.stream` curtain falls beneath, so all three of
        // chancellor's stream/warm beams fire in one card while the rake stays the
        // readable threat. Composition, not a new pattern: `aimed-fan` + `ring` +
        // `aimed-fan`, laser specs in the slots. Sized in seconds via `hpSeconds`,
        // measured against REFERENCE_DPS like every other card (balance.test.ts).
        name: 'Beam Sign "Sweeping Assay"',
        hpSeconds: 15,
        isSpell: true,
        bonus: 400000,
        // 'sable' — chancellor's OWN darkened seal, not magistrate's 'intaglio':
        // the campaign holds one scene per boss (design §E), so a beam card here
        // stays under chancellor's scene, and it names a scene that already exists
        // (src/v4/backgrounds/sable.ts) — no new shader.
        background: 'sable',
        // Stationary. A beam's telegraph is a promise about where the line will be,
        // and a moving muzzle breaks it — the same law 'Picket Line' and
        // 'Colonnade' obey.
        motion: { r: 0, theta: 90 },
        patterns: [
          // The rake: one beam aimed at the player, holding through the telegraph,
          // then sweeping. A pair on the higher tiers, so the count moves in ones.
          {
            pattern: 'aimed-fan',
            options: { spec: RAKE, count: 1, spread: 0, period: 300 },
            difficulty: {
              hard: { count: 2, spread: 60 },
              lunatic: { count: 2, spread: 76, period: 260 },
            },
          },
          // The wall of streams behind the rake: a rotating ring that reconfigures.
          {
            pattern: 'ring',
            options: { spec: STREAM_WALL, count: 5, period: 120, rotation: 12 },
            startAt: 40,
            difficulty: {
              easy: { count: 3 },
              hard: { count: 7 },
              lunatic: { count: 9, rotation: 16 },
            },
          },
          // A light curtain of streams under the rake, aimed so the lane below the
          // sweep is never a free rest.
          {
            pattern: 'aimed-fan',
            options: { spec: STREAM, count: 3, spread: 42, period: 150 },
            startAt: 90,
            difficulty: {
              easy: { count: 2, period: 180 },
              hard: { count: 4, spread: 48, period: 130 },
              lunatic: { count: 5, spread: 54, period: 120 },
            },
          },
        ],
      },
      {
        // Normal's final card. "You are barred from re-arguing." Dense
        // multidirectional pressure that closes retreats, `spray` filling a pure
        // ring's gaps — the tightest-feeling card relative to its health, still
        // lane-carrying. Its name is the hinge the `spire` dialogue turns on.
        name: 'Sign "Estoppel"',
        hpSeconds: 14,
        isSpell: true,
        bonus: 500000,
        // 'sable' — chancellor's darkened seal, held to the fight's normal end.
        background: 'sable',
        patterns: [
          {
            pattern: 'ring',
            options: { spec: DECREE, count: 20, period: 46, rotation: 8 },
            difficulty: {
              easy: { count: 14, period: 58 },
              hard: { count: 24, period: 40 },
              lunatic: { count: 28, period: 36 },
            },
          },
          {
            pattern: 'spray',
            options: { spec: WRIT, count: 4, spread: 360, period: 16 },
            difficulty: {
              easy: { count: 2, period: 22 },
              hard: { count: 5, period: 13 },
              lunatic: { count: 6, period: 11 },
            },
          },
        ],
      },
      {
        // TIER-GATED, Lunatic only — the genre's extra card, gated exactly as
        // sentinel's "Total Eclipse" is, so on every other tier the fight ends on
        // 'Estoppel'. The decree the appeal is denied by: the full combination at
        // once — spiral, aimed-fan and a rotating ring — but the authored lane
        // never closes (readable at the 2000-bullet budget, never the 5000 soup).
        // It lifts to its own drier, closer track for its duration, on the shared
        // 出神 scene `decree` (the seal draining, src/v4/backgrounds/decree.ts),
        // exactly as 'Total Eclipse' pairs `zenith`+`umbra`. `decree` is shared by
        // this card and the regent's 'Sine Die', the one scene for the one `fiat`
        // track. Reached only on the shared Lunatic full run.
        name: 'Fiat "Sealed"',
        hpSeconds: 17,
        isSpell: true,
        difficulties: ['lunatic'],
        bonus: 800000,
        background: 'decree',
        music: 'fiat',
        patterns: [
          { pattern: 'spiral', options: { spec: LEVY, arms: 4, step: 12, period: 2 } },
          { pattern: 'aimed-fan', options: { spec: WRIT, count: 7, spread: 46, period: 44 } },
          { pattern: 'ring', options: { spec: DECREE, count: 20, period: 60, rotation: 5 } },
        ],
      },
    ],
  },

  /**
   * The regent — the final authority, and the office's absent centre. Not another
   * officer in the sentinel -> warden -> magistrate -> chancellor line but the
   * vacancy they all enforced downward from: authority with no content but its own
   * seal. Its SIX cards are the recapitulation — each quotes and escalates one
   * prior boss, so the fight is a final exam of everything the campaign taught. No
   * new danmaku primitive: a boss whose whole design is to quote its predecessors
   * would be contradicted by a new verb, so every card composes existing patterns
   * (the one allowed new-pattern slot is spent nowhere).
   *
   * Wan gold — the chancellor's amber, a shade darker in the vault. Cards stamp
   * the regent's seal `regnum` (the cell resolved and FILLED, crimson — the seal
   * finally pressed into the empty seat) EXCEPT the terminal Sine Die, which comes
   * unmoored to the shared 出神 scene `decree` (the fill draining out), the same
   * scene the chancellor's 'Sealed' takes — one scene for the one `fiat` track.
   * Sizing is `hpSeconds`
   * against REFERENCE_DPS; the lunatic total (80s) is the longest fight in the
   * game, +17s over the chancellor, without bloat.
   */
  regent: {
    sprite: 'halo',
    radius: 22,
    width: 64,
    height: 64,
    tint: { r: 0.95, g: 0.82, b: 0.5 },
    entry: { x: 240, y: 96, ticks: 90 },
    music: 'interregnum',
    onDeath: 'death.big',
    // Final-boss generous, and it includes the bomb: the whole shower lands before
    // the ending screen. A `life` row, like the chancellor's — the second enemy in
    // the game to hand back an extend directly. The richest, most varied shower in
    // the game: the single GOLD BAR jackpot (8000, a 4× jump over a gem), the regent's
    // purple signature gem (2000), and four silver chips glinting under it (4×500 =
    // 2000) — 8000 + 2000 + 2000 = 12000, holding the old 24×500 = 12000 exactly. The
    // retained silver `score` here also keeps that chip reachable off a guaranteed
    // boss, so converting every other `score` drop to gems cannot strand it.
    spoils: [['big-power', 6], ['life', 1], ['bar.gold', 1], ['gem.purple', 1], ['score', 4], ['bomb', 1]],
    // Cold, flat, the reveal delivered without weight. The last line answers the
    // sentinel's opening "The gate is me."
    dialogue: [
      { speaker: 'regent', text: 'Nothing is filed here. Everything already is.' },
      { speaker: 'player', text: 'Then who decided it.' },
      { speaker: 'regent', text: 'No one. That is what makes it binding.' },
      { speaker: 'player', text: 'Show me the one who signs.' },
      { speaker: 'regent', text: 'You are looking at the signature.' },
    ],
    // The per-character variant, for the built-in `spire` — the ship whose arc the
    // sentinel opened ("You climb without a summit") and the chancellor continued.
    // The regent is that absent summit made literal, so the payoff belongs to it.
    dialogueFor: {
      spire: [
        { speaker: 'regent', text: 'You climbed for a seat. Look at it.' },
        { speaker: 'player', text: 'It is empty.' },
        { speaker: 'regent', text: 'It has always been empty. The climbing is what fills it.' },
      ],
    },
    phases: [
      {
        // Baseline rhythm, and the difficulty-honesty opener: the aimed-fan and
        // the spray both carry strict easy<normal<hard<lunatic blocks.
        name: 'Session',
        hpSeconds: 8,
        isSpell: false,
        // 'regnum' — the seal resolved and filled, crimson on the empty seat
        // (src/v4/backgrounds/regnum.ts). Against vault's gold.
        background: 'regnum',
        // A slow horizontal pace, reversed so it stations rather than leaves —
        // aimed streams from a moving source, the chancellor's opener recalled.
        timeline: [
          { count: 0, motion: { r: 0.8, theta: 0 } },
          { count: 90, motion: { r: 0.8, theta: 180 } },
          { count: 180, jump: 0 },
        ],
        patterns: [
          {
            pattern: 'aimed-fan',
            options: { spec: WRIT, count: 5, spread: 38, period: 50 },
            difficulty: {
              easy: { count: 3, period: 64 },
              hard: { count: 6, spread: 42, period: 42 },
              lunatic: { count: 7, spread: 46, period: 38 },
            },
          },
          {
            pattern: 'spray',
            options: { spec: WRIT, count: 3, spread: 360, period: 18 },
            difficulty: {
              easy: { count: 2, period: 24 },
              hard: { count: 4, period: 15 },
              lunatic: { count: 5, period: 13 },
            },
          },
        ],
      },
      {
        // SENTINEL recalled: two orbiting seals where the sentinel had one, turning
        // against each other — the stage-1 lateral dodge, doubled. `ring` composed
        // with the `orbit` behaviour, two specs of opposite `angularSpeed`.
        name: 'Seal Sign "Corolla Regnant"',
        hpSeconds: 12,
        isSpell: true,
        bonus: 300000,
        // 'regnum' — the regent's resolved seal.
        background: 'regnum',
        patterns: [
          {
            pattern: 'ring',
            options: { spec: CROWN_MANDAMUS, count: 12, period: 90, rotation: 4 },
            difficulty: {
              easy: { count: 9 },
              hard: { count: 15 },
              lunatic: { count: 18 },
            },
          },
          {
            pattern: 'ring',
            options: { spec: CROWN_CCW, count: 12, period: 90, rotation: -4 },
            difficulty: {
              easy: { count: 9 },
              hard: { count: 15 },
              lunatic: { count: 18 },
            },
          },
        ],
      },
      {
        // WARDEN recalled, and the graze card: two rings of slow lattice bars at
        // slightly different rotation form a wall whose safe lane SLIDES. The safe
        // read passes deliberately close to the lattice edges — the designed
        // reward. Tiers change ring count/period only, so the lane tightens
        // Easy->Lunatic but never closes.
        name: 'Beam Sign "Portcullis"',
        hpSeconds: 13,
        isSpell: true,
        bonus: 400000,
        // 'regnum' — the regent's resolved seal.
        background: 'regnum',
        patterns: [
          {
            pattern: 'lane-wall',
            options: { spec: LATTICE_TENURE, columns: 9, gapColumn: 3, shift: 1, speed: 1.6, period: 54 },
            difficulty: {
              easy: { columns: 7, period: 66 },
              hard: { columns: 11, period: 46, shift: 2 },
              lunatic: { columns: 13, period: 42, shift: 2 },
            },
          },
          {
            pattern: 'lane-wall',
            options: { spec: LATTICE, columns: 9, gapColumn: 5, shift: -1, speed: 1.6, period: 54 },
            difficulty: {
              easy: { columns: 7, period: 66 },
              hard: { columns: 11, period: 46, shift: -2 },
              lunatic: { columns: 13, period: 42, shift: -2 },
            },
          },
        ],
      },
      {
        // MAGISTRATE recalled, and the game's hardest single read: a ring of homing
        // warrants (seekers) laid over a static aimed-fan colonnade. You cannot
        // stand still (the seekers find you) AND cannot run free (the colonnade
        // predicts the flee) — seekers and beam-walls at once, with a moving lane.
        name: 'Writ Sign "Attainder"',
        hpSeconds: 14,
        isSpell: true,
        bonus: 500000,
        // 'regnum' — the regent's resolved seal.
        background: 'regnum',
        patterns: [
          {
            pattern: 'ring',
            options: { spec: WARRANT, count: 8, period: 64, rotation: 5 },
            difficulty: {
              easy: { count: 6, period: 80 },
              hard: { count: 10, period: 54 },
              lunatic: { count: 12, period: 48 },
            },
          },
          {
            pattern: 'aimed-fan',
            options: { spec: WRIT, count: 4, spread: 30, period: 58 },
            difficulty: {
              easy: { count: 3, period: 72 },
              hard: { count: 5, spread: 34, period: 50 },
              lunatic: { count: 6, spread: 38, period: 46 },
            },
          },
          // The regent's signature: one enormous slow homing edict per volley — the
          // massive 17-frame body — read against the warrant seekers and the aimed
          // colonnade, the hardest single card given a third, heavier thing to
          // track. BIG detonations; like DOCKET it is boss-fired, so its tier
          // reachability rests on an on-field burn-out (slow, life 180, expires near
          // mid-field). One per volley on a long period keeps it a landmark, not a
          // wall; the tier bumps the seeker ring above, not this.
          {
            pattern: 'aimed-fan',
            options: { spec: EDICT, count: 1, spread: 0, period: 120 },
            startAt: 30,
          },
        ],
      },
      {
        // CHANCELLOR recalled: all three primitive curtains on the field at once —
        // ring, spray and spiral, the full composition. Normal's final card;
        // counts are capped so the peak stays a curtain-with-a-lane at the ~2000
        // readable budget, never the soup.
        name: 'Sign "Statute"',
        hpSeconds: 15,
        isSpell: true,
        bonus: 600000,
        // 'regnum' — the regent's resolved seal, held to the fight's normal end.
        background: 'regnum',
        patterns: [
          {
            pattern: 'ring',
            options: { spec: DECREE_MANDAMUS, count: 18, period: 52, rotation: 6 },
            difficulty: {
              easy: { count: 12, period: 64 },
              hard: { count: 22, period: 46 },
              lunatic: { count: 24, period: 42 },
            },
          },
          {
            pattern: 'spray',
            options: { spec: WRIT, count: 3, spread: 360, period: 18 },
            difficulty: {
              easy: { count: 2, period: 24 },
              hard: { count: 4, period: 15 },
              lunatic: { count: 5, period: 13 },
            },
          },
          {
            pattern: 'spiral',
            options: { spec: LEVY, arms: 3, step: 10, period: 3 },
            difficulty: {
              easy: { arms: 2, step: 8 },
              hard: { arms: 4, step: 11 },
              lunatic: { arms: 4, step: 12, period: 2 },
            },
          },
        ],
      },
      {
        // LUNATIC-ONLY finale — the decree that never reconvenes. The composed
        // maximum: spiral, aimed-fan and a rotating ring at once, with a designed
        // lane. Gated exactly as the chancellor's 'Fiat "Sealed"' is, so on every
        // other tier the fight ends on 'Statute'. It is the terminal beat: the
        // seal comes unmoored to the shared 出神 scene `decree` — the same scene
        // the chancellor's 'Sealed' takes, one scene for the one `fiat` track —
        // and lifts to `fiat` itself (the chancellor's decree returning at the
        // source). `decree` is declared ONLY on these two Lunatic cards, so it is
        // Lunatic-only-reachable (reachability.test.ts unions the Lunatic run for
        // exactly this), proved reached on the shared Lunatic run the way
        // `zenith`/`umbra`/`fiat` are.
        name: 'Last Fiat "Sine Die"',
        hpSeconds: 18,
        isSpell: true,
        difficulties: ['lunatic'],
        bonus: 1000000,
        background: 'decree',
        music: 'fiat',
        patterns: [
          { pattern: 'spiral', options: { spec: LEVY, arms: 4, step: 12, period: 2 } },
          { pattern: 'aimed-fan', options: { spec: WRIT, count: 7, spread: 46, period: 44 } },
          { pattern: 'ring', options: { spec: DECREE, count: 22, period: 58, rotation: 5 } },
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
    next: 'stage-3',
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

  /**
   * Stage 3 — the mid-game peak, and the first stage authored natively rather than
   * ported. Its waves are bars against `precedent`, the heaviest, slowest drone in
   * the game: the rests between pressure phrases are load-bearing, and the boss
   * enters on the downbeat after the longest of them. Two facts about the cast
   * shape the placement, the same way the earlier stages' did: `stele` and
   * `assessor` both plant and then leave *upward* under their own power, so they
   * are walls only for the ~three seconds they hold; and `clerk`/`summons` fall
   * straight and aim, so they are placed to pressure the lanes the walls leave.
   *
   * The stage's whole lesson is stage-1's sideways movement and stage-2's walls at
   * once — WEAVING UNDER AIM. The graze wave in the middle states it in miniature
   * (a slab lattice you thread close by choice, homing subpoenas denying the rest
   * spot); the pre-boss squeeze states it at volume (assessor spirals that punish
   * standing under clerk fans that punish fleeing).
   */
  'stage-3': {
    entry: false,
    seed: 0x3c1d05,
    outro: 90,
    background: 'stratum',
    music: 'precedent',
    boss: 'chancellor',
    next: 'stage-4',
    waves: [
      /* Bars 1-2 — state the aim pulse. Two offset clerk columns, the second on
         the "and"; then a small crossing pair. Re-teaching "keep moving" with wide
         lanes at every tier before anything walls the field. */
      { at: 60, enemy: 'clerk', x: LEFT, y: ENTRY_Y, count: 3, interval: 44 },
      { at: 104, enemy: 'clerk', x: RIGHT, y: ENTRY_Y, count: 3, interval: 44 },
      { at: 300, enemy: 'clerk', x: CENTRE - 70, y: ENTRY_Y, count: 2, interval: 40, stepX: 60 },

      /* Rest 1 (telegraph) — one stele slides to centre and plants against an
         empty field; its ring is delayed (the enemy's own startAt) so the empty
         beat teaches the coming downbeat, taught alone the way stage-2 taught its
         first beam. A trickle of clerks keeps the beat from going dead. */
      { at: 440, enemy: 'stele', x: CENTRE, y: ENTRY_Y },
      { at: 560, enemy: 'clerk', x: 120, y: ENTRY_Y, count: 3, interval: 40 },

      /* Middle — THE GRAZE WAVE (hardest stretch #1, the thesis in miniature). A
         line of stele plant across the top; their slow rotating rings interlock
         into a standing lattice with one rotating lane. Summons trickle in behind,
         homing subpoenas into that lane — the wall you thread close by choice, the
         homing that denies the resting spot. */
      { at: 620, enemy: 'stele', x: 140, y: ENTRY_Y },
      { at: 620, enemy: 'stele', x: 340, y: ENTRY_Y },
      { at: 700, enemy: 'stele', x: CENTRE, y: ENTRY_Y },
      { at: 760, enemy: 'summons', x: 90, y: -30, count: 2, interval: 70, stepX: 150 },
      { at: 820, enemy: 'summons', x: 300, y: -30, count: 2, interval: 70, stepX: -80 },

      /* Quiet beat (~900-1040) — rhythm is designed, not dead time: the breath
         that makes the squeeze land. */

      /* Bar 5 — syncopation. A clerk pair arrives on the off-beat, breaking the
         meter right before the squeeze. */
      { at: 1040, enemy: 'clerk', x: RIGHT, y: ENTRY_Y, count: 3, interval: 36 },

      /* First swept beam, deliberately alone in the quiet after the bar — the new
         verb taught against a near-empty field the way stage-2 taught its first
         beam: a ray plants at centre, telegraphs an aimed line, then rakes it. */
      { at: 1060, enemy: 'ray', x: CENTRE, y: ENTRY_Y },

      /* Pre-boss squeeze (hardest stretch #2) — assessor heavies drop spirals
         while clerk pairs aim: spiral (punishes standing) + aimed-fan (punishes
         fleeing) = the combination climax before the boss states it as a card. A
         ray pair rakes across it, the swept lane laid over the isotropic one. */
      { at: 1180, enemy: 'assessor', x: 160, y: HEAVY_ENTRY_Y },
      { at: 1180, enemy: 'assessor', x: 320, y: HEAVY_ENTRY_Y },
      { at: 1240, enemy: 'ray', x: 140, y: ENTRY_Y, count: 2, interval: 34, stepX: 200 },
      { at: 1260, enemy: 'clerk', x: LEFT, y: ENTRY_Y, count: 2, interval: 30 },
      { at: 1280, enemy: 'clerk', x: RIGHT, y: ENTRY_Y, count: 2, interval: 30 },
      { at: 1400, enemy: 'assessor', x: CENTRE, y: HEAVY_ENTRY_Y },
      { at: 1460, enemy: 'stele', x: 200, y: ENTRY_Y },

      /* Rest 3 — the big rest. Field clears, a bright stratum seam passes, the
         breath before the final movement. The chancellor enters through the
         top-level `boss` wiring once the waves are spent — the stage-1 grammar,
         NOT a boss wave. A wave naming the stage's own boss sends the whole
         fight twice, dialogue and all: that shipped here (entrances at ticks
         1621 and 7351) and was felt in play before any gate caught it. The
         boss-wave slot is for a *different* midboss, as stage-2 uses it. */
    ],
  },

  /**
   * Stage 4 — the bottom of the descent, and the game's last stage. It is a final
   * exam of trash: each new type re-teaches one earlier stage's lesson and one
   * enemy per prior stage returns as reprise (`grunt`, `lash`, `assessor`). Two
   * facts about the cast shape the placement, as in every prior stage: `marshal`
   * and `notary` plant and then leave upward under their own power, so they are
   * walls only for the ~three seconds they hold; and `usher` falls fast and aims,
   * so its banks are placed to pressure the lanes the walls leave.
   *
   * The regent is the top-level `boss`, sent once the schedule and its 90-tick
   * outro are spent and the field is clear — the STAGE-2 wiring (magistrate), NOT
   * stage-3's, which lists its boss as a wave too. There is no midboss here, so no
   * boss wave belongs in the list. `next: null` makes this the last stage: clearing
   * it raises the ENDING screen (`EndingScreenState`, on `next === undefined`)
   * before the ALL CLEAR results, and the shell crossfades to `adjourn`.
   */
  'stage-4': {
    entry: false,
    seed: 0x4e2a17,
    outro: 90,
    background: 'vault',
    music: 'ordinance',
    boss: 'regent',
    next: null,
    waves: [
      /* Opening — the first law restated in the gold: usher banks from both
         flanks push you off a line (stage-1 sideways), a marshal plants a rotating
         wall behind them (stage-2). Both carry tier blocks, so the opening rises
         strictly easy<normal<hard<lunatic — the difficulty-honesty riser the
         headless assertion measures. */
      { at: 40, enemy: 'usher', x: LEFT, y: ENTRY_Y, count: 3, interval: 40 },
      { at: 80, enemy: 'usher', x: RIGHT, y: ENTRY_Y, count: 3, interval: 40 },
      { at: 220, enemy: 'marshal', x: CENTRE, y: HEAVY_ENTRY_Y },
      { at: 300, enemy: 'usher', x: CENTRE - 70, y: ENTRY_Y, count: 2, interval: 36, stepX: 60 },

      /* Reprise 1 — stage-1's grunt column, the game's oldest chaff returning at
         the source, keeping the beat under the marshal's wall. */
      { at: 420, enemy: 'grunt', x: 120, y: ENTRY_Y, count: 4, interval: 30 },

      /* The notary — the bomb carrier. Dives centrally, pours a spiral and stamps
         its seal: stage-3's rotating-stream-under-a-wall made flesh, and the
         mid-stage bomb the economy test requires. */
      { at: 560, enemy: 'notary', x: 180, y: HEAVY_ENTRY_Y },

      /* Reprise 2 — stage-2's beam from a flank while the notary presses. */
      { at: 640, enemy: 'lash', x: RIGHT, y: ENTRY_Y },

      /* Two marshals wall the top; usher banks sweep the lane between them — the
         moving gap under the herd, stated at volume. */
      { at: 760, enemy: 'marshal', x: 150, y: HEAVY_ENTRY_Y },
      { at: 760, enemy: 'marshal', x: 330, y: HEAVY_ENTRY_Y },
      { at: 840, enemy: 'usher', x: 90, y: ENTRY_Y, count: 3, interval: 30, stepX: 150 },

      /* Reprise 3 — stage-3's assessor, the isotropic spiral that punishes
         standing, a second bomb carrier before the boss states the squeeze. */
      { at: 980, enemy: 'assessor', x: CENTRE, y: HEAVY_ENTRY_Y },
      { at: 1040, enemy: 'usher', x: RIGHT, y: ENTRY_Y, count: 3, interval: 28 },

      /* Pre-boss squeeze — a notary carrier plants beside a marshal wall while
         ushers herd from both flanks: spiral + wall + aimed herd at once, the
         recapitulation at volume before the regent states it as a set of cards. */
      { at: 1180, enemy: 'notary', x: 320, y: HEAVY_ENTRY_Y },
      { at: 1180, enemy: 'marshal', x: 150, y: HEAVY_ENTRY_Y },
      { at: 1260, enemy: 'usher', x: LEFT, y: ENTRY_Y, count: 3, interval: 26 },
      { at: 1280, enemy: 'usher', x: RIGHT, y: ENTRY_Y, count: 3, interval: 26 },

      /* The big rest. Field clears, the gold oculus steadies, the regent enters
         on the downbeat after the outro — the last boss of the game. */
      { at: 1440, enemy: 'grunt', x: CENTRE, y: ENTRY_Y, count: 2, interval: 40 },
    ],
  },
};

/* ================================================================== */
/* Player weapons — shots, options and bombs the roster flies.        */
/*                                                                    */
/* The player side joins the base pack (decisions-round2 §D), the     */
/* counterpart to the campaign port above. scout/lance/hound/spire/maw, */
/* their five shots, four option sets and two bombs left engine       */
/* TypeScript (content/shots.ts, sim/option.ts, sim/bomb.ts,          */
/* game/run.ts); the engine keeps the machinery — the registries, the */
/* OptionSystem/BombSystem, the nesting-invariant checks — and the    */
/* data is authored here. Headings are degrees in the y-down space    */
/* the motion DSL uses: 270 is up, toward the enemy. A shot names the  */
/* `homing` behaviour, engine code the injector resolves by name — a   */
/* pack ships the reference, never the steering.                       */
/* ================================================================== */

/** Straight up: the whole cast fires toward the top of the screen. */
const FORWARD = 270;

/* ---- shot bullet specs ---- */

/**
 * `spread`'s bolt. Power buys coverage, not damage — every tier fires this same
 * bullet and the upgrade is more of them across a wider arc, so a wider fan
 * trades single-target rate for two lanes at once, a decision made with position.
 */
const GUN_BOLT = {
  style: { sprite: 'glow.small.bolt', r: 0.7, g: 0.95, b: 1 },
  radius: 4,
  motion: { r: 9, theta: FORWARD },
  damage: 1,
};

/**
 * `needle`'s pin — the concentrated counterpart to the bolt, every tier straight
 * forward. `radius: 2` is half the painted thickness (the cell is 26x4); `blade`
 * makes the lethal shape the capsule the art already draws.
 */
const GUN_NEEDLE = {
  style: { sprite: 'needle.pin', r: 1, g: 0.85, b: 0.6, orientToHeading: true },
  radius: 2,
  motion: { r: 11, theta: FORWARD },
  damage: 2,
  blade: { length: 26 },
};

/**
 * `homing`'s tracker. The turn is the registered `homing` behaviour (engine
 * code), referenced by name — no options passed, so the behaviour's own defaults
 * decide the rate. Priced against `spread` by fire rate and speed, not damage: a
 * bullet that cannot miss is slower in the air and comes out at half the cadence.
 */
const GUN_SEEKER = {
  style: { sprite: 'scale.tracker', r: 1, g: 0.8, b: 0.5, additive: true, orientToHeading: true },
  radius: 5,
  motion: { r: 7, theta: FORWARD, behaviour: 'homing' },
  damage: 1,
};

/**
 * `laser`'s beam. `r: 0`, so the muzzle stays where it was fired and the bullet
 * is purely its own length — sweeping is walking the emitter along a row while
 * the beams already in the air keep burning. `life` is not optional: a stationary
 * bullet the offscreen cull can never reach would sit in the field forever.
 * `growth` costs the first ticks of reach, so point-blank fire is immediate while
 * a distant target must be held; `pierce` stops the beam being spent on the first
 * enemy it touches. Per tier the beam gains duration and reach, never muzzles —
 * one emitter at every tier, so the nesting invariant holds by construction.
 */
const GUN_BEAM = {
  // `beam.cyan` — the player's beam wears the cyan whole-beam laser skin, shared
  // with magistrate's `COLUMN_CYAN` (baked colour, and `faction` is a bullet
  // field not a skin field, so one skin serves both a player and an enemy beam).
  // This retires the old `glow.small.beam` bullet-cell name; its stale entry in
  // `tools/bulletpack-map.json` is repointed in the same round (design §F).
  style: { sprite: 'beam.cyan', r: 0.85, g: 0.7, b: 1, additive: true, orientToHeading: true },
  radius: 3,
  motion: { r: 0, theta: FORWARD },
  damage: 1,
  laser: { length: 48, growth: 90, maxLength: 520 },
  pierce: true,
};

/**
 * `scatter`'s ember pellet — MAW's whole design in one field. `life: 18` is the
 * leash: at `r: 8` the pellet reaches 8*18 = 144px and evaporates, so full damage
 * lands inside the ~140px pocket and nothing survives to a top-stationed boss.
 * `radius: 8` is fat and forgiving up close. Ember tint + additive distinguishes
 * it from `spread`'s cool bolt with no new art.
 */
const SCATTER_PELLET = {
  style: { sprite: 'glow.small.spray', r: 1, g: 0.55, b: 0.3, additive: true },
  radius: 8,
  motion: { r: 8, theta: FORWARD },
  damage: 1,
  life: 18,
};

/* ---- player per-tier shot SKINS (战役扩容轮) ----
 * A shot that names a different sprite per power tier grows visibly as the run
 * climbs (`Player.#shot()` indexes `levels[floor(power)]`). Each of these is the
 * base spec with ONLY `style.sprite` changed — radius, damage, motion, blade and
 * life are byte-identical, so the sim reads the same numbers and the golden replay
 * trace does NOT move (a sprite is presentation; the sim never reads a cell). The
 * names floor a growing ladder in `procedural.ts` and bake the BulletPack Cian /
 * Pink / misc art in `tools/bulletpack-map.json`. NO existing skin is displaced:
 * every t0 keeps its backer, and these fill only the tiers that were duplicate or
 * an aliased floor. Player draw-size is presentation, not a fairness surface (the
 * player does not dodge its own bullets), so `bolt.hyper` may read big — its 48px
 * native art is only capped by `style.width/height` to stay tasteful, not honest.
 */
const BOLT_T1 = { ...GUN_BOLT, style: { ...GUN_BOLT.style, sprite: 'glow.medium.bolt' } };
const BOLT_T2 = { ...GUN_BOLT, style: { ...GUN_BOLT.style, sprite: 'glow.large.bolt' } };
const BOLT_HYPER = { ...GUN_BOLT, style: { ...GUN_BOLT.style, sprite: 'bolt.hyper', width: 30, height: 18 } };
const NEEDLE_T1 = { ...GUN_NEEDLE, style: { ...GUN_NEEDLE.style, sprite: 'needle.pin.t0' } };
const NEEDLE_T2 = { ...GUN_NEEDLE, style: { ...GUN_NEEDLE.style, sprite: 'needle.pin.t1' } };
const NEEDLE_T3 = { ...GUN_NEEDLE, style: { ...GUN_NEEDLE.style, sprite: 'needle.pin.t2' } };
const SEEKER_T2 = { ...GUN_SEEKER, style: { ...GUN_SEEKER.style, sprite: 'scale.chase' } };
const SEEKER_T3 = { ...GUN_SEEKER, style: { ...GUN_SEEKER.style, sprite: 'scale.chase.hi' } };
const SPRAY_T1 = { ...SCATTER_PELLET, style: { ...SCATTER_PELLET.style, sprite: 'glow.small.spray.t1' } };
const SPRAY_T2 = { ...SCATTER_PELLET, style: { ...SCATTER_PELLET.style, sprite: 'glow.small.spray.t2' } };
const SPRAY_T3 = { ...SCATTER_PELLET, style: { ...SCATTER_PELLET.style, sprite: 'glow.small.spray.t3' } };

// `scatter`'s two muzzle roles. CENTRAL bolts fire dead-ahead and carry every
// measured single-target hit; CHEEK pairs fan wide enough to miss a point target
// at 100px (past the 12+8 tolerance) — pure coverage, ~0 measured DPS. The free
// floor rests only on the central set, so it does not depend on where the target
// is. CENTRAL is a fixed superset across tiers (only the period tightens); CHEEK
// pairs are added outward, so the muzzle set nests by construction.
const CENTRAL_PAIR = [
  { x: -5, y: -10, angle: FORWARD },
  { x: 5, y: -10, angle: FORWARD },
];
const CENTRAL_MID = [{ x: 0, y: -10, angle: FORWARD }];
const CHEEK_A = [
  { x: -10, y: -6, angle: FORWARD - 16 },
  { x: 10, y: -6, angle: FORWARD + 16 },
];
const CHEEK_B = [
  { x: -12, y: -4, angle: FORWARD - 26 },
  { x: 12, y: -4, angle: FORWARD + 26 },
];
const CHEEK_C = [
  { x: -14, y: -2, angle: FORWARD - 36 },
  { x: 14, y: -2, angle: FORWARD + 36 },
];

/** `spread`'s muzzles: a parallel pair, then symmetric angled bolts mirrored. */
function fan(spread: readonly number[]): Record<string, unknown>[] {
  const offsets: Record<string, unknown>[] = [
    { x: -6, y: -10, angle: FORWARD },
    { x: 6, y: -10, angle: FORWARD },
  ];
  for (const degrees of spread) {
    offsets.push({ x: -10, y: -6, angle: FORWARD - degrees });
    offsets.push({ x: 10, y: -6, angle: FORWARD + degrees });
  }
  return offsets;
}

/** `needle`'s muzzles: the centre, then symmetric pairs at 9px steps outward. */
function rake(pairs: number): Record<string, unknown>[] {
  const offsets: Record<string, unknown>[] = [{ x: 0, y: -12, angle: FORWARD }];
  for (let i = 1; i <= pairs; i++) {
    offsets.push({ x: -9 * i, y: -12, angle: FORWARD });
    offsets.push({ x: 9 * i, y: -12, angle: FORWARD });
  }
  return offsets;
}

/** `laser`'s single emitter, shared by every tier so nesting is not a claim. */
const MUZZLE = [{ x: 0, y: -12, angle: FORWARD }];

const shots: PackContent['shots'] = {
  // Each tier's muzzle set ⊇ the tier below's and its period ≤ the tier below's —
  // the nesting invariant the engine's `shots.test.ts` enforces for every weapon.
  // It makes "a stronger tier deals less against some geometry" unrepresentable.
  spread: {
    description: 'parallel bolts that fan wider with each power tier',
    levels: [
      { spec: GUN_BOLT, offsets: fan([]), period: 5, focusOffsets: [...CENTRAL_PAIR], focusPeriod: 5 },
      { spec: BOLT_T1, offsets: fan([7]), period: 5, focusOffsets: rake(1), focusPeriod: 5 },
      { spec: BOLT_T2, offsets: fan([7, 15]), period: 4, focusOffsets: rake(2), focusPeriod: 5 },
      // 7 and 15 again, not re-spaced: a different muzzle set can be a worse one.
      { spec: BOLT_HYPER, offsets: fan([7, 15, 26]), period: 4, focusOffsets: rake(3), focusPeriod: 5 },
    ],
  },
  needle: {
    description: 'parallel needles; concentration instead of coverage',
    levels: [
      { spec: GUN_NEEDLE, offsets: rake(0), period: 6, focusSpec: { ...GUN_NEEDLE }, focusOffsets: rake(0), focusPeriod: 5 },
      { spec: NEEDLE_T1, offsets: rake(1), period: 6, focusSpec: { ...NEEDLE_T1 }, focusOffsets: rake(1), focusPeriod: 6 },
      { spec: NEEDLE_T2, offsets: rake(2), period: 6, focusSpec: { ...NEEDLE_T2 }, focusOffsets: rake(2), focusPeriod: 6 },
      { spec: NEEDLE_T3, offsets: rake(3), period: 6, focusSpec: { ...NEEDLE_T3 }, focusOffsets: rake(3), focusPeriod: 6 },
    ],
  },
  homing: {
    description: 'slow tracking shot; trades rate and speed for never missing',
    levels: [
      { spec: GUN_SEEKER, offsets: [{ x: 0, y: -12, angle: FORWARD }], period: 9, focusSpec: { ...GUN_SEEKER }, focusOffsets: [{ x: 0, y: -14, angle: FORWARD }], focusPeriod: 7 },
      {
        spec: GUN_SEEKER,
        offsets: [
          { x: -7, y: -10, angle: FORWARD },
          { x: 7, y: -10, angle: FORWARD },
        ],
        period: 9, focusSpec: { ...GUN_SEEKER }, focusOffsets: rake(0), focusPeriod: 7,
      },
      {
        spec: SEEKER_T2,
        offsets: [
          { x: -7, y: -10, angle: FORWARD },
          { x: 7, y: -10, angle: FORWARD },
          { x: 0, y: -14, angle: FORWARD },
        ],
        period: 8, focusSpec: { ...SEEKER_T2 }, focusOffsets: rake(1), focusPeriod: 8,
      },
      {
        spec: SEEKER_T3,
        offsets: [
          { x: -10, y: -8, angle: FORWARD - 6 },
          { x: -4, y: -12, angle: FORWARD },
          { x: 4, y: -12, angle: FORWARD },
          { x: 10, y: -8, angle: FORWARD + 6 },
        ],
        period: 8, focusSpec: { ...SEEKER_T3 }, focusOffsets: rake(1), focusPeriod: 7,
      },
    ],
  },
  laser: {
    description: 'stationary piercing beam; reach instead of a spread',
    levels: [
      // One muzzle at every tier; the tiers buy duration (life) and reach (growth),
      // going from a strobe to an unbroken beam, never more emitters.
      { spec: { ...GUN_BEAM, life: 3 }, offsets: MUZZLE, period: 6, focusSpec: { ...GUN_BEAM, life: 4 }, focusOffsets: MUZZLE, focusPeriod: 6 },
      { spec: { ...GUN_BEAM, life: 4 }, offsets: MUZZLE, period: 6, focusSpec: { ...GUN_BEAM, life: 5 }, focusOffsets: MUZZLE, focusPeriod: 6 },
      { spec: { ...GUN_BEAM, life: 5 }, offsets: MUZZLE, period: 6, focusSpec: { ...GUN_BEAM, life: 6 }, focusOffsets: MUZZLE, focusPeriod: 6 },
      { spec: { ...GUN_BEAM, life: 6, laser: { ...GUN_BEAM.laser, growth: 120 } }, offsets: MUZZLE, period: 5, focusSpec: { ...GUN_BEAM, life: 7, laser: { ...GUN_BEAM.laser, growth: 140 } }, focusOffsets: MUZZLE, focusPeriod: 5 },
    ],
  },
  // MAW's gun: the inverse of `laser`. Reach is capped by the pellet's `life`
  // (144px), not bought back — power adds cheek coverage and tightens the period,
  // never range. Central muzzles are a fixed superset (2 then 3), so the nesting
  // invariant holds; the widening cheeks miss a point target on purpose.
  scatter: {
    description: 'point-blank ember spray that evaporates past the pocket',
    levels: [
      { spec: SCATTER_PELLET, offsets: [...CENTRAL_PAIR], period: 6, focusSpec: { ...SCATTER_PELLET }, focusOffsets: [...CENTRAL_MID], focusPeriod: 3 },
      { spec: SPRAY_T1, offsets: [...CENTRAL_PAIR, ...CENTRAL_MID, ...CHEEK_A], period: 6, focusSpec: { ...SPRAY_T1 }, focusOffsets: [...CENTRAL_PAIR, ...CENTRAL_MID], focusPeriod: 5 },
      { spec: SPRAY_T2, offsets: [...CENTRAL_PAIR, ...CENTRAL_MID, ...CHEEK_A, ...CHEEK_B], period: 5, focusSpec: { ...SPRAY_T2 }, focusOffsets: [...CENTRAL_PAIR, ...CENTRAL_MID], focusPeriod: 4 },
      { spec: SPRAY_T3, offsets: [...CENTRAL_PAIR, ...CENTRAL_MID, ...CHEEK_A, ...CHEEK_B, ...CHEEK_C], period: 4, focusSpec: { ...SPRAY_T3 }, focusOffsets: [...CENTRAL_PAIR, ...CENTRAL_MID], focusPeriod: 3 },
    ],
  },
};

/* ---- option bullet specs ---- */

/** Option fire is weaker per bullet than the ship's own — options multiply shot count. */
const OPT_STD_SHOT = {
  style: { sprite: 'orb.small.satellite', r: 0.75, g: 0.9, b: 1, additive: true },
  radius: 4,
  motion: { r: 11, theta: FORWARD },
  damage: 1,
};

const OPT_SEEKER_SHOT = {
  style: { sprite: 'scale.satellite', r: 1, g: 0.8, b: 0.5, additive: true, orientToHeading: true },
  radius: 5,
  motion: { r: 9, theta: FORWARD },
  damage: 1,
};

const OPT_PICKET_SHOT = {
  style: { sprite: 'orb.small.battery', r: 0.7, g: 0.9, b: 1, additive: true },
  radius: 4,
  motion: { r: 11, theta: FORWARD },
  damage: 1,
};

// Each tier keeps the tier below's slots and adds a pair — the option-layout twin
// of the shot nesting invariant (sim/option.ts holds every set to it). These fire
// straight forward, so a re-placed slot moves its column off the target.
const STD_INNER = [
  { x: -26, y: 6, focusX: -11, focusY: -10, angle: FORWARD },
  { x: 26, y: 6, focusX: 11, focusY: -10, angle: FORWARD },
];
const STD_FORWARD = [
  { x: -18, y: -16, focusX: -7, focusY: -24, angle: FORWARD },
  { x: 18, y: -16, focusX: 7, focusY: -24, angle: FORWARD },
];
const STD_OUTER = [
  { x: -44, y: 14, focusX: -16, focusY: -4, angle: FORWARD },
  { x: 44, y: 14, focusX: 16, focusY: -4, angle: FORWARD },
];

// `picket` is the only formation armed at power 0 — the `homing` gun cannot carry
// a bare ship, so `hound` needs a battery from the start. Period 4 is the fastest
// in the game, keeping the slow gun's ship in the fight between volleys. NOSE and
// INNER gather under focus; MID and OUTER stay wide — coverage, not concentration.
const PICKET_NOSE = [{ x: 0, y: -22, focusX: 0, focusY: -28, angle: FORWARD }];
const PICKET_INNER = [
  { x: -22, y: -6, focusX: -8, focusY: -20, angle: FORWARD },
  { x: 22, y: -6, focusX: 8, focusY: -20, angle: FORWARD },
];
const PICKET_MID = [
  { x: -40, y: 8, focusX: -22, focusY: -6, angle: FORWARD },
  { x: 40, y: 8, focusX: 22, focusY: -6, angle: FORWARD },
];
const PICKET_OUTER = [
  { x: -58, y: 18, focusX: -36, focusY: 6, angle: FORWARD },
  { x: 58, y: 18, focusX: 36, focusY: 6, angle: FORWARD },
];

/**
 * `clinch`'s battery bullet — the option twin of `scatter`'s leash. `life: 20`
 * reaches ~180px, a hair past the gun but still inside the pocket, so no chip
 * damage sneaks out to a distant boss. Ember tint to match MAW's spray.
 */
const CLINCH_SHOT = {
  style: { sprite: 'orb.small.clinch', r: 1, g: 0.55, b: 0.3, additive: true },
  radius: 9,
  motion: { r: 9, theta: FORWARD },
  damage: 1,
  life: 20,
};

// `clinch`'s slots fire straight up: wide when loose (each |x| ≥ 34 keeps the
// column off a point target past the 21px tolerance → ~0 free DPS) and clinched
// to the nose under focus (each |focusX| ≤ 10 < 21 → hits). The free/focus DPS
// split is the whole formation. Each tier keeps the pair below and adds one, and
// the same focus values are reused, so the option nesting invariant holds.
const CLINCH_PAIR_A = [
  { x: -34, y: 2, focusX: -6, focusY: -10, angle: FORWARD },
  { x: 34, y: 2, focusX: 6, focusY: -10, angle: FORWARD },
];
const CLINCH_PAIR_B = [
  { x: -50, y: 10, focusX: -10, focusY: -6, angle: FORWARD },
  { x: 50, y: 10, focusX: 10, focusY: -6, angle: FORWARD },
];
const CLINCH_PAIR_C = [
  { x: -62, y: 16, focusX: -4, focusY: -14, angle: FORWARD },
  { x: 62, y: 16, focusX: 4, focusY: -14, angle: FORWARD },
];

const options: PackContent['options'] = {
  // The default: fixed forward fire, wide when loose and stacked under focus. Tier
  // 0 is empty — the bare ship, so the first power-up has something to give.
  standard: {
    sprite: 'orb.medium',
    shot: OPT_STD_SHOT,
    period: 5,
    followSpeed: 1.6,
    levels: [
      [],
      [...STD_INNER],
      [...STD_INNER, ...STD_FORWARD],
      [...STD_INNER, ...STD_FORWARD, ...STD_OUTER],
    ],
  },
  // Every slot aims, so nothing is wasted on empty sky, but the shot is slower and
  // the satellites trail badly — the cost of the tracking.
  seeker: {
    sprite: 'ring',
    shot: OPT_SEEKER_SHOT,
    period: 8,
    followSpeed: 0.9,
    tint: { r: 1, g: 0.85, b: 0.6 },
    levels: [
      [],
      [{ x: 0, y: -30, focusX: 0, focusY: -22 }],
      [
        { x: -30, y: 0, focusX: -12, focusY: -18 },
        { x: 30, y: 0, focusX: 12, focusY: -18 },
      ],
      [
        { x: -36, y: 4, focusX: -14, focusY: -14 },
        { x: 36, y: 4, focusX: 14, focusY: -14 },
        { x: 0, y: -34, focusX: 0, focusY: -30 },
      ],
    ],
  },
  // SPIRE's anchored lenses stay on a vertical rail. Loose play leaves them
  // behind the ship as delayed repeaters; focus stacks them into the planted beam.
  spire: {
    sprite: 'ring',
    shot: { ...OPT_STD_SHOT, style: { ...OPT_STD_SHOT.style, sprite: 'orb.small.satellite', r: 0.78, g: 0.62, b: 1 } },
    period: 7,
    followSpeed: 0.55,
    tint: { r: 0.82, g: 0.65, b: 1 },
    levels: [
      [],
      [{ x: 0, y: 30, focusX: 0, focusY: -20, angle: FORWARD }],
      [
        { x: 0, y: 30, focusX: 0, focusY: -20, angle: FORWARD },
        { x: 0, y: 52, focusX: 0, focusY: -34, angle: FORWARD },
      ],
      [
        { x: 0, y: 30, focusX: 0, focusY: -20, angle: FORWARD },
        { x: 0, y: 52, focusX: 0, focusY: -34, angle: FORWARD },
        { x: 0, y: 74, focusX: 0, focusY: -48, angle: FORWARD },
      ],
    ],
  },
  picket: {
    sprite: 'orb.medium',
    shot: OPT_PICKET_SHOT,
    period: 4,
    followSpeed: 1.8,
    tint: { r: 0.75, g: 0.9, b: 1 },
    // 1 / 3 / 5 / 7 slots, each tier the one below plus a pair, nothing re-placed.
    levels: [
      [...PICKET_NOSE],
      [...PICKET_NOSE, ...PICKET_INNER],
      [...PICKET_NOSE, ...PICKET_INNER, ...PICKET_MID],
      [...PICKET_NOSE, ...PICKET_INNER, ...PICKET_MID, ...PICKET_OUTER],
    ],
  },
  // MAW's battery: dead at range like the ship. 0 / 2 / 4 / 6 slots, each tier the
  // pair below plus one. The deliberately slow period (12) holds p3-focused under
  // the max rail; the wide-loose / clinched-focus split is the whole free/focus gap.
  clinch: {
    sprite: 'orb.medium',
    shot: CLINCH_SHOT,
    period: 12,
    followSpeed: 1.4,
    tint: { r: 1, g: 0.55, b: 0.3 },
    levels: [
      [],
      [...CLINCH_PAIR_A],
      [...CLINCH_PAIR_A, ...CLINCH_PAIR_B],
      [...CLINCH_PAIR_A, ...CLINCH_PAIR_B, ...CLINCH_PAIR_C],
    ],
  },
};

const bombs: PackContent['bombs'] = {
  // The default: covers the screen, converts everything it eats, modest damage —
  // its real payment is the clear.
  'scout-tide': {
    duration: 90,
    invulnTicks: 150,
    damagePerTick: 2,
    convertBullets: true,
    effect: 'death.big',
  },
  // The trade: half the coverage and no conversion, for four times the damage.
  // Fired point-blank into a boss it is a damage cooldown, not an escape.
  'lance-pierce': {
    duration: 60,
    invulnTicks: 90,
    damagePerTick: 8,
    radius: 96,
    effect: 'explosion',
  },
  'hound-pack': {
    duration: 120,
    invulnTicks: 150,
    damagePerTick: 2,
    radius: 180,
    convertBullets: true,
    effect: 'burst',
  },
  'spire-field': {
    duration: 75,
    invulnTicks: 110,
    damagePerTick: 5,
    radius: 128,
    effect: 'burst.big',
  },
  'maw-devour': {
    duration: 48,
    invulnTicks: 90,
    damagePerTick: 11,
    radius: 78,
    convertBullets: true,
    effect: 'missile.pop.big',
  },
};

/* ================================================================== */
/* Characters — the SELECT roster.                                    */
/*                                                                    */
/* Registered in this order, which is the order SELECT offers them.   */
/* A character names its shot/options/bomb; the injector resolves the  */
/* references (pack-first, then built-in) and fills `player.shots`.    */
/* Every ship names 'ship' — the only region the placeholder generator */
/* paints — and starts at field centre (480x640 → 240, 568).          */
/* ================================================================== */

const characters: PackContent['characters'] = {
  // Even fire, forgiving. The generalist the other three are measured against.
  scout: {
    label: 'SCOUT',
    sprite: 'ship',
    blurb: 'even fire, wide bomb',
    shot: 'spread',
    options: 'standard',
    bomb: 'scout-tide',
    player: {
      x: 240, y: 568, speed: 3.6, focusSpeed: 1.5,
      // Lethal radius against a 40px sprite. That ratio is the genre.
      radius: 2.5, grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90,
    },
  },
  // Slower and more fragile, in exchange for options that do the aiming.
  lance: {
    label: 'LANCE',
    sprite: 'ship',
    blurb: 'homing options, focused bomb',
    shot: 'needle',
    options: 'seeker',
    bomb: 'lance-pierce',
    player: {
      x: 240, y: 568, speed: 3.1, focusSpeed: 1.2,
      radius: 2.5, grazeRadius: 24, lives: 2, bombs: 3, invulnTicks: 90,
    },
  },
  // A wide self-aiming gun and a hand-aimed battery — the exact inversion of
  // lance (narrow gun, all-round options). Slowest ship, fastest focus: the gun
  // keeps 98% of its rate at a 32° bearing, so movement aims nothing and focus is
  // where the fixed-forward `picket` is walked onto a target. The odd 3/2 stock
  // pays for the game's longest fights in lives and charges them in bombs.
  hound: {
    label: 'HOUND',
    sprite: 'ship',
    blurb: 'self-aiming gun, hand-aimed options',
    shot: 'homing',
    options: 'picket',
    bomb: 'hound-pack',
    player: {
      x: 240, y: 568, speed: 2.9, focusSpeed: 1.6,
      radius: 2.5, grazeRadius: 26, lives: 3, bombs: 2, invulnTicks: 90,
    },
  },
  // Commitment and reach: the beam cannot be turned, so every change of target is
  // a change of position and power buys range, not rate. Fastest ship (it crosses
  // the field instead of turning), slowest focus (the width of its correction
  // window in ticks), largest hitbox and graze (it is paid for standing still).
  spire: {
    label: 'SPIRE',
    sprite: 'ship',
    blurb: 'planted beam, point-blank bomb',
    shot: 'laser',
    options: 'spire',
    bomb: 'spire-field',
    player: {
      x: 240, y: 568, speed: 4.2, focusSpeed: 1,
      radius: 2.5, grazeRadius: 28, lives: 2, bombs: 3, invulnTicks: 90,
    },
  },
  // Aggression is the only setting: the inverse of spire (reach traded for up-close
  // rate). The `scatter` gun dies by ~165px and the `clinch` battery by ~205px
  // (pellet travel 144px / 180px plus bullet+target radii), so every other ship can
  // snipe from the floor and MAW cannot — it must fly up into the ~140px full-damage
  // pocket, where the pattern is densest, to deal any damage. Largest graze
  // (30) turns that forced proximity into score; most bombs (4) let it spend the
  // point-blank `lance` and expect refills from drops — but only if it stays close.
  // Lives 2: it lives dangerous.
  maw: {
    label: 'MAW',
    sprite: 'ship',
    blurb: 'point-blank spray, graze-fed',
    shot: 'scatter',
    options: 'clinch',
    bomb: 'maw-devour',
    player: {
      x: 240, y: 568, speed: 3.9, focusSpeed: 1.4,
      radius: 2.5, grazeRadius: 30, lives: 2, bombs: 4, invulnTicks: 90,
    },
  },
};

/* ================================================================== */
/* Manifest assembly                                                  */
/* ================================================================== */

const CONTENT: PackContent = { enemies, bosses, stages, shots, options, bombs, characters };

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
  requires: [
    'content.enemies',
    'content.stages',
    'content.bosses',
    'content.shots',
    'content.characters',
    'content.options',
    'content.bombs',
  ],
  content: CONTENT,
};

/**
 * The canonical JSON text of the base pack — the single source both the
 * generator (which writes it to disk) and the drift test (which byte-compares
 * it against the checked-in file) read, so they cannot disagree. Validated
 * through the real `validateManifest` first: this generator cannot emit a pack
 * its own validator would reject.
 */
export function buildV4ContentJson(): string {
  const result = validateManifest(MANIFEST, MANIFEST.name);
  if ('errors' in result) {
    throw new Error(`make-v4-content: manifest is invalid:\n  ${result.errors.join('\n  ')}`);
  }
  return JSON.stringify(MANIFEST, null, 2) + '\n';
}

/** The checked-in path the generator writes and the drift test reads. */
export const V4_CONTENT_PATH = fileURLToPath(
  new URL('../src/v4/content/campaign.json', import.meta.url),
);

/**
 * The generated fingerprint module's text: a SHA-256 of the v4 campaign JSON
 * bytes, truncated to 12 hex exactly like `hashPack`, wrapped in one exported
 * constant. Derived from `buildV4ContentJson()` so the two artifacts are
 * fingerprint-of-content by construction — the hash can never describe an older
 * JSON than the one shipped beside it. This is the base content's identity in
 * replay meta (`RunConfig.contentFingerprint`): a recording pins it, and a
 * later engine whose bundled content has drifted meets a different hash and is
 * refused rather than silently replaying under content it was not recorded on.
 */
export function buildV4ContentFingerprint(): string {
  const fingerprint = createHash('sha256').update(buildV4ContentJson()).digest('hex').slice(0, 12);
  return (
    `// GENERATED by tools/make-v4-content.ts — do not edit; run \`bun tools/make-v4-content.ts\`.\n` +
    `// SHA-256 of src/v4/content/campaign.json (first 12 hex), the bundled v4\n` +
    `// content's identity in replay meta (see RunConfig.contentFingerprint in\n` +
    `// src/game/run.ts). tools/make-v4-content.test.ts byte-diffs it against the\n` +
    `// generator, so it cannot silently disagree with the JSON it fingerprints.\n` +
    `export const CONTENT_FINGERPRINT = '${fingerprint}';\n`
  );
}

/** The checked-in path of the generated fingerprint module. */
export const V4_CONTENT_FINGERPRINT_PATH = fileURLToPath(
  new URL('../src/v4/content/campaign.fingerprint.ts', import.meta.url),
);

if (import.meta.main) {
  const text = buildV4ContentJson();
  const fingerprint = buildV4ContentFingerprint();
  mkdirSync(fileURLToPath(new URL('../src/v4/content/', import.meta.url)), { recursive: true });
  writeFileSync(V4_CONTENT_PATH, text);
  writeFileSync(V4_CONTENT_FINGERPRINT_PATH, fingerprint);
  // eslint-disable-next-line no-console
  console.log(`wrote ${V4_CONTENT_PATH} (${text.length} bytes)`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${V4_CONTENT_FINGERPRINT_PATH} (${fingerprint.length} bytes)`);
}
