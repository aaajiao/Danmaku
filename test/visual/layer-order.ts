/**
 * Pixel-readback proof that `renderOrder` actually orders sprites.
 *
 * ## Why this is not a unit test
 *
 * The bug this guards against was invisible to every check we had. Setting
 * `renderer.sortObjects = false` looks like it preserves explicit ordering; it
 * removes it, because `renderOrder` is read only by the render-list comparators
 * that flag skips. Draw order silently degrades to scene-graph insertion order.
 * Types were fine, the suite was green, and the ship drew over every bullet.
 *
 * Only the framebuffer knows. So this renders two overlapping quads on known
 * layers and reads the pixel where they cross, which needs a real GL context and
 * therefore a browser rather than `bun test`.
 *
 * ## Running it
 *
 *     bun run dev
 *     open http://localhost:3000/test/visual/layer-order.html
 *
 * The page prints PASS or FAIL, and sets `window.__layerOrderResult` so it can
 * be read by automation.
 */

import * as THREE from 'three';
import { Atlas } from '../../src/render/atlas';
import { SpriteBatch } from '../../src/render/sprite-batch';
import { Layer, Stage } from '../../src/render/stage';

const SIZE = 128;

/** A 1x1 white texel. Colour comes from the per-instance tint, as in the game. */
function whitePixelAtlas(): Atlas {
  const data = new Uint8Array([255, 255, 255, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, 1, 1);
  atlas.define('px', { x: 0, y: 0, w: 1, h: 1 });
  return atlas;
}

const canvas = document.getElementById('field') as HTMLCanvasElement;
const stage = new Stage({ canvas, width: SIZE, height: SIZE, maxPixelRatio: 1 });
const atlas = whitePixelAtlas();

// Red sits on a LOW layer, green on a HIGH one, and they overlap at the centre.
// Green must win. They are also added to the scene in the order that would make
// red win if `renderOrder` were being ignored — otherwise a broken build could
// pass by accident.
const low = new SpriteBatch(atlas, { capacity: 4, renderOrder: Layer.Enemies });
const high = new SpriteBatch(atlas, { capacity: 4, renderOrder: Layer.EnemyShots });

stage.add(high.mesh, 'EnemyShots');
stage.add(low.mesh, 'Enemies');

low.begin();
low.draw(SIZE / 2, SIZE / 2, 'px', { width: 64, height: 64, r: 1, g: 0, b: 0, a: 1 });
low.end();

high.begin();
high.draw(SIZE / 2, SIZE / 2, 'px', { width: 32, height: 32, r: 0, g: 1, b: 0, a: 1 });
high.end();

const gl = stage.renderer.getContext();

function sample(): { centre: Uint8Array; edge: Uint8Array } {
  stage.render();
  const centre = new Uint8Array(4);
  const edge = new Uint8Array(4);
  gl.readPixels(SIZE / 2, SIZE / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, centre);
  // A point inside the red quad but outside the green one, to prove both drew.
  gl.readPixels(SIZE / 2 + 24, SIZE / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, edge);
  return { centre, edge };
}

const { centre, edge } = sample();

const greenOnTop = centre[1]! > centre[0]!;
const redPresent = edge[0]! > edge[1]!;

/**
 * Prove the check can fail.
 *
 * A guard that has never been seen red is a guard nobody should trust. Turning
 * sorting off reproduces the original bug exactly, so red must win the centre
 * pixel. If it does not, this page is measuring something other than what it
 * claims and its PASS above is worthless.
 */
stage.renderer.sortObjects = false;
const broken = sample();
const mutationDetected = broken.centre[0]! > broken.centre[1]!;
stage.renderer.sortObjects = true;

const pass = greenOnTop && redPresent && mutationDetected;

const lines = [
  pass ? 'PASS' : 'FAIL',
  '',
  `centre pixel  rgba(${[...centre].join(', ')})`,
  `  expected green over red — renderOrder ${Layer.EnemyShots} above ${Layer.Enemies}`,
  `  green on top: ${greenOnTop}`,
  '',
  `edge pixel    rgba(${[...edge].join(', ')})`,
  `  expected red, proving the low layer drew at all: ${redPresent}`,
  '',
  `mutation      sortObjects=false → rgba(${[...broken.centre].join(', ')})`,
  `  expected red, proving this page can fail: ${mutationDetected}`,
  '',
  `renderer.sortObjects = ${stage.renderer.sortObjects}`,
];

document.getElementById('result')!.textContent = lines.join('\n');

declare global {
  interface Window {
    __layerOrderResult: {
      pass: boolean;
      centre: number[];
      edge: number[];
      mutationDetected: boolean;
    };
  }
}
window.__layerOrderResult = {
  pass,
  centre: [...centre],
  edge: [...edge],
  mutationDetected,
};
