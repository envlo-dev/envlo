/** Zero-width / BOM characters commonly used to hide prompt-injection payloads. */
const ZERO_WIDTH_RE = /\u200B|\u200C|\u200D|\uFEFF/g;

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
