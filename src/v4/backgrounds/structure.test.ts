import { describe, expect, test } from 'bun:test';
import {
  V4_STAGE_STRUCTURE_FRAGMENT,
  v4StageStructureRole,
} from './structure';

describe('v4 sparse stage structure', () => {
  test('only the four campaign stage scenes carry architecture', () => {
    expect(v4StageStructureRole('expanse')).toBe(1);
    expect(v4StageStructureRole('undertow')).toBe(2);
    expect(v4StageStructureRole('stratum')).toBe(3);
    expect(v4StageStructureRole('vault')).toBe(4);

    for (const scene of [
      undefined,
      'drift',
      'signet',
      'umbra',
      'cordon',
      'intaglio',
      'sable',
      'decree',
      'regnum',
      'signal-decay',
    ]) {
      expect(v4StageStructureRole(scene), String(scene)).toBe(0);
    }
  });

  test('the authored overlay is tick-clocked and has no wall-clock source', () => {
    expect(V4_STAGE_STRUCTURE_FRAGMENT).toContain('uniform float uTick');
    expect(V4_STAGE_STRUCTURE_FRAGMENT).not.toMatch(/performance\s*\.|Date\s*\(|requestAnimationFrame/);
  });

  test('motifs stay stage-scale rather than introducing bullet-sized repeats', () => {
    expect(V4_STAGE_STRUCTURE_FRAGMENT).toContain('112.0');
    expect(V4_STAGE_STRUCTURE_FRAGMENT).toContain('258.0');
    expect(V4_STAGE_STRUCTURE_FRAGMENT).toContain('rectFrame');
    expect(V4_STAGE_STRUCTURE_FRAGMENT).toContain('vec2(36.0, 170.0)');
    expect(V4_STAGE_STRUCTURE_FRAGMENT).not.toMatch(/fract\s*\(.*[xy].*\*\s*(?:[2-9]|[1-9][0-9])/);
  });
});
