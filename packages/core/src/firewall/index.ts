export { sanitizeInvisibleHtml, sanitizeInvisibleHtmlAsync } from "./sanitize-dom.js";
export { htmlToSafeMarkdown, htmlToSafeMarkdownAsync } from "./html-to-markdown.js";
export { isInvisibleElement, isDangerousTag, isTrackingPixel } from "./visibility.js";
export {
  parseInlineStyle,
  normalizeCssColor,
  parseCssLengthPx,
  isOffScreenOffset,
  isZeroOpacity,
} from "./styles.js";
export {
  parseStylesheetRules,
  resolveElementStyles,
  emptyStylesheetRules,
} from "./stylesheets.js";
export { stripZeroWidthChars, countZeroWidthChars } from "./zero-width.js";
export { TimeoutGuard, SanitizeTimeoutError, delay } from "./timeout.js";

export {
  normalizeVisibleText,
  detectMixedScriptHomoglyphs,
  foldCyrillicHomoglyphs,
  foldConfusables,
  findTokenMatches,
  OVERRIDE_PHRASES,
  findOverridePhraseMatches,
  findStructuralOverrideMatches,
  inspectEncodedBlocks,
  scoreInjectionRisk,
  scoreInjectionRiskSync,
  maxInjectionRisk,
  riskFromPoints,
  escapeSpotlightDelimiters,
  spotlightUntrustedEmail,
  generateSpotlightNonce,
  analyzeAndSpotlight,
  buildAgentPromptParts,
  SIDE_EFFECT_TOOL_NAMES,
  isSideEffectTool,
  isToolAllowedForRisk,
  filterToolsForRisk,
  assertToolAllowedForRisk,
  ToolPolicyDeniedError,
  SPOTLIGHT_TAG,
  DEFAULT_SECURITY_HEADER,
  DEFAULT_SCORE_MAX_INPUT_CHARS,
  SCORE_THRESHOLD_MEDIUM,
  SCORE_THRESHOLD_HIGH,
  WEIGHTS,
} from "./injection/index.js";

export type {
  SanitizeDomResult,
  HtmlToMarkdownResult,
  SanitizeOptions,
  AbortFlag,
} from "./types.js";

export type {
  InjectionRisk,
  InjectionScore,
  InjectionScoreReason,
  CustomInjectionClassifier,
  ScoreInjectionOptions,
  SpotlightMeta,
  AnalyzeAndSpotlightResult,
  AgentPromptParts,
  SideEffectToolName,
} from "./injection/index.js";

export { DEFAULT_SANITIZE_TIMEOUT_MS, DEFAULT_MAX_INPUT_CHARS } from "./types.js";
