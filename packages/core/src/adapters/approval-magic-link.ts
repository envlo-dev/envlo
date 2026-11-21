import { stripQuotedReply } from "../markdown/strip-quotes.js";
import type { DraftRecord } from "../state/types.js";
import type { ApprovalController } from "./approval-controller.js";
import { parseApprovalReply } from "./reply-parse.js";
import {
  MemoryApprovalTokenStore,
  extractApprovalToken,
  type ApprovalTokenStore,
} from "./tokens.js";
import type {
  ApprovalChannel,
  OutboundMail,
  OutboundSender,
} from "./types.js";

export type MagicLinkMode = "cloud" | "local";

export type MagicLinkApprovalChannelOptions = {
  controller: ApprovalController;
  /**
   * Transport used to send the approval email.
   * Cloud default path still uses this sender (often ConsoleDryRun or Resend)
   * with `from: approvals@envlo.dev`.
   */
  sender: OutboundSender;
  /** Supervisor inbox that receives the approval request. */
  supervisorEmail: string;
  /**
   * - `cloud` (default): from `approvals@envlo.dev`
   * - `local` / `--local`: from `from` / BYO sender identity
   */
  mode?: MagicLinkMode;
  /** Required in `local` mode — BYO From address. */
  from?: string;
  /**
   * Public base URL for clickable magic links
   * (e.g. `https://app.envlo.dev/approvals` or `http://localhost:8787/approvals`).
   */
  baseUrl: string;
  /** Reply-To domain for plus-address tokens (default `envlo.dev`). */
  replyDomain?: string;
  tokens?: ApprovalTokenStore;
  tokenTtlMs?: number;
};

export type MagicLinkClickAction = "approve" | "reject" | "edit";

export type MagicLinkClickRequest = {
  token: string;
  action: MagicLinkClickAction;
  /** Required for reject. */
  feedback?: string;
  /** Required for edit (body). */
  markdown?: string;
  /** Optional edit fields (Edit & Approve form). */
  subject?: string | null;
  toAddresses?: string[];
  /** Optional note when approving. */
  note?: string;
};

const CLOUD_FROM = "approvals@envlo.dev";

/**
 * Zero-config Reply-to-Approve magic-link email channel.
 *
 * Supervisors can:
 * 1. Click Approve / Edit & Approve / Reject links
 * 2. Reply from their phone — APPROVE / REJECT feedback / EDIT body
 *    (or bare text = reject feedback)
 */
export class MagicLinkApprovalChannel implements ApprovalChannel {
  readonly kind = "magic_link" as const;
  private readonly controller: ApprovalController;
  private readonly sender: OutboundSender;
  private readonly supervisorEmail: string;
  private readonly mode: MagicLinkMode;
  private readonly from: string;
  private readonly baseUrl: string;
  private readonly replyDomain: string;
  readonly tokens: ApprovalTokenStore;
  private readonly tokenTtlMs: number | undefined;
  readonly sent: OutboundMail[] = [];

  constructor(options: MagicLinkApprovalChannelOptions) {
    this.controller = options.controller;
    this.sender = options.sender;
    this.supervisorEmail = options.supervisorEmail;
    this.mode = options.mode ?? "cloud";
    this.from =
      this.mode === "cloud"
        ? CLOUD_FROM
        : (options.from ?? "").trim() ||
          (() => {
            throw new Error(
              "MagicLinkApprovalChannel local mode requires `from` (BYO sender)",
            );
          })();
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.replyDomain = options.replyDomain ?? "envlo.dev";
    this.tokens = options.tokens ?? new MemoryApprovalTokenStore();
    this.tokenTtlMs = options.tokenTtlMs;
  }

  async notifyPending(draft: DraftRecord): Promise<void> {
    const issued = this.tokens.issue({
      draftId: draft.id,
      threadId: draft.threadId,
      inboxId: draft.inboxId,
      ...(this.tokenTtlMs !== undefined ? { ttlMs: this.tokenTtlMs } : {}),
    });

    const approveUrl = `${this.baseUrl}?token=${issued.token}&action=approve`;
    const editUrl = `${this.baseUrl}?token=${issued.token}&action=edit`;
    const rejectUrl = `${this.baseUrl}?token=${issued.token}&action=reject`;
    const replyTo = `approve+${issued.token}@${this.replyDomain}`;

    const text = [
      "An Envlo agent draft needs your approval.",
      "",
      `Draft: ${draft.id}`,
      `To: ${draft.toAddresses.join(", ")}`,
      `Subject: ${draft.subject ?? "(none)"}`,
      "",
      "── draft body ──",
      draft.currentMarkdown,
      "────────────────",
      "",
      `Approve: ${approveUrl}`,
      `Edit & Approve: ${editUrl}`,
      `Reject with Feedback: ${rejectUrl}`,
      "",
      "Or reply to this email:",
      "  APPROVE",
      "  REJECT <your feedback>",
      "  EDIT",
      "  <replacement markdown>",
      "Bare replies without a keyword are treated as rejection feedback.",
    ].join("\n");

    const html = [
      `<p>An Envlo agent draft needs your approval.</p>`,
      `<p><b>Draft</b> <code>${escapeHtml(draft.id)}</code><br/>`,
      `<b>To</b> ${escapeHtml(draft.toAddresses.join(", "))}<br/>`,
      `<b>Subject</b> ${escapeHtml(draft.subject ?? "(none)")}</p>`,
      `<pre style="white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:6px">${escapeHtml(draft.currentMarkdown)}</pre>`,
      `<p>`,
      `<a href="${approveUrl}">Approve</a> · `,
      `<a href="${editUrl}">Edit &amp; Approve</a> · `,
      `<a href="${rejectUrl}">Reject with Feedback</a>`,
      `</p>`,
      `<p>Or reply to this email with <code>APPROVE</code>, <code>REJECT …</code>, or <code>EDIT</code> + body.</p>`,
    ].join("");

    const mail: OutboundMail = {
      from: this.from,
      to: [this.supervisorEmail],
      replyTo,
      subject: `[Envlo] Approve draft ${draft.id}${draft.subject ? `: ${draft.subject}` : ""}`,
      text,
      html,
      headers: {
        "X-Envlo-Draft-Id": draft.id,
        "X-Envlo-Approval-Token": issued.token,
      },
    };

    this.sent.push(mail);
    await this.sender.send(mail);
  }

  /**
   * Handle a magic-link click (host HTTP route).
   * Reject wakes `wait_for_email` via the controller event bus.
   */
  async handleClick(request: MagicLinkClickRequest): Promise<DraftRecord> {
    const record = this.tokens.consume(request.token);
    if (!record) {
      throw new Error("Invalid or expired approval token");
    }

    if (request.action === "approve") {
      return this.controller.approve(
        record.draftId,
        "magic_link_click",
        request.note,
      );
    }
    if (request.action === "edit") {
      const markdown = request.markdown?.trim();
      if (!markdown) {
        throw new Error("Edit & Approve click requires markdown");
      }
      const edits: {
        markdown: string;
        subject?: string | null;
        toAddresses?: string[];
      } = { markdown };
      if (request.subject !== undefined) edits.subject = request.subject;
      if (request.toAddresses !== undefined) edits.toAddresses = request.toAddresses;
      return this.controller.editAndApprove(
        record.draftId,
        edits,
        "magic_link_click",
      );
    }
    if (request.action === "reject") {
      const feedback = request.feedback?.trim();
      if (!feedback) {
        throw new Error("Reject click requires feedback");
      }
      return this.controller.reject(
        record.draftId,
        feedback,
        "magic_link_click",
      );
    }
    throw new Error(`Unknown magic-link action: ${request.action}`);
  }

  /**
   * Handle an inbound reply to the approval email (phone-friendly).
   * Token is taken from Reply-To / Delivered-To / To plus-address or headers.
   */
  async handleInboundReply(input: {
    to?: string | null;
    deliveredTo?: string | null;
    replyTo?: string | null;
    subject?: string | null;
    text?: string | null;
    headers?: Record<string, string | null | undefined>;
  }): Promise<DraftRecord> {
    const token =
      extractApprovalToken(input.to) ??
      extractApprovalToken(input.deliveredTo) ??
      extractApprovalToken(input.replyTo) ??
      extractApprovalToken(input.headers?.["x-envlo-approval-token"]) ??
      extractApprovalToken(input.headers?.["X-Envlo-Approval-Token"]);

    if (!token) {
      throw new Error("Could not extract approval token from inbound reply");
    }

    const record = this.tokens.consume(token);
    if (!record) {
      throw new Error("Invalid or expired approval token");
    }

    const strippedText =
      input.text !== undefined && input.text !== null
        ? stripQuotedReply(input.text).text
        : undefined;
    const parsed = parseApprovalReply({
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(strippedText !== undefined
        ? { text: strippedText }
        : input.text !== undefined
          ? { text: input.text }
          : {}),
    });
    return this.controller.applyAction(
      record.draftId,
      parsed.action,
      "magic_link_reply",
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
