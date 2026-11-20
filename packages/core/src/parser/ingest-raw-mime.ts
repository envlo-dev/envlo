import PostalMime from "postal-mime";
import type { Header } from "postal-mime";
import { scoreInjectionRisk } from "../firewall/injection/score.js";
import { spotlightUntrustedEmail } from "../firewall/injection/spotlight.js";
import { unwrapForwarding } from "../forwarding/unwrap-forwarding.js";
import { extractAuthSignals } from "../extract/extract-auth.js";
import {
  htmlToAgentMarkdown,
  plainTextToAgentMarkdown,
} from "../markdown/html-to-agent-markdown.js";
import { firstAddress, flattenAddresses } from "./addresses.js";
import {
  normalizeAndPersistAttachments,
  normalizeAttachments,
} from "./attachments.js";
import { normalizeMessageId, parseReferencesHeader } from "./references.js";
import { evaluateSenderAuth } from "./sender-auth.js";
import type {
  IngestedMime,
  IngestRawMimeOptions,
  RawMimeInput,
  SenderAuth,
} from "./types.js";

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
 *
 * Visible HTML is sanitized, layout-flattened, and quote-stripped into
 * `safeMarkdown`, then scored for prompt injection and wrapped as
 * `spotlightedText` for agent context. Also extracts `extractedOtp` and
 * `verificationUrl` from subject/text/html when present.
 *
 * Prefer this over firewall `htmlToSafeMarkdown` for agent bodies — that helper
 * only sanitizes + Turndowns and does **not** flatten layout tables or strip quotes.
 *
 * When `persistAttachments: true`, binaries are written through
 * `@envlo/core/attachments` (allowlist + tier caps → `~/.envlo/attachments` or S3)
 * so agents get `localFilePath` / `remoteUrl` instead of Base64 in context.
 */
export async function ingestRawMime(
  input: RawMimeInput,
  options: IngestRawMimeOptions = {},
): Promise<IngestedMime> {
  const includeQuotedHistory = options.includeQuotedHistory ?? false;
  const includeSignatures = options.includeSignatures ?? false;
  const sanitize = options.sanitize ?? true;
  const flattenLayoutTables = options.flattenLayoutTables ?? true;
  const persistAttachmentsFlag = options.persistAttachments ?? false;

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

  const html = email.html ?? null;
  const text = email.text ?? null;
  const agentMarkdown = html
    ? htmlToAgentMarkdown(html, {
        includeQuotedHistory,
        includeSignatures,
        sanitize,
        flattenLayoutTables,
      })
    : null;
  const agentText = !html && text
    ? plainTextToAgentMarkdown(text, { includeQuotedHistory, includeSignatures })
    : null;

  const authSignals = extractAuthSignals({
    html,
    text,
    subject: email.subject ?? null,
  });

  const attachments = persistAttachmentsFlag
    ? await normalizeAndPersistAttachments(email.attachments, {
        tier: options.attachmentTier ?? "pro",
        ...(options.attachmentMaxBytes !== undefined
          ? { maxBytes: options.attachmentMaxBytes }
          : {}),
        ...(options.attachmentStore !== undefined
          ? { store: options.attachmentStore }
          : {}),
        includeContent: options.includeAttachmentContent ?? false,
      })
    : normalizeAttachments(email.attachments);

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
    html,
    text,
    safeMarkdown: agentMarkdown?.markdown ?? null,
    strippedHiddenElementsCount: agentMarkdown?.strippedHiddenElementsCount ?? 0,
    sanitizeTimedOut: agentMarkdown?.sanitizeTimedOut ?? false,
    layoutTablesFlattened: agentMarkdown?.layoutTablesFlattened ?? 0,
    markdownCompressionRatio: agentMarkdown?.compressionRatio ?? null,
    injectionRisk: "low",
    injectionPoints: 0,
    injectionReasons: [],
    spotlightedText: null,
    extractedOtp: authSignals.extractedOtp,
    verificationUrl: authSignals.verificationUrl,
    attachments,
    senderAuthStatus: senderAuth.status,
    senderAuth,
    trueOriginalSender: null,
    replyToAddress: null,
    headers: headerMap,
  };

  const forwarding = await unwrapForwarding(base);
  const withForwarding: IngestedMime = {
    ...base,
    trueOriginalSender: forwarding.trueOriginalSender,
    replyToAddress: forwarding.replyToAddress,
  };

  const visibleBody =
    (withForwarding.safeMarkdown && withForwarding.safeMarkdown.trim()) ||
    (agentText?.markdown && agentText.markdown.trim()) ||
    (withForwarding.text && withForwarding.text.trim()) ||
    "";

  if (!visibleBody) {
    return withForwarding;
  }

  const score = await scoreInjectionRisk(visibleBody, {
    senderAuthStatus: withForwarding.senderAuth.status,
  });

  const senderForSpotlight =
    withForwarding.trueOriginalSender?.address ??
    withForwarding.from?.address ??
    null;

  const spotlightedText = spotlightUntrustedEmail(visibleBody, {
    sender: senderForSpotlight,
    spfDkim: withForwarding.senderAuth.status,
    injectionRisk: score.risk,
  });

  return {
    ...withForwarding,
    injectionRisk: score.risk,
    injectionPoints: score.points,
    injectionReasons: score.reasons,
    spotlightedText,
  };
}
