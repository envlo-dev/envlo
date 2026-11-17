/**
 * Split an RFC 5322 `References` header into Message-ID tokens.
 * Preserves angle brackets when present.
 */
export function parseReferencesHeader(value: string | undefined | null): string[] {
  if (!value) return [];

  const ids: string[] = [];
  const angleBracketed = value.match(/<[^>]+>/g);
  if (angleBracketed && angleBracketed.length > 0) {
    for (const id of angleBracketed) {
      ids.push(id);
    }
    return ids;
  }

  for (const token of value.split(/\s+/)) {
    const trimmed = token.trim();
    if (trimmed) ids.push(trimmed);
  }
  return ids;
}

/** Normalize Message-ID / In-Reply-To to a single ID string (or null). */
export function normalizeMessageId(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/<[^>]+>/);
  return match?.[0] ?? trimmed;
}
