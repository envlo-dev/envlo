import { sanitizeInvisibleHtml } from "../firewall/sanitize-dom.js";
import { flattenHtmlToMarkdown, naiveHtmlToMarkdown } from "./flatten-html.js";
import { stripQuotedReply } from "./strip-quotes.js";
import { compressionRatio, estimateTokenCount } from "./tokens.js";
import type { AgentMarkdownResult, HtmlToAgentMarkdownOptions } from "./types.js";

/**
 * Full agent pipeline:
 * 1) optional DOM sanitize (invisible injection)
 * 2) layout-table flatten → Markdown (unless `flattenLayoutTables: false`)
 * 3) strip quoted history / signatures (default off for agents)
 *
 * Designed for LLM context: maximize signal, cut layout/quote token waste.
 */
export function htmlToAgentMarkdown(
  html: string,
  options: HtmlToAgentMarkdownOptions = {},
): AgentMarkdownResult {
  const sanitize = options.sanitize ?? true;
  const flattenLayoutTables = options.flattenLayoutTables ?? true;
  const includeQuotedHistory = options.includeQuotedHistory ?? false;
  const includeSignatures = options.includeSignatures ?? false;

  let workingHtml = html;
  let sanitizeTimedOut = false;
  let strippedHiddenElementsCount = 0;

  if (sanitize && html.trim()) {
    const cleaned = sanitizeInvisibleHtml(html, {
      ...(options.sanitizeTimeoutMs !== undefined
        ? { timeoutMs: options.sanitizeTimeoutMs }
        : {}),
      ...(options.sanitizeMaxInputChars !== undefined
        ? { maxInputChars: options.sanitizeMaxInputChars }
        : {}),
    });
    sanitizeTimedOut = cleaned.timedOut;
    strippedHiddenElementsCount = cleaned.strippedHiddenElementsCount;
    workingHtml = cleaned.timedOut ? "" : cleaned.html;
  }

  // Compression baseline = original HTML footprint (layout markup + styles).
  // Naive GFM pipe-table Markdown is kept for quality comparisons / debugging.
  const naiveMarkdown = naiveHtmlToMarkdown(workingHtml || html);
  const flattened = flattenHtmlToMarkdown(workingHtml, { flattenLayoutTables });
  const markdownBeforeQuoteStrip = flattened.markdown;

  const stripped = stripQuotedReply(markdownBeforeQuoteStrip, {
    includeQuotedHistory,
    includeSignatures,
  });

  const estimatedTokensBefore = estimateTokenCount(html);
  const estimatedTokensAfter = estimateTokenCount(stripped.text);

  return {
    markdown: stripped.text,
    markdownBeforeQuoteStrip,
    naiveMarkdown,
    layoutTablesFlattened: flattened.layoutTablesFlattened,
    dataTablesPreserved: flattened.dataTablesPreserved,
    estimatedTokensBefore,
    estimatedTokensAfter,
    compressionRatio: compressionRatio(estimatedTokensBefore, estimatedTokensAfter),
    quotesStripped: stripped.quotesStripped,
    signatureStripped: stripped.signatureStripped,
    sanitizeTimedOut,
    strippedHiddenElementsCount,
  };
}

/**
 * Convenience for plain-text email bodies: quote/signature strip only.
 */
export function plainTextToAgentMarkdown(
  text: string,
  options: Pick<
    HtmlToAgentMarkdownOptions,
    "includeQuotedHistory" | "includeSignatures"
  > = {},
): StripPlainResult {
  const stripped = stripQuotedReply(text, {
    includeQuotedHistory: options.includeQuotedHistory ?? false,
    includeSignatures: options.includeSignatures ?? false,
  });
  const before = estimateTokenCount(text);
  const after = estimateTokenCount(stripped.text);
  return {
    markdown: stripped.text,
    quotesStripped: stripped.quotesStripped,
    signatureStripped: stripped.signatureStripped,
    estimatedTokensBefore: before,
    estimatedTokensAfter: after,
    compressionRatio: compressionRatio(before, after),
  };
}

type StripPlainResult = {
  markdown: string;
  quotesStripped: boolean;
  signatureStripped: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  compressionRatio: number;
};
