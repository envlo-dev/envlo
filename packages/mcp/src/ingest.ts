import {
  ingestRawMime,
  type IngestedMime,
  type MessageRecord,
  type ThreadRecord,
} from "@envlo/core";
import type { EnvloMcpContext } from "./context.js";
import { rememberInboundMeta } from "./context.js";

export type IngestInboundResult = {
  thread: ThreadRecord;
  message: MessageRecord;
  created: boolean;
  mime: IngestedMime;
};

/**
 * Shared inbound pipeline for wait wake + webhook + Playwright harness:
 * MIME → firewall/spotlight (inside ingestRawMime) → state → loop reset → bus.
 */
export async function ingestInboundMime(
  ctx: EnvloMcpContext,
  inboxId: string,
  raw: string | Uint8Array | ArrayBuffer,
  options: { persistAttachments?: boolean } = {},
): Promise<IngestInboundResult> {
  const mime = await ingestRawMime(raw, {
    persistAttachments: options.persistAttachments ?? true,
  });

  const fromAddress =
    mime.replyToAddress ??
    mime.trueOriginalSender?.address ??
    mime.from?.address ??
    null;

  const ingested = await ctx.state.ingestMessage(inboxId, {
    messageId: mime.messageId ?? `<missing-${Date.now()}@envlo.local>`,
    ...(mime.inReplyTo ? { inReplyTo: mime.inReplyTo } : {}),
    ...(mime.references.length ? { references: mime.references } : {}),
    direction: "inbound",
    ...(fromAddress ? { fromAddress } : {}),
    toAddresses: mime.to.map((a) => a.address).filter(Boolean) as string[],
    ...(mime.subject !== null ? { subject: mime.subject } : {}),
    ...(mime.date !== null ? { date: mime.date } : {}),
    bodyMarkdown: mime.safeMarkdown ?? mime.text,
  });

  if (fromAddress) {
    ctx.policy.recordInbound(inboxId, fromAddress);
  }
  rememberInboundMeta(ctx, {
    threadId: ingested.thread.id,
    messageId: ingested.message.messageId,
    injectionRisk: mime.injectionRisk,
    extractedOtp: mime.extractedOtp ?? null,
    verificationUrl: mime.verificationUrl ?? null,
  });

  ctx.inboxBus.emit({
    type: "message.inbound",
    inboxId,
    thread: ingested.thread,
    message: ingested.message,
    mime,
    atMs: Date.now(),
  });

  return {
    thread: ingested.thread,
    message: ingested.message,
    created: ingested.created,
    mime,
  };
}
