import { createEmailTurndown, createNaiveTurndown } from "./turndown-rules.js";
import type { FlattenHtmlOptions, FlattenHtmlResult } from "./types.js";

function cleanupMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert HTML to Markdown with email layout-table flattening.
 * Does not sanitize and does not strip quotes — compose those separately.
 *
 * Pass `{ flattenLayoutTables: false }` to force-keep all tables as structured
 * content instead of stacking layout grids.
 */
export function flattenHtmlToMarkdown(
  html: string,
  options: FlattenHtmlOptions = {},
): FlattenHtmlResult {
  if (!html.trim()) {
    return { markdown: "", layoutTablesFlattened: 0, dataTablesPreserved: 0 };
  }

  const flattenLayoutTables = options.flattenLayoutTables ?? true;
  const { service, stats } = createEmailTurndown({ flattenLayoutTables });
  const markdown = cleanupMarkdown(service.turndown(html));
  return {
    markdown,
    layoutTablesFlattened: stats.layoutTablesFlattened,
    dataTablesPreserved: stats.dataTablesPreserved,
  };
}

/** Naive Turndown without layout rules — used for token-reduction benchmarks. */
export function naiveHtmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  return cleanupMarkdown(createNaiveTurndown().turndown(html));
}
