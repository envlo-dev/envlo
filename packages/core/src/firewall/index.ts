export { sanitizeInvisibleHtml } from "./sanitize-dom.js";
export { htmlToSafeMarkdown } from "./html-to-markdown.js";
export { isInvisibleElement, isDangerousTag, isTrackingPixel } from "./visibility.js";
export {
  parseInlineStyle,
  normalizeCssColor,
  parseCssLengthPx,
  isOffScreenOffset,
  isZeroOpacity,
} from "./styles.js";
export { stripZeroWidthChars, countZeroWidthChars } from "./zero-width.js";
export { TimeoutGuard, SanitizeTimeoutError } from "./timeout.js";

export type {
  SanitizeDomResult,
  HtmlToMarkdownResult,
  SanitizeOptions,
} from "./types.js";

export { DEFAULT_SANITIZE_TIMEOUT_MS, DEFAULT_MAX_INPUT_CHARS } from "./types.js";
