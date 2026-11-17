import PostalMime from "postal-mime";
import type { Header } from "postal-mime";
import { unwrapForwarding } from "../forwarding/unwrap-forwarding.js";
import { firstAddress, flattenAddresses } from "./addresses.js";
import { normalizeAttachments } from "./attachments.js";
import { normalizeMessageId, parseReferencesHeader } from "./references.js";
import { evaluateSenderAuth } from "./sender-auth.js";
import type { IngestedMime, RawMimeInput, SenderAuth } from "./types.js";

function buildHeaderMap(headers: Header[]): ReadonlyMap<string, string[]> {
  const map = new Map<string, string[]>();
  for (const header of headers) {
    const key = header.key.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.push(header.value);
    } else {
      map.set(key, [header.value]);
    }
  }
  return map;
}

/**
 * Universal raw MIME ingestion wrapper.
 *
 * Accepts RFC 5322 byte/streams (`Uint8Array | ArrayBuffer | string`), parses with
 * `postal-mime`, and returns threading headers, bodies, attachment buffers, and a
 * coarse `senderAuthStatus` derived from Authentication-Results / Received-SPF.
 *
 * Also unwraps Gmail / Microsoft 365 auto-forwards so `trueOriginalSender` and
 * `replyToAddress` point at the customer, not the forwarder mailbox.
 */
export async function ingestRawMime(input: RawMimeInput): Promise<IngestedMime> {
  const email = await PostalMime.parse(input, {
    attachmentEncoding: "arraybuffer",
  });

  const headerMap = buildHeaderMap(email.headers);
  const referencesHeader = email.references ?? headerMap.get("references")?.[0] ?? null;
  const authDetails = evaluateSenderAuth(email.headers);
  const senderAuth: SenderAuth = {
    status: authDetails.status,
    spf: authDetails.spf,
    dkim: authDetails.dkim,
    dmarc: authDetails.dmarc,
  };

  const base: IngestedMime = {
    messageId: normalizeMessageId(email.messageId ?? headerMap.get("message-id")?.[0]),
    inReplyTo: normalizeMessageId(email.inReplyTo ?? headerMap.get("in-reply-to")?.[0]),
    references: parseReferencesHeader(referencesHeader),
    from: firstAddress(email.from),
    sender: firstAddress(email.sender),
    to: flattenAddresses(email.to),
    cc: flattenAddresses(email.cc),
    bcc: flattenAddresses(email.bcc),
    replyTo: flattenAddresses(email.replyTo),
    subject: email.subject ?? null,
    date: email.date ?? headerMap.get("date")?.[0] ?? null,
    html: email.html ?? null,
    text: email.text ?? null,
    attachments: normalizeAttachments(email.attachments),
    senderAuthStatus: senderAuth.status,
    senderAuth,
    trueOriginalSender: null,
    replyToAddress: null,
    headers: headerMap,
  };

  const forwarding = await unwrapForwarding(base);
  return {
    ...base,
    trueOriginalSender: forwarding.trueOriginalSender,
    replyToAddress: forwarding.replyToAddress,
  };
}
