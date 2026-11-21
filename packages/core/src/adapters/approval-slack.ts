import type { DraftRecord } from "../state/types.js";
import type { ApprovalController } from "./approval-controller.js";
import type {
  ApprovalAction,
  ApprovalChannel,
  FetchLike,
} from "./types.js";

export const SLACK_ACTION_APPROVE = "envlo_approve";
export const SLACK_ACTION_EDIT_APPROVE = "envlo_edit_approve";
export const SLACK_ACTION_REJECT = "envlo_reject";

export type SlackBlock = Record<string, unknown>;

export type SlackApprovalMessage = {
  text: string;
  blocks: SlackBlock[];
};

export type SlackApprovalChannelOptions = {
  /** Incoming webhook URL or chat.postMessage proxy. */
  webhookUrl: string;
  fetch?: FetchLike;
  channel?: string;
};

export type SlackInteractionPayload = {
  type?: string;
  actions?: Array<{
    action_id?: string;
    value?: string;
    selected_option?: { value?: string };
  }>;
  view?: {
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string; rich_text_value?: unknown }>
      >;
    };
    private_metadata?: string;
    callback_id?: string;
  };
  /** Modal submission callback_id for edit/reject. */
  callback_id?: string;
  /** Message button value carries draftId by default. */
  message?: { metadata?: { event_payload?: { draft_id?: string } } };
};

/**
 * Build a Slack Block Kit card with Approve / Edit & Approve / Reject buttons.
 */
export function buildSlackApprovalBlocks(draft: DraftRecord): SlackApprovalMessage {
  const preview =
    draft.currentMarkdown.length > 2800
      ? `${draft.currentMarkdown.slice(0, 2800)}…`
      : draft.currentMarkdown;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Envlo draft needs approval" },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Draft*\n\`${draft.id}\`` },
        {
          type: "mrkdwn",
          text: `*To*\n${draft.toAddresses.join(", ") || "_none_"}`,
        },
        {
          type: "mrkdwn",
          text: `*Subject*\n${draft.subject ?? "_none_"}`,
        },
        { type: "mrkdwn", text: `*Thread*\n\`${draft.threadId}\`` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `\`\`\`${preview}\`\`\`` },
    },
    {
      type: "actions",
      block_id: "envlo_approval_actions",
      elements: [
        {
          type: "button",
          action_id: SLACK_ACTION_APPROVE,
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          value: draft.id,
        },
        {
          type: "button",
          action_id: SLACK_ACTION_EDIT_APPROVE,
          text: { type: "plain_text", text: "Edit & Approve" },
          value: draft.id,
        },
        {
          type: "button",
          action_id: SLACK_ACTION_REJECT,
          text: { type: "plain_text", text: "Reject with Feedback" },
          style: "danger",
          value: draft.id,
        },
      ],
    },
  ];

  return {
    text: `Envlo draft ${draft.id} needs approval`,
    blocks,
  };
}

/**
 * Modal views opened when Edit & Approve / Reject need text input.
 * Hosts open these via `views.open` after the button click.
 */
export function buildSlackEditApproveModal(
  draftId: string,
  defaults: { subject?: string | null; toAddresses?: string[]; markdown?: string } = {},
): SlackBlock {
  return {
    type: "modal",
    callback_id: "envlo_edit_approve_submit",
    private_metadata: draftId,
    title: { type: "plain_text", text: "Edit & Approve" },
    submit: { type: "plain_text", text: "Approve" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "subject_block",
        optional: true,
        label: { type: "plain_text", text: "Subject" },
        element: {
          type: "plain_text_input",
          action_id: "subject",
          ...(defaults.subject
            ? { initial_value: defaults.subject }
            : {}),
        },
      },
      {
        type: "input",
        block_id: "to_block",
        optional: true,
        label: { type: "plain_text", text: "To (comma-separated)" },
        element: {
          type: "plain_text_input",
          action_id: "toAddresses",
          ...(defaults.toAddresses?.length
            ? { initial_value: defaults.toAddresses.join(", ") }
            : {}),
        },
      },
      {
        type: "input",
        block_id: "markdown_block",
        label: { type: "plain_text", text: "Edited markdown" },
        element: {
          type: "plain_text_input",
          action_id: "markdown",
          multiline: true,
          ...(defaults.markdown
            ? { initial_value: defaults.markdown }
            : {}),
        },
      },
    ],
  };
}

export function buildSlackRejectModal(draftId: string): SlackBlock {
  return {
    type: "modal",
    callback_id: "envlo_reject_submit",
    private_metadata: draftId,
    title: { type: "plain_text", text: "Reject with Feedback" },
    submit: { type: "plain_text", text: "Reject" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "feedback_block",
        label: { type: "plain_text", text: "Feedback" },
        element: {
          type: "plain_text_input",
          action_id: "feedback",
          multiline: true,
        },
      },
    ],
  };
}

export type SlackInteractionResult =
  | { kind: "decision"; draftId: string; action: ApprovalAction }
  | { kind: "open_modal"; draftId: string; modal: "edit" | "reject" };

/**
 * Interpret a Slack interactivity payload into an approval decision or a
 * request to open an edit/reject modal.
 */
export function interpretSlackInteraction(
  payload: SlackInteractionPayload,
): SlackInteractionResult {
  if (payload.type === "view_submission") {
    const draftId = payload.view?.private_metadata;
    if (!draftId) throw new Error("Slack view_submission missing private_metadata");
    const callback = payload.view?.callback_id ?? payload.callback_id;
    const values = payload.view?.state?.values ?? {};
    if (callback === "envlo_edit_approve_submit") {
      const markdown = values.markdown_block?.markdown?.value?.trim();
      if (!markdown) throw new Error("Edit & Approve modal requires markdown");
      const subject = values.subject_block?.subject?.value;
      const toRaw = values.to_block?.toAddresses?.value;
      const edits: {
        markdown: string;
        subject?: string | null;
        toAddresses?: string[];
      } = { markdown };
      if (subject !== undefined) edits.subject = subject;
      if (toRaw !== undefined) {
        edits.toAddresses = toRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return {
        kind: "decision",
        draftId,
        action: { type: "edit_and_approve", edits },
      };
    }
    if (callback === "envlo_reject_submit") {
      const feedback = values.feedback_block?.feedback?.value?.trim();
      if (!feedback) throw new Error("Reject modal requires feedback");
      return {
        kind: "decision",
        draftId,
        action: { type: "reject", feedback },
      };
    }
    throw new Error(`Unknown Slack callback_id: ${callback}`);
  }

  const action = payload.actions?.[0];
  if (!action?.action_id || !action.value) {
    throw new Error("Slack interaction missing action_id/value");
  }
  const draftId = action.value;

  if (action.action_id === SLACK_ACTION_APPROVE) {
    return { kind: "decision", draftId, action: { type: "approve" } };
  }
  if (action.action_id === SLACK_ACTION_EDIT_APPROVE) {
    return { kind: "open_modal", draftId, modal: "edit" };
  }
  if (action.action_id === SLACK_ACTION_REJECT) {
    return { kind: "open_modal", draftId, modal: "reject" };
  }
  throw new Error(`Unknown Slack action_id: ${action.action_id}`);
}

/**
 * Apply a Slack interaction that already resolved to a decision
 * (Approve button or modal submit). Reject wakes `wait_for_email`.
 */
export async function handleSlackApprovalDecision(
  controller: ApprovalController,
  draftId: string,
  action: ApprovalAction,
): Promise<DraftRecord> {
  return controller.applyAction(draftId, action, "slack");
}

/**
 * Posts the Block Kit approval card to a Slack incoming webhook.
 */
export class SlackApprovalChannel implements ApprovalChannel {
  readonly kind = "slack" as const;
  private readonly webhookUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly channel: string | undefined;
  readonly delivered: SlackApprovalMessage[] = [];

  constructor(options: SlackApprovalChannelOptions) {
    this.webhookUrl = options.webhookUrl;
    this.fetchImpl =
      options.fetch ??
      ((globalThis.fetch as FetchLike | undefined) as FetchLike);
    if (typeof this.fetchImpl !== "function") {
      throw new Error("SlackApprovalChannel requires fetch");
    }
    this.channel = options.channel;
  }

  async notifyPending(draft: DraftRecord): Promise<void> {
    const message = buildSlackApprovalBlocks(draft);
    this.delivered.push(message);
    const body: Record<string, unknown> = {
      text: message.text,
      blocks: message.blocks,
    };
    if (this.channel) body.channel = this.channel;

    const response = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Slack notify failed (${response.status}): ${text}`);
    }
  }
}
