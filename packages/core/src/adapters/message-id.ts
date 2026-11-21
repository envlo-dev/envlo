import { createOutboundMessageId } from "../state/ids.js";
import { canonicalizeMessageId } from "../state/threading.js";

/** Normalize or mint an RFC 5322 Message-ID. */
export function ensureMessageId(
  value: string | null | undefined,
  domain = "envlo.local",
): string {
  return canonicalizeMessageId(value) ?? createOutboundMessageId(domain);
}

/** Strip angle brackets for providers that want bare ids. */
export function bareMessageId(messageId: string): string {
  const canonical = canonicalizeMessageId(messageId) ?? messageId.trim();
  return canonical.replace(/^<|>$/g, "");
}
