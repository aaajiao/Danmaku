export type CanvasTextTruncation = 'end' | 'middle';

export function boundedCanvasText(
  text: string,
  mode: CanvasTextTruncation,
  limit: number,
): string {
  const boundedLimit = Math.max(1, Math.floor(limit));
  if (text.length <= boundedLimit) return text;
  if (mode === 'end') return text.slice(0, boundedLimit);
  const left = Math.ceil(boundedLimit / 2);
  const right = Math.floor(boundedLimit / 2);
  return `${text.slice(0, left)}${text.slice(text.length - right)}`;
}

function truncatedCandidate(
  source: string,
  keep: number,
  mode: CanvasTextTruncation,
): string {
  const boundedKeep = Math.max(0, Math.min(source.length, keep));
  if (mode === 'end') return `${source.slice(0, boundedKeep)}…`;
  const left = Math.ceil(boundedKeep / 2);
  const right = Math.floor(boundedKeep / 2);
  return `${source.slice(0, left)}…${source.slice(source.length - right)}`;
}

/** Bounded source plus logarithmic width probes, even for a giant token. */
export function truncateCanvasText(
  text: string,
  maxWidth: number,
  mode: CanvasTextTruncation,
  measure: (value: string) => number,
  charLimit: number,
): string {
  const source = boundedCanvasText(text, mode, charLimit);
  if (measure(source) <= maxWidth) {
    return source.length < text.length
      ? truncatedCandidate(source, Math.max(0, source.length - 1), mode)
      : source;
  }
  let low = 0;
  let high = source.length;
  while (low < high) {
    const keep = Math.ceil((low + high) / 2);
    if (measure(truncatedCandidate(source, keep, mode)) <= maxWidth) low = keep;
    else high = keep - 1;
  }
  return truncatedCandidate(source, low, mode);
}

/** Largest fitting prefix in logarithmic rather than per-character probes. */
export function fittingCanvasPrefixLength(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
  start = 0,
): number {
  const boundedStart = Math.max(0, Math.min(text.length, Math.floor(start)));
  const available = text.length - boundedStart;
  if (available === 0) return 0;
  let low = 1;
  let high = 1;
  if (measure(text.slice(boundedStart, boundedStart + 1)) > maxWidth) return 1;
  while (high < available) {
    const candidate = Math.min(available, high * 2);
    if (measure(text.slice(boundedStart, boundedStart + candidate)) <= maxWidth) {
      low = candidate;
      high = candidate;
      continue;
    }
    high = candidate;
    break;
  }
  if (low === available) return low;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    if (measure(text.slice(boundedStart, boundedStart + length)) <= maxWidth) {
      low = length;
    } else {
      high = length - 1;
    }
  }
  return low;
}
