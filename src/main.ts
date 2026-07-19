import * as THREE from 'three';
import { Loop } from './core/loop';
import { Button, Input } from './core/input';

/** Upstream's play-field dimensions. All content data is authored in this space. */
export const FIELD_W = 480;
export const FIELD_H = 480;

const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;

const renderer = new THREE.WebGLRenderer({ canvas: field, antialias: false });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(FIELD_W, FIELD_H, false);
renderer.setClearColor(0x000000, 1);

// Sprites are ordered explicitly, never by depth — CLAUDE.md rule 3.
renderer.sortObjects = false;

const scene = new THREE.Scene();

// Screen-space camera: (0,0) top-left, y down, one unit = one pixel, matching
// the coordinate space every value in `data/` is written in.
//
// The y-flip (top=0 above bottom=FIELD_H) gives the projection a negative Y
// scale, which reverses triangle winding — front faces would be culled. Sprite
// materials must therefore disable culling; see SPRITE_SIDE below.
const camera = new THREE.OrthographicCamera(0, FIELD_W, 0, FIELD_H, -1000, 1000);

/** Required by the y-down projection. Every sprite material must use it. */
export const SPRITE_SIDE = THREE.DoubleSide;

// Placeholder: a single quad, standing in for the sprite batches to come. It
// exists to prove the renderer, the coordinate space and the loop agree.
const probe = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    depthTest: false,
    side: SPRITE_SIDE,
  }),
);
scene.add(probe);

const input = new Input();
input.attach();

// Speeds are per tick, in pixels — the unit every value in `data/` uses.
const SPEED = 4;
const SLOW_SPEED = 1.6;

probe.position.set(FIELD_W / 2, FIELD_H - 64, 0);

const loop = new Loop({
  tick() {
    // Sample once, at the top of the tick. Never from render.
    input.sample();

    const speed = input.held(Button.Slow) ? SLOW_SPEED : SPEED;
    let dx = 0;
    let dy = 0;
    if (input.held(Button.Left)) dx -= 1;
    if (input.held(Button.Right)) dx += 1;
    if (input.held(Button.Up)) dy -= 1;
    if (input.held(Button.Down)) dy += 1;

    // Normalise the diagonal so it is not faster than an axis.
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }

    probe.position.x = clamp(probe.position.x + dx * speed, 12, FIELD_W - 12);
    probe.position.y = clamp(probe.position.y + dy * speed, 12, FIELD_H - 12);
    probe.rotation.z = input.held(Button.Shot) ? loop.count / 6 : 0;
  },

  render() {
    renderer.render(scene, camera);

    surface.clearRect(0, 0, overlay.width, overlay.height);
    surface.fillStyle = '#111';
    surface.fillRect(FIELD_W, 0, overlay.width - FIELD_W, overlay.height);
    surface.fillStyle = '#888';
    surface.font = '12px monospace';
    surface.fillText('DANMAKU', FIELD_W + 16, 28);
    surface.fillText(`tick ${loop.count}`, FIELD_W + 16, 48);
    surface.fillText(`three r${THREE.REVISION}`, FIELD_W + 16, 68);

    const pads = (navigator.getGamepads?.() ?? []).filter((p) => p?.connected);
    surface.fillStyle = pads.length > 0 ? '#6c9' : '#555';
    surface.fillText(`pad ${pads.length > 0 ? 'yes' : 'no'}`, FIELD_W + 16, 96);
    surface.fillStyle = '#888';
    surface.fillText(`btn ${input.buttons.toString(2).padStart(8, '0')}`, FIELD_W + 16, 116);
  },
});

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

loop.start();
