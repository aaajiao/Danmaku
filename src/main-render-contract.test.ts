import { describe, expect, test } from 'bun:test';

const mainSource = await Bun.file(new URL('./main.ts', import.meta.url)).text();
const v4UiSource = await Bun.file(new URL('./render/v4-ui.ts', import.meta.url)).text();

describe('the shell honours baked strip colour', () => {
  test('the shared tint resolver makes baked art identity-white', () => {
    expect(mainSource).toContain("atlas.strip(name).color === 'baked' ? undefined : tint");
    expect(mainSource).toContain('r: (source?.r ?? 1) + boost');
    expect(mainSource).toContain('g: (source?.g ?? 1) + boost');
    expect(mainSource).toContain('b: (source?.b ?? 1) + boost');
  });

  test('enemy, boss, ordinary bullet/missile and effect draws all use it', () => {
    expect(mainSource).toContain('stripTint(bulletAtlas, e.spec.sprite, e.spec.tint)');
    expect(mainSource).toContain('stripTint(bulletAtlas, boss.spec.sprite, boss.spec.tint, boost)');
    expect(mainSource).toContain('stripTint(spriteAtlas, b.style.sprite, b.style)');
    expect(mainSource).toContain('stripTint(atlas, p.spec.sprite, p.spec.tint)');
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
  test('player and bosses use their Ghost actor art before the generic portrait fallback', () => {
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

  test('v4 dialogue portraits keep nearest-neighbour pixel edges', () => {
    const portraitStart = mainSource.indexOf('function drawV4Portrait(');
    const dialogueStart = mainSource.indexOf('function drawDialogue(', portraitStart);
    const portraitSource = mainSource.slice(portraitStart, dialogueStart);
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
    expect(mainSource).toContain('background.step();\n    stageStructure.step();');
    expect(mainSource).toContain('background.transitionTo(scene, SCENE_FADE_TICKS);\n      stageStructure.transitionTo(scene, SCENE_FADE_TICKS);');
  });
});

describe('v4 UI presentation stays event- and tick-driven', () => {
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
  });

  test('the title menu stays bounded in its open composition when the campaign list grows', () => {
    const titleStart = mainSource.indexOf("if (view.kind === 'title')");
    const characterStart = mainSource.indexOf("if (view.kind === 'character-select')", titleStart);
    const titleSource = mainSource.slice(titleStart, characterStart);

    expect(titleSource).toContain('const titleRows = 7');
    expect(titleSource).toContain('titleEntries.slice(titleFirst, titleFirst + titleRows)');
    expect(titleSource).toContain('const titleMenuH = Math.max(128, 72 + visibleTitleEntries.length * 44)');
    expect(titleSource).toContain("if (titleFirst > 0) surface.fillText('\u25b2'");
    expect(titleSource).toContain('titleFirst + visibleTitleEntries.length < titleEntries.length');
    expect(titleSource).toContain("surface.fillText('\u25bc'");
  });

  test('character selection crops transparent actor padding and gives the body priority over its frame', () => {
    const characterStart = mainSource.indexOf("if (view.kind === 'character-select')");
    const difficultyStart = mainSource.indexOf("if (view.kind === 'difficulty-select')", characterStart);
    const characterSource = mainSource.slice(characterStart, difficultyStart);

    expect(characterSource).toContain('const characterLayout = V4_UI_SCREEN.character');
    expect(characterSource).toContain('frame.x + source.x');
    expect(characterSource).toContain('frame.y + source.y');
    expect(characterSource).toContain('actor.x,');
    expect(characterSource).toContain("drawV4Ui(surface, v4Ui, 'ui.character.frame'");
    expect(characterSource).not.toContain('46,\n        142,\n        178,\n        178');
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

  test('production hides diagnostics and the Bloom control', () => {
    expect(mainSource).toContain("get('debug') === '1'");
    expect(mainSource).toContain("if (!DEBUG_UI || e.code !== 'KeyB'");
    expect(mainSource).toContain('if (DEBUG_UI) {');
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
});

describe('native projectile paint contains its collision geometry', () => {
  test('ordinary bullets and missiles share the collision-safe size path', () => {
    expect(mainSource).toContain('const projectileStrip = spriteAtlas.strip(b.style.sprite)');
    expect(mainSource).toContain('bladeDisplaySize(b.style, b.bladeHalf, b.radius, projectileStrip)');
    expect(mainSource).not.toContain("onMissile\n      ? { width: b.style.width, height: b.style.height }");
  });
});
