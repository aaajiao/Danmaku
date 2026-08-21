import { describe, expect, test } from 'bun:test';
import {
  boundedCanvasText,
  fittingCanvasPrefixLength,
  truncateCanvasText,
} from './canvas-text';

describe('bounded canvas text', () => {
  test('preserves both identity ends for middle truncation', () => {
    expect(boundedCanvasText('0123456789', 'middle', 6)).toBe('012789');
  });

  test('truncates a million-character metadata token with logarithmic probes', () => {
    let probes = 0;
    const result = truncateCanvasText(
      `PREFIX-${'x'.repeat(1_000_000)}-#IDENTITY`,
      160,
      'middle',
      (value) => {
        probes++;
        return value.length * 8;
      },
      2048,
    );
    expect(result.startsWith('PREFIX-')).toBeTrue();
    expect(result.endsWith('#IDENTITY')).toBeTrue();
    expect(result.length).toBeLessThanOrEqual(21);
    expect(probes).toBeLessThanOrEqual(13);
  });

  test('finds a fitting no-space prefix logarithmically', () => {
    let probes = 0;
    const length = fittingCanvasPrefixLength(
      'x'.repeat(2048),
      80,
      (value) => {
        probes++;
        return value.length * 8;
      },
    );
    expect(length).toBe(10);
    expect(probes).toBeLessThanOrEqual(12);
  });
});
