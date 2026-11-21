import type {
  DraftRecord,
  EnvloStateStore,
  MessageRecord,
} from "../state/types.js";
import { draftToOutboundMail, type DraftToOutboundMailOptions } from "./draft-mail.js";
import type { DraftLifecycleBus } from "./events.js";
import type { OutboundSendResult, OutboundSender } from "./types.js";

export type DeliverDraftOptions = DraftToOutboundMailOptions & {
  state: EnvloStateStore;
  sender: OutboundSender;
  draftId: string;
  /** When set, emit `draft.sent` after markDraftSent. */
  events?: DraftLifecycleBus;
  /** Skip markDraftSent (transport only). */
  skipMarkSent?: boolean;
};

/**
 * Transport-send an APPROVED draft, then persist SENT via the state store.
 * Prefer this over calling `markDraftSent` alone when a real sender is wired.
 */
export async function deliverApprovedDraft(
  options: DeliverDraftOptions,
): Promise<{
  draft: DraftRecord;
  message: MessageRecord | null;
  send: OutboundSendResult;
}> {
  const draft = await options.state.getDraft(options.draftId);
  if (!draft) throw new Error(`draft not found: ${options.draftId}`);
  if (draft.status !== "APPROVED" && draft.status !== "PENDING_APPROVAL") {
    throw new Error(
      `deliverApprovedDraft requires APPROVED or PENDING_APPROVAL (got ${draft.status})`,
    );
  }

  let approved = draft;
  if (draft.status === "PENDING_APPROVAL") {
    approved = await options.state.approveDraft(draft.id);
  }

  const mail = draftToOutboundMail(approved, {
    from: options.from,
    ...(options.replyTo !== undefined ? { replyTo: options.replyTo } : {}),
    ...(options.html !== undefined ? { html: options.html } : {}),
    ...(options.text !== undefined ? { text: options.text } : {}),
    ...(options.cc !== undefined ? { cc: options.cc } : {}),
    ...(options.bcc !== undefined ? { bcc: options.bcc } : {}),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
    ...(options.attachments !== undefined
      ? { attachments: options.attachments }
      : {}),
  });

  const send = await options.sender.send(mail);

  if (options.skipMarkSent) {
    return { draft: approved, message: null, send };
  }

  const marked = await options.state.markDraftSent(approved.id, {
    finalSentMarkdown: mail.text ?? approved.currentMarkdown,
    messageId: send.messageId,
    fromAddress: options.from,
  });

  options.events?.emit({
    type: "draft.sent",
    draft: marked.draft,
    messageId: send.messageId,
    senderKind: options.sender.kind,
    atMs: Date.now(),
  });

  return { draft: marked.draft, message: marked.message, send };
}
