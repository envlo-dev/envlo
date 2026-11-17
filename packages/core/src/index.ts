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
  htmlToSafeMarkdown,
  isInvisibleElement,
  isDangerousTag,
  isTrackingPixel,
  parseInlineStyle,
  normalizeCssColor,
  stripZeroWidthChars,
  TimeoutGuard,
  SanitizeTimeoutError,
  DEFAULT_SANITIZE_TIMEOUT_MS,
  DEFAULT_MAX_INPUT_CHARS,
} from "./firewall/index.js";

export type {
  SanitizeDomResult,
  HtmlToMarkdownResult,
  SanitizeOptions,
} from "./firewall/index.js";
