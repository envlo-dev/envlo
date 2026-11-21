import type { DraftRecord } from "../state/types.js";
import type { OutboundMail, OutboundMailAttachment } from "./types.js";

export type DraftToOutboundMailOptions = {
  from: string;
  replyTo?: string;
  html?: string;
  /** Override text body (default: draft.currentMarkdown). */
  text?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  /** Optional outbound attachments (from attachment cache / host). */
  attachments?: OutboundMailAttachment[];
};

/** Map a draft (+ from address) onto the portable OutboundMail shape. */
export function draftToOutboundMail(
  draft: DraftRecord,
  options: DraftToOutboundMailOptions,
): OutboundMail {
  if (!options.from.trim()) throw new Error("from address is required");
  if (draft.toAddresses.length === 0) {
    throw new Error(`draft ${draft.id} has no recipients`);
  }
  return {
    from: options.from,
    to: [...draft.toAddresses],
    ...(options.cc?.length ? { cc: options.cc } : {}),
    ...(options.bcc?.length ? { bcc: options.bcc } : {}),
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    subject: draft.subject ?? "(no subject)",
    text: options.text ?? draft.currentMarkdown,
    ...(options.html !== undefined ? { html: options.html } : {}),
    ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
    ...(draft.references.length ? { references: [...draft.references] } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.attachments?.length
      ? { attachments: options.attachments }
      : {}),
  };
}

export function toPendingApprovalPayload(draft: DraftRecord) {
  return {
    draftId: draft.id,
    threadId: draft.threadId,
    inboxId: draft.inboxId,
    status: draft.status,
    toAddresses: [...draft.toAddresses],
    subject: draft.subject,
    markdown: draft.currentMarkdown,
    originalMarkdown: draft.originalDraftMarkdown,
    humanFeedback: draft.humanFeedback,
    submittedAt: draft.submittedAt,
  };
}
