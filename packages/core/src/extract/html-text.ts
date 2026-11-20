import { parseHTML } from "linkedom";

/**
 * Pull visible-ish text from HTML for OTP scanning (anchors kept as text, scripts dropped).
 */
export function htmlToPlainText(html: string): string {
  if (!html.trim()) return "";

  const looksLikeDocument = /<!DOCTYPE\b|<html[\s>]/i.test(html);
  let body: { textContent: string | null; querySelectorAll: (s: string) => ArrayLike<{ remove?: () => void }> };

  if (looksLikeDocument) {
    const { document } = parseHTML(html);
    body = (document.body ?? document.documentElement) as unknown as typeof body;
  } else {
    const { document } = parseHTML(`<!DOCTYPE html><html><body></body></html>`);
    document.body.innerHTML = html;
    body = document.body as unknown as typeof body;
  }

  if (!body) return "";

  const doomed = body.querySelectorAll("script, style, noscript");
  for (let i = 0; i < doomed.length; i += 1) {
    doomed[i]?.remove?.();
  }

  return (body.textContent ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}
