/** Larger than any authored screen, bounded against imported metadata. */
export const ACCESSIBLE_TITLE_LIMIT = 256;
export const ACCESSIBLE_DETAILS_LIMIT = 16_384;

export function boundedAccessibleText(value: string, limit: number): string {
  const boundedLimit = Math.max(1, Math.floor(limit));
  if (value.length <= boundedLimit) return value;
  return `${value.slice(0, boundedLimit - 1)}…`;
}

/** Join without first allocating an unbounded imported string. */
export function joinAccessibleDetails(
  values: readonly string[],
  limit = ACCESSIBLE_DETAILS_LIMIT,
): string {
  const boundedLimit = Math.max(1, Math.floor(limit));
  let result = '';
  for (let index = 0; index < values.length; index++) {
    const separator = result === '' ? '' : '\n';
    const available = boundedLimit - result.length - separator.length;
    if (available <= 0) return boundedAccessibleText(`${result}…`, boundedLimit);
    const value = values[index] ?? '';
    if (value.length > available) {
      return `${result}${separator}${boundedAccessibleText(value, available)}`;
    }
    result += `${separator}${value}`;
  }
  return result;
}
