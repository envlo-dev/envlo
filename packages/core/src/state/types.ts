/** Outbound draft approval lifecycle (Section 4.3). */
export type DraftStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED_WITH_FEEDBACK"
  | "SENT";

export type MessageDirection = "inbound" | "outbound";

export type InboxRecord = {
  id: string;
  address: string;
  displayName: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type ThreadRecord = {
  id: string;
  inboxId: string;
  subject: string | null;
  rootMessageId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  threadId: string;
  inboxId: string;
  /** RFC 5322 Message-ID (angle brackets preserved when present). */
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  direction: MessageDirection;
  fromAddress: string | null;
  toAddresses: string[];
  subject: string | null;
  date: string | null;
  bodyMarkdown: string | null;
  createdAt: string;
};

/**
 * Draft with approval-state fields.
 * `originalDraftMarkdown` is immutable after create; edits update `currentMarkdown`.
 * `finalSentMarkdown` is captured on SENT for few-shot diff learning.
 */
export type DraftRecord = {
  id: string;
  threadId: string;
  inboxId: string;
  status: DraftStatus;
  toAddresses: string[];
  subject: string | null;
  originalDraftMarkdown: string;
  currentMarkdown: string;
  finalSentMarkdown: string | null;
  humanFeedback: string | null;
  /** Parent Message-ID for reply stitching. */
  inReplyTo: string | null;
  /** Full References chain for outbound reply. */
  references: string[];
  /** Outbound Message-ID assigned when sent. */
  createdMessageId: string | null;
  sentMessageRowId: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  sentAt: string | null;
};

/** Statuses still relevant to agents on `read_thread` (excludes SENT). */
export const ACTIVE_DRAFT_STATUSES: readonly DraftStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED_WITH_FEEDBACK",
] as const;

export type CreateInboxInput = {
  address: string;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  id?: string;
};

export type IngestMessageInput = {
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  direction?: MessageDirection;
  fromAddress?: string | null;
  toAddresses?: string[];
  subject?: string | null;
  date?: string | null;
  bodyMarkdown?: string | null;
  /** Force attach to an existing thread (advanced). */
  threadId?: string;
};

export type CreateDraftInput = {
  threadId: string;
  markdown: string;
  toAddresses?: string[];
  subject?: string | null;
  /**
   * Parent Message-ID to reply to. Defaults to the thread's latest message.
   */
  inReplyTo?: string | null;
  id?: string;
};

export type UpdateDraftInput = {
  markdown?: string;
  toAddresses?: string[];
  subject?: string | null;
};

export type MarkDraftSentInput = {
  /** Final body actually transmitted (few-shot diff capture). */
  finalSentMarkdown?: string;
  /** Outbound RFC Message-ID (generated if omitted). */
  messageId?: string;
  fromAddress?: string | null;
  date?: string | null;
};

export type ThreadView = {
  thread: ThreadRecord;
  messages: MessageRecord[];
  /** Non-SENT drafts for this thread (includes rejected-with-feedback). */
  activeDrafts: DraftRecord[];
};

export type StitchedReplyHeaders = {
  inReplyTo: string;
  references: string[];
};

/**
 * Persistent state engine for inboxes / threads / messages / drafts.
 * Implemented by Memory (portable) and SQLite (`~/.envlo/state.db`).
 */
export type EnvloStateStore = {
  readonly kind: "memory" | "sqlite" | string;

  createInbox(input: CreateInboxInput): Promise<InboxRecord>;
  getInbox(id: string): Promise<InboxRecord | null>;
  getInboxByAddress(address: string): Promise<InboxRecord | null>;
  listInboxes(): Promise<InboxRecord[]>;

  ingestMessage(inboxId: string, input: IngestMessageInput): Promise<{
    thread: ThreadRecord;
    message: MessageRecord;
    created: boolean;
  }>;

  getThread(threadId: string): Promise<ThreadRecord | null>;
  listThreads(inboxId: string): Promise<ThreadRecord[]>;
  listMessages(threadId: string): Promise<MessageRecord[]>;
  /** `read_thread` projection: messages + activeDrafts. */
  readThread(threadId: string): Promise<ThreadView | null>;

  createDraft(input: CreateDraftInput): Promise<DraftRecord>;
  getDraft(draftId: string): Promise<DraftRecord | null>;
  updateDraft(draftId: string, input: UpdateDraftInput): Promise<DraftRecord>;
  submitDraftForApproval(draftId: string): Promise<DraftRecord>;
  approveDraft(draftId: string): Promise<DraftRecord>;
  /**
   * PENDING_APPROVAL → APPROVED with optional supervisor edits in one step
   * (Slack / magic-link `[Edit & Approve]`). Does not require REJECTED first.
   */
  editAndApproveDraft(
    draftId: string,
    input: UpdateDraftInput,
  ): Promise<DraftRecord>;
  /**
   * Attach a supervisor note without changing status.
   * Allowed in PENDING_APPROVAL (and APPROVED before send).
   */
  annotateDraft(draftId: string, note: string): Promise<DraftRecord>;
  rejectDraft(draftId: string, humanFeedback: string): Promise<DraftRecord>;
  /**
   * APPROVED → SENT: persist `finalSentMarkdown`, insert outbound message,
   * and return the updated draft + message.
   */
  markDraftSent(
    draftId: string,
    input?: MarkDraftSentInput,
  ): Promise<{ draft: DraftRecord; message: MessageRecord }>;
  listActiveDrafts(threadId: string): Promise<DraftRecord[]>;

  /**
   * Compute RFC 5322 In-Reply-To / References for an outbound reply
   * against the given (or latest) parent message in the thread.
   */
  stitchReplyHeaders(
    threadId: string,
    parentMessageId?: string | null,
  ): Promise<StitchedReplyHeaders>;

  close?(): Promise<void>;
};

export type OpenSqliteStateOptions = {
  /** Defaults to `~/.envlo/state.db`. Use `:memory:` for ephemeral SQLite. */
  path?: string;
};
