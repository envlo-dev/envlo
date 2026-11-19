import EmailReplyParser from "email-reply-parser";
import type { StripQuotesResult } from "./types.js";

const parser = new EmailReplyParser();

/**
 * Outlook / Exchange HTML replies often become Markdown attribution blocks
 * (`**From:**` / `**Sent:**`) after Turndown — email-reply-parser misses those.
 * Also catch localized "Original Message" separators and Japanese attributions.
 */
const OUTLOOK_SEPARATOR =
  /(?:^|\n)(-{5,}Original Message-{5,}|-{5,}Ursprüngliche Nachricht-{5,}|-{5,}Mensaje original-{5,}|-{5,}Message d['’]origine-{5,}|-{5,}Messaggio originale-{5,}|-{5,}Oorspronkelijk bericht-{5,}|-{5,}オリジナル(?:・| )?メッセージ-{5,}|_{5,})\s*(?:\n|$)/iu;

const OUTLOOK_HEADER_BLOCK =
  /(?:^|\n)(?:(?:\* \* \*|-{3,}|_{3,})\s*\n+)?(?:\*{0,2}(?:From|Von|De|Da|Van):\*{0,2})\s+.+\n(?:\*{0,2}(?:Sent|Gesendet|Envoyé|Enviado|Inviato|Verzonden):\*{0,2})\s+/iu;

/** Japanese client attribution: `2026年11月10日 9:00 Name <email>:` */
const JA_ATTRIBUTION =
  /(?:^|\n)\d{4}年\d{1,2}月\d{1,2}日[^\n]{0,160}:\s*(?:\n|$)/u;

/** Korean-style date attribution occasionally left after quote strip. */
const KO_ATTRIBUTION =
  /(?:^|\n)\d{4}년\s*\d{1,2}월\s*\d{1,2}일[^\n]{0,160}:\s*(?:\n|$)/u;

function cutClientQuoteTail(text: string): { text: string; cut: boolean } {
  let cutAt = -1;

  const candidates = [
    OUTLOOK_SEPARATOR.exec(text),
    OUTLOOK_HEADER_BLOCK.exec(text),
    JA_ATTRIBUTION.exec(text),
    KO_ATTRIBUTION.exec(text),
  ];

  for (const match of candidates) {
    if (match && typeof match.index === "number") {
      cutAt = cutAt < 0 ? match.index : Math.min(cutAt, match.index);
    }
  }

  if (cutAt < 0) return { text, cut: false };
  return { text: text.slice(0, cutAt).trimEnd(), cut: true };
}

/**
 * Strip quoted reply history and/or signatures from plain-text-like Markdown
 * using `email-reply-parser` (supports common locales / mobile signatures),
 * plus Outlook / Japanese attribution tails that survive HTML→Markdown.
 */
export function stripQuotedReply(
  text: string,
  options: {
    includeQuotedHistory?: boolean;
    includeSignatures?: boolean;
  } = {},
): StripQuotesResult {
  const includeQuotedHistory = options.includeQuotedHistory ?? false;
  const includeSignatures = options.includeSignatures ?? false;

  if (!text.trim()) {
    return { text: "", quotesStripped: false, signatureStripped: false };
  }

  if (includeQuotedHistory && includeSignatures) {
    return { text, quotesStripped: false, signatureStripped: false };
  }

  const email = parser.read(text);
  const fragments = email.getFragments();

  let quotesStripped = false;
  let signatureStripped = false;
  const kept: string[] = [];

  for (const fragment of fragments) {
    const isQuote = fragment.isQuoted();
    const isSig = fragment.isSignature();

    if (isQuote) {
      quotesStripped = true;
      if (!includeQuotedHistory) continue;
    }
    if (isSig) {
      signatureStripped = true;
      if (!includeSignatures) continue;
    }
    // Hidden non-quote/non-sig fragments are usually empty separators.
    if (fragment.isHidden() && !isQuote && !isSig) continue;

    const content = fragment.getContent();
    if (content.trim()) kept.push(content.replace(/\s+$/u, ""));
  }

  let resultText: string;
  if (!includeQuotedHistory && !includeSignatures) {
    const visible = email.getVisibleText().trim();
    resultText = visible;
    quotesStripped = quotesStripped || visible.length < text.trim().length;
    signatureStripped = signatureStripped || visible.length < text.trim().length;
  } else {
    resultText = kept.join("\n").trim();
  }

  if (!includeQuotedHistory) {
    const trimmed = cutClientQuoteTail(resultText);
    if (trimmed.cut) {
      resultText = trimmed.text;
      quotesStripped = true;
    }
  }

  return {
    text: resultText.trim(),
    quotesStripped,
    signatureStripped,
  };
}
