import type { MimeAddress } from "../parser/types.js";

/** How the original sender was recovered from an auto-forwarded message. */
export type ForwardingDetection =
  | "rfc822-attachment"
  | "gmail-inline"
  | "yahoo-inline"
  | "m365-inline"
  | "apple-inline"
  | "resent"
  | "x-original-from"
  | "none";

export type ForwardingUnwrap = {
  /**
   * The customer / original author to reply to when the outer `From` is a
   * company forwarder (`support@company.com` → `acme@envlo.dev`).
   */
  trueOriginalSender: MimeAddress | null;
  /**
   * Address agents should use for `reply_to_thread` / outbound replies.
   * Prefers `trueOriginalSender`, then outer `Reply-To`, then outer `From`.
   */
  replyToAddress: string | null;
  /** Outer forwarder mailbox when detected (often the rewritten `From`). */
  forwarderAddress: string | null;
  detection: ForwardingDetection;
};
