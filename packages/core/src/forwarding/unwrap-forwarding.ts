import type { IngestedMime, MimeAddress } from "../parser/types.js";
import {
  bodyTextForForwardScan,
  parseAppleInlineForward,
  parseGmailInlineForward,
  parseM365InlineForward,
  parseYahooInlineForward,
} from "./inline-blocks.js";
import { extractEmailsFromHeader, parseAddressString } from "./parse-address.js";
import { parseRfc822AttachmentSender } from "./rfc822.js";
import type { ForwardingUnwrap } from "./types.js";

function headerValues(mail: IngestedMime, key: string): string[] {
  return mail.headers.get(key.toLowerCase()) ?? [];
}

function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function pickReplyToAddress(
  trueOriginalSender: MimeAddress | null,
  mail: IngestedMime,
): string | null {
  if (trueOriginalSender?.address) return trueOriginalSender.address;
  if (mail.replyTo[0]?.address) return mail.replyTo[0].address;
  if (mail.from?.address) return mail.from.address;
  return null;
}

function subjectLooksForwarded(subject: string | null): boolean {
  if (!subject) return false;
  // EN/FR/ES/DE/NL common forward prefixes (Fwd/FW/TR/RV/WG/VL/ENC).
  return /^(fwd?|fw|vl|tr|rv|enc|wg)\s*:/i.test(subject.trim());
}

function looksLikeReply(mail: IngestedMime): boolean {
  if (mail.inReplyTo) return true;
  if (mail.subject && /^re\s*:/i.test(mail.subject.trim())) return true;
  return false;
}

function hasForwardingHeaders(mail: IngestedMime): boolean {
  return (
    headerValues(mail, "x-forwarded-to").length > 0 ||
    headerValues(mail, "x-forwarded-for").length > 0 ||
    headerValues(mail, "resent-from").length > 0 ||
    headerValues(mail, "x-ms-exchange-organization-autoforwarded").length > 0 ||
    headerValues(mail, "x-original-from").length > 0
  );
}

/**
 * M365 From/Sent/To blocks also appear in normal reply quotes. Only treat as a
 * forward unwrap when we have corroborating forward signals — never on Re:/In-Reply-To.
 */
function shouldAcceptM365Inline(mail: IngestedMime): boolean {
  if (looksLikeReply(mail) && !subjectLooksForwarded(mail.subject)) {
    return false;
  }
  if (subjectLooksForwarded(mail.subject)) return true;
  if (hasForwardingHeaders(mail)) return true;
  return false;
}

function inferForwarderAddress(mail: IngestedMime, outerFrom: MimeAddress | null): string | null {
  const xForwardedFor = headerValues(mail, "x-forwarded-for").flatMap((v) =>
    extractEmailsFromHeader(v),
  );
  // Gmail's X-Forwarded-For is typically the *pre-forward recipient* (the
  // company mailbox), not the customer. Prefer it as forwarder when present.
  if (xForwardedFor[0]) return xForwardedFor[0];

  const xForwardedTo = headerValues(mail, "x-forwarded-to").flatMap((v) =>
    extractEmailsFromHeader(v),
  );
  if (xForwardedTo[0] && outerFrom && !addressesEqual(xForwardedTo[0], outerFrom.address)) {
    return outerFrom.address;
  }

  return outerFrom?.address ?? null;
}

/**
 * Recover the true original sender from Zero-MX / auto-forward envelopes
 * (Gmail & Microsoft 365 → Envlo inbox).
 *
 * Detection order:
 * 1. Nested `message/rfc822` attachment
 * 2. Apple Mail “Begin forwarded message”
 * 3. Gmail inline forwarded block (innermost hop when nested)
 * 4. Yahoo inline forwarded block
 * 5. Microsoft 365 / Outlook From/Sent/To block (guarded against reply quotes)
 * 6. `X-Original-From`
 * 7. `Resent-From` present → outer `From` is the original (Resent-* = resender)
 *
 * Note: `X-Forwarded-For` is parsed for forwarder hints only — on Gmail it is
 * usually the company mailbox that was forwarded, not the customer.
 */
export async function unwrapForwarding(mail: IngestedMime): Promise<ForwardingUnwrap> {
  const outerFrom = mail.from;
  const body = bodyTextForForwardScan(mail.text, mail.html);

  const rfc822Sender = await parseRfc822AttachmentSender(mail);
  if (rfc822Sender && !addressesEqual(rfc822Sender.address, outerFrom?.address)) {
    return {
      trueOriginalSender: rfc822Sender,
      replyToAddress: pickReplyToAddress(rfc822Sender, mail),
      forwarderAddress: inferForwarderAddress(mail, outerFrom),
      detection: "rfc822-attachment",
    };
  }

  // Apple before Gmail: "Begin forwarded message" must not be claimed by Gmail.
  const appleSender = parseAppleInlineForward(body);
  if (appleSender) {
    return {
      trueOriginalSender: appleSender,
      replyToAddress: pickReplyToAddress(appleSender, mail),
      forwarderAddress: inferForwarderAddress(mail, outerFrom),
      detection: "apple-inline",
    };
  }

  const gmailSender = parseGmailInlineForward(body);
  if (gmailSender) {
    return {
      trueOriginalSender: gmailSender,
      replyToAddress: pickReplyToAddress(gmailSender, mail),
      forwarderAddress: inferForwarderAddress(mail, outerFrom),
      detection: "gmail-inline",
    };
  }

  const yahooSender = parseYahooInlineForward(body);
  if (yahooSender) {
    return {
      trueOriginalSender: yahooSender,
      replyToAddress: pickReplyToAddress(yahooSender, mail),
      forwarderAddress: inferForwarderAddress(mail, outerFrom),
      detection: "yahoo-inline",
    };
  }

  const m365 = parseM365InlineForward(body);
  if (
    m365 &&
    shouldAcceptM365Inline(mail) &&
    !addressesEqual(m365.sender.address, outerFrom?.address)
  ) {
    return {
      trueOriginalSender: m365.sender,
      replyToAddress: pickReplyToAddress(m365.sender, mail),
      forwarderAddress: inferForwarderAddress(mail, outerFrom),
      detection: "m365-inline",
    };
  }

  const xOriginalFrom = parseAddressString(headerValues(mail, "x-original-from")[0] ?? null);
  if (xOriginalFrom && !addressesEqual(xOriginalFrom.address, outerFrom?.address)) {
    return {
      trueOriginalSender: xOriginalFrom,
      replyToAddress: pickReplyToAddress(xOriginalFrom, mail),
      forwarderAddress: inferForwarderAddress(mail, outerFrom),
      detection: "x-original-from",
    };
  }

  const resentFrom = parseAddressString(headerValues(mail, "resent-from")[0] ?? null);
  if (resentFrom && outerFrom) {
    return {
      trueOriginalSender: outerFrom,
      replyToAddress: pickReplyToAddress(outerFrom, mail),
      forwarderAddress: resentFrom.address,
      detection: "resent",
    };
  }

  return {
    trueOriginalSender: outerFrom,
    replyToAddress: pickReplyToAddress(outerFrom, mail),
    forwarderAddress: hasForwardingHeaders(mail) ? inferForwarderAddress(mail, outerFrom) : null,
    detection: "none",
  };
}

export async function applyForwardingUnwrap<T extends IngestedMime>(
  mail: T,
): Promise<T & ForwardingUnwrap> {
  const unwrapped = await unwrapForwarding(mail);
  return {
    ...mail,
    ...unwrapped,
  };
}
