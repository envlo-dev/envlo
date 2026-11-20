import { parseHTML } from "linkedom";
import {
  includesKeyword,
  LINK_NEGATIVE_HOST_FRAGMENTS,
  LINK_NEGATIVE_KEYWORDS,
  LINK_POSITIVE_KEYWORDS,
} from "./keywords.js";
import type { ExtractAuthOptions, VerificationLinkCandidate } from "./types.js";

const BARE_URL =
  /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.;:!?]+$/g, "");
}

function normalizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (/^(mailto:|tel:|javascript:|#)/i.test(trimmed)) return null;
  try {
    // Absolute URLs
    if (/^https?:\/\//i.test(trimmed)) {
      return stripTrailingPunctuation(trimmed);
    }
    // Protocol-relative
    if (trimmed.startsWith("//")) {
      return stripTrailingPunctuation(`https:${trimmed}`);
    }
  } catch {
    return null;
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function scoreLink(url: string, text: string): VerificationLinkCandidate | null {
  const haystack = `${url} ${text}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const host = hostOf(url);
  for (const frag of LINK_NEGATIVE_HOST_FRAGMENTS) {
    if (host === frag || host.endsWith(`.${frag}`)) {
      return null;
    }
  }

  const negative = includesKeyword(haystack, LINK_NEGATIVE_KEYWORDS);
  if (negative) {
    score -= 8;
    reasons.push(`neg:${negative}`);
  }

  // Multiple positive hits stack.
  for (const keyword of LINK_POSITIVE_KEYWORDS) {
    if (haystack.includes(keyword.toLowerCase())) {
      score += keyword.length >= 8 ? 4 : 3;
      reasons.push(`pos:${keyword}`);
      // Cap stacking so one long URL doesn't explode.
      if (reasons.filter((r) => r.startsWith("pos:")).length >= 4) break;
    }
  }

  // Query-string auth shapes: ?token= ?code= ?auth=
  if (/[?&](token|code|auth|magic|verify|confirm|otp|sid|session)=/i.test(url)) {
    score += 5;
    reasons.push("query-auth");
  }

  // Path shapes: /verify/ /confirm/ /magic/
  if (/\/(verify|confirm|activate|magic|auth|login|signin|sign-in|callback)\b/i.test(url)) {
    score += 4;
    reasons.push("path-auth");
  }

  // Button-like CTA text
  if (/^\s*(verify|confirm|activate|continue|log\s*in|sign\s*in|get\s*started)\b/i.test(text)) {
    score += 3;
    reasons.push("cta-text");
  }

  if (score <= 0) return null;

  return {
    url,
    text: text.trim().slice(0, 200),
    score,
    reasons,
  };
}

function collectHtmlAnchors(html: string): VerificationLinkCandidate[] {
  const { document } = parseHTML(`<!DOCTYPE html><html><body></body></html>`);
  // Full documents: parse as document; fragments: assign into body.
  let root: { querySelectorAll: (s: string) => ArrayLike<{ getAttribute: (n: string) => string | null; textContent: string | null }> };
  if (/<!DOCTYPE\b|<html[\s>]/i.test(html)) {
    const parsed = parseHTML(html);
    root = (parsed.document.body ?? parsed.document) as typeof root;
  } else {
    document.body.innerHTML = html;
    root = document.body as unknown as typeof root;
  }

  const out: VerificationLinkCandidate[] = [];
  const anchors = root.querySelectorAll("a");
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    if (!a) continue;
    const href = a.getAttribute("href");
    if (!href) continue;
    const url = normalizeHref(href);
    if (!url) continue;
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    const scored = scoreLink(url, text);
    if (scored) out.push(scored);
  }
  return out;
}

function collectBareUrls(text: string): VerificationLinkCandidate[] {
  const out: VerificationLinkCandidate[] = [];
  for (const match of text.matchAll(BARE_URL)) {
    const raw = match[0];
    if (!raw) continue;
    const url = normalizeHref(raw);
    if (!url) continue;
    const index = match.index ?? 0;
    const ctxStart = Math.max(0, index - 40);
    const ctxEnd = Math.min(text.length, index + raw.length + 40);
    const ctx = text.slice(ctxStart, ctxEnd);
    const scored = scoreLink(url, ctx);
    if (scored) out.push(scored);
  }
  return out;
}

function dedupeLinks(candidates: VerificationLinkCandidate[]): VerificationLinkCandidate[] {
  const best = new Map<string, VerificationLinkCandidate>();
  for (const c of candidates) {
    const key = c.url.toLowerCase();
    const prev = best.get(key);
    if (!prev || c.score > prev.score) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}

/**
 * Score HTML `<a>` tags (and bare URLs in text) to isolate verification / magic links.
 */
export function extractVerificationLinkCandidates(
  input: { html?: string | null; text?: string | null },
  _options: ExtractAuthOptions = {},
): VerificationLinkCandidate[] {
  const collected: VerificationLinkCandidate[] = [];
  if (input.html?.trim()) collected.push(...collectHtmlAnchors(input.html));
  if (input.text?.trim()) collected.push(...collectBareUrls(input.text));
  return dedupeLinks(collected);
}

export function pickBestVerificationUrl(
  candidates: VerificationLinkCandidate[],
  options: ExtractAuthOptions = {},
): string | null {
  const min = options.minLinkScore ?? 4;
  const best = candidates[0];
  if (!best || best.score < min) return null;
  return best.url;
}
