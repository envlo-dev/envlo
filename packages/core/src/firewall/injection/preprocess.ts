import { foldConfusables, stripInvisibleAndBidi } from "./confusables.js";
import { normalizeVisibleText } from "./normalize.js";

const MAX_DECODE_ROUNDS = 2;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/gi, "&");
}

function tryUrlDecode(text: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return text;
  try {
    return decodeURIComponent(text.replace(/\+/g, "%20"));
  } catch {
    // Partial / malformed URL encoding — decode what we can safely.
    return text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => {
      try {
        return decodeURIComponent(`%${hex}`);
      } catch {
        return `%${hex}`;
      }
    });
  }
}

export type PreprocessResult = {
  /** Fully normalized text used for primary scanning. */
  text: string;
  /** Confusable-folded variant for second-pass phrase/pattern scans. */
  folded: string;
};

/**
 * Normalize visible email text before scoring: NFKC → strip bidi/ZW →
 * HTML entities → light URL-decode → confusable fold (secondary view).
 */
export function preprocessForInjectionScan(raw: string): PreprocessResult {
  let text = normalizeVisibleText(raw);
  text = stripInvisibleAndBidi(text);
  text = decodeHtmlEntities(text);

  for (let i = 0; i < MAX_DECODE_ROUNDS; i += 1) {
    const next = tryUrlDecode(text);
    if (next === text) break;
    text = next;
  }

  const folded = foldConfusables(text);
  return { text, folded };
}
