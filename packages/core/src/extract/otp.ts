import { includesKeyword, OTP_CONTEXT_KEYWORDS } from "./keywords.js";
import type { ExtractAuthOptions, OtpCandidate } from "./types.js";

const CONTEXT_RADIUS = 80;

/** Hyphenated English compounds that look like device codes. */
const HYPHEN_STOPWORDS = new Set([
  "one-time",
  "on-time",
  "sign-in",
  "sign-up",
  "log-in",
  "log-out",
  "opt-out",
  "opt-in",
  "two-factor",
  "multi-factor",
  "real-time",
  "single-use",
  "end-to-end",
  "check-in",
  "check-out",
]);

type RawMatch = {
  raw: string;
  index: number;
  kind: OtpCandidate["kind"];
};

function resolveLengthBounds(options: ExtractAuthOptions): { min: number; max: number } {
  return {
    min: options.minCodeLength ?? options.minOtpDigits ?? 4,
    max: options.maxCodeLength ?? options.maxOtpDigits ?? 12,
  };
}

function windowAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT_RADIUS);
  const end = Math.min(text.length, index + length + CONTEXT_RADIUS);
  return text.slice(start, end);
}

/** Normalize display form → agent code. */
export function normalizeAuthCode(raw: string, kind: OtpCandidate["kind"]): string {
  if (kind === "numeric") {
    return raw.replace(/[\s-]+/g, "");
  }
  // Device / alphanumeric: uppercase, collapse odd spaces, keep hyphens.
  return raw.replace(/\s+/g, "").toUpperCase();
}

function isYear(digits: string, before: string, after: string): boolean {
  if (digits.length !== 4) return false;
  const n = Number(digits);
  if (n < 1900 || n > 2099) return false;
  if (/(?:©|copyright|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)$/i.test(before)) {
    return true;
  }
  if (/^(?:\s*[,.-]?\s*(?:year|yrs?|g\.?|a\.?d\.?)\b)/i.test(after)) return true;
  return true;
}

function isZipCode(digits: string, before: string, after: string): boolean {
  if (digits.length !== 5) return false;
  if (/^(?:-\d{4})\b/.test(after)) return true;
  if (/\b(?:zip|postal)\s*[#:]?\s*$/i.test(before)) return true;
  if (/,\s*[A-Z]{2}\s+$/i.test(before)) return true;
  return false;
}

function isHexColorContext(raw: string, before: string): boolean {
  const prefix = before.slice(-9);
  const hashIdx = prefix.lastIndexOf("#");
  if (hashIdx < 0) return false;
  const hexSoFar = prefix.slice(hashIdx + 1);
  if (!/^[0-9A-Fa-f]*$/.test(hexSoFar)) return false;
  const compact = raw.replace(/[\s-]/g, "");
  if (!/^[0-9A-Fa-f]+$/.test(compact)) return false;
  const total = hexSoFar.length + compact.length;
  return total === 3 || total === 6 || total === 8;
}

function isPhoneFragment(digits: string, before: string, after: string): boolean {
  if (/[+(]\s*\d{0,3}\s*$/.test(before) && digits.length <= 4) return true;
  if (/^\s*[-().\s]+\d/.test(after) && /\d\s*[-().\s]+$/.test(before)) return true;
  if (/\b(?:tel|phone|fax|mobile)\b[^.]{0,20}$/i.test(before) && digits.length <= 7) {
    return true;
  }
  return false;
}

function isPriceNoise(before: string): boolean {
  return /(?:\$|€|£)\s*$/.test(before) || /\b(?:usd|eur|gbp)\s*$/i.test(before);
}

function isUrlOrEmailToken(before: string, after: string): boolean {
  if (/@\s*$/.test(before) || /^@/.test(after)) return true;
  // Domain TLD after token: auth0.com — not a sentence-final period.
  if (/^\.[A-Za-z]/.test(after)) return true;
  // Inside a URL path/query without whitespace back to scheme.
  const tail = before.slice(-80);
  if (/https?:\/\/\S*$/i.test(tail) || /www\.\S*$/i.test(tail)) return true;
  return false;
}

function isHexAdjacent(raw: string, before: string): boolean {
  const compact = raw.replace(/[\s-]/g, "");
  if (!/^[0-9A-Fa-f]+$/i.test(compact)) return false;
  return /#[0-9A-Fa-f]*$/i.test(before.slice(-9));
}

function collectRawMatches(
  text: string,
  options: ExtractAuthOptions,
): RawMatch[] {
  const { min, max } = resolveLengthBounds(options);
  const allowAlphanumeric = options.allowAlphanumeric ?? true;
  const matches: RawMatch[] = [];

  // 1) Hyphenated device codes: WDJB-MJHT, ABCD-1234-EF
  if (allowAlphanumeric) {
    const deviceRe =
      /(?<![\p{L}\p{N}])([A-Za-z0-9]{3,5}(?:-[A-Za-z0-9]{3,5}){1,4})(?![\p{L}\p{N}])/gu;
    for (const m of text.matchAll(deviceRe)) {
      const raw = m[1];
      if (!raw || m.index === undefined) continue;
      const compact = raw.replace(/-/g, "");
      if (compact.length < min || compact.length > max) continue;
      // Must include a letter (otherwise it's just digit groups like 12-34-56 → numeric path).
      if (!/[A-Za-z]/.test(raw)) continue;
      if (HYPHEN_STOPWORDS.has(raw.toLowerCase())) continue;
      matches.push({ raw, index: m.index, kind: "device" });
    }
  }

  // 2) Spaced / hyphenated numeric groups: 4 8 2 9 1 3, 318-472, 12-34-56
  const groupedNumericRe =
    /(?<![\p{L}\p{N}])(\d(?:[\s-]*\d){2,14})(?![\p{L}\p{N}])/gu;
  for (const m of text.matchAll(groupedNumericRe)) {
    const raw = m[1];
    if (!raw || m.index === undefined) continue;
    if (!/[\s-]/.test(raw)) continue; // solid runs handled below
    const digits = raw.replace(/[\s-]+/g, "");
    if (digits.length < min || digits.length > max) continue;
    matches.push({ raw, index: m.index, kind: "numeric" });
  }

  // 3) Solid digit runs
  const solidDigitRe = new RegExp(
    `(?<![\\p{L}\\p{N}])(\\d{${min},${max}})(?![\\p{L}\\p{N}])`,
    "gu",
  );
  for (const m of text.matchAll(solidDigitRe)) {
    const raw = m[1];
    if (!raw || m.index === undefined) continue;
    matches.push({ raw, index: m.index, kind: "numeric" });
  }

  // 4) Solid alphanumeric (must mix letters + digits): AB12CD, A1B2C3
  if (allowAlphanumeric) {
    const alphaRe =
      /(?<![\p{L}\p{N}])(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)([A-Za-z0-9]{4,12})(?![\p{L}\p{N}])/gu;
    for (const m of text.matchAll(alphaRe)) {
      const raw = m[1];
      if (!raw || m.index === undefined) continue;
      if (raw.length < min || raw.length > max) continue;
      matches.push({ raw, index: m.index, kind: "alphanumeric" });
    }
  }

  return matches;
}

function scoreMatch(
  match: RawMatch,
  text: string,
  options: ExtractAuthOptions,
): OtpCandidate | null {
  const { min, max } = resolveLengthBounds(options);
  const code = normalizeAuthCode(match.raw, match.kind);
  if (code.length < min || code.length > max) return null;

  const before = text.slice(Math.max(0, match.index - CONTEXT_RADIUS), match.index);
  const after = text.slice(
    match.index + match.raw.length,
    match.index + match.raw.length + CONTEXT_RADIUS,
  );
  const ctx = windowAround(text, match.index, match.raw.length);
  const reasons: string[] = [`kind:${match.kind}`];
  const digitsOnly = code.replace(/\D/g, "");

  if (isUrlOrEmailToken(before, after)) return null;
  if (isHexAdjacent(match.raw, before) || isHexColorContext(match.raw, before)) return null;

  if (match.kind === "numeric") {
    if (isPriceNoise(before)) return null;
    if (isPhoneFragment(digitsOnly, before, after)) return null;
  }

  const keyword = includesKeyword(ctx, OTP_CONTEXT_KEYWORDS);

  if (match.kind === "numeric") {
    // Calendar years are almost never OTPs — drop even if "code" appears nearby.
    if (isYear(digitsOnly, before, after)) return null;
    if (isZipCode(digitsOnly, before, after) && !keyword) return null;
  }

  let score = 1;

  // Length priors (common OTP sizes still win, but longer codes are allowed).
  if (code.length === 6) {
    score += 3;
    reasons.push("len-6");
  } else if (code.length === 4 || code.length === 8) {
    score += 2;
    reasons.push(`len-${code.length}`);
  } else if (code.length === 5 || code.length === 7) {
    score += 1;
    reasons.push(`len-${code.length}`);
  } else if (code.length >= 9) {
    // Long codes need context; small base score.
    score += 0;
    reasons.push(`len-${code.length}`);
  }

  if (keyword) {
    score += 8;
    reasons.push(`ctx:${keyword}`);
  }

  if (/[:=]\s*$/.test(before) || /\bG-$/i.test(before)) {
    score += 3;
    reasons.push("labeled");
  }

  if (/[\s-]/.test(match.raw) && match.kind === "numeric") {
    score += 2;
    reasons.push("grouped");
  }

  if (match.kind === "device") {
    score += 2;
    reasons.push("device-shape");
  }

  if (match.kind === "alphanumeric" || match.kind === "device") {
    // Alphanumeric without context is usually a SKU / id — require keyword or label.
    if (!keyword && !/[:=]\s*$/.test(before)) {
      score -= 6;
      reasons.push("alpha-needs-ctx");
    }
    // Letter-only device codes need explicit device/user-code language.
    if (match.kind === "device" && !/\d/.test(code)) {
      const deviceCtx = includesKeyword(ctx, [
        "device code",
        "user code",
        "device",
        "enter code",
        "enter the code",
      ]);
      if (!deviceCtx) {
        score -= 4;
        reasons.push("letter-device-needs-device-ctx");
      } else {
        score += 3;
        reasons.push(`ctx:${deviceCtx}`);
      }
    }
  }

  // Long numeric without OTP context → tracking / order noise.
  if (match.kind === "numeric" && code.length >= 9 && !keyword) {
    score -= 8;
    reasons.push("long-no-ctx");
  }

  if (/^(\d)\1+$/.test(digitsOnly) && match.kind === "numeric") {
    score -= 4;
    reasons.push("repeated-digit");
  }

  if (
    match.kind === "numeric" &&
    (code === "123456" || code === "654321" || code === "1234" || code === "4321")
  ) {
    score -= 1;
    reasons.push("sequential");
  }

  if (
    !keyword &&
    /\b(?:tracking|zip|postal|order\s*#|invoice|sku|qty|quantity)\b/i.test(ctx)
  ) {
    score -= 5;
    reasons.push("order-noise");
  }

  // Alphanumeric / device almost always need net positive context.
  if ((match.kind === "alphanumeric" || match.kind === "device") && score < 6) {
    return null;
  }

  if (score < 2) return null;

  return {
    code,
    raw: match.raw,
    score,
    reasons,
    index: match.index,
    kind: match.kind,
  };
}

/**
 * Extract ranked verification / OTP / device-code candidates from plain text.
 *
 * Supports:
 * - numeric 4–12 digits (default)
 * - spaced / hyphenated numeric groups (`4 8 2 9 1 3`, `318-472`)
 * - alphanumeric codes (`AB12CD`) and device codes (`WDJB-MJHT`)
 */
export function extractOtpCandidates(
  text: string,
  options: ExtractAuthOptions = {},
): OtpCandidate[] {
  if (!text.trim()) return [];

  const found: OtpCandidate[] = [];
  const seen = new Set<string>();

  for (const match of collectRawMatches(text, options)) {
    const candidate = scoreMatch(match, text, options);
    if (!candidate) continue;
    const key = `${candidate.code}@${candidate.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(candidate);
  }

  // Prefer higher score; for ties prefer earlier + more specific kind.
  const kindRank = { device: 0, alphanumeric: 1, numeric: 2 };
  found.sort(
    (a, b) =>
      b.score - a.score ||
      kindRank[a.kind] - kindRank[b.kind] ||
      a.index - b.index,
  );

  // Drop numeric substrings of a winning grouped code at the same region.
  return found.filter((c, i) => {
    if (c.kind !== "numeric") return true;
    return !found.some(
      (other, j) =>
        j < i &&
        other.kind === "numeric" &&
        other.code === c.code &&
        Math.abs(other.index - c.index) < other.raw.length,
    );
  });
}

export function pickBestOtp(candidates: OtpCandidate[]): string | null {
  const best = candidates[0];
  if (!best) return null;
  const hasCtx = best.reasons.some((r) => r.startsWith("ctx:"));
  if (best.score < 5 && !hasCtx) return null;
  if ((best.kind === "alphanumeric" || best.kind === "device") && !hasCtx && best.score < 8) {
    return null;
  }
  return best.code;
}
