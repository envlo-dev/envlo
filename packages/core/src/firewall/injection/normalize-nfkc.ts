/**
 * NFKC-normalize visible text so fullwidth / compatibility forms collapse
 * before heuristic scanning.
 */
export function normalizeVisibleText(text: string): string {
  return text.normalize("NFKC");
}
