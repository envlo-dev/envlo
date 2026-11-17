/** Result of DOM-level invisible prompt-injection sanitization. */
export type SanitizeDomResult = {
  /** Cleaned HTML with invisible / dangerous nodes removed. */
  html: string;
  /** Number of DOM elements deleted for invisibility or policy (script/iframe/…). */
  strippedHiddenElementsCount: number;
  /** True when the timeout / size guard aborted the walk early. */
  timedOut: boolean;
};

/**
 * Sanitize + Turndown pipeline for **agent-facing Markdown**.
 * Not a faithful HTML email viewer — hidden UI chrome and injections are removed
 * so LLMs never see invisible prompt text.
 */
export type HtmlToMarkdownResult = SanitizeDomResult & {
  markdown: string;
};

export type SanitizeOptions = {
  /** Soft/hard deadline for DOM work (default 1500ms). */
  timeoutMs?: number;
  /** Reject / short-circuit inputs larger than this many characters (default 2_000_000). */
  maxInputChars?: number;
  /**
   * Keep `display:none` / `visibility:hidden` / `hidden` nodes (collapsed quote UI).
   * Harder injection hides (opacity 0, font-size 0, same-color, off-screen, clip, …)
   * are still stripped. Default false (fail closed for agents).
   */
  preserveCollapsedQuotes?: boolean;
};

export const DEFAULT_SANITIZE_TIMEOUT_MS = 1500;
export const DEFAULT_MAX_INPUT_CHARS = 2_000_000;

/** Shared abort flag for cooperative + Promise.race hard deadlines. */
export type AbortFlag = { aborted: boolean };
