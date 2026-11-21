import {
  resolveAttachmentsForForward,
  resolveAttachmentsForReply,
  resolveAttachmentsForSend,
  type DraftRecord,
  type EnforceOutboundResult,
  type OutboundAttachmentRef,
  type OutboundPolicyContext,
  type OutboundToolName,
} from "@envlo/core";
import { createOutboundMessageId } from "@envlo/core/state";
import type { EnvloMcpContext } from "./context.js";
import { threadRiskOf } from "./context.js";

export type OutboundToolResult = {
  disposition: "AUTO_SEND" | "REQUIRE_APPROVAL" | "IDEMPOTENT_REPLAY";
  draft: DraftRecord | null;
  decision: EnforceOutboundResult["decision"];
  outboundMessageId: string | null;
  idempotentReplay: boolean;
};

async function resolveAttachments(
  tool: OutboundToolName,
  refs: OutboundAttachmentRef[] | undefined,
) {
  if (!refs?.length) return [];
  if (tool === "reply_to_thread") return resolveAttachmentsForReply(refs);
  if (tool === "forward_thread") return resolveAttachmentsForForward(refs);
  return resolveAttachmentsForSend(refs);
}

/**
 * Ensure `send_email` has a thread — seeds a synthetic outbound message when
 * `threadId` is omitted (state store has no createThread API).
 */
export async function ensureSendThread(
  ctx: EnvloMcpContext,
  input: {
    inboxId: string;
    to: string[];
    subject: string;
    threadId?: string;
  },
): Promise<string> {
  if (input.threadId) return input.threadId;

  const inbox = await ctx.state.getInbox(input.inboxId);
  if (!inbox) throw new Error(`inbox not found: ${input.inboxId}`);

  const seeded = await ctx.state.ingestMessage(input.inboxId, {
    messageId: createOutboundMessageId("envlo.seed"),
    direction: "outbound",
    fromAddress: inbox.address,
    toAddresses: input.to,
    subject: input.subject,
    bodyMarkdown: "(envlo outbound thread seed)",
  });
  return seeded.thread.id;
}

function normalizeAttachmentRefs(
  refs:
    | Array<{
        filePath?: string;
        url?: string;
        filename?: string;
        mimeType?: string;
      }>
    | undefined,
): OutboundAttachmentRef[] | undefined {
  if (!refs?.length) return undefined;
  return refs.map((ref) => {
    const out: OutboundAttachmentRef = {};
    if (ref.filePath !== undefined) out.filePath = ref.filePath;
    if (ref.url !== undefined) out.url = ref.url;
    if (ref.filename !== undefined) out.filename = ref.filename;
    if (ref.mimeType !== undefined) out.mimeType = ref.mimeType;
    return out;
  });
}

export async function runOutboundTool(
  ctx: EnvloMcpContext,
  input: {
    tool: OutboundToolName;
    inboxId: string;
    threadId: string;
    to: string[];
    subject?: string | null;
    markdownBody: string;
    attachments?: Array<{
      filePath?: string;
      url?: string;
      filename?: string;
      mimeType?: string;
    }>;
    idempotencyKey?: string;
  },
): Promise<OutboundToolResult> {
  const inbox = await ctx.state.getInbox(input.inboxId);
  if (!inbox) throw new Error(`inbox not found: ${input.inboxId}`);

  const attachments = await resolveAttachments(
    input.tool,
    normalizeAttachmentRefs(input.attachments),
  );
  const risk = threadRiskOf(ctx, input.threadId);

  const policyCtx: OutboundPolicyContext = {
    tool: input.tool,
    inboxId: input.inboxId,
    threadId: input.threadId,
    to: input.to,
    markdownBody: input.markdownBody,
    inboxAddress: inbox.address,
    injectionRisk: risk,
    hasAttachment: attachments.length > 0,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.idempotencyKey !== undefined
      ? { idempotencyKey: input.idempotencyKey }
      : {}),
  };

  // Policy engine uses configured from when sending; set per-inbox From.
  const from = ctx.fromOverride ?? inbox.address;
  const prepared = await ctx.policy.enforce(policyCtx, ctx.state);

  if (prepared.idempotentReplay) {
    return {
      disposition: "IDEMPOTENT_REPLAY",
      draft: prepared.draft,
      decision: prepared.decision,
      outboundMessageId: prepared.cached?.outboundMessageId ?? null,
      idempotentReplay: true,
    };
  }

  if (!prepared.draft) {
    throw new Error("enforceOutboundPolicy returned no draft");
  }

  if (prepared.decision?.disposition === "REQUIRE_APPROVAL") {
    return {
      disposition: "REQUIRE_APPROVAL",
      draft: prepared.draft,
      decision: prepared.decision,
      outboundMessageId: null,
      idempotentReplay: false,
    };
  }

  // AUTO_SEND — transport via configured sender (ConsoleDryRun by default).
  const sent = await ctx.policy.sendApprovedDraft({
    state: ctx.state,
    draftId: prepared.draft.id,
    ctx: policyCtx,
    sender: ctx.sender,
    from,
    ...(attachments.length
      ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            contentType: a.mimeType,
            content: a.content,
          })),
        }
      : {}),
  });

  return {
    disposition: "AUTO_SEND",
    draft: sent.draft,
    decision: prepared.decision,
    outboundMessageId: sent.outboundMessageId,
    idempotentReplay: false,
  };
}

/** Build a forwarded-message markdown body for `forward_thread`. */
export function buildForwardMarkdown(input: {
  preface?: string;
  fromAddress: string | null;
  subject: string | null;
  date: string | null;
  body: string | null;
}): string {
  const header = [
    "---------- Forwarded message ---------",
    `From: ${input.fromAddress ?? "(unknown)"}`,
    `Date: ${input.date ?? "(unknown)"}`,
    `Subject: ${input.subject ?? "(no subject)"}`,
    "",
  ].join("\n");
  const body = input.body ?? "";
  const preface = input.preface?.trim();
  return preface ? `${preface}\n\n${header}${body}` : `${header}${body}`;
}
