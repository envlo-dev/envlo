export {
  normalizeVisibleText,
  detectMixedScriptHomoglyphs,
  foldCyrillicHomoglyphs,
  foldConfusables,
  hasMixedScriptConfusables,
  stripInvisibleAndBidi,
} from "./normalize.js";
export { findTokenMatches, CHAT_TEMPLATE_PATTERNS, TOOL_CALL_PATTERNS } from "./tokens.js";
export { OVERRIDE_PHRASES, findOverridePhraseMatches } from "./dictionary.js";
export { findStructuralOverrideMatches, findProximityBonus } from "./patterns.js";
export { preprocessForInjectionScan } from "./preprocess.js";
export { inspectEncodedBlocks } from "./encoded-blocks.js";
export {
  scoreInjectionRisk,
  scoreInjectionRiskSync,
  maxInjectionRisk,
  riskFromPoints,
} from "./score.js";
export {
  escapeSpotlightDelimiters,
  spotlightUntrustedEmail,
  generateSpotlightNonce,
} from "./spotlight.js";
export { analyzeAndSpotlight } from "./analyze.js";
export type { AnalyzeAndSpotlightResult } from "./analyze.js";
export {
  SIDE_EFFECT_TOOL_NAMES,
  isSideEffectTool,
  isToolAllowedForRisk,
  filterToolsForRisk,
  assertToolAllowedForRisk,
  ToolPolicyDeniedError,
} from "./policy.js";
export type { SideEffectToolName } from "./policy.js";
export { buildAgentPromptParts } from "./prompt.js";
export type { AgentPromptParts } from "./prompt.js";

export type {
  InjectionRisk,
  InjectionScore,
  InjectionScoreReason,
  CustomInjectionClassifier,
  ScoreInjectionOptions,
  SpotlightMeta,
} from "./types.js";

export {
  SPOTLIGHT_TAG,
  DEFAULT_SECURITY_HEADER,
  DEFAULT_SCORE_MAX_INPUT_CHARS,
  SCORE_THRESHOLD_MEDIUM,
  SCORE_THRESHOLD_HIGH,
  WEIGHTS,
} from "./types.js";
