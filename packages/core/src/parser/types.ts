/** Accepted raw RFC 5322 MIME inputs for `ingestRawMime`. */
export type RawMimeInput = Uint8Array | ArrayBuffer | string;

/**
 * Options for agent Markdown generation during ingest.
 * Defaults strip quoted history and signatures (token-efficient for agents).
 */
export type IngestRawMimeOptions = {
  /** Keep `On … wrote:` / Outlook quote tails in agent-facing body. Default false. */
  includeQuotedHistory?: boolean;
  /** Keep trailing signatures (`--`, mobile footers). Default false. */
  includeSignatures?: boolean;
  /**
   * Run DOM sanitize before Markdown (default true).
   * Set false only for already-trusted HTML.
   */
  sanitize?: boolean;
  /**
   * Flatten email layout tables into stacked Markdown (default true).
   * Set false to force-keep tables as structured content.
   */
  flattenLayoutTables?: boolean;
  /**
   * Persist attachments through the sandboxed cache pipeline
   * (`@envlo/core/attachments`). Default false (inline buffers only) for
   * portability; enable for agent inboxes that need `localFilePath` / S3 URLs.
   */
  persistAttachments?: boolean;
  /** Size-tier policy when `persistAttachments` is true (default `pro` = 5MB). */
  attachmentTier?: "sandbox" | "pro";
  /** Override max attachment bytes when persisting. */
  attachmentMaxBytes?: number;
  /**
   * Custom store (local disk / memory / S3). Defaults to
   * `LocalAttachmentStore` under `~/.envlo/attachments`.
   */
  attachmentStore?: import("../attachments/types.js").AttachmentStore;
  /**
   * Keep raw `content` bytes on **stored** attachments after persistence.
   * Default false (path/URL refs only). Rejected attachments never retain bytes.
   */
  includeAttachmentContent?: boolean;
};

/** Aggregated SPF/DKIM/DMARC verdict for spoofing detection. */
export type SenderAuthStatus = "pass" | "fail" | "unverified";

/** Individual auth-method result tokens commonly seen in Authentication-Results. */
export type AuthMethodOutcome =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "policy"
  | string;

export type MimeAddress = {
  name: string;
  address: string;
};

export type IngestedAttachment = {
  filename: string | null;
  mimeType: string;
  disposition: "attachment" | "inline" | null;
  contentId?: string;
  /**
   * Decoded binary content (always `Uint8Array`, never Base64 text).
   * Empty when cache status is `metadata-only` / rejected, or when
   * `includeContent: false` after persistence.
   */
  content: Uint8Array;
  /** Stable cache id when the attachment cache pipeline ran. */
  attachmentId: string | null;
  /** Absolute sandboxed path (`~/.envlo/attachments/<id>.ext`) when stored locally. */
  localFilePath: string | null;
  /** Remote object URL when using an S3-compatible store. */
  remoteUrl: string | null;
  sizeBytes: number;
  cacheStatus: "stored" | "metadata-only" | "rejected" | "inline-buffer";
  rejectReason: string | null;
};

/**
 * Rich sender-auth breakdown for agents/UI.
 * `status` is the coarse spoofing verdict; per-method fields are the latest
 * SPF/DKIM/DMARC tokens parsed from Authentication-Results / Received-SPF.
 */
export type SenderAuth = {
  status: SenderAuthStatus;
  spf: AuthMethodOutcome | null;
  dkim: AuthMethodOutcome | null;
  dmarc: AuthMethodOutcome | null;
};

/**
 * Normalized result of raw MIME ingestion.
 *
 * Threading fields follow RFC 5322 (`Message-ID`, `In-Reply-To`, `References`).
 */
export type IngestedMime = {
  messageId: string | null;
  inReplyTo: string | null;
  /** Ordered Message-ID tokens from the `References` header (angle brackets preserved when present). */
  references: string[];
  from: MimeAddress | null;
  /** RFC 5322 `Sender` when present (may differ from `From`, e.g. mailing lists). */
  sender: MimeAddress | null;
  to: MimeAddress[];
  cc: MimeAddress[];
  bcc: MimeAddress[];
  replyTo: MimeAddress[];
  subject: string | null;
  /** Original `Date` header value when present (ISO when postal-mime parses it). */
  date: string | null;
  html: string | null;
  text: string | null;
  /**
   * Agent-safe Markdown from sanitized + layout-flattened HTML with quoted
   * history stripped. Null when there is no HTML part. Prefer this over raw
   * `html` for LLM context.
   */
  safeMarkdown: string | null;
  /** Elements removed by the DOM sanitizer while building `safeMarkdown`. */
  strippedHiddenElementsCount: number;
  /** True when HTML sanitize hit the timeout/size guard (Markdown will be empty). */
  sanitizeTimedOut: boolean;
  /** Layout `<table>` grids flattened while building `safeMarkdown`. */
  layoutTablesFlattened: number;
  /**
   * Token footprint reduction vs original HTML (`0.8` ≈ 80% smaller).
   * Null when there was no HTML body to convert.
   */
  markdownCompressionRatio: number | null;
  /**
   * Visible prompt-injection risk for the agent-facing body
   * (`safeMarkdown` ?? `text`).
   */
  injectionRisk: "low" | "medium" | "high";
  /** Numeric heuristic points that produced `injectionRisk`. */
  injectionPoints: number;
  /** Machine-readable scoring reasons (phrases, tokens, encodings, …). */
  injectionReasons: Array<{ code: string; detail: string; weight?: number }>;
  /**
   * Spotlight-wrapped body for LLM context (nonced XML + security header/footer).
   * Null when there is no visible text/html body to wrap.
   */
  spotlightedText: string | null;
  /**
   * Best verification / OTP / device code near auth keywords, or null when none
   * found. Supports numeric (incl. spaced/hyphenated), alphanumeric, and
   * device codes. Years, ZIP codes, and hex colors are ignored.
   */
  extractedOtp: string | null;
  /**
   * Highest-scoring verification / magic link (`<a href>` or bare URL), or null.
   * Unsubscribe / privacy / social noise is filtered out.
   */
  verificationUrl: string | null;
  attachments: IngestedAttachment[];
  /** @deprecated Prefer `senderAuth.status` — kept as a shorthand. */
  senderAuthStatus: SenderAuthStatus;
  senderAuth: SenderAuth;
  /**
   * Original customer sender when the message was auto-forwarded into Envlo
   * (Gmail / M365 Zero-MX). Equals `from` when no forwarding was detected.
   */
  trueOriginalSender: MimeAddress | null;
  /**
   * Best address for `reply_to_thread` — prefers `trueOriginalSender`, then
   * outer `Reply-To`, then outer `From`.
   */
  replyToAddress: string | null;
  /** Lowercased header map for callers that need raw auth/threading lines. */
  headers: ReadonlyMap<string, string[]>;
};

export type AuthMethodResult = {
  method: "spf" | "dkim" | "dmarc";
  result: string;
};

export type SenderAuthDetails = SenderAuth & {
  results: AuthMethodResult[];
};
