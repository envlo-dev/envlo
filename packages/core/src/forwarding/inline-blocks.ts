import type { MimeAddress } from "../parser/types.js";
import { parseAddressString } from "./parse-address.js";

/** Outlook/M365 “Sent” label variants (EN/FR/ES/DE). */
const SENT_LABEL = "Sent|Envoy[eé]|Enviado|Gesendet";
/** Outlook/M365 “To” label variants. */
const TO_LABEL = "To|À|A:|Para|An";
/** Outlook/M365 “Subject” label variants. */
const SUBJECT_LABEL = "Subject|Objet|Asunto|Betreff";

const M365_BLOCK_RE = new RegExp(
  String.raw`(?:^|\n)From:\s*(.+)\r?\n(?:${SENT_LABEL}):\s*(.+)\r?\n(?:${TO_LABEL}):\s*(.+)(?:\r?\nCc:\s*(.+))?\r?\n(?:${SUBJECT_LABEL}):\s*(.+)`,
  "i",
);

const GMAIL_BLOCK_RE =
  /(?:^|\n)-{2,}\s*Forwarded message\s*-{2,}\r?\nFrom:\s*(.+)\r?\nDate:\s*(.+)\r?\nSubject:\s*(.+)\r?\nTo:\s*(.+)/i;

// Apple inserts a blank line after the banner.
const APPLE_BLOCK_RE =
  /(?:^|\n)Begin forwarded message:\s*\r?\nFrom:\s*(.+)\r?\n(?:Subject:\s*(.+)\r?\n)?(?:Date:\s*(.+)\r?\n)?To:\s*(.+)/i;

const YAHOO_BLOCK_RE =
  /(?:^|\n)-{2,}\s*Forwarded Message\s*-{2,}\r?\nFrom:\s*(.+)\r?\nTo:\s*(.+)\r?\n/i;

function htmlToApproxText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<\s*\/div\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function bodyTextForForwardScan(text: string | null, html: string | null): string {
  if (text && text.trim()) return text;
  if (html && html.trim()) return htmlToApproxText(html);
  return "";
}

/** Dashed Gmail/Yahoo separators only — not Apple's "Begin forwarded message". */
export function hasGmailForwardMarker(body: string): boolean {
  return /-{2,}\s*Forwarded message\s*-{2,}/i.test(body);
}

export function parseGmailInlineForward(body: string): MimeAddress | null {
  const gmail = GMAIL_BLOCK_RE.exec(body);
  if (gmail?.[1]) return parseAddressString(gmail[1]);

  // Unicode dash variants, but still require a dashed separator (not Apple).
  const loose = /-{2,}\s*Forwarded message\s*-{2,}[\s\S]{0,80}?\nFrom:\s*(.+)\r?\n/i.exec(body);
  if (loose?.[1] && hasGmailForwardMarker(body)) {
    return parseAddressString(loose[1]);
  }

  return null;
}

export function parseAppleInlineForward(body: string): MimeAddress | null {
  if (!/Begin forwarded message:/i.test(body)) return null;
  const match = APPLE_BLOCK_RE.exec(body);
  if (match?.[1]) return parseAddressString(match[1]);
  return null;
}

export function parseYahooInlineForward(body: string): MimeAddress | null {
  const match = YAHOO_BLOCK_RE.exec(body);
  if (match?.[1]) return parseAddressString(match[1]);
  return null;
}

export type M365InlineMatch = {
  sender: MimeAddress;
  toLine: string;
};

export function parseM365InlineForward(body: string): M365InlineMatch | null {
  // Outlook often prefixes with a rule line of underscores.
  const normalized = body.replace(/^_+\r?\n/gm, "\n");
  const match = M365_BLOCK_RE.exec(normalized);
  if (!match?.[1]) return null;
  const sender = parseAddressString(match[1]);
  if (!sender) return null;
  return { sender, toLine: match[3] ?? "" };
}
