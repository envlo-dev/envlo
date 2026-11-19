/** Options for HTML → agent Markdown conversion. */
export type HtmlToAgentMarkdownOptions = {
  /**
   * Run the DOM invisible-prompt sanitizer before Turndown (default true).
   * Disable only when HTML is already trusted/cleaned.
   */
  sanitize?: boolean;
  /**
   * Flatten email layout `<table>` grids into stacked Markdown blocks (default true).
   * Set false to keep tables as structured/GFM-style content (force-keep tables).
   */
  flattenLayoutTables?: boolean;
  /**
   * Keep quoted thread history (`On Tue… wrote:`) in the output.
   * Default false — strip for agent token efficiency.
   */
  includeQuotedHistory?: boolean;
  /**
   * Keep trailing signatures (`--`, `Sent from my iPhone`, …).
   * Default false. Only applies when quote stripping runs (plain-text style body).
   */
  includeSignatures?: boolean;
  /** Forwarded to the DOM sanitizer when `sanitize` is true. */
  sanitizeTimeoutMs?: number;
  sanitizeMaxInputChars?: number;
};

/** Options for `flattenHtmlToMarkdown`. */
export type FlattenHtmlOptions = {
  /** Flatten layout tables (default true). False keeps all tables structured. */
  flattenLayoutTables?: boolean;
};

export type FlattenHtmlResult = {
  /** Markdown after layout-table flattening (quotes not yet stripped). */
  markdown: string;
  /** How many layout `<table>` nodes were flattened (vs left as data tables). */
  layoutTablesFlattened: number;
  /** How many data-like tables were left for default Turndown table handling. */
  dataTablesPreserved: number;
};

export type StripQuotesResult = {
  text: string;
  quotesStripped: boolean;
  signatureStripped: boolean;
};

export type AgentMarkdownResult = FlattenHtmlResult & {
  /**
   * Final agent-facing Markdown (layout flattened + quotes/signatures stripped
   * unless opted in).
   */
  markdown: string;
  /** Markdown before quote/signature stripping. */
  markdownBeforeQuoteStrip: string;
  /** Naive Turndown without layout rules (for compression comparisons). */
  naiveMarkdown: string;
  /** Token estimate of the original HTML (layout markup + styles). */
  estimatedTokensBefore: number;
  /** Token estimate of the final agent Markdown. */
  estimatedTokensAfter: number;
  /**
   * Token footprint reduction vs original HTML (`0.8` ≈ 80% smaller).
   * Target for real transactional layout emails: ~0.75–0.85.
   */
  compressionRatio: number;
  quotesStripped: boolean;
  signatureStripped: boolean;
  sanitizeTimedOut: boolean;
  strippedHiddenElementsCount: number;
};
