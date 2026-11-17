import TurndownService from "turndown";
import { sanitizeInvisibleHtml } from "./sanitize-dom.js";
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
 * Delete invisible / dangerous DOM nodes, then convert the cleaned HTML to Markdown.
 * Hidden prompt-injection text must never reach the Markdown string.
 */
export function htmlToSafeMarkdown(
  html: string,
  options: SanitizeOptions = {},
): HtmlToMarkdownResult {
  const sanitized = sanitizeInvisibleHtml(html, options);

  if (sanitized.timedOut) {
    return {
      ...sanitized,
      markdown: "",
    };
  }

  const markdown = sanitized.html.trim()
    ? getTurndown().turndown(sanitized.html)
    : "";

  return {
    ...sanitized,
    markdown,
  };
}
