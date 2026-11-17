/** Result of DOM-level invisible prompt-injection sanitization. */
export type SanitizeDomResult = {
  /** Cleaned HTML with invisible / dangerous nodes removed. */
  html: string;
  /** Number of DOM elements deleted for invisibility or policy (script/iframe/…). */
  strippedHiddenElementsCount: number;
  /** True when the timeout guard aborted the walk early. */
  timedOut: boolean;
};

/** Sanitize + Turndown pipeline for agent-facing Markdown. */
export type HtmlToMarkdownResult = SanitizeDomResult & {
  markdown: string;
};

export type SanitizeOptions = {
  /** Soft deadline for DOM/regex work (default 1500ms). */
  timeoutMs?: number;
  /** Reject / short-circuit inputs larger than this many characters (default 2_000_000). */
  maxInputChars?: number;
};

export const DEFAULT_SANITIZE_TIMEOUT_MS = 1500;
export const DEFAULT_MAX_INPUT_CHARS = 2_000_000;
