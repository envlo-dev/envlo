/** Accepted raw RFC 5322 MIME inputs for `ingestRawMime`. */
export type RawMimeInput = Uint8Array | ArrayBuffer | string;

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
  /** Decoded binary content (always `Uint8Array`, never Base64 text). */
  content: Uint8Array;
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
