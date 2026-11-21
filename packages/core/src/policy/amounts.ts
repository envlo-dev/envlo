/**
 * Detect monetary amounts in markdown/plain text that meet/exceed `threshold`.
 * Handles $, USD, EUR, GBP, and common "1,234.56" / "1234" forms.
 */

const AMOUNT_PATTERNS: RegExp[] = [
  // $1,234.56 / $100 / $-50
  /(?<!\w)\$\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?!\w)/gi,
  // USD 100 / EUR 1,200.00 / GBP 50
  /(?<!\w)(?:USD|EUR|GBP|CAD|AUD)\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?!\w)/gi,
  // 100 dollars / 1,200.50 usd
  /(?<!\w)-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|usd|euros?|eur|pounds?|gbp)(?!\w)/gi,
  // €100 / £50
  /(?<!\w)[€£]\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?!\w)/gi,
];

function parseAmountToken(raw: string): number | null {
  const cleaned = raw
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

export type AmountMatch = {
  raw: string;
  value: number;
};

/** Find all monetary amounts in text. */
export function findAmounts(text: string): AmountMatch[] {
  if (!text) return [];
  const out: AmountMatch[] = [];
  const seen = new Set<string>();
  for (const pattern of AMOUNT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = match[0] ?? "";
      const key = `${match.index}:${raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const value = parseAmountToken(raw);
      if (value === null) continue;
      out.push({ raw, value });
    }
  }
  return out;
}

/** True when any detected amount is >= threshold. */
export function containsAmountOver(text: string, threshold: number): boolean {
  return findAmounts(text).some((m) => m.value >= threshold);
}
