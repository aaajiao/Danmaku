import { describe, expect, test } from 'bun:test';

const mainSource = await Bun.file(new URL('./main.ts', import.meta.url)).text();

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
    expect(mainSource).toContain('if (!drawV4Portrait(line.speaker, characterName');
    expect(mainSource).toContain('portraitImage(line.speaker)');
  });
});

describe('the Japanese STG hit point is presentation, not body geometry', () => {
  test('focus exposes the configured lethal centre on the overlay', () => {
    expect(mainSource).toContain('run?.player.alive && run.player.focused');
    expect(mainSource).toContain('radius: hitRadius');
    expect(mainSource).toContain('surface.arc(x, y, hitRadius');
    expect(mainSource).toContain("drawV4Ui(surface, v4Ui, 'ui.focus.ring'");
    expect(mainSource).toContain('(run.tickCount % 120)');
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

describe('v4 UI presentation stays event- and tick-driven', () => {
  test('state screens leave the background shader unobscured outside local panels', () => {
    expect(mainSource).toContain('drawV4UiPanel(surface, v4Ui');
    expect(mainSource).not.toContain('surface.fillRect(0, 0, FIELD_W, FIELD_H)');
    expect(mainSource).not.toContain("surface.fillStyle = 'rgba(0,0,0,0.34)'");
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
