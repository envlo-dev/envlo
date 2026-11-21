import type { DraftRecord } from "../state/types.js";
import type { ApprovalController } from "./approval-controller.js";
import { toPendingApprovalPayload } from "./draft-mail.js";
import type {
  ApprovalAction,
  ApprovalChannel,
  FetchLike,
  PendingApprovalPayload,
} from "./types.js";

export type WebhookNotifierOptions = {
  url: string;
  fetch?: FetchLike;
  /** Extra static JSON fields merged into the POST body. */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export type WebhookApprovalRequest = {
  action: "approve" | "edit_and_approve" | "reject" | "comment";
  draftId: string;
  feedback?: string;
  /** Optional note when approving, or comment body. */
  note?: string;
  markdown?: string;
  subject?: string | null;
  toAddresses?: string[];
};

/**
 * Generic webhook notifier — POSTs a pending-approval payload to the host URL.
 */
export class WebhookApprovalChannel implements ApprovalChannel {
  readonly kind = "webhook" as const;
  private readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly extra: Record<string, unknown>;
  private readonly headers: Record<string, string>;
  readonly delivered: PendingApprovalPayload[] = [];

  constructor(options: WebhookNotifierOptions) {
    this.url = options.url;
    this.fetchImpl =
      options.fetch ??
      ((globalThis.fetch as FetchLike | undefined) as FetchLike);
    if (typeof this.fetchImpl !== "function") {
      throw new Error("WebhookApprovalChannel requires fetch");
    }
    this.extra = options.extra ?? {};
    this.headers = options.headers ?? {};
  }

  async notifyPending(draft: DraftRecord): Promise<void> {
    const payload = toPendingApprovalPayload(draft);
    this.delivered.push(payload);
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify({
        type: "envlo.draft.pending_approval",
        ...this.extra,
        draft: payload,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Webhook notify failed (${response.status}): ${text}`);
    }
  }
}

export function webhookRequestToAction(
  request: WebhookApprovalRequest,
): ApprovalAction {
  if (request.action === "approve") {
    return request.note?.trim()
      ? { type: "approve", note: request.note.trim() }
      : { type: "approve" };
  }
  if (request.action === "edit_and_approve") {
    const edits: {
      markdown?: string;
      subject?: string | null;
      toAddresses?: string[];
    } = {};
    if (request.markdown !== undefined) edits.markdown = request.markdown;
    if (request.subject !== undefined) edits.subject = request.subject;
    if (request.toAddresses !== undefined) edits.toAddresses = request.toAddresses;
    if (edits.markdown === undefined && edits.subject === undefined && edits.toAddresses === undefined) {
      throw new Error("edit_and_approve requires at least one edit field");
    }
    return { type: "edit_and_approve", edits };
  }
  if (request.action === "reject") {
    const feedback = request.feedback?.trim();
    if (!feedback) throw new Error("reject requires feedback");
    return { type: "reject", feedback };
  }
  if (request.action === "comment") {
    const note = request.note?.trim() ?? request.feedback?.trim();
    if (!note) throw new Error("comment requires note");
    return { type: "comment", note };
  }
  throw new Error(`Unknown webhook action: ${(request as WebhookApprovalRequest).action}`);
}

/**
 * Handle an inbound webhook decision callback (host HTTP route → this).
 */
export async function handleWebhookApprovalRequest(
  controller: ApprovalController,
  request: WebhookApprovalRequest,
): Promise<DraftRecord> {
  return controller.applyAction(
    request.draftId,
    webhookRequestToAction(request),
    "webhook",
  );
}
