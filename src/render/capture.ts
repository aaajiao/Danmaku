/**
 * Compose the authored frame for screenshots and video.
 *
 * The visible game is two canvases: WebGL below and Canvas2D UI above. Reading
 * either one alone is not a screenshot. The shell calls `compose` synchronously
 * after both have rendered; keeping that timing outside this class avoids
 * enabling WebGL's persistent drawing buffer just to support an occasional
 * capture.
 */

export interface CaptureName {
  readonly stage?: string;
  readonly difficulty?: string;
  readonly tick?: number;
}

export class FrameCapture {
  readonly canvas: HTMLCanvasElement;
  readonly #surface: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const surface = canvas.getContext('2d');
    if (surface === null) throw new Error('capture: 2D canvas is unavailable');
    this.canvas = canvas;
    this.#surface = surface;
    this.#surface.imageSmoothingEnabled = false;
  }

  compose(field: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
    this.#surface.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.#surface.drawImage(field, 0, 0, this.canvas.width, this.canvas.height);
    this.#surface.drawImage(overlay, 0, 0, this.canvas.width, this.canvas.height);
  }

  png(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        this.canvas.toBlob((blob) => {
          if (blob === null) {
            reject(new Error('capture: browser returned an empty PNG'));
            return;
          }
          resolve(blob);
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  }
}

export function isScreenshotShortcut(
  event: Pick<KeyboardEvent, 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return (
    event.code === 'KeyC'
    && !event.repeat
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
  );
}

export function screenshotFilename(now: Date, capture: CaptureName = {}): string {
  const stamp = now.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.000', '');
  const parts = ['danmaku', stamp];
  if (capture.stage !== undefined) parts.push(safePart(capture.stage));
  if (capture.difficulty !== undefined) parts.push(safePart(capture.difficulty));
  if (capture.tick !== undefined) parts.push(`tick-${Math.max(0, Math.floor(capture.tick)).toString().padStart(6, '0')}`);
  return `${parts.join('-')}.png`;
}

function safePart(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe === '' ? 'unknown' : safe;
}
