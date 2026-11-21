import type { DraftRecord, UpdateDraftInput } from "../state/types.js";

/** Pluggable outbound mail transport (BYO). */
export type OutboundSenderKind =
  | "console"
  | "resend"
  | "ses"
  | "smtp"
  | string;

export type OutboundMailAttachment = {
  filename: string;
  contentType: string;
  content: Uint8Array;
};

/**
 * Portable outbound mail payload — adapters map this onto provider APIs.
 */
export type OutboundMail = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
  attachments?: OutboundMailAttachment[];
};

export type OutboundSendResult = {
  /** RFC 5322 Message-ID (angle brackets preferred). */
  messageId: string;
  /** Provider-native id when available (Resend id, SES MessageId, …). */
  providerId?: string | null;
  dryRun?: boolean;
};

export type OutboundSender = {
  readonly kind: OutboundSenderKind;
  send(mail: OutboundMail): Promise<OutboundSendResult>;
};

/** Minimal fetch surface for Resend (inject custom fetch in tests). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** Injected AWS SES-compatible client — `@envlo/core` does not bundle the SDK. */
export type SesCompatibleClient = {
  sendEmail(input: {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
    subject: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string }>;
};

/** Injected SMTP transport (nodemailer-style). */
export type SmtpTransport = {
  sendMail(input: {
    from: string;
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    subject: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string }>;
};

export type ApprovalChannelKind =
  | "cli"
  | "webhook"
  | "slack"
  | "magic_link"
  | string;

export type ApprovalAction =
  | { type: "approve"; note?: string }
  | { type: "edit_and_approve"; edits: UpdateDraftInput }
  | { type: "reject"; feedback: string }
  /** Supervisor note while still PENDING_APPROVAL (does not approve/reject). */
  | { type: "comment"; note: string };

export type ApprovalDecisionSource =
  | "cli"
  | "webhook"
  | "slack"
  | "magic_link_click"
  | "magic_link_reply"
  | string;

export type DraftLifecycleEvent =
  | {
      type: "draft.pending";
      draft: DraftRecord;
      channel: ApprovalChannelKind;
      atMs: number;
    }
  | {
      type: "draft.approved";
      draft: DraftRecord;
      source: ApprovalDecisionSource;
      edited: boolean;
      atMs: number;
      /** True when a duplicate decision was ignored (already approved/sent). */
      idempotent?: boolean;
      note?: string | null;
    }
  | {
      type: "draft.rejected";
      draft: DraftRecord;
      source: ApprovalDecisionSource;
      humanFeedback: string;
      atMs: number;
      /** True when a duplicate decision was ignored (already rejected). */
      idempotent?: boolean;
    }
  | {
      type: "draft.comment";
      draft: DraftRecord;
      source: ApprovalDecisionSource;
      note: string;
      atMs: number;
    }
  | {
      type: "draft.sent";
      draft: DraftRecord;
      messageId: string;
      senderKind: OutboundSenderKind;
      atMs: number;
    };

/**
 * Out-of-band channel that notifies a supervisor a draft needs approval.
 * Decisions flow back through `ApprovalController` (not MCP tools).
 */
export type ApprovalChannel = {
  readonly kind: ApprovalChannelKind;
  notifyPending(draft: DraftRecord): Promise<void>;
};

export type PendingApprovalPayload = {
  draftId: string;
  threadId: string;
  inboxId: string;
  status: DraftRecord["status"];
  toAddresses: string[];
  subject: string | null;
  markdown: string;
  originalMarkdown: string;
  humanFeedback: string | null;
  submittedAt: string | null;
};
