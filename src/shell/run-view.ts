import type { Run } from '../game/run';
import { getItemSpec, itemNames } from '../sim/item';
import {
  ACTOR_PAD_CELL,
  actorPadLayout,
  type ActorPadRole,
} from '../render/actor-pad';
import type { Atlas } from '../render/atlas';
import { beamLayout } from '../render/beam';
import { bossFeedbackLayout } from '../render/boss-feedback';
import {
  visibleBossCastFx,
  type BossCastFx,
} from '../render/boss-cast-fx';
import {
  visibleBossIdentityFx,
  type BossIdentityFx,
} from '../render/boss-identity-fx';
import { bladeDisplaySize } from '../render/bullet-geometry';
import { getLaserSkin } from '../render/laser-skin';
import { tintFor } from '../render/portrait';
import { laserBodyDisplayThickness } from '../render/procedural';
import type { SpriteBatch } from '../render/sprite-batch';
import { stripFrame } from '../render/strip';
import {
  V4_BOSS_ACTORS,
  V4_ENEMY_ACTORS,
  V4_PLAYER_ACTORS,
  v4BossPoseFrame,
  v4EnemyPoseFrame,
  v4PlayerBankFrame,
  type V4ActorAtlases,
} from '../render/v4-actors';

export type RunViewBatchName =
  | 'actorEnemyPads'
  | 'enemies'
  | 'actorEnemies'
  | 'actorBosses'
  | 'items'
  | 'actorPlayerPads'
  | 'player'
  | 'actorPlayer'
  | 'options'
  | 'optionsFx'
  | 'playerFx'
  | 'playerShots'
  | 'enemyShots'
  | 'enemyShotsAdditive'
  | 'missiles'
  | 'effects'
  | 'bursts'
  | 'burstsBack'
  | 'itemGlow'
  | 'pickups'
  | 'beamBodies'
  | 'beamCaps'
  | 'bombFx'
  | 'bossBodyFx'
  | 'bossDeathFx';

export type RunViewBatches = Readonly<Record<RunViewBatchName, SpriteBatch>>;

interface DrawStripStyle {
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
  readonly rotation?: number;
  readonly r?: number;
  readonly g?: number;
  readonly b?: number;
  readonly a?: number;
}

export interface RunViewDependencies {
  readonly batches: RunViewBatches;
  readonly bulletAtlas: Atlas;
  readonly shipAtlas: Atlas;
  readonly fxAtlas: Atlas;
  readonly laserAtlas: Atlas;
  readonly missileAtlas: Atlas;
  readonly pickupAtlas: Atlas;
  readonly v4Actors: V4ActorAtlases;
  readonly hasPackShipLayer: boolean;
  readonly usesFiveWayShipBanking: boolean;
}

export interface RunViewFrame {
  readonly runs: readonly Run[];
  readonly bossCastFx: readonly BossCastFx<Run>[];
  readonly bossIdentityFx: readonly BossIdentityFx<Run>[];
}

export interface RunView {
  draw(frame: RunViewFrame): void;
}

/**
 * Draw the current fixed-tick Run into shell-owned sprite batches.
 *
 * All atlases, batches, and presentation queues remain owned by `main.ts`.
 * This view receives references and a per-frame Run snapshot; it neither ticks
 * simulation nor creates mutable lifecycle state.
 */
export function createRunView(deps: RunViewDependencies): RunView {
  const {
    batches,
    bulletAtlas,
    shipAtlas,
    fxAtlas,
    laserAtlas,
    missileAtlas,
    pickupAtlas,
    v4Actors,
    hasPackShipLayer,
    usesFiveWayShipBanking,
  } = deps;

  /**
   * Resolve both the fixed-tick strip frame and its engine display geometry.
   * Every animated entity draw site routes through this helper.
   */
  function drawStrip(
    batch: SpriteBatch,
    atlas: Atlas,
    x: number,
    y: number,
    name: string,
    age: number,
    style: DrawStripStyle = {},
  ): void {
    const strip = atlas.strip(name);
    const region = atlas.frameOf(strip, stripFrame(strip, age));
    const scale = style.scale ?? 1;
    const width = (
      style.width
      ?? strip.displayW
      ?? strip.frameW
    ) * scale;
    const height = (
      style.height
      ?? strip.displayH
      ?? strip.frameH
    ) * scale;
    batch.draw(x, y, region, {
      rotation: style.rotation,
      width,
      height,
      r: style.r,
      g: style.g,
      b: style.b,
      a: style.a,
    });
  }

  function drawPose(
    batch: SpriteBatch,
    atlas: Atlas,
    x: number,
    y: number,
    name: string,
    frame: number,
    style: {
      width?: number;
      height?: number;
      r?: number;
      g?: number;
      b?: number;
      a?: number;
    } = {},
  ): void {
    const strip = atlas.strip(name);
    batch.draw(x, y, atlas.frameOf(strip, frame), {
      width: style.width ?? strip.displayW ?? strip.frameW,
      height: style.height ?? strip.displayH ?? strip.frameH,
      r: style.r,
      g: style.g,
      b: style.b,
      a: style.a,
    });
  }

  /** Draw one bounded normal-blend darkness plate immediately behind a v4 actor. */
  function drawActorPad(
    batch: SpriteBatch,
    role: ActorPadRole,
    x: number,
    y: number,
    actorSize: number,
    alphaScale = 1,
  ): void {
    const pad = actorPadLayout(role, actorSize);
    batch.draw(x, y, ACTOR_PAD_CELL, {
      width: pad.width,
      height: pad.height,
      a: pad.alpha * alphaScale,
    });
  }

  /**
   * Resolve the instance tint for one named strip.
   *
   * A tinted strip is white art whose colour comes from content, so it keeps the
   * authored tint. A baked strip already carries its final colour in its texels and
   * therefore draws identity-white.
   */
  function stripTint(
    atlas: Atlas,
    name: string,
    tint?: { r?: number; g?: number; b?: number },
  ): { r: number; g: number; b: number } {
    const source = atlas.strip(name).color === 'baked' ? undefined : tint;
    return {
      r: source?.r ?? 1,
      g: source?.g ?? 1,
      b: source?.b ?? 1,
    };
  }

  function drawRun(
    run: Run,
    bossCastFx: readonly BossCastFx<Run>[],
  ): void {
    for (const e of run.enemies.enemies) {
      const actor = V4_ENEMY_ACTORS[e.name];
      const actorAtlas = v4Actors.enemies;
      if (actor !== undefined && actorAtlas?.has(actor.strip)) {
        // Women are the positive form; their projectile vocabulary remains on the
        // selected art pack, project-owned v4 by default. The two breathing frames
        // yield to attack/recover only after the sim reports a successful volley.
        // Never rotate a person by
        // her movement angle: the authored front three-quarter silhouette is part
        // of the safe-space grammar.
        drawActorPad(batches.actorEnemyPads, 'enemy', e.x, e.y, actor.size);
        drawPose(
          batches.actorEnemies,
          actorAtlas,
          e.x,
          e.y,
          actor.strip,
          v4EnemyPoseFrame(e.age, e.ticksSinceFire),
          { width: actor.size, height: actor.size, r: 0.86, g: 0.86, b: 0.86 },
        );
        continue;
      }
      // Law of Animation: the frame resolves off `e.age` (enemy.ts sets it, 0 at
      // spawn, tick-advanced) so a multi-frame enemy strip (clerk/hunter/ray) cycles
      // instead of freezing on frame 0 — the primary bug the user reported. Size
      // stays SPEC-driven: `spec.width/height` override any `displayW`, because an
      // enemy's size is its spec and the cell is only its skin.
      const tint = stripTint(bulletAtlas, e.spec.sprite, e.spec.tint);
      drawStrip(batches.enemies, bulletAtlas, e.x, e.y, e.spec.sprite, e.age, {
        rotation: e.angle,
        width: e.spec.width,
        height: e.spec.height,
        ...tint,
      });
    }

    const boss = run.boss.boss;
    if (boss?.alive) {
      const feedback = bossFeedbackLayout({
        hpFraction: boss.phaseHpFraction,
        phaseTicks: boss.phaseTicks,
        impactKind: boss.impact?.kind,
        impactFraction: boss.impactFraction,
        direction8: boss.impact?.direction8,
      });
      const drawX = boss.x + feedback.recoilX;
      const drawY = boss.y + feedback.recoilY;
      const candidateActor = V4_BOSS_ACTORS[boss.name];
      const actorAtlas = v4Actors.bosses;
      const actor =
        candidateActor !== undefined && actorAtlas?.has(candidateActor.strip)
          ? candidateActor
          : undefined;
      const legacyStrip = actor === undefined ? bulletAtlas.strip(boss.spec.sprite) : undefined;
      const bodyWidth = actor?.size
        ?? boss.spec.width
        ?? legacyStrip?.displayW
        ?? legacyStrip?.frameW
        ?? boss.spec.radius * 2;
      const bodyHeight = actor?.size
        ?? boss.spec.height
        ?? legacyStrip?.displayH
        ?? legacyStrip?.frameH
        ?? boss.spec.radius * 2;
      if (actor !== undefined) {
        const size = actor.size * feedback.bodyScale;
        drawActorPad(batches.actorEnemyPads, 'boss', boss.x, boss.y, actor.size);
        drawPose(
          batches.actorBosses,
          actorAtlas!,
          drawX,
          drawY,
          actor.strip,
          v4BossPoseFrame({
            entering: boss.entering,
            phaseTicks: boss.phaseTicks,
            ticksSinceFire: boss.ticksSinceFire,
            phaseHpFraction: boss.phaseHpFraction,
            phaseTimeFraction: boss.phaseTimeFraction,
            impactKind: boss.impact?.kind,
            impactFraction: boss.impactFraction,
          }),
          { width: size, height: size, r: 0.86, g: 0.86, b: 0.86 },
        );
      } else {
        const tint = stripTint(bulletAtlas, boss.spec.sprite, boss.spec.tint);
        drawStrip(batches.enemies, bulletAtlas, drawX, drawY, boss.spec.sprite, boss.age, {
          rotation: boss.angle,
          width: boss.spec.width,
          height: boss.spec.height,
          scale: feedback.bodyScale,
          ...tint,
        });
      }
      for (const cast of visibleBossCastFx(bossCastFx, run, boss.name)) {
        const strip = fxAtlas.strip(cast.strip);
        const life = strip.frames * strip.ticksPerFrame;
        const castTint = stripTint(fxAtlas, cast.strip, tintFor(boss.name));
        drawStrip(batches.bossBodyFx, fxAtlas, drawX, drawY, cast.strip, cast.age, {
          ...castTint,
          a: Math.min(1, Math.max(0, (life - cast.age) / 6)),
        });
      }
      if (feedback.distress > 0) {
        const distressWidth = bodyWidth * feedback.bodyScale;
        const distressHeight = bodyHeight * feedback.bodyScale;
        const coreSize = Math.min(distressWidth, distressHeight);
        const material = boss.spec.hitMaterial;
        if (material === 'surface' || material === 'skeleton' || material === 'mycelium') {
          drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY, `boss.distress.${material}`, feedback.materialFrame, {
            width: distressWidth,
            height: distressHeight,
            a: feedback.crackAlpha,
          });
        }
        else if (material === 'heart') {
          drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY - coreSize * 0.05, 'boss.distress.heart', feedback.heartFrame, {
            width: coreSize * 0.36 * feedback.heartScale,
            height: coreSize * 0.36 * feedback.heartScale,
            a: feedback.heartAlpha,
          });
        }
        else {
          // Guest Bosses without the v4 material vocabulary keep a restrained
          // generic crack plus heart fallback, sized from their actual atlas body.
          drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY, 'boss.distress.crack', feedback.crackFrame, {
            width: distressWidth, height: distressHeight, a: feedback.crackAlpha * 0.7,
          });
          drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY - coreSize * 0.05, 'boss.distress.heart', feedback.heartFrame, {
            width: coreSize * 0.3 * feedback.heartScale,
            height: coreSize * 0.3 * feedback.heartScale,
            a: feedback.heartAlpha * 0.45,
          });
        }
      }
    }

    for (const item of run.items.items) {
      // A looping glow behind every pickup — the run-relative-loop proof consumer.
      // `pulse` is a `mode: 'loop'` strip on the fx sheet, and its frame is clocked
      // off `item.age` (run-relative, starts at 0 at spawn, reproduced by a replay)
      // — NEVER `loop.count`, whose program-global phase would desync the loop
      // across replays watched at different session offsets (the grafted clock law).
      const glow = fxAtlas.strip('pulse');
      const glowFrame = fxAtlas.frameOf(glow, stripFrame(glow, item.age));
      const glowTint = stripTint(fxAtlas, 'pulse', item.spec.tint);
      batches.itemGlow.draw(item.x, item.y, glowFrame, {
        width: glow.frameW,
        height: glow.frameH,
        ...glowTint,
        a: 0.5,
      });

      // Route by which atlas owns the sprite (the "shell knows both halves" pattern,
      // exactly as the fx-particle draw below does with `fxAtlas.has`): a coin/gem/bar
      // skin lives on the pickup sheet and draws through the pickup batch, spinning on
      // its own strip clocked off `item.age` (run-relative, tick-only, reproduced by a
      // replay — NEVER `loop.count`). Every legacy item (`power`/`life`/`bomb`/`score`)
      // stays on the bullet atlas and the items batch, byte-identical to before.
      if (pickupAtlas.has(item.spec.sprite)) {
        // Baked art carries its own colour (tint stays identity-white so it shows
        // unmultiplied); a tinted floor strip takes the content tint, so a coin is
        // coloured by its denomination until baked pixels load (the strips colour law
        // the missile/beam draws obey). The glow halo above follows the same rule.
        // `drawStrip` resolves the frame off `item.age` (Law of Animation, already so
        // for the spinning pickup) and the size off `displayW` (Law of Geometry).
        const tint = stripTint(pickupAtlas, item.spec.sprite, item.spec.tint);
        drawStrip(batches.pickups, pickupAtlas, item.x, item.y, item.spec.sprite, item.age, {
          ...tint,
        });
      } else {
        // The bullet-atlas item branch (`power`/`life`/`bomb`/`score`/`big-power`).
        // Routed off `item.age` so a multi-frame item skin cycles — this is what
        // unfreezes `big-power`→`star` (7 frames), reported static.
        const tint = stripTint(bulletAtlas, item.spec.sprite, item.spec.tint);
        drawStrip(batches.items, bulletAtlas, item.x, item.y, item.spec.sprite, item.age, {
          rotation: item.angle,
          ...tint,
        });
      }
    }

    for (const b of run.bullets.bullets) {
      // Enemy bullets honour their authored blend flag too. The old single normal
      // batch made every additive pack-authored curtain draw as a flat sticker; the
      // split remains presentation-only and keeps both batches on the same atlas.
      const batch = b.faction === 'player'
        ? batches.playerShots
        : b.style.additive === true
          ? batches.enemyShotsAdditive
          : batches.enemyShots;

      // A beam is a line, and its stored position is the **muzzle** — one end,
      // not the middle. It draws as a two-element composite: a body strip stretched
      // or tiled from the muzzle to the tip, and a cap flash at the tip while it can
      // kill. The anatomy lives behind a skin name resolved here (the sim named a
      // string, `render/laser-skin.ts`); a beam whose sprite names no skin falls
      // back to the legacy stretched quad below, byte-identical to before.
      if (b.laser !== undefined && b.length > 0) {
        const skin = getLaserSkin(b.style.sprite);
        if (skin !== undefined) {
          const bodyStrip = laserAtlas.strip(skin.body);
          const capStrip = laserAtlas.strip(skin.cap);
          // Frame clock is `b.age` — run-relative, tick-only, reproduced by a replay
          // (the strips clock law; `strip.test.ts` asserts every shell stripFrame
          // call reads a `.age`). Never `loop.count`, never a wall clock.
          const bodyUV = laserAtlas.uv(laserAtlas.frameOf(bodyStrip, stripFrame(bodyStrip, b.age)));
          const capUV = laserAtlas.uv(laserAtlas.frameOf(capStrip, stripFrame(capStrip, b.age)));
          const layout = beamLayout({
            muzzleX: b.x,
            muzzleY: b.y,
            angle: b.angle,
            length: b.length,
            fit: skin.fit,
            // The skin value is the VISIBLE band. A native frame keeps transparent
            // cross-axis padding, so compensate by frameH/contentH at draw time.
            thickness: laserBodyDisplayThickness(
              skin.thickness,
              bodyStrip.frameH,
              bodyStrip.contentH,
            ),
            // Default the tile length to the body strip's own frame width, so the
            // procedural floor and a native reskin each tile at their native cell.
            tileLength: skin.tileLength ?? bodyStrip.frameW,
            bodyUV,
            // Law of Geometry: the cap adopts its display size (its
            // per-frame union → engine cap size) when the pack carries `contentW`,
            // native `frameW/H` otherwise. The body uses the contentH correction
            // above; its imported +x frame already has no transparent pad.
            cap: {
              uv: capUV,
              width: capStrip.displayW ?? capStrip.frameW,
              height: capStrip.displayH ?? capStrip.frameH,
            },
            age: b.age,
            warmup: b.laser.warmup ?? 0,
            life: b.life,
            cooldown: b.laser.cooldown ?? 0,
            baseAlpha: b.style.a ?? 1,
          });
          // Baked art carries its own colour (tint stays white so it shows
          // unmultiplied); the tinted procedural floor takes the content tint, so a
          // beam is coloured by its spec until real pixels load (the strips colour
          // law) — the shell is the only place that knows both halves.
          const bodyBaked = bodyStrip.color === 'baked';
          for (const q of layout.body) {
            // Player beam impacts own a thin persistent hot edge; unlike contact
            // particles this stays continuous along the rendered beam and consumes
            // no simulation state or RNG.
            if (b.faction === 'player' && b.feedback === 'beam') {
              batches.beamBodies.draw(q.x, q.y, q.uv, {
                rotation: q.rotation,
                width: q.width,
                height: q.height * 1.35,
                r: bodyBaked ? 1 : b.style.r,
                g: bodyBaked ? 1 : b.style.g,
                b: bodyBaked ? 1 : b.style.b,
                a: q.alpha * 0.24,
              });
            }
            batches.beamBodies.draw(q.x, q.y, q.uv, {
              rotation: q.rotation,
              width: q.width,
              height: q.height,
              r: bodyBaked ? 1 : b.style.r,
              g: bodyBaked ? 1 : b.style.g,
              b: bodyBaked ? 1 : b.style.b,
              a: q.alpha,
            });
          }
          if (layout.cap !== undefined) {
            const capBaked = capStrip.color === 'baked';
            const q = layout.cap;
            batches.beamCaps.draw(q.x, q.y, q.uv, {
              rotation: q.rotation,
              width: q.width,
              height: q.height,
              r: capBaked ? 1 : b.style.r,
              g: capBaked ? 1 : b.style.g,
              b: capBaked ? 1 : b.style.b,
              a: q.alpha,
            });
          }
          continue;
        }

        // Legacy fallback: the stretched quad, centred on the beam's midpoint (its
        // stored x/y is the muzzle, one end) and stretched +x, rotated by the
        // heading (rule 7). Faded while it is only a telegraph, solid once lethal.
        const half = b.length / 2;
        const tint = stripTint(bulletAtlas, b.style.sprite, b.style);
        batch.draw(
          b.x + half * Math.cos(b.angle),
          b.y + half * Math.sin(b.angle),
          b.style.sprite,
          {
            rotation: b.angle,
            width: b.length,
            height: b.style.height ?? b.style.width,
            ...tint,
            a: (b.style.a ?? 1) * (b.lethal ? 1 : 0.45),
          },
        );
        continue;
      }

      // A missile draws from its OWN atlas into its OWN batch/layer — routed by the
      // sim field `b.missile` (the render layer cannot be imported by the sim, so
      // the sim marks the missile as a string-named skin and the shell resolves it,
      // the import boundary). It falls through the laser branches above because a
      // missile sets `blade`, never `laser`. An ordinary bullet stays on the bullet
      // atlas and its faction batch, byte-identical to before.
      const onMissile = b.missile !== undefined;
      const spriteAtlas = onMissile ? missileAtlas : bulletAtlas;
      const drawBatch = onMissile ? batches.missiles : batch;
      // A baked body carries its own colour, so the tint stays white and it shows
      // unmultiplied; the tinted procedural floor takes the content tint. That strip
      // colour rule applies equally to missiles and ordinary bullets, after routing
      // each body to the atlas that owns it. Routed through `drawStrip` off `b.age`:
      // the frame animates
      // (Law of Animation) and the size is `b.style.width ?? displayW ?? frameW` (Law
      // of Geometry — an explicit spec width still wins; `displayW` is dormant until
      // the pack carries `contentW`). For the base game every bullet strip is
      // `frames: 1` at 32px, so this stays byte-identical to before.
      const tint = stripTint(spriteAtlas, b.style.sprite, b.style);
      // A carried blade's collision is a capsule. A named baked reskin used to be
      // fitted back into the tiny needle cell and could paint only ~5px around a
      // 26px lethal shape. The view now covers the capsule unless content supplied
      // an explicit size; missiles keep their dedicated body geometry.
      const projectileStrip = spriteAtlas.strip(b.style.sprite);
      const bladeSize = bladeDisplaySize(b.style, b.bladeHalf, b.radius, projectileStrip);
      drawStrip(drawBatch, spriteAtlas, b.x, b.y, b.style.sprite, b.age, {
        rotation: b.angle,
        width: bladeSize.width,
        height: bladeSize.height,
        ...tint,
        a: b.style.a,
      });
    }

    for (const p of run.effects.particles) {
      // Route by which atlas owns the sprite (the "shell knows both halves"
      // pattern): a burst strip lives on the fx sheet and draws through the fx
      // batch; every existing small particle stays on the bullet atlas and the
      // effects batch, byte-identical (its `frameW === 32`, so the size below is
      // the old `32 * p.scale`). The frame is selected off `p.age` — a
      // run-relative, tick-only clock the replay reproduces (rule 1's analogue),
      // never a wall clock or the interpolation alpha.
      const onFx = fxAtlas.has(p.spec.sprite);
      const atlas = onFx ? fxAtlas : bulletAtlas;
      // Route by which atlas owns the sprite, then — on the fx sheet — by blend: a
      // non-additive fx (only the boss blast's `boom.boss.back` plate) draws through
      // the normal-blend `burstsBack` batch UNDER the additive core; every other fx
      // stays additive. The split is read from the spec, not a hardcoded name set.
      const batch = onFx
        ? p.spec.additive === false
          ? batches.burstsBack
          : batches.bursts
        : batches.effects;
      // Routed through `drawStrip` off `p.age`: the frame animates (already so — a
      // squared burst) and `scale: p.scale` multiplies the resolved size, which is
      // `displayW ?? frameW` (Law of Geometry, dormant until `contentW`). With no
      // display size this is the old `frameW * p.scale`, byte-identical.
      const tint = stripTint(atlas, p.spec.sprite, p.spec.tint);
      drawStrip(batch, atlas, p.x, p.y, p.spec.sprite, p.age, {
        rotation: p.angle,
        scale: p.scale,
        ...tint,
        a: p.alpha,
      });
    }

    // Read from the spec, not hardcoded: `OptionSpec` already declares a sprite
    // and a tint per option set, and a shell that picks its own makes those two
    // fields decorative — `seeker` authors a tinted `ring` and was drawn as
    // `standard`'s untinted orb.
    const optionSpec = run.options.spec;
    for (let optionIndex = 0; optionIndex < run.options.options.length; optionIndex++) {
      const option = run.options.options[optionIndex];
      if (option === undefined) continue;
      if (!option.active) continue;
      // Built-in heroines first claim their own option strip; a pack that supplies
      // only the historical shared strip still works, and guest characters retain
      // their declared option sprite. `option.age` is fixed simulation time.
      const characterOption = `player.option.${run.characterName}`;
      const playerOption = fxAtlas.has(characterOption)
        ? characterOption
        : fxAtlas.has('player.option')
          ? 'player.option'
          : undefined;
      const usePlayerOption = playerOption !== undefined;
      const atlas = usePlayerOption ? fxAtlas : bulletAtlas;
      const batch = usePlayerOption ? batches.optionsFx : batches.options;
      const sprite = playerOption ?? optionSpec.sprite;
      const tint = stripTint(atlas, sprite, optionSpec.tint);
      drawStrip(batch, atlas, option.x, option.y, sprite, option.age, {
        // `Option.angle` is DEGREES — its own doc comment says so, and contrasts
        // itself with `Bullet.angle`, which is the radians this attribute wants.
        // Fed across unconverted, an option aiming at 270 was drawn at 349.9.
        rotation: (option.angle * Math.PI) / 180,
        ...tint,
      });
    }

    const player = run.player;
    if (player.alive) {
      const blink = player.invuln > 0 && Math.floor(player.invuln / 4) % 2 === 0;
      // Read from the spec, not hardcoded — the same rule the option draw below
      // already follows. A shell that picks the player's sprite makes
      // `CharacterSpec.sprite` decorative, and leaves a four-ship roster with
      // one silhouette and nowhere to put the others when real art lands.
      const ship = run.character;
      // The three named thrust states and two residue strips are conventional
      // fx names, so any pack can supply them without widening Bomb/Player specs.
      // Vertical intent comes from the replay mask; the animation clock is the
      // player's fixed entity age, never the render loop.
      const thrust = player.verticalIntent < 0
        ? 'player.thruster.up'
        : player.verticalIntent > 0
          ? 'player.thruster.down'
          : 'player.thruster.cruise';
      if (fxAtlas.has(thrust)) {
        drawStrip(batches.playerFx, fxAtlas, player.x, player.y + 19, thrust, player.age, {
          a: blink ? 0.25 : 0.9,
        });
      }
      for (const [i, residue] of ['player.thruster.particle.0', 'player.thruster.particle.1'].entries()) {
        if (!fxAtlas.has(residue)) continue;
        drawStrip(batches.playerFx, fxAtlas, player.x, player.y + 25 + i * 5, residue, player.age, {
          a: blink ? 0.18 : 0.55 - i * 0.12,
        });
      }

      // Five source frames are banking POSES, not a 60 Hz loop. A fresh direction
      // uses the gentle frame for three replayed ticks, then settles into the hard
      // pose and holds. A pack ship participates only when its manifest explicitly
      // declares the same five-way semantics; arbitrary/legacy strips stay frame 0.
      const bankFrame = v4PlayerBankFrame(player.horizontalIntent, player.horizontalHeldTicks);
      const shipFrame = usesFiveWayShipBanking ? bankFrame : 0;
      const candidateActor = V4_PLAYER_ACTORS[run.characterName];
      const actorAtlas = v4Actors.players;
      const actor =
        candidateActor !== undefined && actorAtlas?.has(candidateActor.strip)
          ? candidateActor
          : undefined;
      if (actor !== undefined) {
        // Keep the local darkness present through the invulnerability blink so
        // the player's location never disappears into scene texture. It softens
        // with the actor, but unlike the actor never drops to a near-invisible
        // frame.
        drawActorPad(
          batches.actorPlayerPads,
          'player',
          player.x,
          player.y,
          actor.size,
          blink ? 0.72 : 1,
        );
        // A pack ship remains visible as the heroine's compact back wing/core
        // rather than impersonating the protagonist. It is pack-owned, so a
        // zero-pack run simply omits this optional under-layer.
        if (hasPackShipLayer) {
          drawPose(batches.player, shipAtlas, player.x, player.y + 5, ship.sprite, shipFrame, {
            width: 36,
            height: 36,
            a: blink ? 0.2 : 0.72,
            g: blink ? 0.5 : 1,
            b: blink ? 0.5 : 1,
          });
        }
        drawPose(
          batches.actorPlayer,
          actorAtlas!,
          player.x,
          player.y,
          actor.strip,
          bankFrame,
          {
            width: actor.size,
            height: actor.size,
            r: 0.88,
            g: blink ? 0.44 : 0.88,
            b: blink ? 0.44 : 0.88,
            a: blink ? 0.35 : 1,
          },
        );
      } else {
        // Pack characters keep their declared ship surface; only an explicit
        // five-way contract enables banking, otherwise this is stable frame 0.
        drawPose(batches.player, shipAtlas, player.x, player.y, ship.sprite, shipFrame, {
          width: ship.width ?? 40,
          height: ship.height ?? 40,
          a: blink ? 0.35 : 1,
          g: blink ? 0.5 : 1,
          b: blink ? 0.5 : 1,
        });
      }
    }

    // Specialized pack strips take priority when a bomb registry name claims one.
    // Their age is fixed simulation time; guest/legacy names retain the two old
    // visual fallbacks below.
    // elapsed time comes from BombSystem's integer duration/remaining pair. This
    // is view-only: damage, clearing, conversion and invulnerability stay exactly
    // where they were in the fixed-tick simulation.
    if (run.bombs.active) {
      const bomb = run.bombs;
      const specialized = `player.bomb.${bomb.name}`;
      if (fxAtlas.has(specialized)) {
        drawStrip(batches.bombFx, fxAtlas, bomb.x, bomb.y, specialized, bomb.age, {
          scale: 3.9,
          a: 0.78,
        });
      } else if (bomb.name === 'spread' && fxAtlas.has('player.bomb.field')) {
        drawStrip(batches.bombFx, fxAtlas, bomb.x, bomb.y, 'player.bomb.field', bomb.age, {
          scale: 3.9,
          a: 0.7,
        });
      } else if (bomb.name === 'lance') {
        // A lance bomb is a travelling attack, not two large decals nailed to
        // the activation point. Position is a pure function of the bomb entity's
        // fixed age; the sprites keep their authored cell aspect ratio.
        const projectileY = bomb.y - Math.min(bomb.age, 42) * 7;
        const missileY = bomb.y - 24 - Math.min(bomb.age, 34) * 9;
        if (fxAtlas.has('player.bomb.projectile')) {
          drawStrip(batches.bombFx, fxAtlas, bomb.x - 26, projectileY, 'player.bomb.projectile', bomb.age, {
            scale: 3.1,
            a: 0.68,
          });
          drawStrip(batches.bombFx, fxAtlas, bomb.x + 26, projectileY, 'player.bomb.projectile', bomb.age, {
            scale: 3.1,
            a: 0.75,
          });
        }
        if (fxAtlas.has('player.bomb.missile')) {
          drawStrip(batches.bombFx, fxAtlas, bomb.x, missileY, 'player.bomb.missile', bomb.age, {
            scale: 4,
            a: 0.9,
          });
        }
      }
    }
  }

  return {
    draw: ({
      runs,
      bossCastFx,
      bossIdentityFx,
    }) => {
      for (const run of runs) drawRun(run, bossCastFx);

      const visibleRuns = new Set(runs);
      for (
        const identity
        of visibleBossIdentityFx(bossIdentityFx, visibleRuns)
      ) {
        const strip = fxAtlas.strip(identity.strip);
        const life = strip.frames * strip.ticksPerFrame;
        drawStrip(
          batches.bossDeathFx,
          fxAtlas,
          identity.x,
          identity.y,
          identity.strip,
          identity.age,
          { a: Math.max(0, 1 - identity.age / life) },
        );
      }
    },
  };
}
