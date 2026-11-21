import type {
  DraftRecord,
  EnvloStateStore,
  UpdateDraftInput,
} from "../state/types.js";
import { DraftLifecycleBus, defaultDraftLifecycleBus } from "./events.js";
import type {
  ApprovalAction,
  ApprovalChannel,
  ApprovalChannelKind,
  ApprovalDecisionSource,
} from "./types.js";

export type ApprovalControllerOptions = {
  state: EnvloStateStore;
  events?: DraftLifecycleBus;
  channels?: ApprovalChannel[];
};

export type NotifyPendingResult = {
  draft: DraftRecord;
  /** Channels that threw during notify (others still ran). */
  channelErrors: Array<{ channel: ApprovalChannelKind; error: unknown }>;
};

/**
 * Central out-of-band approval gateway. Channels notify supervisors; decisions
 * come back here so the draft FSM updates and `wait_for_email` can wake via the
 * lifecycle bus (`draft.rejected` / `draft.approved`).
 *
 * Approve / reject / edit-and-approve are **idempotent**: repeating the same
 * decision after the draft has already left PENDING_APPROVAL returns the
 * current draft without throwing (double-click / webhook replay safe).
 */
export class ApprovalController {
  readonly state: EnvloStateStore;
  readonly events: DraftLifecycleBus;
  private readonly channels: ApprovalChannel[];

  constructor(options: ApprovalControllerOptions) {
    this.state = options.state;
    this.events = options.events ?? defaultDraftLifecycleBus;
    this.channels = options.channels ? [...options.channels] : [];
  }

  addChannel(channel: ApprovalChannel): void {
    this.channels.push(channel);
  }

  /**
   * Fan-out PENDING_APPROVAL notification to all registered channels.
   * Uses `Promise.allSettled` so one failing channel does not block others.
   */
  async notifyPending(draftId: string): Promise<NotifyPendingResult> {
    const draft = await this.requirePending(draftId);
    if (this.channels.length === 0) {
      return { draft, channelErrors: [] };
    }

    const settled = await Promise.allSettled(
      this.channels.map(async (channel) => {
        await channel.notifyPending(draft);
        this.events.emit({
          type: "draft.pending",
          draft,
          channel: channel.kind,
          atMs: Date.now(),
        });
        return channel.kind;
      }),
    );

    const channelErrors: NotifyPendingResult["channelErrors"] = [];
    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i]!;
      if (result.status === "rejected") {
        channelErrors.push({
          channel: this.channels[i]!.kind,
          error: result.reason,
        });
      }
    }

    if (channelErrors.length === this.channels.length) {
      throw new AggregateError(
        channelErrors.map((e) =>
          e.error instanceof Error ? e.error : new Error(String(e.error)),
        ),
        `All approval channels failed for draft ${draftId}`,
      );
    }

    return { draft, channelErrors };
  }

  async approve(
    draftId: string,
    source: ApprovalDecisionSource = "cli",
    note?: string,
  ): Promise<DraftRecord> {
    const existing = await this.requireDraft(draftId);
    if (existing.status === "APPROVED" || existing.status === "SENT") {
      this.events.emit({
        type: "draft.approved",
        draft: existing,
        source,
        edited: false,
        atMs: Date.now(),
        idempotent: true,
        note: existing.humanFeedback,
      });
      return existing;
    }
    if (existing.status !== "PENDING_APPROVAL") {
      throw new Error(
        `approve requires PENDING_APPROVAL (got ${existing.status})`,
      );
    }

    const trimmedNote = note?.trim();
    if (trimmedNote) {
      await this.state.annotateDraft(draftId, trimmedNote);
    }
    const draft = await this.state.approveDraft(draftId);
    this.events.emit({
      type: "draft.approved",
      draft,
      source,
      edited: false,
      atMs: Date.now(),
      ...(trimmedNote ? { note: trimmedNote } : {}),
    });
    return draft;
  }

  async editAndApprove(
    draftId: string,
    edits: UpdateDraftInput,
    source: ApprovalDecisionSource = "cli",
  ): Promise<DraftRecord> {
    const existing = await this.requireDraft(draftId);
    if (existing.status === "APPROVED" || existing.status === "SENT") {
      this.events.emit({
        type: "draft.approved",
        draft: existing,
        source,
        edited: true,
        atMs: Date.now(),
        idempotent: true,
      });
      return existing;
    }
    if (existing.status !== "PENDING_APPROVAL") {
      throw new Error(
        `editAndApprove requires PENDING_APPROVAL (got ${existing.status})`,
      );
    }

    const draft = await this.state.editAndApproveDraft(draftId, edits);
    this.events.emit({
      type: "draft.approved",
      draft,
      source,
      edited: true,
      atMs: Date.now(),
    });
    return draft;
  }

  async reject(
    draftId: string,
    feedback: string,
    source: ApprovalDecisionSource = "cli",
  ): Promise<DraftRecord> {
    const existing = await this.requireDraft(draftId);
    if (existing.status === "REJECTED_WITH_FEEDBACK") {
      this.events.emit({
        type: "draft.rejected",
        draft: existing,
        source,
        humanFeedback: existing.humanFeedback ?? feedback,
        atMs: Date.now(),
        idempotent: true,
      });
      return existing;
    }
    if (existing.status !== "PENDING_APPROVAL") {
      throw new Error(
        `reject requires PENDING_APPROVAL (got ${existing.status})`,
      );
    }

    const draft = await this.state.rejectDraft(draftId, feedback);
    this.events.emit({
      type: "draft.rejected",
      draft,
      source,
      humanFeedback: draft.humanFeedback ?? feedback,
      atMs: Date.now(),
    });
    return draft;
  }

  /** Comment-only: attach a supervisor note without approving or rejecting. */
  async comment(
    draftId: string,
    note: string,
    source: ApprovalDecisionSource = "cli",
  ): Promise<DraftRecord> {
    const draft = await this.state.annotateDraft(draftId, note);
    this.events.emit({
      type: "draft.comment",
      draft,
      source,
      note: note.trim(),
      atMs: Date.now(),
    });
    return draft;
  }

  async applyAction(
    draftId: string,
    action: ApprovalAction,
    source: ApprovalDecisionSource,
  ): Promise<DraftRecord> {
    switch (action.type) {
      case "approve":
        return this.approve(draftId, source, action.note);
      case "edit_and_approve":
        return this.editAndApprove(draftId, action.edits, source);
      case "reject":
        return this.reject(draftId, action.feedback, source);
      case "comment":
        return this.comment(draftId, action.note, source);
      default: {
        const _exhaustive: never = action;
        throw new Error(`Unknown approval action: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  private async requireDraft(draftId: string): Promise<DraftRecord> {
    const draft = await this.state.getDraft(draftId);
    if (!draft) throw new Error(`draft not found: ${draftId}`);
    return draft;
  }

  private async requirePending(draftId: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    if (draft.status !== "PENDING_APPROVAL") {
      throw new Error(
        `notifyPending requires PENDING_APPROVAL (got ${draft.status})`,
      );
    }
    return draft;
  }
}
