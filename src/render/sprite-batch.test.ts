import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Atlas } from './atlas';
import { SpriteBatch } from './sprite-batch';

function alphaValues(batch: SpriteBatch): Float32Array {
  const geometry = batch.mesh.geometry as THREE.InstancedBufferGeometry;
  return (geometry.getAttribute('iColor') as THREE.InstancedBufferAttribute).array as Float32Array;
}

describe('SpriteBatch group opacity', () => {
  test('defaults to identity and multiplies per-instance alpha', () => {
    const atlas = new Atlas(new THREE.Texture(), 16, 16).define('cell', {
      x: 0,
      y: 0,
      w: 16,
      h: 16,
    });
    const batch = new SpriteBatch(atlas, { capacity: 2 });

    batch.begin();
    batch.draw(8, 8, 'cell', { a: 0.5 });
    expect(batch.opacity).toBe(1);
    expect(alphaValues(batch)[3]).toBeCloseTo(0.5);

    batch.setOpacity(0.4);
    batch.draw(8, 8, 'cell', { a: 0.5 });
    expect(alphaValues(batch)[7]).toBeCloseTo(0.2);

    batch.dispose();
    atlas.texture.dispose();
  });

  test('clamps the group multiplier to the visible range', () => {
    const atlas = new Atlas(new THREE.Texture(), 16, 16).define('cell', {
      x: 0,
      y: 0,
      w: 16,
      h: 16,
    });
    const batch = new SpriteBatch(atlas);

    batch.setOpacity(-0.25);
    expect(batch.opacity).toBe(0);
    batch.begin();
    batch.draw(8, 8, 'cell');
    expect(alphaValues(batch)[3]).toBe(0);

    batch.setOpacity(1.25);
    expect(batch.opacity).toBe(1);
    batch.begin();
    batch.draw(8, 8, 'cell');
    expect(alphaValues(batch)[3]).toBe(1);

    batch.setOpacity(Number.NaN);
    expect(batch.opacity).toBe(0);

    batch.dispose();
    atlas.texture.dispose();
  });
});
