/**
 * Identity pins for the production files the V4 kit ships without a JSON
 * manifest row.
 *
 * Every other runtime asset gets its `sha256` from a JSON manifest
 * (atlas-index, frame-index, backgrounds, audio-manifest). The UI atlas and the
 * UI typeface are not described by any JSON manifest in the kit; their only
 * authored identity is a row in the kit's own `checksums-sha256.txt`, which the
 * content authority (`tools/content/validate-content.ts`) verifies byte-for-byte
 * against the real files on every build.
 *
 * These pins mirror those rows so the binding layer still fails closed at
 * runtime. `kit-checksums-v4.test.ts` re-reads `checksums-sha256.txt` from disk
 * and fails if a pin here ever drifts from the kit.
 */
export const V4_UNMANIFESTED_CHECKSUMS = Object.freeze({
  "ui/atlas/ui-atlas.png":
    "18ee69565abd86ed34d455bf64385a43dcb868f0da1615c3efe88df94378e661",
  "fonts/NotoSansSC-Variable.ttf":
    "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da",
  "fonts/OFL.txt":
    "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9",
} as const);

export type V4UnmanifestedPath = keyof typeof V4_UNMANIFESTED_CHECKSUMS;

export function v4UnmanifestedChecksum(sourcePath: V4UnmanifestedPath): string {
  const sha256 = V4_UNMANIFESTED_CHECKSUMS[sourcePath];
  if (sha256 === undefined) {
    throw new Error(`V4 kit has no pinned checksum for ${sourcePath}`);
  }
  return sha256;
}
