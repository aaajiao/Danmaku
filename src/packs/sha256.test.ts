import { describe, expect, test } from 'bun:test';
import { sha256, sha256Fallback } from './sha256';

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('SHA-256 fallback', () => {
  test.each([
    [
      '',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ],
    [
      'abc',
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ],
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
  ])('matches the known vector for %p', (text, expected) => {
    expect(hex(sha256Fallback(encoder.encode(text)))).toBe(expected);
  });

  test('matches WebCrypto across SHA-256 padding boundaries', async () => {
    const provider = globalThis.crypto.subtle;
    for (const length of [0, 1, 55, 56, 63, 64, 65, 255, 4097]) {
      const input = Uint8Array.from(
        { length },
        (_, index) => (index * 73 + length * 19) & 0xff,
      );
      const native = await sha256(input, provider);
      const fallback = await sha256(input, null);
      expect(fallback, `length ${length}`).toEqual(native);
    }
  });
});
