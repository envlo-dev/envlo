import { createOutboundMessageId, createStateId, nowIso } from "./ids.js";
import {
  assertDraftEditable,
  assertDraftTransition,
  isActiveDraftStatus,
} from "./drafts.js";
import {
  canonicalizeMessageId,
  canonicalizeReferences,
  correlationMessageIds,
  selectParentMessage,
  sortMessagesChronologically,
  stitchReplyHeadersFromParent,
} from "./threading.js";
import type {
  CreateDraftInput,
  CreateInboxInput,
  DraftRecord,
  EnvloStateStore,
  InboxRecord,
  IngestMessageInput,
  MarkDraftSentInput,
  MessageRecord,
  StitchedReplyHeaders,
  ThreadRecord,
  ThreadView,
  UpdateDraftInput,
} from "./types.js";
import { ACTIVE_DRAFT_STATUSES } from "./types.js";

/**
 * In-memory state store for tests and portable runtimes without SQLite.
 * Same behavioral contract as `SqliteStateStore`.
 */
export class MemoryStateStore implements EnvloStateStore {
  readonly kind = "memory";

  private readonly inboxes = new Map<string, InboxRecord>();
  private readonly inboxesByAddress = new Map<string, string>();
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly messages = new Map<string, MessageRecord>();
  private readonly messagesByInboxMessageId = new Map<string, string>();
  private readonly drafts = new Map<string, DraftRecord>();

  async createInbox(input: CreateInboxInput): Promise<InboxRecord> {
    const address = input.address.trim().toLowerCase();
    if (!address) throw new Error("inbox address is required");
    if (this.inboxesByAddress.has(address)) {
      throw new Error(`inbox already exists: ${address}`);
    }
    const record: InboxRecord = {
      id: input.id ?? createStateId("inbox"),
      address,
      displayName: input.displayName ?? null,
      createdAt: nowIso(),
      metadata: input.metadata ?? {},
    };
    this.inboxes.set(record.id, record);
    this.inboxesByAddress.set(address, record.id);
    return { ...record, metadata: { ...record.metadata } };
  }

  async getInbox(id: string): Promise<InboxRecord | null> {
    const found = this.inboxes.get(id);
    return found ? { ...found, metadata: { ...found.metadata } } : null;
  }

  async getInboxByAddress(address: string): Promise<InboxRecord | null> {
    const id = this.inboxesByAddress.get(address.trim().toLowerCase());
    return id ? this.getInbox(id) : null;
  }

  async listInboxes(): Promise<InboxRecord[]> {
    return [...this.inboxes.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ ...r, metadata: { ...r.metadata } }));
  }

  async ingestMessage(
    inboxId: string,
    input: IngestMessageInput,
  ): Promise<{ thread: ThreadRecord; message: MessageRecord; created: boolean }> {
    const inbox = await this.requireInbox(inboxId);
    const messageId = canonicalizeMessageId(input.messageId);
    if (!messageId) throw new Error("messageId is required");

    const existingKey = `${inboxId}::${messageId}`;
    const existingRowId = this.messagesByInboxMessageId.get(existingKey);
    if (existingRowId) {
      const existing = this.messages.get(existingRowId)!;
      const thread = this.threads.get(existing.threadId)!;
      return { thread: { ...thread }, message: cloneMessage(existing), created: false };
    }

    const references = canonicalizeReferences(input.references);
    const inReplyTo = canonicalizeMessageId(input.inReplyTo ?? null);
    const now = nowIso();

    let thread: ThreadRecord | null = null;
    if (input.threadId) {
      thread = this.threads.get(input.threadId) ?? null;
      if (!thread || thread.inboxId !== inboxId) {
        throw new Error(`thread not found in inbox: ${input.threadId}`);
      }
    } else {
      for (const candidate of correlationMessageIds({ inReplyTo, references })) {
        const rowId = this.messagesByInboxMessageId.get(`${inboxId}::${candidate}`);
        if (!rowId) continue;
        const parent = this.messages.get(rowId);
        if (!parent) continue;
        thread = this.threads.get(parent.threadId) ?? null;
        if (thread) break;
      }
    }

    if (!thread) {
      thread = {
        id: createStateId("thread"),
        inboxId: inbox.id,
        subject: input.subject ?? null,
        rootMessageId: messageId,
        lastMessageAt: input.date ?? now,
        createdAt: now,
        updatedAt: now,
      };
      this.threads.set(thread.id, thread);
    } else {
      thread = {
        ...thread,
        subject: thread.subject ?? input.subject ?? null,
        lastMessageAt: input.date ?? now,
        updatedAt: now,
      };
      this.threads.set(thread.id, thread);
    }

    const message: MessageRecord = {
      id: createStateId("msg"),
      threadId: thread.id,
      inboxId: inbox.id,
      messageId,
      inReplyTo,
      references,
      direction: input.direction ?? "inbound",
      fromAddress: input.fromAddress ?? null,
      toAddresses: input.toAddresses ?? [],
      subject: input.subject ?? null,
      date: input.date ?? null,
      bodyMarkdown: input.bodyMarkdown ?? null,
      createdAt: now,
    };
    this.messages.set(message.id, message);
    this.messagesByInboxMessageId.set(existingKey, message.id);

    return { thread: { ...thread }, message: cloneMessage(message), created: true };
  }

  async getThread(threadId: string): Promise<ThreadRecord | null> {
    const found = this.threads.get(threadId);
    return found ? { ...found } : null;
  }

  async listThreads(inboxId: string): Promise<ThreadRecord[]> {
    await this.requireInbox(inboxId);
    return [...this.threads.values()]
      .filter((t) => t.inboxId === inboxId)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt).localeCompare(a.lastMessageAt ?? a.updatedAt))
      .map((t) => ({ ...t }));
  }

  async listMessages(threadId: string): Promise<MessageRecord[]> {
    await this.requireThread(threadId);
    return sortMessagesChronologically(
      [...this.messages.values()].filter((m) => m.threadId === threadId),
    ).map(cloneMessage);
  }

  async readThread(threadId: string): Promise<ThreadView | null> {
    const thread = await this.getThread(threadId);
    if (!thread) return null;
    const messages = await this.listMessages(threadId);
    const activeDrafts = await this.listActiveDrafts(threadId);
    return { thread, messages, activeDrafts };
  }

  async createDraft(input: CreateDraftInput): Promise<DraftRecord> {
    const thread = await this.requireThread(input.threadId);
    const markdown = input.markdown;
    if (!markdown.trim()) throw new Error("draft markdown is required");

    const messages = await this.listMessages(thread.id);
    const parent = selectParentMessage(messages, input.inReplyTo);
    const stitched = parent
      ? stitchReplyHeadersFromParent(parent)
      : { inReplyTo: null as string | null, references: [] as string[] };

    const now = nowIso();
    const draft: DraftRecord = {
      id: input.id ?? createStateId("draft"),
      threadId: thread.id,
      inboxId: thread.inboxId,
      status: "DRAFT",
      toAddresses: input.toAddresses ?? [],
      subject: input.subject ?? thread.subject,
      originalDraftMarkdown: markdown,
      currentMarkdown: markdown,
      finalSentMarkdown: null,
      humanFeedback: null,
      inReplyTo: stitched.inReplyTo,
      references: stitched.references,
      createdMessageId: null,
      sentMessageRowId: null,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      decidedAt: null,
      sentAt: null,
    };
    this.drafts.set(draft.id, draft);
    return cloneDraft(draft);
  }

  async getDraft(draftId: string): Promise<DraftRecord | null> {
    const found = this.drafts.get(draftId);
    return found ? cloneDraft(found) : null;
  }

  async updateDraft(draftId: string, input: UpdateDraftInput): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftEditable(draft);
    if (input.markdown !== undefined) {
      if (!input.markdown.trim()) throw new Error("draft markdown is required");
      draft.currentMarkdown = input.markdown;
    }
    if (input.toAddresses !== undefined) draft.toAddresses = [...input.toAddresses];
    if (input.subject !== undefined) draft.subject = input.subject;
    // Clear stale feedback hint when author revises after rejection.
    if (draft.status === "REJECTED_WITH_FEEDBACK" && input.markdown !== undefined) {
      // Keep humanFeedback for learning; status stays REJECTED until resubmit.
    }
    draft.updatedAt = nowIso();
    this.drafts.set(draft.id, draft);
    return cloneDraft(draft);
  }

  async submitDraftForApproval(draftId: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "PENDING_APPROVAL");
    draft.status = "PENDING_APPROVAL";
    draft.submittedAt = nowIso();
    draft.updatedAt = draft.submittedAt;
    this.drafts.set(draft.id, draft);
    return cloneDraft(draft);
  }

  async approveDraft(draftId: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "APPROVED");
    draft.status = "APPROVED";
    draft.decidedAt = nowIso();
    draft.updatedAt = draft.decidedAt;
    this.drafts.set(draft.id, draft);
    return cloneDraft(draft);
  }

  async editAndApproveDraft(
    draftId: string,
    input: UpdateDraftInput,
  ): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "APPROVED");
    if (input.markdown !== undefined) {
      if (!input.markdown.trim()) throw new Error("draft markdown is required");
      draft.currentMarkdown = input.markdown;
    }
    if (input.toAddresses !== undefined) draft.toAddresses = [...input.toAddresses];
    if (input.subject !== undefined) draft.subject = input.subject;
    draft.status = "APPROVED";
    draft.decidedAt = nowIso();
    draft.updatedAt = draft.decidedAt;
    this.drafts.set(draft.id, draft);
    return cloneDraft(draft);
  }

  async annotateDraft(draftId: string, note: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    if (draft.status !== "PENDING_APPROVAL" && draft.status !== "APPROVED") {
      throw new Error(
        `annotateDraft requires PENDING_APPROVAL or APPROVED (got ${draft.status})`,
      );
    }
    const trimmed = note.trim();
    if (!trimmed) throw new Error("annotateDraft requires a non-empty note");
    draft.humanFeedback = draft.humanFeedback
      ? `${draft.humanFeedback}\n---\n${trimmed}`
      : trimmed;
    draft.updatedAt = nowIso();
    this.drafts.set(draft.id, draft);
    return cloneDraft(draft);
  }

  async rejectDraft(draftId: string, humanFeedback: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "REJECTED_WITH_FEEDBACK");
    const feedback = humanFeedback.trim();
    if (!feedback) throw new Error("humanFeedback is required when rejecting a draft");
    draft.status = "REJECTED_WITH_FEEDBACK";
    draft.humanFeedback = feedback;
    draft.decidedAt = nowIso();
    draft.updatedAt = draft.decidedAt;
    this.drafts.set(draft.id, draft);
    return cloneDraft(draft);
  }

  async markDraftSent(
    draftId: string,
    input: MarkDraftSentInput = {},
  ): Promise<{ draft: DraftRecord; message: MessageRecord }> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "SENT");

    // Re-stitch against the current thread tip so late inbound mail is reflected.
    const messages = await this.listMessages(draft.threadId);
    const parent = selectParentMessage(messages, null);
    if (parent) {
      const stitched = stitchReplyHeadersFromParent(parent);
      draft.inReplyTo = stitched.inReplyTo;
      draft.references = stitched.references;
    }

    const messageId =
      canonicalizeMessageId(input.messageId) ?? createOutboundMessageId();
    const finalSentMarkdown = input.finalSentMarkdown ?? draft.currentMarkdown;
    const now = nowIso();

    const message: MessageRecord = {
      id: createStateId("msg"),
      threadId: draft.threadId,
      inboxId: draft.inboxId,
      messageId,
      inReplyTo: draft.inReplyTo,
      references: [...draft.references],
      direction: "outbound",
      fromAddress: input.fromAddress ?? null,
      toAddresses: [...draft.toAddresses],
      subject: draft.subject,
      date: input.date ?? now,
      bodyMarkdown: finalSentMarkdown,
      createdAt: now,
    };
    this.messages.set(message.id, message);
    this.messagesByInboxMessageId.set(`${draft.inboxId}::${messageId}`, message.id);

    const thread = this.threads.get(draft.threadId)!;
    thread.lastMessageAt = message.date ?? now;
    thread.updatedAt = now;
    this.threads.set(thread.id, thread);

    draft.status = "SENT";
    draft.finalSentMarkdown = finalSentMarkdown;
    draft.createdMessageId = messageId;
    draft.sentMessageRowId = message.id;
    draft.sentAt = now;
    draft.updatedAt = now;
    this.drafts.set(draft.id, draft);

    return { draft: cloneDraft(draft), message: cloneMessage(message) };
  }

  async listActiveDrafts(threadId: string): Promise<DraftRecord[]> {
    await this.requireThread(threadId);
    return [...this.drafts.values()]
      .filter((d) => d.threadId === threadId && isActiveDraftStatus(d.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneDraft);
  }

  async stitchReplyHeaders(
    threadId: string,
    parentMessageId?: string | null,
  ): Promise<StitchedReplyHeaders> {
    const messages = await this.listMessages(threadId);
    const parent = selectParentMessage(messages, parentMessageId);
    if (!parent) {
      throw new Error(`thread has no messages to reply to: ${threadId}`);
    }
    return stitchReplyHeadersFromParent(parent);
  }

  /** Test helper — expose active status list. */
  get activeDraftStatuses() {
    return ACTIVE_DRAFT_STATUSES;
  }

  private async requireInbox(id: string): Promise<InboxRecord> {
    const inbox = await this.getInbox(id);
    if (!inbox) throw new Error(`inbox not found: ${id}`);
    return inbox;
  }

  private async requireThread(id: string): Promise<ThreadRecord> {
    const thread = await this.getThread(id);
    if (!thread) throw new Error(`thread not found: ${id}`);
    return thread;
  }

  private async requireDraft(id: string): Promise<DraftRecord> {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`draft not found: ${id}`);
    return draft;
  }
}

function cloneMessage(message: MessageRecord): MessageRecord {
  return {
    ...message,
    references: [...message.references],
    toAddresses: [...message.toAddresses],
  };
}

function cloneDraft(draft: DraftRecord): DraftRecord {
  return {
    ...draft,
    toAddresses: [...draft.toAddresses],
    references: [...draft.references],
  };
}
