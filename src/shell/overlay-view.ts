import type { StateView } from '../game/state';
import { getCharacter, type Run } from '../game/run';
import type { LoadedPacks } from '../packs/loader';
import type { Atlas } from '../render/atlas';
import { focusIndicatorLayout } from '../render/focus-indicator';
import { portraitImage, tintFor } from '../render/portrait';
import { stripFrame } from '../render/strip';
import {
  V4_BOSS_ACTORS,
  V4_PLAYER_ACTORS,
  type V4ActorAtlases,
} from '../render/v4-actors';
import {
  v4PortraitSource,
  v4PortraitSpec,
  v4PortraitStrip,
} from '../render/v4-portrait';
import {
  V4_CHARACTER_UI,
  V4_DIFFICULTY_UI,
  V4_UI_CELLS,
  V4_UI_SCREEN,
  drawV4Ui,
  v4CharacterActorSource,
  v4MenuRowGeometry,
  v4StatusMenuLayout,
  type V4UiCellName,
} from '../render/v4-ui';
import type { V4EndingMix } from '../v4/ending/presentation';
import type { EndingTraceRecorder } from '../v4/ending/trace';
import type { MenuActionLayout } from './menu-actions';

export interface OverlayGrazePulse {
  readonly run: Run;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  age: number;
}

export interface ControllerActionBounds {
  readonly x: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface OverlayControllerAction {
  readonly isVisible: () => boolean;
  readonly label: () => string;
  readonly isActive: () => boolean;
  readonly setBounds: (bounds: ControllerActionBounds) => void;
}

export interface OverlayViewDependencies {
  readonly surface: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  readonly fieldWidth: number;
  readonly fieldHeight: number;
  readonly versionLabel: string;
  readonly v4Ui: Atlas;
  readonly v4Actors: V4ActorAtlases;
  readonly pickupAtlas: Atlas;
  readonly hudIcons: LoadedPacks['hudIcons'];
  readonly debugUi: boolean;
  readonly isBloomEnabled: () => boolean;
  readonly drawCalls: () => number;
  readonly grazeUiPulses: readonly OverlayGrazePulse[];
  readonly grazeUiTicks: number;
  readonly endingTraceByRun: WeakMap<Run, EndingTraceRecorder>;
  readonly tallyCoinIcons: Map<string, HTMLCanvasElement>;
  readonly hideMenuClickTargets: () => void;
  readonly layoutMenuClickTargets: (layout: MenuActionLayout) => void;
  readonly controllerAction: OverlayControllerAction;
}

export interface OverlayViewFrame {
  readonly run: Run | undefined;
  readonly views: readonly StateView[];
  readonly endingMix: V4EndingMix | undefined;
}

export interface OverlayView {
  draw(frame: OverlayViewFrame): void;
}

/**
 * Canvas-authored browser chrome.
 *
 * The factory closes over resources and references supplied by `main.ts`, but
 * owns no run, state-machine, effect-queue, trace, DOM, or diagnostic state.
 * Every animated value remains a fixed-tick value supplied by the composition
 * root; this module has no wall clock.
 */
export function createOverlayView(deps: OverlayViewDependencies): OverlayView {
  const {
    surface,
    canvas,
    fieldWidth: FIELD_W,
    fieldHeight: FIELD_H,
    versionLabel,
    v4Ui,
    v4Actors,
    pickupAtlas,
    hudIcons,
    debugUi,
    isBloomEnabled,
    drawCalls,
    grazeUiPulses,
    grazeUiTicks,
    endingTraceByRun,
    tallyCoinIcons,
    hideMenuClickTargets,
    layoutMenuClickTargets,
    controllerAction,
  } = deps;

  /** CJK-capable fallback stack: guest-pack labels remain verbatim Unicode. */
  const UI_FONT = '"Hiragino Sans GB", "Yu Gothic", "Noto Sans CJK SC", system-ui, sans-serif';

  function uiFont(size: number, weight: 400 | 500 | 600 = 400): void {
    surface.font = `${weight} ${size}px ${UI_FONT}`;
  }

  function drawGrazeFeedback(run: Run): void {
    for (const pulse of grazeUiPulses) {
      if (pulse.run !== run) continue;
      const frame = Math.min(3, Math.floor(pulse.age / 4));
      const alpha = Math.max(0, 1 - pulse.age / grazeUiTicks);
      drawV4Ui(surface, v4Ui, 'ui.graze.arc', pulse.x - 16, pulse.y - 16, {
        frame,
        alpha,
        rotation: ((pulse.age + pulse.count * 2) % 32) * (Math.PI / 16),
      });
    }
  }

  /**
   * Draw the focused lethal centre after all WebGL and gameplay feedback.
   *
   * The outer authored ring is deliberately restrained. A near-black keyline
   * then occludes any additive respawn/bomb light directly under the real core,
   * and the final white disc uses `player.radius` unchanged.
   */
  function drawFocusIndicator(run: Run): void {
    if (!run.player.alive || !run.player.focused) return;
    const { x, y, radius } = run.player;
    const indicator = focusIndicatorLayout(x, y, radius, run.tickCount);
    surface.save();
    drawV4Ui(surface, v4Ui, 'ui.focus.ring', indicator.ringX, indicator.ringY, {
      width: indicator.ringSize,
      height: indicator.ringSize,
      rotation: indicator.ringRotation,
      alpha: indicator.ringAlpha,
    });

    surface.shadowBlur = 0;
    surface.fillStyle = 'rgba(2,5,10,0.96)';
    surface.beginPath();
    surface.arc(x, y, indicator.keylineRadius, 0, Math.PI * 2);
    surface.fill();

    surface.fillStyle = '#f5fbff';
    surface.beginPath();
    surface.arc(x, y, indicator.coreRadius, 0, Math.PI * 2);
    surface.fill();
    surface.restore();
  }

  /**
   * Draw the real route sampled from the terminal Run.
   *
   * Straight segments connect fixed-tick samples only; there is no curve
   * fitting, endpoint ornament, or invented "ideal" route.
   */
  function drawEndingTrace(run: Run, opacity: number): void {
    if (opacity <= 0.001) return;
    const recorder = endingTraceByRun.get(run);
    if (recorder === undefined) return;
    const segments = recorder.segments.filter((segment) => segment.length >= 2);
    if (segments.length === 0) return;

    const strokeSegments = (): void => {
      for (const segment of segments) {
        const first = segment[0]!;
        surface.beginPath();
        surface.moveTo(first.x, first.y);
        for (let index = 1; index < segment.length; index++) {
          const point = segment[index]!;
          surface.lineTo(point.x, point.y);
        }
        surface.stroke();
      }
    };

    surface.save();
    surface.lineCap = 'round';
    surface.lineJoin = 'round';
    surface.strokeStyle = `rgba(2, 5, 10, ${Math.min(0.62, opacity * 1.8)})`;
    surface.lineWidth = 4.5;
    strokeSegments();
    surface.strokeStyle = `rgba(158, 178, 193, ${Math.min(0.42, opacity)})`;
    surface.lineWidth = 1.25;
    strokeSegments();
    surface.restore();
  }

  function drawOverlay({
    run,
    views,
    endingMix,
  }: OverlayViewFrame): void {
    surface.clearRect(0, 0, canvas.width, canvas.height);
    hideMenuClickTargets();
    const recordingReplay = views.some((view) => view.recording === true);

    if (endingMix !== undefined) {
      // The ordinary HUD would turn the ending back into a live combat read.
      if (run !== undefined) drawEndingTrace(run, endingMix.trace);
    } else {
      if (run !== undefined) drawGrazeFeedback(run);
      drawHud(run, recordingReplay);
      if (run !== undefined) drawFocusIndicator(run);

      // Dialogue is declared run state and composites below modal state views.
      if (run) {
        const line = run.dialogue;
        if (line) drawDialogue(line, run.tickCount, run.characterName);
      }
    }

    for (const view of views) {
      if (view.kind === 'playing') continue;
      drawView(view);
    }
  }

  /**
   * The whole screen is the play field, so the HUD composites over it.
   * Edges and corners remain the negative-space budget; production luminance
   * stays well below bullets.
   */
  function drawHud(run: Run | undefined, recordingReplay = false): void {
    uiFont(11, 500);
    surface.textAlign = 'left';

    if (debugUi) {
      const bloomEnabled = isBloomEnabled();
      surface.fillStyle = bloomEnabled ? '#668a77' : '#555861';
      surface.fillText(`bloom ${bloomEnabled ? 'on' : 'off'} [B]`, 8, FIELD_H - 8);
    }

    if (!run) return;

    const p = run.player;
    const boss = run.boss.boss;
    const bossUp = boss?.alive === true;

    const topY = bossUp ? 50 : 16;
    drawV4Ui(surface, v4Ui, 'ui.hud.score', 8, topY - 12, { alpha: 0.9 });
    surface.fillStyle = '#d6e1e8';
    surface.fillText(`${p.score.toString().padStart(9, '0')}`, 29, topY);
    drawV4Ui(surface, v4Ui, 'ui.hud.graze', 8, topY + 3, { alpha: 0.8 });
    surface.fillStyle = '#8796a3';
    surface.fillText(`GRAZE ${p.graze}`, 29, topY + 15);

    surface.textAlign = 'right';
    surface.fillStyle = '#d6e1e8';
    const lives = run.config.infiniteLives === true ? '∞' : `${p.lives}`;
    hudResource(hudIcons.life, 'ui.hud.life', lives, FIELD_W - 8, topY);
    surface.fillStyle = '#91a0ad';
    hudResource(hudIcons.bomb, 'ui.hud.bomb', `${p.bombs}`, FIELD_W - 8, topY + 15);
    hudResource(undefined, 'ui.hud.power', `P ${p.power.toFixed(2)}`, FIELD_W - 52, topY + 15);

    surface.fillStyle = '#687783';
    surface.fillText(run.difficulty.toUpperCase(), FIELD_W - 8, topY + 31);
    if (run.playingBack) {
      surface.fillStyle = '#b6cfdb';
      surface.fillText('REPLAY', FIELD_W - 8, topY + 47);
    } else if (recordingReplay) {
      surface.fillStyle = '#d69aaa';
      surface.fillText('● REPLAY REC', FIELD_W - 8, topY + 47);
    }

    if (debugUi) {
      surface.fillStyle = '#59616b';
      surface.fillText(
        `${run.tickCount} t  ${run.bullets.count} b  ${drawCalls()} dc`,
        FIELD_W - 8,
        FIELD_H - 8,
      );
    }
    surface.textAlign = 'left';

    if (bossUp && boss) drawBossBar(boss);
  }

  /**
   * A right-aligned HUD resource: a pack icon when supplied, the engine-owned
   * v4 glyph otherwise. Position, size, and alpha remain engine-owned.
   */
  const HUD_ICON = 13;
  const HUD_ICON_GAP = 3;
  const HUD_ICON_ALPHA = 0.85;

  function hudResource(
    icon: HTMLImageElement | undefined,
    fallback: V4UiCellName,
    text: string,
    rightX: number,
    baselineY: number,
  ): void {
    surface.fillText(text, rightX, baselineY);
    const iconX = rightX - surface.measureText(text).width - HUD_ICON - HUD_ICON_GAP;
    if (icon === undefined) {
      drawV4Ui(surface, v4Ui, fallback, iconX, baselineY - HUD_ICON, {
        width: HUD_ICON,
        height: HUD_ICON,
        alpha: HUD_ICON_ALPHA,
      });
    } else {
      surface.save();
      surface.globalAlpha = HUD_ICON_ALPHA;
      surface.drawImage(icon, iconX, baselineY - HUD_ICON, HUD_ICON, HUD_ICON);
      surface.restore();
    }
  }

  function drawBossBar(boss: NonNullable<Run['boss']['boss']>): void {
    const spell = boss.phase.isSpell === true;
    drawV4Ui(surface, v4Ui, 'ui.boss.ornament', 80, 0, {
      width: 320,
      height: 52,
      alpha: 0.72,
    });
    drawUiBarFill(
      spell ? 'ui.boss.fill.spell' : 'ui.boss.fill.normal',
      110,
      8,
      boss.phaseHpFraction,
      260,
    );

    if (spell) {
      drawUiBarFill('ui.boss.timer', 110, 20, 1 - boss.phaseTimeFraction, 260);
    }

    const tint = tintFor(boss.name);
    surface.fillStyle = `rgb(${Math.round(tint.r * 215)},${Math.round(tint.g * 215)},${Math.round(tint.b * 225)})`;
    uiFont(9, 600);
    surface.textAlign = 'left';
    surface.fillText(boss.name, 84, 61);
    surface.fillStyle = spell ? '#edb8c8' : '#9caab5';
    surface.textAlign = 'right';
    surface.fillText(spell ? `✧ ${boss.phase.name}` : boss.phase.name, FIELD_W - 84, 61);
    surface.textAlign = 'left';
  }

  function drawUiBarFill(
    name: V4UiCellName,
    x: number,
    y: number,
    fraction: number,
    displayWidth?: number,
  ): void {
    const spec = V4_UI_CELLS[name];
    const visible = Math.max(0, Math.min(spec.frameW, Math.round(spec.frameW * fraction)));
    if (visible === 0) return;
    const visibleDisplayWidth = (displayWidth ?? spec.displayW) * (visible / spec.frameW);
    surface.save();
    surface.imageSmoothingEnabled = false;
    surface.drawImage(
      v4Ui.texture.image as CanvasImageSource,
      spec.x,
      spec.y,
      visible,
      spec.frameH,
      x,
      y,
      visibleDisplayWidth,
      spec.displayH,
    );
    surface.restore();
  }

  function drawView(view: StateView): void {
    surface.save();
    const age = view.age ?? 0;
    const cx = FIELD_W / 2;

    if (view.kind === 'title') {
      const masthead = V4_UI_CELLS['ui.title.masthead'];
      drawV4Ui(surface, v4Ui, 'ui.title.masthead', cx - masthead.displayW / 2, 38, {
        alpha: 0.96,
      });
      surface.textAlign = 'center';
      uiFont(27, 600);
      surface.fillStyle = '#e1ebf1';
      surface.fillText(view.title ?? 'DANMAKU', cx, 98);
      uiFont(11, 500);
      surface.fillStyle = '#8596a3';
      surface.fillText('余白御寮  /  THE NEGATIVE-SPACE WARD', cx, 152);
      drawViewLines(view.lines ?? [], cx, 212, 320, '#8d9da8');

      const titleEntries = view.menu ?? [];
      const titleSelected = Math.max(
        0,
        Math.min(titleEntries.length - 1, view.selected ?? 0),
      );
      const showControllerAction = controllerAction.isVisible();
      const titleRows = showControllerAction ? 6 : 7;
      const titleFirst = Math.max(
        0,
        Math.min(
          titleSelected - Math.floor(titleRows / 2),
          titleEntries.length - titleRows,
        ),
      );
      const visibleTitleEntries = titleEntries.slice(titleFirst, titleFirst + titleRows);
      const controllerRows = showControllerAction ? 1 : 0;
      const titleMenuH = Math.max(
        128,
        72 + (visibleTitleEntries.length + controllerRows) * 44,
      );
      drawMenuRows(visibleTitleEntries, titleSelected - titleFirst, 74, 302, 332, 44, age);
      layoutMenuClickTargets({
        state: view.kind,
        entries: visibleTitleEntries,
        selected: titleSelected,
        count: titleEntries.length,
        x: 74,
        firstBaseline: 302,
        width: 332,
        step: 44,
        indexOffset: titleFirst,
      });
      if (showControllerAction) {
        const controllerBaseline = 302 + visibleTitleEntries.length * 44;
        positionControllerMenuAction(74, controllerBaseline, 332, 44);
        drawMenuRows(
          [controllerAction.label()],
          controllerAction.isActive() ? 0 : undefined,
          74,
          controllerBaseline,
          332,
          44,
          age,
        );
      }
      surface.textAlign = 'center';
      uiFont(9, 500);
      surface.fillStyle = '#71808c';
      if (titleFirst > 0) surface.fillText('▲', cx, 272);
      if (titleFirst + visibleTitleEntries.length < titleEntries.length) {
        surface.fillText('▼', cx, 246 + titleMenuH - 12);
      }
      surface.textAlign = 'right';
      uiFont(9, 500);
      surface.fillStyle = '#71808c';
      surface.fillText(versionLabel, FIELD_W - 12, FIELD_H - 12);
      surface.restore();
      return;
    }

    if (view.kind === 'character-select') {
      drawScreenHeading(view.title ?? 'SELECT', 72);
      const previewActor = view.character === undefined
        ? undefined
        : V4_PLAYER_ACTORS[view.character];
      const previewAtlas = v4Actors.players;
      const identity = view.character === undefined
        ? undefined
        : V4_CHARACTER_UI[view.character as keyof typeof V4_CHARACTER_UI];
      const characterLayout = V4_UI_SCREEN.character;
      if (previewActor !== undefined && previewAtlas?.has(previewActor.strip)) {
        const strip = previewAtlas.strip(previewActor.strip);
        const frame = previewAtlas.frameOf(strip, 2);
        const source = v4CharacterActorSource(frame);
        const actor = characterLayout.actor;
        surface.imageSmoothingEnabled = false;
        surface.globalAlpha = 0.96;
        surface.drawImage(
          previewAtlas.texture.image as CanvasImageSource,
          source.x,
          source.y,
          source.w,
          source.h,
          actor.x,
          actor.y,
          actor.w,
          actor.h,
        );
        surface.globalAlpha = 1;
      } else if (view.character !== undefined) {
        const fallback = characterLayout.fallback;
        surface.drawImage(
          portraitImage(view.character),
          fallback.x,
          fallback.y,
          fallback.w,
          fallback.h,
        );
      }
      const characterFrame = characterLayout.frame;
      drawV4Ui(surface, v4Ui, 'ui.character.frame', characterFrame.x, characterFrame.y, {
        width: characterFrame.w,
        height: characterFrame.h,
        alpha: 0.92,
      });
      if (identity !== undefined) {
        const crest = characterLayout.crest;
        drawV4Ui(
          surface,
          v4Ui,
          identity.crest,
          crest.x,
          crest.y,
          { width: crest.w, height: crest.h },
        );
      }
      const menu = characterLayout.menu;
      const characterEntries = view.menu ?? [];
      drawMenuRows(
        characterEntries,
        view.selected,
        menu.x,
        menu.y,
        menu.w,
        menu.rowH,
        age,
      );
      layoutMenuClickTargets({
        state: view.kind,
        entries: characterEntries,
        selected: view.selected ?? 0,
        count: characterEntries.length,
        x: menu.x,
        firstBaseline: menu.y,
        width: menu.w,
        step: menu.rowH,
      });
      const copy = characterLayout.copy;
      drawViewLines(view.lines ?? [], copy.x, copy.y, copy.w, '#93a2ae');
      surface.restore();
      return;
    }

    if (view.kind === 'difficulty-select') {
      drawScreenHeading(view.title ?? 'RUN SETUP', 78);
      const difficultyEntries = view.menu ?? [];
      const setup = V4_UI_SCREEN.setup;
      difficultyEntries.forEach((entry, index) => {
        const y = setup.firstBaseline + index * setup.step;
        const active = index === view.selected;
        const seal = V4_DIFFICULTY_UI[entry as keyof typeof V4_DIFFICULTY_UI];
        const row = v4MenuRowGeometry(y, setup.step);
        drawMenuRowFrame(148, row.top, 270, row.height, active);
        if (seal !== undefined) {
          drawV4Ui(surface, v4Ui, seal, 96, y - 27, {
            alpha: active ? 1 : 0.55,
          });
        } else {
          drawV4Ui(surface, v4Ui, 'ui.assist.seal', 96, y - 27, {
            alpha: active ? 1 : 0.55,
          });
        }
        if (active) {
          drawV4Ui(surface, v4Ui, 'ui.cursor', 73, y - 15, {
            rotation: (age % 80) * (Math.PI / 40),
          });
        }
        surface.textAlign = 'left';
        uiFont(13, active ? 600 : 400);
        surface.fillStyle = active ? '#e2ebf1' : '#71808c';
        surface.fillText(entry, 164, y + 4);
      });
      layoutMenuClickTargets({
        state: view.kind,
        entries: difficultyEntries,
        selected: view.selected ?? 0,
        count: difficultyEntries.length,
        x: 73,
        firstBaseline: setup.firstBaseline,
        width: 345,
        step: setup.step,
      });
      drawViewLines(view.lines ?? [], cx, setup.blurbY, 318, '#96a6b2');
      surface.restore();
      return;
    }

    if (view.kind === 'replay-library' || view.kind === 'replay-session') {
      drawScreenHeading(view.title ?? 'REPLAYS', 76);
      drawViewLines(view.lines ?? [], cx, 118, 336, '#8d9da8');
      const entries = view.menu ?? [];
      const selected = Math.max(0, Math.min(entries.length - 1, view.selected ?? 0));
      const visibleRows = 8;
      const first = Math.max(
        0,
        Math.min(
          selected - Math.floor(visibleRows / 2),
          entries.length - visibleRows,
        ),
      );
      const visible = entries.slice(first, first + visibleRows);
      drawMenuRows(visible, selected - first, 64, 208, 352, 48, age);
      layoutMenuClickTargets({
        state: view.kind,
        entries: visible,
        selected,
        count: entries.length,
        x: 64,
        firstBaseline: 208,
        width: 352,
        step: 48,
        indexOffset: first,
        actions: view.menuActions,
      });
      surface.textAlign = 'center';
      uiFont(9, 500);
      surface.fillStyle = '#71808c';
      if (first > 0) surface.fillText('▲', cx, 176);
      if (first + visible.length < entries.length) surface.fillText('▼', cx, 612);
      surface.restore();
      return;
    }

    if (view.kind === 'ending') {
      drawEndingView(view);
      surface.restore();
      return;
    }

    const { x: statusX, y: statusY, w: statusW, h: statusH } = V4_UI_SCREEN.status;
    surface.save();
    surface.fillStyle = 'rgba(4, 7, 12, 0.88)';
    surface.fillRect(
      statusX + 18,
      statusY + 22,
      statusW - 36,
      statusH - 44,
    );
    surface.restore();
    drawV4Ui(surface, v4Ui, 'ui.status.frame', statusX, statusY, {
      width: statusW,
      height: statusH,
      alpha: 0.94,
    });
    const sealByKind: Partial<Record<string, V4UiCellName>> = {
      pause: 'ui.status.pause',
      'replay-pause': 'ui.status.pause',
      cleared: 'ui.status.clear',
      'game-over': 'ui.status.gameover',
    };
    const statusSeal = view.kind === 'cleared' && view.title === 'ALL CLEAR'
      ? 'ui.status.result'
      : sealByKind[view.kind] ?? 'ui.status.result';
    drawV4Ui(surface, v4Ui, statusSeal, cx - 28, 132, {});
    if (view.title !== undefined) drawScreenHeading(view.title, 224);
    drawV4Ui(surface, v4Ui, 'ui.divider', 110, 242, {
      width: 260,
      alpha: 0.68,
    });
    let y = view.title === undefined ? 230 : 274;
    y = drawViewLines(view.lines ?? [], cx, y, 270, '#9cabb6');
    if (view.tally && view.tally.length > 0) {
      y += 8;
      drawCoinTally(view.tally, cx, y, age);
      y += 28;
    }
    const statusEntries = view.menu ?? [];
    const statusSelected = Math.max(
      0,
      Math.min(statusEntries.length - 1, view.selected ?? 0),
    );
    const statusMenu = v4StatusMenuLayout(
      y,
      statusEntries.length,
      statusSelected,
    );
    const visibleStatusEntries = statusEntries.slice(
      statusMenu.first,
      statusMenu.first + statusMenu.visibleCount,
    );
    drawMenuRows(
      visibleStatusEntries,
      statusMenu.selected,
      112,
      statusMenu.firstBaseline,
      256,
      statusMenu.step,
      age,
    );
    layoutMenuClickTargets({
      state: view.kind,
      entries: visibleStatusEntries,
      selected: statusSelected,
      count: statusEntries.length,
      x: 112,
      firstBaseline: statusMenu.firstBaseline,
      width: 256,
      step: statusMenu.step,
      indexOffset: statusMenu.first,
      actions: view.menuActions,
    });
    surface.textAlign = 'center';
    uiFont(9, 500);
    surface.fillStyle = '#71808c';
    const statusHintX = statusX + statusW - 14;
    if (statusMenu.first > 0) {
      surface.fillText('▲', statusHintX, statusMenu.firstBaseline + 3);
    }
    if (statusMenu.first + statusMenu.visibleCount < statusEntries.length) {
      const lastBaseline = (
        statusMenu.firstBaseline
        + (statusMenu.visibleCount - 1) * statusMenu.step
      );
      surface.fillText('▼', statusHintX, lastBaseline + 3);
    }
    surface.restore();
  }

  /**
   * The ending is an open composition, not another opaque result card.
   * A local radial ink wash protects only the copy.
   */
  function drawEndingView(view: StateView): void {
    const page = view.endingPage;
    const pageIndex = Math.max(0, Math.min(2, page?.index ?? 0));
    const age = page?.age ?? view.age ?? 0;
    const rawAppearance = Math.max(0, Math.min(1, age / 18));
    const appearance = rawAppearance * rawAppearance * (3 - 2 * rawAppearance);
    const cx = FIELD_W / 2;

    surface.save();
    surface.globalAlpha = appearance;
    const wash = surface.createRadialGradient(cx, 250, 18, cx, 250, 196);
    wash.addColorStop(0, 'rgba(3, 6, 11, 0.72)');
    wash.addColorStop(0.56, 'rgba(3, 6, 11, 0.42)');
    wash.addColorStop(1, 'rgba(3, 6, 11, 0)');
    surface.fillStyle = wash;
    surface.fillRect(42, 68, FIELD_W - 84, 398);
    surface.restore();

    const ornamentAlpha = [0.36, 0.25, 0.14][pageIndex]! * appearance;
    drawV4Ui(surface, v4Ui, 'ui.status.ending', cx - 18, 112, {
      width: 36,
      height: 36,
      alpha: ornamentAlpha,
    });
    drawV4Ui(surface, v4Ui, 'ui.divider', cx - 80, 168, {
      width: 160,
      alpha: ornamentAlpha * 1.35,
    });

    surface.save();
    surface.globalAlpha = appearance;
    const copyY = pageIndex === 1 ? 238 : 208;
    drawViewLines(view.lines ?? [], cx, copyY, 306, '#aab8c2');
    surface.restore();

    drawV4Ui(surface, v4Ui, 'ui.prompt', cx - 56, 536, {
      alpha: 0.34 + appearance * 0.32,
    });
    surface.textAlign = 'center';
    uiFont(10, 600);
    surface.fillStyle = `rgba(194, 206, 214, ${0.52 + appearance * 0.26})`;
    surface.fillText('CONTINUE', cx, 552);
  }

  /** Align the real WebHID click target with its canvas-authored menu row. */
  function positionControllerMenuAction(
    x: number,
    baseline: number,
    width: number,
    step: number,
  ): void {
    const row = v4MenuRowGeometry(baseline, step);
    controllerAction.setBounds({
      x,
      top: row.top,
      width,
      height: row.height,
    });
  }

  function drawScreenHeading(title: string, baseline: number): void {
    surface.textAlign = 'center';
    uiFont(20, 600);
    surface.fillStyle = '#e0eaf0';
    surface.fillText(title, FIELD_W / 2, baseline);
  }

  function drawMenuRows(
    entries: readonly string[],
    selected: number | undefined,
    x: number,
    y: number,
    width: number,
    step: number,
    age: number,
  ): void {
    entries.forEach((entry, index) => {
      const active = index === selected;
      const baseline = y + index * step;
      const row = v4MenuRowGeometry(baseline, step);
      drawMenuRowFrame(x + 16, row.top, width - 16, row.height, active);
      if (active) {
        drawV4Ui(surface, v4Ui, 'ui.cursor', x, baseline - 16, {
          alpha: 0.95,
          rotation: (age % 120) * (Math.PI / 60),
        });
      }
      surface.textAlign = 'center';
      uiFont(12, active ? 600 : 400);
      surface.fillStyle = active ? '#e1ebf1' : '#697783';
      // Draw the source string verbatim: pack labels may be namespaced or Unicode.
      surface.fillText(entry, x + width / 2, baseline, width - 34);
    });
  }

  /** One generated row silhouette, modulated rather than replaced by selection. */
  function drawMenuRowFrame(
    x: number,
    top: number,
    width: number,
    height: number,
    active: boolean,
  ): void {
    drawV4Ui(surface, v4Ui, 'ui.menu.row', x, top, {
      width,
      height,
      alpha: active ? 0.78 : 0.2,
    });
  }

  function drawViewLines(
    lines: readonly string[],
    cx: number,
    startY: number,
    maxWidth: number,
    colour: string,
  ): number {
    surface.textAlign = 'center';
    uiFont(11, 400);
    surface.fillStyle = colour;
    let y = startY;
    for (const value of lines) {
      // An authored empty line is vertical punctuation, not absent data.
      if (value === '') {
        y += 17;
        continue;
      }
      for (const row of wrapText(value, maxWidth)) {
        surface.fillText(row, cx, y);
        y += 17;
      }
    }
    return y;
  }

  /**
   * The results-card coin tally resolves each state-owned sprite name against
   * the pickup atlas. The frame clock is the result state's fixed-tick age.
   */
  const TALLY_COIN_BOX = 16;
  const TALLY_COIN_LABEL_GAP = 5;

  /**
   * Cache one 16px result-card icon per tally strip. The cache instance remains
   * owned by the composition root and is merely filled here.
   */
  function tallyCoinIcon(sprite: string, age: number): HTMLCanvasElement {
    const strip = pickupAtlas.strip(sprite);
    const frameIndex = stripFrame(strip, age);
    const key = `${sprite}:${frameIndex}`;
    const cached = tallyCoinIcons.get(key);
    if (cached !== undefined) return cached;

    const icon = document.createElement('canvas');
    icon.width = TALLY_COIN_BOX;
    icon.height = TALLY_COIN_BOX;
    const iconSurface = icon.getContext('2d');
    if (iconSurface === null) {
      throw new Error('2D canvas unavailable for tally coin');
    }
    iconSurface.imageSmoothingEnabled = false;

    const frame = pickupAtlas.frameOf(strip, frameIndex);
    const displayW = strip.displayW ?? strip.frameW;
    const displayH = strip.displayH ?? strip.frameH;
    const fit = Math.min(TALLY_COIN_BOX / displayW, TALLY_COIN_BOX / displayH);
    const drawW = displayW * fit;
    const drawH = displayH * fit;
    const drawX = (TALLY_COIN_BOX - drawW) / 2;
    const drawY = (TALLY_COIN_BOX - drawH) / 2;
    iconSurface.drawImage(
      pickupAtlas.texture.image as CanvasImageSource,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      drawX,
      drawY,
      drawW,
      drawH,
    );
    if (strip.color !== 'baked') {
      const [tr, tg, tb] = sprite.includes('gold')
        ? [230, 194, 74]
        : [198, 204, 214];
      const pixels = iconSurface.getImageData(
        0,
        0,
        TALLY_COIN_BOX,
        TALLY_COIN_BOX,
      );
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = Math.round((pixels.data[index] ?? 0) * tr / 255);
        pixels.data[index + 1] = Math.round(
          (pixels.data[index + 1] ?? 0) * tg / 255,
        );
        pixels.data[index + 2] = Math.round(
          (pixels.data[index + 2] ?? 0) * tb / 255,
        );
      }
      iconSurface.putImageData(pixels, 0, 0);
    }
    tallyCoinIcons.set(key, icon);
    return icon;
  }

  function drawCoinTally(
    tally: readonly { readonly sprite: string; readonly count: number }[],
    cx: number,
    baselineY: number,
    age: number,
  ): void {
    uiFont(12, 500);
    surface.textAlign = 'left';
    const iconW = TALLY_COIN_BOX + TALLY_COIN_LABEL_GAP;
    const gap = 18;
    const labels = tally.map((entry) => `${entry.count}`);
    const widths = tally.map(
      (_, index) => iconW + surface.measureText(labels[index] ?? '').width,
    );
    const total = widths.reduce((a, b) => a + b, 0)
      + gap * Math.max(0, tally.length - 1);

    const centreY = baselineY - 4;
    let x = cx - total / 2;
    surface.save();
    surface.imageSmoothingEnabled = false;
    tally.forEach((entry, index) => {
      surface.drawImage(
        tallyCoinIcon(entry.sprite, age),
        x,
        centreY - TALLY_COIN_BOX / 2,
      );
      surface.fillStyle = '#aab7c0';
      surface.fillText(labels[index] ?? '', x + iconW, baselineY);
      x += (widths[index] ?? 0) + gap;
    });
    surface.restore();
    surface.textAlign = 'center';
  }

  const DIALOG_PORTRAIT_PAD = 14;
  const DIALOG_PORTRAIT_MAX = 112;
  const DIALOG_PORTRAIT_INSET = 32;

  /** Draw the v4 close-up, falling back to the field actor for older packs. */
  function drawV4Portrait(
    speaker: string,
    characterName: string,
    x: number,
    y: number,
    size: number,
  ): boolean {
    const portraitStrip = v4PortraitStrip(speaker, characterName);
    const portraitAtlas = v4Actors.portraits;
    if (
      portraitStrip !== undefined
      && portraitAtlas !== undefined
      && portraitAtlas.has(portraitStrip)
    ) {
      const frame = portraitAtlas.frameOf(portraitAtlas.strip(portraitStrip), 0);
      surface.save();
      surface.imageSmoothingEnabled = true;
      surface.imageSmoothingQuality = 'high';
      surface.drawImage(
        portraitAtlas.texture.image as CanvasImageSource,
        frame.x,
        frame.y,
        frame.w,
        frame.h,
        x,
        y,
        size,
        size,
      );
      surface.restore();
      return true;
    }

    const player = speaker === 'player'
      ? V4_PLAYER_ACTORS[characterName]
      : undefined;
    const boss = V4_BOSS_ACTORS[speaker];
    const actor = player ?? boss;
    const portrait = v4PortraitSpec(speaker, characterName);
    if (actor === undefined || portrait === undefined) return false;

    const atlas = player === undefined ? v4Actors.bosses : v4Actors.players;
    if (atlas === undefined || !atlas.has(actor.strip)) return false;
    const frame = atlas.frameOf(atlas.strip(actor.strip), portrait.pose);
    const source = v4PortraitSource(frame, portrait);
    surface.save();
    surface.imageSmoothingEnabled = false;
    surface.drawImage(
      atlas.texture.image as CanvasImageSource,
      source.x,
      source.y,
      source.w,
      source.h,
      x,
      y,
      size,
      size,
    );
    surface.restore();
    return true;
  }

  /**
   * The pre-boss exchange box stays low on the frame and is animated only by
   * `tickCount`, never a wall clock.
   */
  function drawDialogue(
    line: { speaker: string; text: string; index: number; count: number },
    tickCount: number,
    characterName: string,
  ): void {
    const {
      x: boxX,
      y: boxY,
      w: boxW,
      h: boxH,
      copy,
    } = V4_UI_SCREEN.dialogue;
    const playerIdentity = line.speaker === 'player'
      ? V4_CHARACTER_UI[characterName as keyof typeof V4_CHARACTER_UI]
      : undefined;
    const seeded = tintFor(line.speaker);
    const tint = playerIdentity === undefined
      ? seeded
      : {
        r: playerIdentity.rgb[0] / 255,
        g: playerIdentity.rgb[1] / 255,
        b: playerIdentity.rgb[2] / 255,
      };
    const speakerLabel = line.speaker === 'player'
      ? getCharacter(characterName).label
      : line.speaker;

    const portraitSize = Math.min(
      DIALOG_PORTRAIT_MAX,
      boxH - DIALOG_PORTRAIT_PAD * 2,
    );
    const pX = boxX + DIALOG_PORTRAIT_INSET;
    const pY = boxY + (boxH - portraitSize) / 2;
    const pCx = pX + portraitSize / 2;
    const pCy = pY + portraitSize / 2;
    const textX = boxX + copy.leftInset;

    surface.save();
    surface.fillStyle = 'rgba(4, 7, 12, 0.84)';
    surface.beginPath();
    surface.arc(pCx, pCy, portraitSize / 2 + 8, 0, Math.PI * 2);
    surface.rect(textX - 16, boxY + 18, boxX + boxW - textX, boxH - 36);
    surface.fill();
    surface.restore();

    drawV4Ui(surface, v4Ui, 'ui.dialogue.frame', boxX, boxY, {
      width: boxW,
      height: boxH,
      alpha: 0.94,
    });

    surface.save();
    surface.beginPath();
    surface.arc(pCx, pCy, portraitSize / 2, 0, Math.PI * 2);
    surface.clip();
    if (!drawV4Portrait(line.speaker, characterName, pX, pY, portraitSize)) {
      surface.drawImage(
        portraitImage(line.speaker),
        pX,
        pY,
        portraitSize,
        portraitSize,
      );
    }
    surface.restore();

    surface.save();
    surface.strokeStyle = `rgba(${Math.round(tint.r * 200)},${Math.round(tint.g * 200)},${Math.round(tint.b * 210)},0.75)`;
    surface.lineWidth = 1;
    surface.beginPath();
    surface.arc(pCx, pCy, portraitSize / 2 - 0.5, 0, Math.PI * 2);
    surface.stroke();
    surface.restore();
    if (playerIdentity !== undefined) {
      drawV4Ui(
        surface,
        v4Ui,
        playerIdentity.crest,
        pX - 7,
        pY - 7,
        { width: 30, height: 30 },
      );
    }

    const textW = boxX + boxW - copy.rightInset - textX;
    surface.textAlign = 'left';

    drawV4Ui(surface, v4Ui, 'ui.nameplate', textX - 7, boxY + copy.nameplateTop, {
      width: Math.min(248, textW + 7),
      height: 28,
      alpha: 0.72,
    });
    uiFont(12, 600);
    surface.fillStyle = `rgb(${Math.round(tint.r * 220)},${Math.round(tint.g * 220)},${Math.round(tint.b * 230)})`;
    surface.fillText(speakerLabel, textX, boxY + copy.headerBaseline);

    uiFont(12, 400);
    surface.fillStyle = '#9a9aa4';
    let lineY = boxY + copy.bodyBaseline;
    for (const row of wrapText(line.text, textW)) {
      surface.fillText(row, textX, lineY);
      lineY += 16;
    }

    surface.fillStyle = '#66737e';
    surface.textAlign = 'right';
    surface.fillText(
      `${line.index + 1} / ${line.count}`,
      boxX + boxW - copy.rightInset,
      boxY + copy.footerBaseline,
    );

    if (Math.floor(tickCount / 20) % 3 !== 2) {
      surface.fillText(
        '▸ SHOT',
        boxX + boxW - copy.rightInset,
        boxY + copy.promptBaseline,
      );
    }
    surface.textAlign = 'left';
  }

  /**
   * Greedy word-wrap against the current font. A lone token wider than the
   * column breaks at the character level so guest-pack text cannot escape.
   */
  function wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const rows: string[] = [];
    let row = '';
    for (const word of words) {
      const candidate = row === '' ? word : `${row} ${word}`;
      if (
        row !== ''
        && surface.measureText(candidate).width > maxWidth
      ) {
        rows.push(row);
        row = word;
      } else {
        row = candidate;
      }
      while (
        row.length > 1
        && surface.measureText(row).width > maxWidth
      ) {
        let cut = 1;
        while (
          cut < row.length
          && surface.measureText(row.slice(0, cut + 1)).width <= maxWidth
        ) {
          cut++;
        }
        rows.push(row.slice(0, cut));
        row = row.slice(cut);
      }
    }
    if (row !== '') rows.push(row);
    return rows;
  }

  return { draw: drawOverlay };
}
