/**
 * @envlo/core — runtime-portable email firewall primitives.
 *
 * Intentionally free of Node-specific native/C++ addons so the same build
 * runs on Node.js, Cloudflare Workers/Pages, Deno, and Bun.
 */

export const ENVLO_CORE_VERSION = "0.0.0" as const;

export type EnvloRuntime = "node" | "cloudflare" | "deno" | "bun" | "unknown";

/** Lightweight runtime probe with no platform-specific imports. */
export function detectRuntime(): EnvloRuntime {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.Deno !== "undefined") return "deno";
  if (typeof g.Bun !== "undefined") return "bun";
  if (typeof g.caches !== "undefined" && typeof g.WebSocketPair !== "undefined") {
    return "cloudflare";
  }
  if (typeof g.process === "object" && g.process !== null) {
    const processLike = g.process as { versions?: { node?: string } };
    if (processLike.versions?.node) return "node";
  }
  return "unknown";
}

export function createCoreBanner(): string {
  return `@envlo/core@${ENVLO_CORE_VERSION} (${detectRuntime()})`;
}

export {
  ingestRawMime,
  evaluateSenderAuth,
  evaluateSenderAuthStatus,
  parseReferencesHeader,
  normalizeMessageId,
} from "./parser/index.js";

export type {
  RawMimeInput,
  IngestRawMimeOptions,
  SenderAuthStatus,
  AuthMethodOutcome,
  MimeAddress,
  IngestedAttachment,
  IngestedMime,
  SenderAuth,
  AuthMethodResult,
  SenderAuthDetails,
} from "./parser/index.js";

export {
  unwrapForwarding,
  applyForwardingUnwrap,
  parseAddressString,
  extractEmailsFromHeader,
  parseGmailInlineForward,
  parseM365InlineForward,
  parseAppleInlineForward,
  parseYahooInlineForward,
  parseRfc822AttachmentSender,
} from "./forwarding/index.js";

export type { ForwardingDetection, ForwardingUnwrap } from "./forwarding/index.js";

export {
  sanitizeInvisibleHtml,
  sanitizeInvisibleHtmlAsync,
  htmlToSafeMarkdown,
  htmlToSafeMarkdownAsync,
  isInvisibleElement,
  isDangerousTag,
  isTrackingPixel,
  parseInlineStyle,
  normalizeCssColor,
  parseStylesheetRules,
  resolveElementStyles,
  stripZeroWidthChars,
  TimeoutGuard,
  SanitizeTimeoutError,
  DEFAULT_SANITIZE_TIMEOUT_MS,
  DEFAULT_MAX_INPUT_CHARS,
  scoreInjectionRisk,
  scoreInjectionRiskSync,
  spotlightUntrustedEmail,
  escapeSpotlightDelimiters,
  analyzeAndSpotlight,
  buildAgentPromptParts,
  isToolAllowedForRisk,
  filterToolsForRisk,
  assertToolAllowedForRisk,
  ToolPolicyDeniedError,
  SIDE_EFFECT_TOOL_NAMES,
  normalizeVisibleText,
  detectMixedScriptHomoglyphs,
  SPOTLIGHT_TAG,
  DEFAULT_SECURITY_HEADER,
} from "./firewall/index.js";

export type {
  SanitizeDomResult,
  HtmlToMarkdownResult,
  SanitizeOptions,
  InjectionRisk,
  InjectionScore,
  ScoreInjectionOptions,
  SpotlightMeta,
  CustomInjectionClassifier,
  AnalyzeAndSpotlightResult,
  AgentPromptParts,
} from "./firewall/index.js";

export {
  htmlToAgentMarkdown,
  plainTextToAgentMarkdown,
  flattenHtmlToMarkdown,
  naiveHtmlToMarkdown,
  stripQuotedReply,
  isLayoutTable,
  estimateTokenCount,
  compressionRatio,
} from "./markdown/index.js";

export type {
  HtmlToAgentMarkdownOptions,
  FlattenHtmlOptions,
  FlattenHtmlResult,
  StripQuotesResult,
  AgentMarkdownResult,
} from "./markdown/index.js";

export {
  extractAuthSignals,
  extractOtpCandidates,
  pickBestOtp,
  normalizeAuthCode,
  extractVerificationLinkCandidates,
  pickBestVerificationUrl,
} from "./extract/index.js";

export type {
  ExtractAuthInput,
  ExtractAuthOptions,
  ExtractAuthResult,
  OtpCandidate,
  VerificationLinkCandidate,
} from "./extract/index.js";

export {
  persistAttachment,
  persistAttachments,
  toAttachmentRef,
  toAttachmentRefs,
  resolveOutboundAttachment,
  resolveOutboundAttachments,
  resolveAttachmentsForReply,
  resolveAttachmentsForSend,
  resolveAttachmentsForForward,
  LocalAttachmentStore,
  MemoryAttachmentStore,
  S3AttachmentStore,
  evaluateAttachmentAllowlist,
  defaultAttachmentsRoot,
  policyForTier,
  PRO_MAX_ATTACHMENT_BYTES,
  SANDBOX_MAX_ATTACHMENT_BYTES,
} from "./attachments/index.js";

export type {
  AttachmentTier,
  AttachmentCacheStatus,
  AttachmentRef,
  OutboundAttachmentBytes,
  AttachmentInput,
  PersistAttachmentResult,
  AttachmentStore,
  PersistAttachmentsOptions,
  OutboundAttachmentRef,
  OutboundRedirectMode,
  ResolveOutboundOptions,
  S3CompatibleClient,
} from "./attachments/index.js";

export {
  openStateStore,
  openSqliteStateStore,
  MemoryStateStore,
  SqliteStateStore,
  stitchReplyHeadersFromParent,
  DraftTransitionError,
  defaultStateDbPath,
  ACTIVE_DRAFT_STATUSES,
  isNodeSqliteAvailable,
} from "./state/index.js";

export type {
  DraftStatus,
  MessageDirection,
  InboxRecord,
  ThreadRecord,
  MessageRecord,
  DraftRecord,
  ThreadView,
  StitchedReplyHeaders,
  EnvloStateStore,
  CreateInboxInput,
  IngestMessageInput,
  CreateDraftInput,
  UpdateDraftInput,
  MarkDraftSentInput,
  OpenSqliteStateOptions,
  OpenStateStoreOptions,
} from "./state/index.js";
