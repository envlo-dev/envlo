/**
 * Invisible / format characters used to hide or confuse prompt-injection text.
 * Ticket list + common extras (soft hyphen, word joiner, invisible operators).
 */
const ZERO_WIDTH_RE =
  /\u00AD|\u200B|\u200C|\u200D|\u2060|\u2061|\u2062|\u2063|\u2064|\uFEFF/g;

export function stripZeroWidthChars(value: string): string {
  // Bound regex work: replace on the whole string once; callers should size-limit input.
  ZERO_WIDTH_RE.lastIndex = 0;
  return value.replace(ZERO_WIDTH_RE, "");
}

export function countZeroWidthChars(value: string): number {
  ZERO_WIDTH_RE.lastIndex = 0;
  const matches = value.match(ZERO_WIDTH_RE);
  return matches?.length ?? 0;
}
