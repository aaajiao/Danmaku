import { describe, expect, test } from 'bun:test';
import {
  ACCESSIBLE_DETAILS_LIMIT,
  boundedAccessibleText,
  joinAccessibleDetails,
} from './accessible-text';

describe('accessible state text bounds', () => {
  test('preserves ordinary state copy exactly', () => {
    expect(joinAccessibleDetails(['metadata', 'warning'])).toBe('metadata\nwarning');
  });

  test('bounds a single imported token and marks omission', () => {
    expect(boundedAccessibleText('abcdefgh', 5)).toBe('abcd…');
  });

  test('never builds more than the accessible detail budget', () => {
    const value = joinAccessibleDetails([
      'a'.repeat(ACCESSIBLE_DETAILS_LIMIT),
      'b'.repeat(ACCESSIBLE_DETAILS_LIMIT),
    ]);
    expect(value.length).toBeLessThanOrEqual(ACCESSIBLE_DETAILS_LIMIT);
    expect(value.endsWith('…')).toBeTrue();
  });
});
