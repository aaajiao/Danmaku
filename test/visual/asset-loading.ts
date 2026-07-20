/**
 * Pixel-readback proof that the asset loading paths address what they claim to.
 *
 * ## Why this is not a unit test
 *
 * `bun test` has no GL context, no image decoder and no WebAudio, so every
 * check we have of `loadTexture`, `loadAtlas` and the `url` branch of `Audio`
 * runs against something built in memory — a `DataTexture`, a synthesised
 * `AudioBuffer`. Decoding, colour space, alpha, non-power-of-two dimensions and
 * the UV arithmetic that turns a cell index into a texture rect have never
 * actually run against a file.
 *
 * The bug this is aimed at is a UV or cell-addressing error. It is invisible
 * until content is authored against it, and then it is invisible again, because
 * the art was drawn to look right under the broken mapping. `grid-8x2.png`
 * gives each of the 16 cells a flat, maximally distinct colour precisely so the
 * framebuffer can answer "did you draw the cell I asked for" with a yes or a no.
 *
 * ## Running it
 *
 *     bun run test:assets
 *     open http://localhost:3007/test/visual/asset-loading.html
 *
 * The page prints PASS or FAIL and sets `window.__assetLoadingResult`. The
 * texture checks run on load; the `Audio` checks need a real user gesture (see
 * "What is not verified" below) and run on the first click.
 *
 * ## What is not verified
 *
 * - **That anything is audible.** No sound is heard, and nothing here can hear
 *   one. `Audio` builds its own `AudioContext` and exposes no tap on it, so the
 *   samples it feeds the hardware cannot be captured. What is verified is that
 *   the fixture decodes to the right duration, channel count, sample rate and
 *   per-channel peaks; that `Audio.unlock()` reaches an unlocked state; that
 *   `Audio` really fetches the fixture URL rather than quietly synthesising a
 *   placeholder; and that neither a defined nor an undefined `play` throws.
 * - **Filtering and mip behaviour.** Every quad here is drawn at 1:1 or as a
 *   flat colour, so nothing samples between texels.
 * - **Atlas row bounds.** `Atlas` has no row count and does not bounds-check
 *   `cell()`. That is asserted below as the behaviour it is, not wished away.
 */

import * as THREE from 'three';
import { Atlas, loadAtlas, loadTexture } from '../../src/render/atlas';
import { SpriteBatch } from '../../src/render/sprite-batch';
import { Stage } from '../../src/render/stage';
import { BULLET_COLUMNS, BULLET_GRID, BULLET_ROWS } from '../../src/render/procedural';
import { Audio, defineSound, soundNames } from '../../src/audio';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * The fixtures, imported so the bundler resolves them.
 *
 * `new URL('./x.png', import.meta.url)` is the form CLAUDE.md prefers, and it
 * does not work here: Bun's dev server leaves `import.meta.url` as the source
 * file's own `file://` path in the client bundle, so the URL resolves to a
 * local path the browser refuses to fetch. Nor can the fixtures simply be
 * fetched by repository path — an HTML-entry dev server answers every unknown
 * route with the entry document, so `/test/fixtures/grid-8x2.png` returns 200
 * with the page HTML and the PNG decoder fails on markup.
 *
 * An asset import is resolved by the bundler and served verbatim (checked:
 * the bytes served for `grid-8x2.png` hash identically to the committed file).
 * `@ts-expect-error` on each because `bun-types` declares `*.txt`, `*.toml`,
 * `*.html` and friends but no image or audio module, and the wildcard
 * declaration that would fix it belongs in a `.d.ts` this harness does not own.
 */
// @ts-expect-error no ambient declaration for *.png
import GRID_URL from '../fixtures/grid-8x2.png';
// @ts-expect-error no ambient declaration for *.png
import NPOT_URL from '../fixtures/npot.png';
// @ts-expect-error no ambient declaration for *.png
import NO_ALPHA_URL from '../fixtures/no-alpha.png';
// @ts-expect-error no ambient declaration for *.png
import RAGGED_URL from '../fixtures/ragged.png';
// @ts-expect-error no ambient declaration for *.png
import ONE_PIXEL_URL from '../fixtures/one-pixel.png';
// @ts-expect-error no ambient declaration for *.wav
import BLIP_URL from '../fixtures/blip.wav';
// @ts-expect-error no ambient declaration for *.wav
import STEREO_URL from '../fixtures/stereo.wav';

/**
 * The 16 cell colours of `grid-8x2.png`, in cell order.
 *
 * Restated rather than imported because `tools/make-fixtures.ts` is a generator
 * that runs under Bun, not a module this page can pull in — and because a
 * fixture check that imports its expectations from the thing that wrote the
 * fixture proves only that the generator is self-consistent. These are
 * transcribed from the committed file; if they ever disagree with it, the cell
 * identity check below fails, which is the outcome we want.
 */
const CELL_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
  [255, 0, 255], [0, 255, 255], [255, 128, 0], [128, 0, 255],
  [0, 128, 64], [128, 64, 0], [64, 0, 128], [192, 192, 192],
  [255, 255, 255], [16, 16, 16], [0, 96, 255], [255, 0, 96],
];

/** `ragged.png` paints every pixel outside a whole cell this colour. */
const OUT_OF_GRID: readonly [number, number, number] = [255, 0, 255];

const CELL_NAMES = CELL_COLOURS.map((_, i) => `cell${i}`);

/* ------------------------------------------------------------------ */
/* Stage and readback                                                  */
/* ------------------------------------------------------------------ */

const WIDTH = 384;
const HEIGHT = 288;

const canvas = document.getElementById('field') as HTMLCanvasElement;
const stage = new Stage({ canvas, width: WIDTH, height: HEIGHT, maxPixelRatio: 1 });
const gl = stage.renderer.getContext();

type RGB = readonly [number, number, number];

/**
 * Read one pixel in stage coordinates.
 *
 * `readPixels` origin is bottom-left; the stage camera is y-down from the
 * top-left (CLAUDE.md, rule 6). Getting this flip wrong reads a plausible pixel
 * from the wrong row, which is exactly the class of bug the page is hunting, so
 * the conversion lives in one place.
 */
function readPixel(x: number, y: number): [number, number, number, number] {
  const out = new Uint8Array(4);
  gl.readPixels(Math.floor(x), HEIGHT - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

/**
 * Render one batch alone and hand back the framebuffer.
 *
 * Nothing may `await` between the render and the readback: the drawing buffer
 * is not preserved, so the pixels only exist until the browser composites.
 */
function pass(batch: SpriteBatch, draw: (b: SpriteBatch) => void): void {
  stage.add(batch.mesh, 'Enemies');
  batch.begin();
  draw(batch);
  batch.end();
  stage.render();
  stage.remove(batch.mesh);
}

/* ------------------------------------------------------------------ */
/* Colour transfer                                                     */
/* ------------------------------------------------------------------ */

/**
 * `loadTexture` tags its textures `SRGBColorSpace`, which makes the GPU decode
 * each texel to linear on sample. `SpriteBatch` writes `gl_FragColor` from a
 * hand-written shader with no three.js output-encoding chunk, so whether the
 * value that lands in the framebuffer is re-encoded is a property of the
 * renderer's colour pipeline, not of anything this page controls.
 *
 * Hard-coding a guess about that would make the page fail for a reason that has
 * nothing to do with asset loading. Instead both candidate transfers are
 * applied to the expected colours, the one that fits the measurement is
 * reported, and the assertion is on *cell identity* — which colour landed in
 * which cell. Both transfers are strictly monotone per channel, so a UV error
 * breaks the identity under either. Picking the better fit cannot rescue a
 * wrong cell; it only stops the page from mislabelling a correct one.
 *
 * `Math.pow` is fine here. Rule 3 binds `sim`, `content` and `core` because
 * approximated results integrate into gameplay; this is a test-only comparison
 * against an 8-bit measurement with a tolerance an order of magnitude wider
 * than any ULP disagreement between engines.
 */
type Transfer = { name: string; apply: (v: number) => number };

const TRANSFERS: readonly Transfer[] = [
  { name: 'identity (framebuffer holds sRGB bytes)', apply: (v) => v },
  {
    name: 'sRGB→linear (texture decoded, never re-encoded)',
    apply: (v) => {
      const c = v / 255;
      const linear = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      return Math.round(linear * 255);
    },
  },
];

function distance(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function transferred(transfer: Transfer, colour: RGB): RGB {
  return [transfer.apply(colour[0]), transfer.apply(colour[1]), transfer.apply(colour[2])];
}

/** The transfer that best explains a set of measurements of known colours. */
function fitTransfer(measured: readonly RGB[], expected: readonly RGB[]): Transfer {
  let best = TRANSFERS[0]!;
  let bestError = Infinity;
  for (const transfer of TRANSFERS) {
    let error = 0;
    measured.forEach((m, i) => {
      error += distance(m, transferred(transfer, expected[i]!));
    });
    if (error < bestError) {
      bestError = error;
      best = transfer;
    }
  }
  return best;
}

/** Index of the palette entry a measured pixel is closest to. */
function nearestCell(transfer: Transfer, measured: RGB): number {
  let best = -1;
  let bestDistance = Infinity;
  CELL_COLOURS.forEach((colour, i) => {
    const d = distance(measured, transferred(transfer, colour));
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* Result accumulation                                                 */
/* ------------------------------------------------------------------ */

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(name: string, passed: boolean, detail: string): boolean {
  checks.push({ name, pass: passed, detail });
  return passed;
}

const lines: string[] = [];

function section(title: string): void {
  lines.push('', title, '─'.repeat(title.length));
}

/* ------------------------------------------------------------------ */
/* 1. The grid: does a named cell address the cell you named?           */
/* ------------------------------------------------------------------ */

/**
 * Where each cell is drawn. Four across and four down, 32x32 at 48px pitch, so
 * every quad is isolated by 16px of background — a quad bleeding past its own
 * bounds cannot be read as its neighbour.
 */
function cellCentre(i: number): [number, number] {
  return [24 + (i % 4) * 48, 24 + Math.floor(i / 4) * 48];
}

/** Draw all 16 cells, `shift` places off from the one they are read as. */
function measureCells(batch: SpriteBatch, shift: number): RGB[] {
  pass(batch, (b) => {
    CELL_NAMES.forEach((_, i) => {
      const [x, y] = cellCentre(i);
      b.draw(x, y, CELL_NAMES[(i + shift) % CELL_NAMES.length]!);
    });
  });
  return CELL_NAMES.map((_, i) => {
    const [x, y] = cellCentre(i);
    const [r, g, bb] = readPixel(x, y);
    return [r, g, bb] as RGB;
  });
}

const gridAtlas = await loadAtlas(GRID_URL, BULLET_GRID);
gridAtlas.defineGrid(CELL_NAMES);

const gridBatch = new SpriteBatch(gridAtlas, { capacity: 32 });

section('1. grid-8x2.png — cell addressing through SpriteBatch');

check(
  'grid dimensions',
  gridAtlas.width === BULLET_GRID.cellW * BULLET_COLUMNS &&
    gridAtlas.height === BULLET_GRID.cellH * BULLET_ROWS,
  `${gridAtlas.width}x${gridAtlas.height}, expected ` +
    `${BULLET_GRID.cellW * BULLET_COLUMNS}x${BULLET_GRID.cellH * BULLET_ROWS}`,
);
lines.push(`  loaded ${gridAtlas.width}x${gridAtlas.height}, ${gridAtlas.names.length} named cells`);

const measured = measureCells(gridBatch, 0);
const transfer = fitTransfer(measured, CELL_COLOURS);
lines.push(`  colour transfer that fits the measurement: ${transfer.name}`);
lines.push('');

let identityHolds = true;
let worstResidual = 0;

measured.forEach((m, i) => {
  const want = transferred(transfer, CELL_COLOURS[i]!);
  const nearest = nearestCell(transfer, m);
  const residual = distance(m, want);
  worstResidual = Math.max(worstResidual, residual);
  if (nearest !== i) identityHolds = false;
  lines.push(
    `  cell${String(i).padStart(2)} ` +
      `measured rgb(${m.join(', ')})`.padEnd(28) +
      `expected rgb(${want.join(', ')})`.padEnd(28) +
      `nearest=cell${nearest}${nearest === i ? '' : '  ← WRONG CELL'}`,
  );
});

check(
  'every named cell reads back its own colour',
  identityHolds,
  identityHolds
    ? 'all 16 cells nearest-match their own palette entry'
    : 'at least one cell resolved to a different palette entry — UV or stride error',
);

// A loose residual on purpose: the assertion that matters is cell identity, and
// the palette entries are far enough apart that a wrong cell can never sneak in
// under this bound. Tightening it would only make the page fragile to the
// renderer's colour pipeline, which is not what it is testing.
const RESIDUAL_LIMIT = 24;
check(
  'measured colours match the palette within tolerance',
  worstResidual <= RESIDUAL_LIMIT,
  `worst channel-space residual ${worstResidual.toFixed(1)}, limit ${RESIDUAL_LIMIT}`,
);

/* ------------------------------------------------------------------ */
/* 2. Non-power-of-two, no-alpha, ragged, 1x1                          */
/* ------------------------------------------------------------------ */

section('2. npot.png — non-power-of-two dimensions and a real alpha ramp');

const npotAtlas = await loadAtlas(NPOT_URL);
npotAtlas.define('full', { x: 0, y: 0, w: 100, h: 60 });
const npotBatch = new SpriteBatch(npotAtlas, { capacity: 4 });

check(
  'npot dimensions',
  npotAtlas.width === 100 && npotAtlas.height === 60,
  `${npotAtlas.width}x${npotAtlas.height}, expected 100x60`,
);

// Drawn 1:1 with its top-left at (10, 10), so image pixel (x, y) is stage pixel
// (10 + x, 10 + y) and no filtering is involved.
const NPOT_ORIGIN = 10;
pass(npotBatch, (b) => {
  b.draw(NPOT_ORIGIN + 50, NPOT_ORIGIN + 30, 'full');
});
const npotOpaque = readPixel(NPOT_ORIGIN + 99, NPOT_ORIGIN + 59);
const npotTransparent = readPixel(NPOT_ORIGIN + 0, NPOT_ORIGIN + 0);

lines.push(`  image (99,59) alpha=255 → rgba(${npotOpaque.join(', ')})`);
lines.push(`  image ( 0, 0) alpha=0   → rgba(${npotTransparent.join(', ')})`);

check(
  'npot right edge draws opaque',
  npotOpaque[0]! > 200 && npotOpaque[1]! > 200,
  `rgb(${npotOpaque.slice(0, 3).join(', ')}), expected the ramp maximum in r and g`,
);

// The discriminator for a dropped alpha channel. Image pixel (0,0) is
// rgba(0,0,64,0): if alpha survived decoding it is discarded by alphaTest and
// the background shows through, and if it did not it draws as visible blue.
check(
  'npot alpha channel survives decoding',
  npotTransparent[0]! < 8 && npotTransparent[1]! < 8 && npotTransparent[2]! < 8,
  `rgb(${npotTransparent.slice(0, 3).join(', ')}), expected black — a blue pixel here means ` +
    'the alpha channel was dropped and the texel drew opaque',
);

section('3. no-alpha.png — PNG colour type 2, no alpha channel at all');

const noAlphaAtlas = await loadAtlas(NO_ALPHA_URL);
noAlphaAtlas.define('full', { x: 0, y: 0, w: 64, h: 48 });
const noAlphaBatch = new SpriteBatch(noAlphaAtlas, { capacity: 4 });

check(
  'no-alpha dimensions',
  noAlphaAtlas.width === 64 && noAlphaAtlas.height === 48,
  `${noAlphaAtlas.width}x${noAlphaAtlas.height}, expected 64x48`,
);

const NO_ALPHA_ORIGIN = 10;
pass(noAlphaBatch, (b) => {
  b.draw(NO_ALPHA_ORIGIN + 32, NO_ALPHA_ORIGIN + 24, 'full');
});
const noAlphaDark = readPixel(NO_ALPHA_ORIGIN + 0, NO_ALPHA_ORIGIN + 0);
const noAlphaBright = readPixel(NO_ALPHA_ORIGIN + 63, NO_ALPHA_ORIGIN + 47);

lines.push(`  image ( 0, 0) source rgb(0,0,128)     → rgba(${noAlphaDark.join(', ')})`);
lines.push(`  image (63,47) source rgb(255,255,128) → rgba(${noAlphaBright.join(', ')})`);

// "Correct" for a file with no alpha channel is fully opaque, everywhere. The
// upstream defect this is aimed at is the opposite reading: rumia.png had no
// alpha and drew on an opaque box. Image pixel (0,0) is the darkest in the
// image but still carries blue, so a loader that fabricated a zero alpha from
// the missing channel would erase it against the background.
check(
  'no-alpha image is treated as fully opaque',
  noAlphaDark[2]! > 20 && noAlphaBright[0]! > 200,
  `darkest pixel keeps its blue (b=${noAlphaDark[2]}) and the brightest is opaque ` +
    `(r=${noAlphaBright[0]})`,
);

section('4. ragged.png — a 100x40 image against a 32x32 grid');

/**
 * What "correct" is here, stated before it is measured.
 *
 * 100x40 divides into three whole 32px columns with 4px left over, and one
 * whole 32px row with 8px left over. `Atlas` computes its column count by
 * flooring, so the partial fourth column is **not addressable by a linear cell
 * index** — indices walk 0,1,2 and then wrap to the next row. That is the
 * behaviour we want and it is asserted.
 *
 * `Atlas` has no row count, and `cell()` bounds-checks nothing. Index 3 is
 * therefore column 0 of row 1, a rect running from y=32 to y=64 on a 40px
 * image, and column 3 is likewise a rect running past the right edge. Both are
 * out of bounds and both resolve, silently, through the texture's clamp. This
 * is a real gap and the honest assertion is that partial and out-of-range cells
 * read as the fixture's out-of-grid magenta rather than as plausible art — not
 * that they are rejected, because nothing rejects them.
 */
const raggedAtlas = await loadAtlas(RAGGED_URL, BULLET_GRID);
const raggedBatch = new SpriteBatch(raggedAtlas, { capacity: 8 });

check(
  'ragged dimensions',
  raggedAtlas.width === 100 && raggedAtlas.height === 40,
  `${raggedAtlas.width}x${raggedAtlas.height}, expected 100x40`,
);

// Three whole columns: index 3 must be row 1 column 0, not the partial column.
const wrapped = raggedAtlas.cell(3);
check(
  'the partial 4px column is not addressable by linear index',
  wrapped.x === 0 && wrapped.y === BULLET_GRID.cellH,
  `cell(3) = {x:${wrapped.x}, y:${wrapped.y}} — column count floors to 3, so index 3 wraps ` +
    'to the next row rather than landing in the 4px remainder',
);

raggedAtlas.define('whole0', raggedAtlas.cell(0, 0));
raggedAtlas.define('whole1', raggedAtlas.cell(1, 0));
raggedAtlas.define('whole2', raggedAtlas.cell(2, 0));
raggedAtlas.define('partialColumn', raggedAtlas.cell(3, 0));
raggedAtlas.define('offBottom', raggedAtlas.cell(0, 1));

const RAGGED_SPOTS: ReadonlyArray<readonly [string, number, number]> = [
  ['whole0', 24, 24],
  ['whole1', 72, 24],
  ['whole2', 120, 24],
  ['partialColumn', 168, 24],
  ['offBottom', 216, 24],
];

pass(raggedBatch, (b) => {
  for (const [name, x, y] of RAGGED_SPOTS) b.draw(x, y, name);
});

const raggedRead = RAGGED_SPOTS.map(([name, x, y]) => {
  const [r, g, bb] = readPixel(x, y);
  return { name, colour: [r, g, bb] as RGB };
});

for (const { name, colour } of raggedRead) {
  lines.push(`  ${name.padEnd(14)} rgb(${colour.join(', ')})`);
}

const wholeCellsCorrect = [0, 1, 2].every((i) => {
  const got = raggedRead[i]!.colour;
  return nearestCell(transfer, got) === i;
});

check(
  'the three whole cells of the ragged grid read their own colours',
  wholeCellsCorrect,
  `cells 0..2 nearest-match cell${raggedRead
    .slice(0, 3)
    .map((r) => nearestCell(transfer, r.colour))
    .join(', cell')}`,
);

const magenta = transferred(transfer, OUT_OF_GRID);
const partialIsMagenta = distance(raggedRead[3]!.colour, magenta) <= RESIDUAL_LIMIT;
const offBottomIsMagenta = distance(raggedRead[4]!.colour, magenta) <= RESIDUAL_LIMIT;

check(
  'out-of-grid regions read as the fixture out-of-grid marker, not as art',
  partialIsMagenta && offBottomIsMagenta,
  `partial column rgb(${raggedRead[3]!.colour.join(', ')}) and off-bottom row ` +
    `rgb(${raggedRead[4]!.colour.join(', ')}) both resolve to the magenta remainder — ` +
    'Atlas.cell() does not bounds-check, and this documents that rather than hiding it',
);

section('5. one-pixel.png — the degenerate case, half-transparent');

const onePixelTexture = await loadTexture(ONE_PIXEL_URL);
const onePixelImage = onePixelTexture.image as { width: number; height: number };
const onePixelAtlas = new Atlas(onePixelTexture, onePixelImage.width, onePixelImage.height);
onePixelAtlas.define('px', { x: 0, y: 0, w: 1, h: 1 });
const onePixelBatch = new SpriteBatch(onePixelAtlas, { capacity: 4 });

check(
  'one-pixel dimensions',
  onePixelImage.width === 1 && onePixelImage.height === 1,
  `${onePixelImage.width}x${onePixelImage.height}, expected 1x1`,
);

// Blown up to 32x32 so there is something to read. Source is rgba(255,128,0,128)
// over a black background, so the framebuffer must show roughly half intensity —
// full opacity here would mean the alpha byte was ignored.
pass(onePixelBatch, (b) => {
  b.draw(48, 48, 'px', { width: 32, height: 32 });
});
const onePixel = readPixel(48, 48);
lines.push(`  source rgba(255,128,0,128) drawn 32x32 → rgba(${onePixel.join(', ')})`);

check(
  'the single texel draws, at partial alpha',
  onePixel[0]! > 90 && onePixel[0]! < 170 && onePixel[2]! < 12,
  `r=${onePixel[0]} (expected roughly half of 255 after the 0.502 alpha), ` +
    `b=${onePixel[2]} (expected 0) — r near 255 would mean the alpha byte was ignored`,
);

/* ------------------------------------------------------------------ */
/* 6. Proof that this page can fail                                    */
/* ------------------------------------------------------------------ */

section('6. mutation — the same measurement, deliberately mis-addressed');

/**
 * A guard nobody has seen fail is not a guard.
 *
 * This redraws the grid with every cell shifted one place along, which is the
 * exact shape of a real off-by-one in cell indexing or in the UV offset, and
 * requires the identity check above to reject all sixteen. If it does not, the
 * PASS printed above is measuring something other than what it claims.
 */
const shifted = measureCells(gridBatch, 1);
const rejected = shifted.filter((m, i) => nearestCell(transfer, m) !== i).length;

lines.push('  every cell drawn one place along from the cell it is read as:');
shifted.forEach((m, i) => {
  const nearest = nearestCell(transfer, m);
  lines.push(
    `  cell${String(i).padStart(2)} ` +
      `measured rgb(${m.join(', ')})`.padEnd(28) +
      `nearest=cell${nearest}${nearest === i ? '  ← NOT REJECTED' : ''}`,
  );
});

check(
  'a one-cell mis-addressing is rejected',
  rejected === CELL_NAMES.length,
  `${rejected}/${CELL_NAMES.length} shifted cells resolved to a different palette entry`,
);

/**
 * A second mutation, on the other half of the page: a whole cell of the ragged
 * grid, deliberately compared against the out-of-grid marker. It must not
 * match, or the magenta assertion above would pass for anything.
 */
const wholeIsNotMagenta = distance(raggedRead[0]!.colour, magenta) > RESIDUAL_LIMIT;
check(
  'the magenta comparison rejects a legitimate cell',
  wholeIsNotMagenta,
  `whole cell 0 rgb(${raggedRead[0]!.colour.join(', ')}) is ` +
    `${distance(raggedRead[0]!.colour, magenta).toFixed(1)} from the marker, limit ` +
    `${RESIDUAL_LIMIT}`,
);

/* ------------------------------------------------------------------ */
/* 7. Audio — decode, then the Audio class                             */
/* ------------------------------------------------------------------ */

section('7. WAV decode — verifiable without a gesture');

interface DecodedInfo {
  channels: number;
  sampleRate: number;
  length: number;
  duration: number;
  peaks: number[];
}

/**
 * Decode at the file's own rate.
 *
 * `decodeAudioData` resamples to the context's sample rate, and a live
 * `AudioContext` typically runs at 48kHz — which would turn a 2646-frame file
 * into 2880 frames and make an off-by-one in length arithmetic unmeasurable.
 * An `OfflineAudioContext` pinned to 44100 keeps the frame count the file
 * actually declares, and needs no user gesture.
 */
async function decodeAt(url: string, rate: number): Promise<DecodedInfo> {
  const ctx = new OfflineAudioContext(1, 1, rate);
  const encoded = await (await fetch(url)).arrayBuffer();
  const buffer = await ctx.decodeAudioData(encoded);
  const peaks: number[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    let peak = 0;
    for (const sample of data) peak = Math.max(peak, Math.abs(sample));
    peaks.push(peak);
  }
  return {
    channels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    duration: buffer.duration,
    peaks,
  };
}

const FIXTURE_RATE = 44100;
const blip = await decodeAt(BLIP_URL, FIXTURE_RATE);
const stereo = await decodeAt(STEREO_URL, FIXTURE_RATE);

lines.push(
  `  blip.wav   ${blip.channels}ch @${blip.sampleRate}Hz, ${blip.length} frames, ` +
    `${blip.duration.toFixed(4)}s, peak ${blip.peaks.map((p) => p.toFixed(3)).join(' / ')}`,
);
lines.push(
  `  stereo.wav ${stereo.channels}ch @${stereo.sampleRate}Hz, ${stereo.length} frames, ` +
    `${stereo.duration.toFixed(4)}s, peaks ${stereo.peaks.map((p) => p.toFixed(3)).join(' / ')}`,
);

check(
  'blip.wav decodes as 44.1kHz mono, 2646 frames',
  blip.channels === 1 && blip.sampleRate === FIXTURE_RATE && blip.length === 2646,
  `${blip.channels}ch @${blip.sampleRate}Hz, ${blip.length} frames — expected 1ch @44100Hz, 2646`,
);

check(
  'stereo.wav decodes as 44.1kHz stereo, 11025 frames',
  stereo.channels === 2 && stereo.sampleRate === FIXTURE_RATE && stereo.length === 11025,
  `${stereo.channels}ch @${stereo.sampleRate}Hz, ${stereo.length} frames — expected 2ch ` +
    '@44100Hz, 11025',
);

// The fixture puts 220Hz at peak 0.90 in the left channel and 1320Hz at peak
// 0.25 in the right, precisely so a channel swap is measurable. Peak level
// alone separates them by a factor of three.
const left = stereo.peaks[0] ?? 0;
const right = stereo.peaks[1] ?? 0;
check(
  'stereo channels are not swapped',
  left > 0.8 && left < 1 && right > 0.15 && right < 0.4 && left > right * 2,
  `left peak ${left.toFixed(3)} (expected ~0.90), right peak ${right.toFixed(3)} ` +
    '(expected ~0.25)',
);

section('8. Audio class — needs a user gesture, runs on click');

// Registered against the real fixture, which sends `Audio` down its `url`
// branch — the one path `bun test` cannot reach, since it needs both fetch and
// a decoder.
defineSound('fixture-blip', { url: BLIP_URL, volume: 0.2, polyphony: 2 });

const UNDEFINED_SOUND = 'no-such-sound-exists';
check(
  'an undefined sound is not in the registry',
  !soundNames().includes(UNDEFINED_SOUND),
  `soundNames() = ${soundNames().join(', ')}`,
);

/** Requests `Audio` makes, so the `url` branch can be told from synthesis. */
const fetched: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  fetched.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const audio = new Audio({ masterVolume: 0.2 });

interface AudioResult {
  ran: boolean;
  unlocked: boolean;
  fetchedFixture: boolean;
  fetchedUnregistered: boolean;
  fetchCount: number;
  definedPlayThrew: boolean;
  undefinedPlayThrew: boolean;
}

const audioResult: AudioResult = {
  ran: false,
  unlocked: false,
  fetchedFixture: false,
  fetchedUnregistered: false,
  fetchCount: 0,
  definedPlayThrew: false,
  undefinedPlayThrew: false,
};

async function runAudioChecks(): Promise<void> {
  if (audioResult.ran) return;
  audioResult.ran = true;

  // Section 7 fetched both WAVs to decode them. Only what `Audio` asks for from
  // here on is evidence about `Audio`.
  fetched.length = 0;

  await audio.unlock();
  audioResult.unlocked = audio.unlocked;

  // `#ensure` kicks the fetch off and returns undefined until it lands, so the
  // first `play` of a url-backed sound is silent by design. Give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Compared against the resolved URL, not against the word "blip": the
  // bundler serves fixtures under a content-hashed name, so a substring match
  // on the source filename never fires. That mistake made this check read
  // false on a run where `Audio` had in fact fetched the file — a false alarm
  // is still a broken measurement.
  const request = (url: string): boolean => fetched.some((seen) => seen === url);
  audioResult.fetchCount = fetched.length;
  audioResult.fetchedFixture = request(BLIP_URL);
  // `stereo.wav` is decoded directly by section 7 but never registered as a
  // sound, so `Audio` must not have asked for it. Without this, a matcher that
  // said yes to any request at all would look identical to a correct one.
  audioResult.fetchedUnregistered = request(STEREO_URL);

  try {
    audio.play('fixture-blip');
  } catch {
    audioResult.definedPlayThrew = true;
  }

  try {
    audio.play(UNDEFINED_SOUND);
  } catch {
    audioResult.undefinedPlayThrew = true;
  }

  audio.stopAll();
  finish();
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    __assetLoadingResult: {
      pass: boolean;
      audioRan: boolean;
      transfer: string;
      checks: Check[];
      cells: number[][];
      shiftedRejected: number;
      audio: AudioResult;
      wav: { blip: DecodedInfo; stereo: DecodedInfo };
    };
  }
}

const result = document.getElementById('result')!;
const prompt = document.getElementById('prompt')!;

function finish(): void {
  const audioChecks: Check[] = audioResult.ran
    ? [
        {
          name: 'Audio.unlock() succeeds after a gesture',
          pass: audioResult.unlocked,
          detail: `audio.unlocked = ${audioResult.unlocked}`,
        },
        {
          name: 'Audio takes the url branch and fetches the fixture',
          pass: audioResult.fetchedFixture,
          detail: audioResult.fetchedFixture
            ? 'blip.wav was requested — the sound is the file, not a synthesised placeholder'
            : `no request for the fixture; ${audioResult.fetchCount} request(s) seen`,
        },
        {
          name: 'Audio requests only what is registered',
          pass: !audioResult.fetchedUnregistered,
          detail:
            'stereo.wav is decoded by section 7 but never registered as a sound, and Audio ' +
            `did not ask for it — ${audioResult.fetchCount} request(s) total, so the check ` +
            'above is not matching indiscriminately',
        },
        {
          name: 'playing a defined sound does not throw',
          pass: !audioResult.definedPlayThrew,
          detail: 'play("fixture-blip") returned normally',
        },
        {
          name: 'playing an undefined sound is a silent no-op',
          pass: !audioResult.undefinedPlayThrew,
          detail: `play("${UNDEFINED_SOUND}") returned normally without registering anything`,
        },
      ]
    : [];

  const all = [...checks, ...audioChecks];
  const pass = all.every((c) => c.pass);

  const summary = [
    pass ? (audioResult.ran ? 'PASS' : 'PASS (texture and decode only)') : 'FAIL',
    '',
    ...all.map((c) => `  ${c.pass ? 'ok  ' : 'FAIL'}  ${c.name}\n          ${c.detail}`),
    ...lines,
    '',
    'Not verified here: that any sound is audible, that the samples Audio feeds the',
    'hardware are the fixture rather than something else, and any filtering behaviour —',
    'every quad above is drawn 1:1 or as a flat colour.',
  ];

  result.textContent = summary.join('\n');
  prompt.textContent = audioResult.ran
    ? ''
    : 'click anywhere to run the Audio checks (they need a real user gesture)';

  window.__assetLoadingResult = {
    pass,
    audioRan: audioResult.ran,
    transfer: transfer.name,
    checks: all,
    cells: measured.map((m) => [...m]),
    shiftedRejected: rejected,
    audio: audioResult,
    wav: { blip, stereo },
  };
}

finish();

// A synthetic `dispatchEvent` does not carry user activation, so the audio
// checks cannot be driven from script — a real click is the only way in.
addEventListener('pointerdown', () => void runAudioChecks(), { once: true });
