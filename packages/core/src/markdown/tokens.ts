/**
 * Rough token footprint estimate for compression metrics.
 * Uses ~4 characters per token (common English/HTML→Markdown heuristic).
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function compressionRatio(beforeTokens: number, afterTokens: number): number {
  if (beforeTokens <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - afterTokens / beforeTokens));
}
