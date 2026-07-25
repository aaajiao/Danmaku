import { describe, expect, test } from 'bun:test';
import { Layer } from './render/stage';

const mainSource = await Bun.file(new URL('./main.ts', import.meta.url)).text();
const v4UiSource = await Bun.file(new URL('./render/v4-ui.ts', import.meta.url)).text();
const htmlSource = await Bun.file(new URL('../index.html', import.meta.url)).text();
const styleSource = await Bun.file(new URL('./style.css', import.meta.url)).text();

function parentShellElementId(source: string, wanted: string): string | undefined {
  const stack: (string | undefined)[] = [];
  for (const match of source.matchAll(/<\/?(?:main|div)\b[^>]*>/g)) {
    const tag = match[0];
    if (tag.startsWith('</')) {
      stack.pop();
      continue;
    }
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    if (id === wanted) return stack.at(-1);
    stack.push(id);
  }
  return undefined;
}

describe('touch controls remain a shell input source', () => {
  test('stick, A, B, and Start join the existing tick-sampled mask', () => {
    const start = mainSource.indexOf(
      'const touchInput = new TouchInput(window)',
    );
    const end = mainSource.indexOf('input.attach();', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const setup = mainSource.slice(start, end);
    expect(setup).toContain('touchInput.attachStick(touchStick)');
    expect(setup).toContain('touchInput.attachAction(touchA, Button.Shot)');
    expect(setup).toContain('touchInput.attachAction(touchB, Button.Bomb)');
    expect(setup).toContain('touchInput.attachAction(touchStart, Button.Start)');
    expect(setup).toContain('touchInput,');
    expect(setup).not.toContain('Button.Slow');
  });

  test('the authored frame scales inside its real slot rather than the viewport', () => {
    const start = mainSource.indexOf('function fitStage(): void');
    const end = mainSource.indexOf('let touchControlsEnabled', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const fit = mainSource.slice(start, end);
    expect(fit).toContain('stageSlot.getBoundingClientRect()');
    expect(fit).toContain("setProperty('--stage-scale'");
    expect(fit).not.toContain('style.transform');
    expect(styleSource).toContain('margin-top: -320px');
    expect(styleSource).toContain('margin-left: -240px');
    expect(styleSource).toContain('transform: scale(var(--stage-scale))');
  });

  test('controls are a safe-area-aware sibling, never a child of the stage', () => {
    expect(htmlSource).toContain('viewport-fit=cover');
    expect(parentShellElementId(htmlSource, 'stage')).toBe('stage-slot');
    expect(parentShellElementId(htmlSource, 'stage-slot')).toBe('game-shell');
    expect(parentShellElementId(htmlSource, 'touch-controls')).toBe('game-shell');
    expect(styleSource).toContain('#touch-controls[hidden]');
    expect(styleSource).toContain('env(safe-area-inset-bottom');
    expect(styleSource).toContain('touch-action: none');
    expect(styleSource).toContain('@media (orientation: landscape)');
  });

  test('every control wrapper remains in the iPhone hit-test tree', () => {
    const controlsStart = styleSource.indexOf('#touch-controls {');
    const controlsEnd = styleSource.indexOf('}', controlsStart);
    const clusterStart = styleSource.indexOf('.touch-action-cluster {');
    const clusterEnd = styleSource.indexOf('}', clusterStart);
    expect(controlsStart).toBeGreaterThan(-1);
    expect(clusterStart).toBeGreaterThan(-1);
    expect(styleSource.slice(controlsStart, controlsEnd)).toContain(
      'pointer-events: auto',
    );
    expect(styleSource.slice(clusterStart, clusterEnd)).toContain(
      'pointer-events: auto',
    );
    const landscapeStageStart = styleSource.indexOf(
      '#game-shell.touch-controls-enabled #stage-slot {',
    );
    const landscapeStageEnd = styleSource.indexOf('}', landscapeStageStart);
    expect(landscapeStageStart).toBeGreaterThan(-1);
    expect(
      styleSource.slice(landscapeStageStart, landscapeStageEnd),
    ).toContain('z-index: 2');
  });

  test('only four complete ornaments remain, including a real moving stick', () => {
    const touchStart = htmlSource.indexOf('<div id="touch-controls"');
    const touchEnd = htmlSource.indexOf('</main>', touchStart);
    expect(touchStart).toBeGreaterThan(-1);
    expect(touchEnd).toBeGreaterThan(touchStart);
    const touchMarkup = htmlSource.slice(touchStart, touchEnd);

    expect(htmlSource).toContain('id="touch-stick"');
    expect(htmlSource).toContain('class="touch-stick-knob"');
    expect(htmlSource).toContain('aria-label="Virtual movement stick"');
    expect(htmlSource).not.toContain('touch-dpad');
    expect(touchMarkup.match(/<button\b/g)?.length).toBe(3);
    expect(touchMarkup).toContain('aria-label="Menu, pause, and confirm"');
    expect(touchMarkup).toContain('class="touch-stick-well"');
    expect(touchMarkup).toContain('class="touch-start-seal"');
    expect(touchMarkup.match(/class="touch-action-letter"/g)?.length).toBe(2);
    expect(touchMarkup).not.toContain('>START<');
    expect(styleSource).not.toContain('touch-ritual');
    expect(styleSource).not.toContain('touch-ritual-divider');
    expect(styleSource).not.toContain('touch-ritual-bridge');

    const stickStart = styleSource.indexOf('#touch-stick {');
    const stickEnd = styleSource.indexOf('}', stickStart);
    expect(stickStart).toBeGreaterThan(-1);
    expect(stickEnd).toBeGreaterThan(stickStart);
    expect(styleSource.slice(stickStart, stickEnd)).not.toContain('clip-path');

    expect(styleSource).toContain(
      'calc(-50% + var(--touch-stick-x))',
    );
    expect(styleSource).toContain(
      'calc(-50% + var(--touch-stick-y))',
    );
    expect(mainSource).toContain(
      "touchStick.style.setProperty('--touch-stick-x'",
    );
    expect(mainSource).toContain(
      "touchStick.style.setProperty('--touch-stick-y'",
    );
    expect(mainSource).toContain('const distance = Math.hypot(x, y)');

    // One atlas and palette serve all four established control ornaments.
    expect(styleSource).toContain(
      "--touch-ui-atlas: url('./assets/v4/ui-v4.png')",
    );
    expect(styleSource).toContain('--touch-ice: 211 225 235');
    expect(styleSource).toContain('--touch-heart: 255 145 189');
    expect(styleSource).toContain('#touch-stick,\n#touch-start,\n.touch-action');
  });

  test('real control contacts dim the chrome until every stream releases', () => {
    expect(mainSource).toContain(
      'const touchControlPointers = new Map<number, string>()',
    );
    expect(mainSource).toContain(
      'const touchControlTouches = new Set<number>()',
    );
    expect(mainSource).toContain(
      "touchControls.dataset.operating = 'true'",
    );
    expect(mainSource).toContain('delete touchControls.dataset.operating');
    expect(mainSource).toContain(
      "touchControls.addEventListener('pointerdown'",
    );
    expect(mainSource).toContain(
      "touchControls.addEventListener('touchstart'",
    );
    expect(mainSource).toContain(
      "window.addEventListener('pointerup', endTouchControlPointer",
    );
    expect(mainSource).toContain(
      "window.addEventListener('touchend', endTouchControlTouch",
    );
    expect(mainSource.match(/resetTouchControlActivity\(\)/g)?.length)
      .toBeGreaterThanOrEqual(4);

    expect(styleSource).toContain(
      "#touch-controls[data-operating='true']",
    );
    expect(styleSource).toContain('opacity: 0.44');
    expect(styleSource).toContain('brightness(0.7) saturate(0.78)');
    expect(styleSource).toContain(
      'transition: opacity 120ms ease-out, filter 120ms ease-out',
    );
  });

  test('a drag can unlock audio without relying on click', () => {
    const unlockStart = mainSource.indexOf(
      'function unlockAudioFromUserActivation',
    );
    const unlockEnd = mainSource.indexOf(
      'const touchInput = new TouchInput(window)',
      unlockStart,
    );
    expect(unlockStart).toBeGreaterThan(-1);
    expect(unlockEnd).toBeGreaterThan(unlockStart);
    const unlock = mainSource.slice(unlockStart, unlockEnd);
    expect(unlock).toContain('audioOutput.activateFromGesture()');
    expect(unlock).toContain('audioOutput.unlock()');
    expect(unlock).toContain('audio.unlock()');
    expect(unlock).toContain('music.unlock()');
    expect(unlock).toContain(
      "window.addEventListener('pointerdown', unlockAudioFromUserActivation",
    );
    expect(unlock).toContain(
      "window.addEventListener('pointerup', unlockAudioFromUserActivation",
    );
    expect(unlock).toContain(
      "window.addEventListener('touchstart', unlockAudioFromUserActivation",
    );
    expect(unlock).toContain(
      "window.addEventListener('touchend', unlockAudioFromUserActivation",
    );
    expect(unlock).toContain(
      "window.addEventListener('click', unlockAudioFromUserActivation",
    );
    expect(unlock).toContain(
      "window.addEventListener('keydown', unlockAudioFromUserActivation",
    );
    expect(unlock.indexOf('audioOutput.activateFromGesture()')).toBeLessThan(
      unlock.indexOf('audioOutput.unlock()'),
    );

    // A cancelled/dragged touch may never synthesize click. Both halves reach
    // the synchronous capture path before TouchInput prevents its defaults.
    expect(
      unlock.indexOf(
        "window.addEventListener('pointerdown', unlockAudioFromUserActivation",
      ),
    ).toBeLessThan(
      mainSource.indexOf('const touchInput = new TouchInput(window)'),
    );

    const tick = mainSource.indexOf('const buttons = input.sample();');
    const machineTick = mainSource.indexOf('machine.tick(buttons);', tick);
    expect(tick).toBeGreaterThan(-1);
    expect(machineTick).toBeGreaterThan(tick);
    expect(mainSource.slice(tick, machineTick)).not.toContain(
      'audioOutput.unlock()',
    );
  });

  test('page restore revalidates only an already-started audio output', () => {
    const restoreStart = mainSource.indexOf(
      'function resumeAudioAfterPageRestore',
    );
    const restoreEnd = mainSource.indexOf(
      'const touchInput = new TouchInput(window)',
      restoreStart,
    );
    expect(restoreStart).toBeGreaterThan(-1);
    expect(restoreEnd).toBeGreaterThan(restoreStart);
    const restore = mainSource.slice(restoreStart, restoreEnd);
    expect(restore).toContain('if (document.hidden) return');
    expect(restore).toContain('audioOutput.resumeIfStarted()');
    expect(restore).toContain(
      "window.addEventListener('pageshow', resumeAudioAfterPageRestore)",
    );
    expect(restore).toContain(
      "document.addEventListener('visibilitychange', resumeAudioAfterPageRestore)",
    );
    expect(restore).not.toContain('audioOutput.activateFromGesture()');
  });

  test('a waiting PWA release activates only from the title tick', () => {
    expect(mainSource).toContain(
      "import { activateWaitingPwaUpdate } from './pwa'",
    );
    const tick = mainSource.indexOf('const loop = new Loop({');
    const sample = mainSource.indexOf('const buttons = input.sample();', tick);
    const beforeInput = mainSource.slice(tick, sample);
    expect(beforeInput).toContain(
      "if (machine.current?.name === 'title') activateWaitingPwaUpdate();",
    );
  });

  test('interruptions clear touch state', () => {
    expect(mainSource.match(/touchInput\.reset\(\)/g)?.length)
      .toBeGreaterThanOrEqual(3);
    const tick = mainSource.indexOf('machine.tick(buttons);');
    const transition = mainSource.indexOf(
      'if (machine.current !== stateBeforeTick)',
      tick,
    );
    expect(tick).toBeGreaterThan(-1);
    expect(transition).toBeGreaterThan(tick);
    expect(mainSource.slice(transition, transition + 500))
      .not.toContain('touchInput.reset()');
  });
});

describe('the shell honours baked strip colour', () => {
  test('the shared tint resolver makes baked art identity-white', () => {
    expect(mainSource).toContain("atlas.strip(name).color === 'baked' ? undefined : tint");
    expect(mainSource).toContain('r: source?.r ?? 1');
    expect(mainSource).toContain('g: source?.g ?? 1');
    expect(mainSource).toContain('b: source?.b ?? 1');
    expect(mainSource).not.toContain('boost');
  });

  test('enemy, boss, ordinary bullet/missile and effect draws all use it', () => {
    expect(mainSource).toContain('stripTint(bulletAtlas, e.spec.sprite, e.spec.tint)');
    expect(mainSource).toContain('stripTint(bulletAtlas, boss.spec.sprite, boss.spec.tint)');
    expect(mainSource).not.toContain('boss.hitFlash');
    expect(mainSource).toContain('stripTint(spriteAtlas, b.style.sprite, b.style)');
    expect(mainSource).toContain('stripTint(atlas, p.spec.sprite, p.spec.tint)');
  });
});

describe('boss feedback stays local and below bullet danger', () => {
  test('distress is below both shot layers while death identity stays with bursts', () => {
    expect(Layer.Enemies + 3).toBeLessThan(Layer.PlayerShots);
    expect(Layer.Enemies + 3).toBeLessThan(Layer.EnemyShots);
    expect(mainSource).toContain('renderOrder: Layer.Enemies + 3');
    expect(mainSource).toContain('renderOrder: Layer.Bursts + 2');
    expect(mainSource).toContain("drawActorPad(batches.actorEnemyPads, 'boss', boss.x, boss.y, actor.size)");
    expect(mainSource).toContain('const drawX = boss.x + feedback.recoilX');
  });

  test('a defeated v4 boss queues, draws, and fades its unique identity strip', () => {
    expect(mainSource).toContain("if (event.type === 'boss-defeated')");
    expect(mainSource).toContain('V4_BOSS_ACTORS[event.name]?.deathStrip');
    expect(mainSource).toContain('bossIdentityFx.push({ run, strip, x: event.x, y: event.y, age: 0 })');
    expect(mainSource).toContain('stepBossIdentityFx(bossIdentityFx');
    expect(mainSource).toContain('visibleBossIdentityFx(bossIdentityFx, visibleRuns)');
    expect(mainSource).toContain('drawStrip(batches.bossDeathFx');
    expect(mainSource).toContain('a: Math.max(0, 1 - identity.age / life)');
  });

  test('a phase event queues that exact Boss phase declaration and follows its live body', () => {
    expect(mainSource).toContain("if (event.type === 'boss-phase')");
    expect(mainSource).toContain(
      'v4BossPhaseCastStrip(activeBoss.name, event.count)',
    );
    expect(mainSource).toContain('bossCastFx.push({');
    expect(mainSource).toContain('stepBossCastFx(bossCastFx');
    expect(mainSource).toContain('visibleBossCastFx(bossCastFx, run, boss.name)');
    expect(mainSource).toContain(
      'drawStrip(batches.bossBodyFx, fxAtlas, drawX, drawY, cast.strip, cast.age',
    );
    expect(Layer.Enemies + 3).toBeLessThan(Layer.EnemyShots);
  });

  test('guest boss distress follows its actual atlas display geometry', () => {
    expect(mainSource).toContain('const legacyStrip = actor === undefined ? bulletAtlas.strip(boss.spec.sprite) : undefined');
    expect(mainSource).toContain('legacyStrip?.displayW');
    expect(mainSource).toContain('legacyStrip?.frameW');
    expect(mainSource).toContain('legacyStrip?.displayH');
    expect(mainSource).toContain('legacyStrip?.frameH');
    expect(mainSource).not.toContain('Math.max(boss.spec.width ?? 64, boss.spec.height ?? 64)');
  });

  test('each authored boss material selects its own low-health strip', () => {
    expect(mainSource).toContain("material === 'surface' || material === 'skeleton' || material === 'mycelium'");
    expect(mainSource).toContain('`boss.distress.${material}`');
    expect(mainSource).toContain("else if (material === 'heart')");
    expect(mainSource).toContain("'boss.distress.crack', feedback.crackFrame");
    expect(mainSource).toContain('feedback.materialFrame');
  });
});

describe('the ending tally consumes its pickup-atlas strips', () => {
  test('draws a state-age frame from the atlas image rather than a named-colour glyph', () => {
    expect(mainSource).toContain('pickupAtlas.texture.image as CanvasImageSource');
    expect(mainSource).toContain('const frameIndex = stripFrame(strip, age)');
    expect(mainSource).toContain('const frame = pickupAtlas.frameOf(strip, frameIndex)');
    expect(mainSource).toContain('surface.drawImage(tallyCoinIcon(entry.sprite, age)');
    expect(mainSource).toContain("if (strip.color !== 'baked')");
    expect(mainSource).toContain('iconSurface.getImageData(0, 0, TALLY_COIN_BOX, TALLY_COIN_BOX)');
    expect(mainSource).toContain('iconSurface.putImageData(pixels, 0, 0)');
    expect(mainSource).not.toContain('function tallyCoinColor(');
    expect(mainSource).not.toContain('surface.arc(x + TALLY_COIN_R');
  });
});

describe('authored ending pauses survive text layout', () => {
  test('an empty view line reserves one baseline instead of disappearing', () => {
    const start = mainSource.indexOf('function drawViewLines(');
    const end = mainSource.indexOf('const TALLY_COIN_BOX', start);
    const source = mainSource.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source).toContain("if (value === '')");
    expect(source).toContain('y += 17');
  });
});

describe('the ending prompt names its action', () => {
  test('uses a device-neutral continuation label instead of raw button names', () => {
    expect(mainSource).toContain("surface.fillText('CONTINUE', cx, 552)");
    expect(mainSource).not.toContain("surface.fillText('SHOT / START'");
  });
});

describe('the shell injects v4 ending data into the generic game context', () => {
  test('wires the edition map instead of relying on engine-owned prose', () => {
    expect(mainSource).toContain("import { CONTENT_FINGERPRINT, V4_ENDINGS } from './v4'");
    expect(mainSource).toContain('campaignEndings: V4_ENDINGS');
  });
});

describe('the v4 ending removes information instead of covering it', () => {
  test('drives frozen batch groups and the worn plate from the fixed page clock', () => {
    expect(mainSource).toContain('const endingMix = endingMixFromViews(views)');
    expect(mainSource).toContain('setEndingBatchMix(endingMix)');
    expect(mainSource).toContain(
      "background.setScalarUniform('uEndingArt', endingMix.art)",
    );
    for (const group of ['enemies', 'player', 'projectiles', 'pickups', 'effects']) {
      expect(mainSource).toContain(`ENDING_BATCH_GROUPS.${group}`);
    }
  });

  test('records the actual updated Run position and never feeds it back into play', () => {
    const tick = mainSource.indexOf('machine.tick(buttons);');
    const sample = mainSource.indexOf('endingTraceRecorder(pointerRun).sample({', tick);
    expect(tick).toBeGreaterThan(-1);
    expect(sample).toBeGreaterThan(tick);
    expect(mainSource.slice(sample, sample + 360)).toContain(
      'tick: pointerRun.tickCount',
    );
    expect(mainSource).toContain('const endingTraceByRun = new WeakMap<Run, EndingTraceRecorder>()');
  });

  test('uses a local copy wash while the combat HUD yields to the real trace', () => {
    const branch = mainSource.indexOf("if (view.kind === 'ending')");
    const status = mainSource.indexOf('const { x: statusX', branch);
    const endingSource = mainSource.slice(branch, status);
    expect(branch).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(branch);
    expect(endingSource).toContain('drawEndingView(view)');
    expect(endingSource).not.toContain('rgba(4, 7, 12, 0.88)');
    expect(mainSource).toContain('surface.createRadialGradient(cx, 250');
    expect(mainSource).toContain('drawEndingTrace(run, endingMix.trace)');
  });
});

describe('every bullet-atlas draw path honours baked colour', () => {
  test('items, legacy beams and options use the shared tint resolver too', () => {
    expect(mainSource).toContain('stripTint(bulletAtlas, item.spec.sprite, item.spec.tint)');
    expect(mainSource).toContain('stripTint(bulletAtlas, b.style.sprite, b.style)');
    expect(mainSource).toContain('const atlas = usePlayerOption ? fxAtlas : bulletAtlas');
    expect(mainSource).toContain('stripTint(atlas, sprite, optionSpec.tint)');
  });
});

describe('built-in player effects prefer their named visual strips', () => {
  test('options select character-first while guests and legacy packs retain both fallbacks', () => {
    expect(mainSource).toContain('const characterOption = `player.option.${run.characterName}`');
    expect(mainSource).toContain("fxAtlas.has('player.option')");
    expect(mainSource).toContain('const sprite = playerOption ?? optionSpec.sprite');
    expect(mainSource).toContain('option.age');
  });

  test('active bombs select their name-derived strip before spread/lance compatibility art', () => {
    expect(mainSource).toContain('const specialized = `player.bomb.${bomb.name}`');
    expect(mainSource).toContain('if (fxAtlas.has(specialized))');
    expect(mainSource).toContain("else if (bomb.name === 'spread' && fxAtlas.has('player.bomb.field'))");
    expect(mainSource).toContain("else if (bomb.name === 'lance')");
    expect(mainSource).toContain('specialized, bomb.age');
  });
});

describe('the pickup glow follows the same strip-colour contract', () => {
  test('a baked pulse is identity-white while the procedural floor keeps the item tint', () => {
    expect(mainSource).toContain("const glowTint = stripTint(fxAtlas, 'pulse', item.spec.tint)");
    expect(mainSource).toContain('...glowTint');
  });
});

describe('built-in dialogue keeps the v4 character identity', () => {
  test('player and bosses prefer the close-up atlas, then field art, then the generic fallback', () => {
    expect(mainSource).toContain('v4PortraitStrip(speaker, characterName)');
    expect(mainSource).toContain('const portraitAtlas = v4Actors.portraits');
    expect(mainSource).toContain("speaker === 'player' ? V4_PLAYER_ACTORS[characterName]");
    expect(mainSource).toContain('const boss = V4_BOSS_ACTORS[speaker]');
    expect(mainSource).toContain('v4PortraitSpec(speaker, characterName)');
    expect(mainSource).toContain('v4PortraitSource(frame, portrait)');
    expect(mainSource).toContain('if (!drawV4Portrait(line.speaker, characterName');
    expect(mainSource).toContain('portraitImage(line.speaker)');
  });
});

describe('the Japanese STG hit point is presentation, not body geometry', () => {
  test('focus exposes the configured lethal centre on the overlay', () => {
    expect(mainSource).toContain('if (!run.player.alive || !run.player.focused) return');
    expect(mainSource).toContain('focusIndicatorLayout(x, y, radius, run.tickCount)');
    expect(mainSource).toContain('surface.arc(x, y, indicator.keylineRadius');
    expect(mainSource).toContain('surface.arc(x, y, indicator.coreRadius');
    expect(mainSource).toContain("surface.fillStyle = 'rgba(2,5,10,0.96)'");
    expect(mainSource).toContain("drawV4Ui(surface, v4Ui, 'ui.focus.ring'");
    expect(mainSource).toContain('drawFocusIndicator(run)');
  });

  test('v4 dialogue close-ups downsample smoothly while field-art fallback stays nearest', () => {
    const portraitStart = mainSource.indexOf('function drawV4Portrait(');
    const dialogueStart = mainSource.indexOf('function drawDialogue(', portraitStart);
    const portraitSource = mainSource.slice(portraitStart, dialogueStart);
    const smooth = portraitSource.indexOf('surface.imageSmoothingEnabled = true');
    const nearest = portraitSource.indexOf('surface.imageSmoothingEnabled = false');
    expect(smooth).toBeGreaterThan(-1);
    expect(nearest).toBeGreaterThan(smooth);
    expect(portraitSource).toContain("surface.imageSmoothingQuality = 'high'");
    expect(portraitSource).toContain('surface.imageSmoothingEnabled = false');
    expect(portraitSource).toContain('surface.save()');
    expect(portraitSource).toContain('surface.restore()');
  });

  test('only a ship that declares five-way semantics follows player banking', () => {
    expect(mainSource).toContain("packs.shipStrip?.banking === 'five-way' ? bankFrame : 0");
    expect(mainSource).toContain('ship.sprite, shipFrame');
  });
});

describe('v4 women carry bounded local contrast rather than a full-screen grade', () => {
  test('enemy, boss and player pads follow actor positions below their body tiers', () => {
    expect(mainSource).toContain('ACTOR_PAD_RENDER_ORDER.enemy');
    expect(mainSource).toContain('ACTOR_PAD_RENDER_ORDER.player');
    expect(mainSource).toContain("drawActorPad(batches.actorEnemyPads, 'enemy', e.x, e.y, actor.size)");
    expect(mainSource).toContain("drawActorPad(batches.actorEnemyPads, 'boss', boss.x, boss.y, actor.size)");
    expect(mainSource).toContain('batches.actorPlayerPads');
    expect(mainSource).not.toContain('actorPadAtlas.texture.repeat');
  });

  test('authored attack poses read successful fixed-tick volley facts', () => {
    expect(mainSource).toContain('v4EnemyPoseFrame(e.age, e.ticksSinceFire)');
    expect(mainSource).toContain('ticksSinceFire: boss.ticksSinceFire');
    expect(mainSource).toContain('phaseHpFraction: boss.phaseHpFraction');
    expect(mainSource).toContain('phaseTimeFraction: boss.phaseTimeFraction');
    expect(mainSource).not.toContain('v4BossPoseFrame(boss.entering, boss.phaseIndex');
  });
});

describe('campaign architecture follows the same scene transition clock', () => {
  test('the sparse structure steps and cross-fades beside the authored background', () => {
    expect(mainSource).toContain("new V4StageStructure(stage, 'drift')");
    expect(mainSource).toContain(
      'if (replayExportPresentationAdvances(\n'
      + '      exportPhaseBeforeTick,\n'
      + '      exportState?.phase,\n'
      + '      exportRunTickBefore === undefined\n'
      + '        || exportState === undefined\n'
      + '        || exportState.run.tickCount > exportRunTickBefore,\n'
      + '    )) {\n'
      + '      background.step();\n'
      + '      stageStructure.step();',
    );
    expect(mainSource).toContain('background.transitionTo(scene, SCENE_FADE_TICKS);\n      stageStructure.transitionTo(scene, SCENE_FADE_TICKS);');
  });
});

describe('v4 UI presentation stays event- and tick-driven', () => {
  test('the direct-controller row is capability-gated, not URL-mode-gated', () => {
    expect(mainSource).not.toContain("matchMedia('(display-mode: standalone)')");
    expect(mainSource).not.toContain("SEARCH.get('webhid')");
    expect(mainSource).toContain(
      'if (webHid === undefined || hasConnectedStandardController())',
    );
    expect(mainSource).toContain(
      'const directController = webHid === undefined\n'
      + '  ? undefined\n'
      + '  : new XboxWebHidInput(webHid, showControllerStatus);',
    );
    expect(mainSource).toContain('SELECT A CONTROLLER IN THIS BROWSER');
    expect(mainSource).toContain('ALLOW THIS BROWSER IN INPUT MONITORING');
  });

  test('title, difficulty and character selection use open compositions without outer panels', () => {
    const titleStart = mainSource.indexOf("if (view.kind === 'title')");
    const characterStart = mainSource.indexOf("if (view.kind === 'character-select')", titleStart);
    const difficultyStart = mainSource.indexOf("if (view.kind === 'difficulty-select')", characterStart);
    const endingStart = mainSource.indexOf("if (view.kind === 'ending')", difficultyStart);
    expect(titleStart).toBeGreaterThan(-1);
    expect(characterStart).toBeGreaterThan(titleStart);
    expect(difficultyStart).toBeGreaterThan(characterStart);
    expect(endingStart).toBeGreaterThan(difficultyStart);

    const branches = [
      mainSource.slice(titleStart, characterStart),
      mainSource.slice(characterStart, difficultyStart),
      mainSource.slice(difficultyStart, endingStart),
    ];
    for (const branch of branches) {
      expect(branch).not.toContain('drawV4UiOrnatePanel');
      expect(branch).not.toContain('drawV4UiPanel');
    }
    expect(mainSource).not.toContain('drawV4UiOrnatePanel');
    expect(v4UiSource).not.toContain("V4_UI_CELLS['ui.screen.frame']");
    expect(v4UiSource).not.toContain('V4_UI_SCREEN_FRAME_CORNER');
    expect(mainSource).not.toContain('surface.fillRect(0, 0, FIELD_W, FIELD_H)');
    expect(mainSource).not.toContain("surface.fillStyle = 'rgba(0,0,0,0.34)'");
  });

  test('the shell consumes every production UI ornament', () => {
    const cells = [
      'ui.title.masthead',
      'ui.menu.row',
      'ui.character.frame',
      'ui.dialogue.frame',
      'ui.status.frame',
      'ui.boss.ornament',
    ] as const;

    for (const cell of cells) {
      expect(mainSource).toContain(`drawV4Ui(surface, v4Ui, '${cell}'`);
    }
  });

  test('the title keeps its copy state-owned instead of baking it into the masthead', () => {
    const titleStart = mainSource.indexOf("if (view.kind === 'title')");
    const characterStart = mainSource.indexOf("if (view.kind === 'character-select')", titleStart);
    expect(titleStart).toBeGreaterThan(-1);
    expect(characterStart).toBeGreaterThan(titleStart);

    const titleSource = mainSource.slice(titleStart, characterStart);
    expect(titleSource).toContain("drawV4Ui(surface, v4Ui, 'ui.title.masthead'");
    expect(titleSource).toContain('drawViewLines(view.lines ?? []');
    expect(mainSource).toContain("import { GAME_VERSION_LABEL } from './version'");
    expect(titleSource).toContain(
      'surface.fillText(GAME_VERSION_LABEL, FIELD_W - 12, FIELD_H - 12)',
    );
  });

  test('the title menu and shell controller row stay bounded when the campaign list grows', () => {
    const titleStart = mainSource.indexOf("if (view.kind === 'title')");
    const characterStart = mainSource.indexOf("if (view.kind === 'character-select')", titleStart);
    const titleSource = mainSource.slice(titleStart, characterStart);

    expect(titleSource).toContain('const titleRows = showControllerAction ? 6 : 7');
    expect(titleSource).toContain('titleEntries.slice(titleFirst, titleFirst + titleRows)');
    expect(titleSource).toContain(
      '72 + (visibleTitleEntries.length + controllerRows) * 44',
    );
    expect(titleSource).toContain('positionControllerMenuAction(74, controllerBaseline, 332, 44)');
    expect(titleSource).toContain(
      "[controllerConnect.textContent ?? 'CONNECT CONTROLLER']",
    );
    expect(titleSource).toContain("if (titleFirst > 0) surface.fillText('\u25b2'");
    expect(titleSource).toContain('titleFirst + visibleTitleEntries.length < titleEntries.length');
    expect(titleSource).toContain("surface.fillText('\u25bc'");
  });

  test('character selection crops transparent actor padding and gives the body priority over its frame', () => {
    const characterStart = mainSource.indexOf("if (view.kind === 'character-select')");
    const difficultyStart = mainSource.indexOf("if (view.kind === 'difficulty-select')", characterStart);
    const characterSource = mainSource.slice(characterStart, difficultyStart);

    expect(characterSource).toContain('const characterLayout = V4_UI_SCREEN.character');
    expect(characterSource).toContain('const source = v4CharacterActorSource(frame)');
    expect(characterSource).toContain('source.x,');
    expect(characterSource).toContain('source.y,');
    expect(characterSource).not.toContain('frame.x + source.x');
    expect(characterSource).not.toContain('frame.y + source.y');
    expect(characterSource).toContain('actor.x,');
    expect(characterSource).toContain("drawV4Ui(surface, v4Ui, 'ui.character.frame'");
    expect(characterSource).not.toContain('46,\n        142,\n        178,\n        178');
  });

  test('run setup shares one six-row geometry with its click targets', () => {
    const difficultyStart = mainSource.indexOf("if (view.kind === 'difficulty-select')");
    const replayStart = mainSource.indexOf(
      "if (view.kind === 'replay-library'",
      difficultyStart,
    );
    const setupSource = mainSource.slice(difficultyStart, replayStart);

    expect(setupSource).toContain('const setup = V4_UI_SCREEN.setup');
    expect(setupSource).toContain('setup.firstBaseline + index * setup.step');
    expect(setupSource).toContain('v4MenuRowGeometry(y, setup.step)');
    expect(setupSource).toContain(
      'setup.firstBaseline,\n      345,\n      setup.step,',
    );
    expect(setupSource).toContain('drawViewLines(view.lines ?? [], cx, setup.blurbY');
  });

  test('live recording is declared by the state view and marked in the HUD', () => {
    expect(mainSource).toContain(
      'const recordingReplay = views.some((view) => view.recording === true)',
    );
    expect(mainSource).toContain("surface.fillText('● REPLAY REC'");
  });

  test('dialogue uses the shared layout and clips both portrait paths to its round well', () => {
    const dialogueStart = mainSource.indexOf('function drawDialogue(');
    const wrapStart = mainSource.indexOf('function wrapText(', dialogueStart);
    expect(dialogueStart).toBeGreaterThan(-1);
    expect(wrapStart).toBeGreaterThan(dialogueStart);

    const dialogueSource = mainSource.slice(dialogueStart, wrapStart);
    expect(dialogueSource).toContain('V4_UI_SCREEN.dialogue');
    expect(dialogueSource).toContain("drawV4Ui(surface, v4Ui, 'ui.dialogue.frame'");
    expect(dialogueSource).toContain('surface.arc(pCx, pCy, portraitSize / 2');
    const clip = dialogueSource.indexOf('surface.clip();');
    const builtInPortrait = dialogueSource.indexOf('drawV4Portrait(line.speaker, characterName');
    const fallbackPortrait = dialogueSource.indexOf('portraitImage(line.speaker)');
    expect(clip).toBeGreaterThan(-1);
    expect(builtInPortrait).toBeGreaterThan(clip);
    expect(fallbackPortrait).toBeGreaterThan(builtInPortrait);
  });

  test('the terminal clear has a distinct result seal', () => {
    const drawViewStart = mainSource.indexOf('function drawView(');
    const headingStart = mainSource.indexOf('function drawScreenHeading(', drawViewStart);
    const drawViewSource = mainSource.slice(drawViewStart, headingStart);
    expect(drawViewSource).toContain('V4_UI_SCREEN.status');
    expect(drawViewSource).toMatch(
      /view\.kind === 'cleared' && view\.title === 'ALL CLEAR'\s*\? 'ui\.status\.result'/,
    );
    expect(drawViewSource).toContain('drawV4Ui(surface, v4Ui, statusSeal');
  });

  test('status-card paint and click targets share the bounded menu window', () => {
    const drawViewStart = mainSource.indexOf('function drawView(');
    const headingStart = mainSource.indexOf('function drawScreenHeading(', drawViewStart);
    const drawViewSource = mainSource.slice(drawViewStart, headingStart);
    expect(drawViewSource).toContain('const statusMenu = v4StatusMenuLayout(');
    expect(drawViewSource).toContain('visibleStatusEntries');
    expect(drawViewSource).toContain('statusMenu.firstBaseline');
    expect(drawViewSource).toContain('statusMenu.step');
    expect(drawViewSource).toContain('statusMenu.first,');

    const rowStart = mainSource.indexOf('function drawMenuRows(');
    const rowEnd = mainSource.indexOf('function drawViewLines(', rowStart);
    expect(mainSource.slice(rowStart, rowEnd)).toContain(
      'v4MenuRowGeometry(baseline, step)',
    );
    expect(mainSource).toContain(
      'const row = v4MenuRowGeometry(\n'
      + '      firstBaseline + visibleIndex * step,\n'
      + '      step,\n'
      + '    );',
    );
  });

  test('production hides diagnostics and the Bloom control', () => {
    expect(mainSource).toContain("get('debug') === '1'");
    expect(mainSource).toContain("if (!DEBUG_UI || e.code !== 'KeyB'");
    expect(mainSource).toContain('if (DEBUG_UI) {');
  });

  test('screenshot capture reads the fully composited frame before encoding', () => {
    const renderStart = mainSource.indexOf('render() {');
    const renderEnd = mainSource.indexOf('\\n  },\\n});', renderStart);
    const renderSource = mainSource.slice(renderStart, renderEnd);
    const webgl = renderSource.indexOf('post.render();');
    const hud = renderSource.indexOf('drawOverlay(hud, views, endingMix);');
    const compose = renderSource.indexOf('frameCapture.compose(field, overlay);');
    const encode = renderSource.indexOf('frameCapture.png()');
    expect(webgl).toBeGreaterThan(-1);
    expect(hud).toBeGreaterThan(webgl);
    expect(compose).toBeGreaterThan(hud);
    expect(encode).toBeGreaterThan(compose);
  });

  test('video starts from tick-zero composition and stops only after a final composition', () => {
    const renderStart = mainSource.indexOf('render() {');
    const renderEnd = mainSource.indexOf('\n  },\n});', renderStart);
    const renderSource = mainSource.slice(renderStart, renderEnd);
    const webgl = renderSource.indexOf('post.render();');
    const hud = renderSource.indexOf('drawOverlay(hud, views, endingMix);');
    const compose = renderSource.indexOf('frameCapture.compose(field, overlay);');
    const start = renderSource.indexOf('startReplayExportRecording(exporting);');
    const stop = renderSource.indexOf('stopReplayExport(exporting);');
    expect(compose).toBeGreaterThan(hud);
    expect(hud).toBeGreaterThan(webgl);
    expect(start).toBeGreaterThan(compose);
    expect(stop).toBeGreaterThan(compose);

    const startFunction = mainSource.slice(
      mainSource.indexOf('function startReplayExportRecording('),
      mainSource.indexOf('function stopReplayExport(', mainSource.indexOf('function startReplayExportRecording(')),
    );
    const recorderStart = startFunction.indexOf('video.start()');
    const capturedTickZero = startFunction.indexOf('frameCapture.compose(field, overlay);');
    const arm = startFunction.indexOf('active.state.arm()');
    expect(capturedTickZero).toBeGreaterThan(recorderStart);
    expect(arm).toBeGreaterThan(capturedTickZero);
  });

  test('video export uses one mixed audio route and cancels when the tab hides', () => {
    expect(mainSource).toContain('const audioOutput = new AudioOutput();');
    expect(mainSource).toContain('new Audio({ output: audioOutput })');
    expect(mainSource).toContain(
      'new Music({ output: audioOutput, masterVolume: MUSIC_LEVEL })',
    );
    expect(mainSource).toContain('audioOutput.capture()');
    expect(mainSource).toContain('requireAudio: true');
    expect(mainSource).toContain(
      'Promise.all([audioOutput.unlock(), audio.unlock(), music.unlock()])',
    );
    expect(mainSource).toContain(
      '(!audio.unlocked || !music.unlocked || !audioOutput.unlocked)',
    );
    expect(mainSource).toContain(
      "current.fail('video export: cancelled because the tab was hidden')",
    );
  });

  test('an encoder that ends before requested shutdown fails even with recorded data', () => {
    const startFunction = mainSource.slice(
      mainSource.indexOf('function startReplayExportRecording('),
      mainSource.indexOf('function stopReplayExport(', mainSource.indexOf('function startReplayExportRecording(')),
    );
    expect(startFunction).toContain(
      'failReplayExport(active, unexpectedVideoCaptureEndError(outcome));',
    );
    expect(startFunction).not.toContain("outcome.status === 'recorded'");
  });

  test('replay import keeps the file chooser inside a direct DOM gesture', () => {
    expect(mainSource).toContain("button.dataset.action === 'import-replay'");
    expect(mainSource).toContain('openReplayImport();');
    expect(mainSource).toContain("}, { capture: true });");
    expect(mainSource).not.toContain('event.stopImmediatePropagation()');
    expect(mainSource).toContain('e.stopImmediatePropagation()');
  });

  test('replay deletion synchronizes the optimistic list and restores it on failure', () => {
    const deleteStart = mainSource.indexOf('onDeleteReplaySession: (session) => {');
    const errorStart = mainSource.indexOf('onReplayError:', deleteStart);
    const deleteSource = mainSource.slice(deleteStart, errorStart);
    expect(deleteStart).toBeGreaterThan(0);
    expect(deleteSource).toContain('const deleted = replayLibrary.remove(session.id)');
    expect(deleteSource.match(/context\.replaySessions = replayLibrary\.sessions/g))
      .toHaveLength(3);
    expect(deleteSource).toContain("showShellStatus('DELETE FAILED · SESSION KEPT', 'error')");
  });

  test('graze art is created only from the existing RunEvent', () => {
    expect(mainSource).toContain("if (event.type === 'graze')");
    expect(mainSource).toContain('grazeUiPulses.push({');
    expect(mainSource).toContain("drawV4Ui(surface, v4Ui, 'ui.graze.arc'");
  });

  test('dialogue uses the selected character label and preserves guest speaker strings', () => {
    expect(mainSource).toContain('getCharacter(characterName).label');
    expect(mainSource).toContain(': line.speaker;');
    expect(mainSource).not.toContain('line.speaker.toUpperCase()');
  });
});

describe('native laser bodies size visible paint, not transparent padding', () => {
  test('the shell corrects body thickness from the strip content height', () => {
    expect(mainSource).toContain('thickness: laserBodyDisplayThickness(');
    expect(mainSource).toContain('bodyStrip.frameH,');
    expect(mainSource).toContain('bodyStrip.contentH,');
    expect(mainSource).toContain('tileLength: skin.tileLength ?? bodyStrip.frameW');
  });

  test('only an authored player beam receives the persistent contact edge', () => {
    expect(mainSource).toContain("b.faction === 'player' && b.feedback === 'beam'");
  });
});

describe('native projectile paint contains its collision geometry', () => {
  test('ordinary bullets and missiles share the collision-safe size path', () => {
    expect(mainSource).toContain('const projectileStrip = spriteAtlas.strip(b.style.sprite)');
    expect(mainSource).toContain('bladeDisplaySize(b.style, b.bladeHalf, b.radius, projectileStrip)');
    expect(mainSource).not.toContain("onMissile\n      ? { width: b.style.width, height: b.style.height }");
  });
});
