/**
 * The GL-free half of `background.ts`: the registry and the shader assembly.
 *
 * The `Background` class itself is verified by hand — see the manual check in
 * that file's header — because a full-screen quad only proves anything against a
 * framebuffer. What is testable here is the part that would break silently: a
 * change to the standard uniform block invalidates every background ever
 * written, and the failure surfaces as a shader compile error in a browser
 * nobody has opened yet rather than as a red test.
 */

import { describe, expect, test } from 'bun:test';
import {
  BACKGROUND_ART_MODE_VALUE,
  backgroundNames,
  composeFragmentShader,
  defineBackground,
  getBackgroundSpec,
} from './background';

describe('registry', () => {
  // Nothing here names a shipped scene. This file imports the engine and only
  // the engine, so it stays green if every background in the game is deleted —
  // which is the point of them living in `./backgrounds/` rather than in here.
  // The scenes are covered by `backgrounds/index.test.ts`.

  test('a background is added by writing a spec, not by editing the module', () => {
    defineBackground('test-registry', { fragment: 'vec3 background(vec2 uv) { return vec3(0.0); }' });

    expect(backgroundNames()).toContain('test-registry');
    expect(getBackgroundSpec('test-registry').scrollSpeed).toBeUndefined();
  });

  test('rejects a duplicate name rather than silently replacing', () => {
    defineBackground('test-duplicate', { fragment: '' });
    expect(() => defineBackground('test-duplicate', { fragment: '' })).toThrow(
      'background "test-duplicate" is already defined',
    );
  });

  test('an unknown name fails loudly, at construction rather than in the shader', () => {
    expect(() => getBackgroundSpec('test-absent')).toThrow('unknown background "test-absent"');
  });

  test('a painted plate remains URL-only registry data until browser boot', () => {
    defineBackground('test-painted', {
      fragment: 'vec3 background(vec2 uv) { return vec3(uv, 0.0); }',
      art: { url: '/test-painted.png', width: 480, height: 640 },
    });

    expect(getBackgroundSpec('test-painted').art).toEqual({
      url: '/test-painted.png',
      width: 480,
      height: 640,
    });
    expect(BACKGROUND_ART_MODE_VALUE).toEqual({ shader: 0, art: 1, hybrid: 2 });
  });
});

describe('shader assembly', () => {
  const assembled = composeFragmentShader('vec3 background(vec2 uv) { return vec3(uv, 0.0); }');

  test('declares every standard uniform', () => {
    expect(assembled).toContain('uniform float uTick;');
    expect(assembled).toContain('uniform float uScroll;');
    expect(assembled).toContain('uniform vec2 uRes;');
    expect(assembled).toContain('uniform float uIntensity;');
  });

  test('calls the spec entry point and applies intensity and fade alpha', () => {
    expect(assembled).toContain('background(vUv)');
    expect(assembled).toContain('uIntensity');
    expect(assembled).toContain('uAlpha');
  });

  test('places the body at global scope, so a spec can declare its own uniforms', () => {
    const withUniform = composeFragmentShader('uniform float uCustom;\nvec3 background(vec2 uv) { return vec3(uCustom); }');
    // Anything after `void main` would be inside the wrapper's function body,
    // where GLSL forbids a uniform declaration.
    expect(withUniform.indexOf('uniform float uCustom;')).toBeLessThan(withUniform.indexOf('void main'));
  });

  test('is pure: the same spec assembles byte-identical source twice', () => {
    const body = 'vec3 background(vec2 uv) { return vec3(0.5); }';
    expect(composeFragmentShader(body)).toBe(composeFragmentShader(body));
  });
});

/**
 * The module's one hard requirement, and the only one a reviewer can forget.
 *
 * A background driven by a wall clock desynchronises from a replay visually
 * while every test stays green — the sim is untouched, so nothing else can
 * notice. Scanning the source is crude, but it is the only check that fails at
 * the moment the mistake is made rather than on a 144Hz display months later.
 */
test('no wall-clock source reaches the background', async () => {
  const source = await Bun.file(new URL('./background.ts', import.meta.url)).text();

  const forbidden = [
    'Date.now',
    'performance.now',
    'new Date',
    'requestAnimationFrame',
    'setTimeout',
    'setInterval',
  ];

  const found = forbidden.filter((name) => {
    // Skip the prose: the header names these in order to ban them.
    return source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .some((line) => line.includes(name));
  });

  expect(found).toEqual([]);
});
