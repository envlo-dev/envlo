import TurndownService from "turndown";
import { sanitizeInvisibleHtml, sanitizeInvisibleHtmlAsync } from "./sanitize-dom.js";
import type { HtmlToMarkdownResult, SanitizeOptions } from "./types.js";

let turndownSingleton: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!turndownSingleton) {
    turndownSingleton = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
  }
  return turndownSingleton;
}

/**
 * Delete invisible / dangerous DOM nodes, then convert cleaned HTML to Markdown.
 *
 * **Prefer `htmlToAgentMarkdown` from `@envlo/core/markdown` (or ingest via
 * `ingestRawMime`) for agent context.** That path also flattens email layout
 * tables and strips quoted reply history — this helper only sanitizes + Turndown.
 *
 * Hidden prompt-injection text must never reach the Markdown string.
 */
export function htmlToSafeMarkdown(
  html: string,
  options: SanitizeOptions = {},
): HtmlToMarkdownResult {
  const sanitized = sanitizeInvisibleHtml(html, options);
  return toMarkdownResult(sanitized);
}

/** Async variant with Promise.race hard deadline (yields during the DOM walk). */
export async function htmlToSafeMarkdownAsync(
  html: string,
  options: SanitizeOptions = {},
): Promise<HtmlToMarkdownResult> {
  const sanitized = await sanitizeInvisibleHtmlAsync(html, options);
  return toMarkdownResult(sanitized);
}

function toMarkdownResult(
  sanitized: Awaited<ReturnType<typeof sanitizeInvisibleHtmlAsync>>,
): HtmlToMarkdownResult {
  if (sanitized.timedOut) {
    return { ...sanitized, markdown: "" };
  }

  const markdown = sanitized.html.trim() ? getTurndown().turndown(sanitized.html) : "";
  return { ...sanitized, markdown };
}
