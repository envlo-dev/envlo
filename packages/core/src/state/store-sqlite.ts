import { chmod, mkdir } from "node:fs/promises";
import { createOutboundMessageId, createStateId, nowIso } from "./ids.js";
import {
  assertDraftEditable,
  assertDraftTransition,
  isActiveDraftStatus,
} from "./drafts.js";
import { defaultStateDbPath, stateDbParentDir } from "./paths.js";
import { STATE_SCHEMA_SQL } from "./schema.js";
import {
  loadNodeSqlite,
  type SqliteDatabase,
  type SqliteStatement,
} from "./sqlite-driver.js";
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
  DraftStatus,
  EnvloStateStore,
  InboxRecord,
  IngestMessageInput,
  MarkDraftSentInput,
  MessageDirection,
  MessageRecord,
  OpenSqliteStateOptions,
  StitchedReplyHeaders,
  ThreadRecord,
  ThreadView,
  UpdateDraftInput,
} from "./types.js";

type InboxRow = {
  id: string;
  address: string;
  display_name: string | null;
  created_at: string;
  metadata_json: string;
};

type ThreadRow = {
  id: string;
  inbox_id: string;
  subject: string | null;
  root_message_id: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  inbox_id: string;
  message_id: string;
  in_reply_to: string | null;
  references_json: string;
  direction: string;
  from_address: string | null;
  to_addresses_json: string;
  subject: string | null;
  date: string | null;
  body_markdown: string | null;
  created_at: string;
};

type DraftRow = {
  id: string;
  thread_id: string;
  inbox_id: string;
  status: string;
  to_addresses_json: string;
  subject: string | null;
  original_draft_markdown: string;
  current_markdown: string;
  final_sent_markdown: string | null;
  human_feedback: string | null;
  in_reply_to: string | null;
  references_json: string;
  created_message_id: string | null;
  sent_message_row_id: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  sent_at: string | null;
};

/**
 * SQLite-backed state store (`~/.envlo/state.db` by default).
 * Uses Node's built-in `node:sqlite` (no native addon).
 */
export class SqliteStateStore implements EnvloStateStore {
  readonly kind = "sqlite";
  readonly path: string;
  private readonly db: SqliteDatabase;

  private constructor(path: string, db: SqliteDatabase) {
    this.path = path;
    this.db = db;
  }

  static async open(options: OpenSqliteStateOptions = {}): Promise<SqliteStateStore> {
    const path = options.path ?? defaultStateDbPath();
    if (path !== ":memory:") {
      await mkdir(stateDbParentDir(path), { recursive: true, mode: 0o700 });
    }
    const sqlite = await loadNodeSqlite();
    const db = new sqlite.DatabaseSync(path, {
      enableForeignKeyConstraints: true,
    });
    db.exec(STATE_SCHEMA_SQL);
    if (path !== ":memory:") {
      await chmod(path, 0o600);
    }
    return new SqliteStateStore(path, db);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Run multi-statement writes atomically. */
  private withTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
  }

  async createInbox(input: CreateInboxInput): Promise<InboxRecord> {
    const address = input.address.trim().toLowerCase();
    if (!address) throw new Error("inbox address is required");
    const id = input.id ?? createStateId("inbox");
    const createdAt = nowIso();
    const metadata = input.metadata ?? {};
    try {
      this.prepare(
        `INSERT INTO inboxes (id, address, display_name, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, address, input.displayName ?? null, createdAt, JSON.stringify(metadata));
    } catch (error) {
      throw new Error(`inbox already exists: ${address}`, { cause: error });
    }
    return (await this.getInbox(id))!;
  }

  async getInbox(id: string): Promise<InboxRecord | null> {
    const row = this.prepare(
      `SELECT id, address, display_name, created_at, metadata_json FROM inboxes WHERE id = ?`,
    ).get(id) as InboxRow | undefined;
    return row ? mapInbox(row) : null;
  }

  async getInboxByAddress(address: string): Promise<InboxRecord | null> {
    const row = this.prepare(
      `SELECT id, address, display_name, created_at, metadata_json FROM inboxes WHERE address = ?`,
    ).get(address.trim().toLowerCase()) as InboxRow | undefined;
    return row ? mapInbox(row) : null;
  }

  async listInboxes(): Promise<InboxRecord[]> {
    const rows = this.prepare(
      `SELECT id, address, display_name, created_at, metadata_json FROM inboxes ORDER BY created_at ASC`,
    ).all() as InboxRow[];
    return rows.map(mapInbox);
  }

  async ingestMessage(
    inboxId: string,
    input: IngestMessageInput,
  ): Promise<{ thread: ThreadRecord; message: MessageRecord; created: boolean }> {
    await this.requireInbox(inboxId);
    const messageId = canonicalizeMessageId(input.messageId);
    if (!messageId) throw new Error("messageId is required");

    const existing = this.prepare(
      `SELECT * FROM messages WHERE inbox_id = ? AND message_id = ?`,
    ).get(inboxId, messageId) as MessageRow | undefined;
    if (existing) {
      const thread = (await this.getThread(existing.thread_id))!;
      return { thread, message: mapMessage(existing), created: false };
    }

    const references = canonicalizeReferences(input.references);
    const inReplyTo = canonicalizeMessageId(input.inReplyTo ?? null);
    const now = nowIso();

    let threadId = input.threadId ?? null;
    if (threadId) {
      const thread = await this.getThread(threadId);
      if (!thread || thread.inboxId !== inboxId) {
        throw new Error(`thread not found in inbox: ${threadId}`);
      }
    } else {
      for (const candidate of correlationMessageIds({ inReplyTo, references })) {
        const parent = this.prepare(
          `SELECT thread_id FROM messages WHERE inbox_id = ? AND message_id = ?`,
        ).get(inboxId, candidate) as { thread_id: string } | undefined;
        if (parent) {
          threadId = parent.thread_id;
          break;
        }
      }
    }

    const resolvedThreadId = threadId;
    const rowId = createStateId("msg");

    this.withTransaction(() => {
      let activeThreadId = resolvedThreadId;
      if (!activeThreadId) {
        activeThreadId = createStateId("thread");
        this.prepare(
          `INSERT INTO threads (id, inbox_id, subject, root_message_id, last_message_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          activeThreadId,
          inboxId,
          input.subject ?? null,
          messageId,
          input.date ?? now,
          now,
          now,
        );
      } else {
        this.prepare(
          `UPDATE threads
           SET subject = COALESCE(subject, ?),
               last_message_at = ?,
               updated_at = ?
           WHERE id = ?`,
        ).run(input.subject ?? null, input.date ?? now, now, activeThreadId);
      }

      this.prepare(
        `INSERT INTO messages (
           id, thread_id, inbox_id, message_id, in_reply_to, references_json,
           direction, from_address, to_addresses_json, subject, date, body_markdown, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        rowId,
        activeThreadId,
        inboxId,
        messageId,
        inReplyTo,
        JSON.stringify(references),
        input.direction ?? "inbound",
        input.fromAddress ?? null,
        JSON.stringify(input.toAddresses ?? []),
        input.subject ?? null,
        input.date ?? null,
        input.bodyMarkdown ?? null,
        now,
      );

      threadId = activeThreadId;
    });

    const thread = (await this.getThread(threadId!))!;
    const messageRow = this.prepare(`SELECT * FROM messages WHERE id = ?`).get(rowId) as MessageRow;
    return { thread, message: mapMessage(messageRow), created: true };
  }

  async getThread(threadId: string): Promise<ThreadRecord | null> {
    const row = this.prepare(`SELECT * FROM threads WHERE id = ?`).get(threadId) as
      | ThreadRow
      | undefined;
    return row ? mapThread(row) : null;
  }

  async listThreads(inboxId: string): Promise<ThreadRecord[]> {
    await this.requireInbox(inboxId);
    const rows = this.prepare(
      `SELECT * FROM threads WHERE inbox_id = ?
       ORDER BY COALESCE(last_message_at, updated_at) DESC`,
    ).all(inboxId) as ThreadRow[];
    return rows.map(mapThread);
  }

  async listMessages(threadId: string): Promise<MessageRecord[]> {
    await this.requireThread(threadId);
    const rows = this.prepare(
      `SELECT * FROM messages WHERE thread_id = ?`,
    ).all(threadId) as MessageRow[];
    return sortMessagesChronologically(rows.map(mapMessage));
  }

  async readThread(threadId: string): Promise<ThreadView | null> {
    const thread = await this.getThread(threadId);
    if (!thread) return null;
    return {
      thread,
      messages: await this.listMessages(threadId),
      activeDrafts: await this.listActiveDrafts(threadId),
    };
  }

  async createDraft(input: CreateDraftInput): Promise<DraftRecord> {
    const thread = await this.requireThread(input.threadId);
    if (!input.markdown.trim()) throw new Error("draft markdown is required");

    const messages = await this.listMessages(thread.id);
    const parent = selectParentMessage(messages, input.inReplyTo);
    const stitched = parent
      ? stitchReplyHeadersFromParent(parent)
      : { inReplyTo: null as string | null, references: [] as string[] };

    const id = input.id ?? createStateId("draft");
    const now = nowIso();
    this.prepare(
      `INSERT INTO drafts (
         id, thread_id, inbox_id, status, to_addresses_json, subject,
         original_draft_markdown, current_markdown, final_sent_markdown, human_feedback,
         in_reply_to, references_json, created_message_id, sent_message_row_id,
         created_at, updated_at, submitted_at, decided_at, sent_at
       ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
    ).run(
      id,
      thread.id,
      thread.inboxId,
      JSON.stringify(input.toAddresses ?? []),
      input.subject ?? thread.subject,
      input.markdown,
      input.markdown,
      stitched.inReplyTo,
      JSON.stringify(stitched.references),
      now,
      now,
    );
    return (await this.getDraft(id))!;
  }

  async getDraft(draftId: string): Promise<DraftRecord | null> {
    const row = this.prepare(`SELECT * FROM drafts WHERE id = ?`).get(draftId) as
      | DraftRow
      | undefined;
    return row ? mapDraft(row) : null;
  }

  async updateDraft(draftId: string, input: UpdateDraftInput): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftEditable(draft);
    const markdown = input.markdown !== undefined ? input.markdown : draft.currentMarkdown;
    if (!markdown.trim()) throw new Error("draft markdown is required");
    const toAddresses = input.toAddresses ?? draft.toAddresses;
    const subject = input.subject !== undefined ? input.subject : draft.subject;
    const updatedAt = nowIso();
    this.prepare(
      `UPDATE drafts
       SET current_markdown = ?, to_addresses_json = ?, subject = ?, updated_at = ?
       WHERE id = ?`,
    ).run(markdown, JSON.stringify(toAddresses), subject, updatedAt, draftId);
    return (await this.getDraft(draftId))!;
  }

  async submitDraftForApproval(draftId: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "PENDING_APPROVAL");
    const now = nowIso();
    this.prepare(
      `UPDATE drafts SET status = 'PENDING_APPROVAL', submitted_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, draftId);
    return (await this.getDraft(draftId))!;
  }

  async approveDraft(draftId: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "APPROVED");
    const now = nowIso();
    this.prepare(
      `UPDATE drafts SET status = 'APPROVED', decided_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, draftId);
    return (await this.getDraft(draftId))!;
  }

  async editAndApproveDraft(
    draftId: string,
    input: UpdateDraftInput,
  ): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "APPROVED");
    const markdown =
      input.markdown !== undefined ? input.markdown : draft.currentMarkdown;
    if (!markdown.trim()) throw new Error("draft markdown is required");
    const toAddresses = input.toAddresses ?? draft.toAddresses;
    const subject = input.subject !== undefined ? input.subject : draft.subject;
    const now = nowIso();
    this.prepare(
      `UPDATE drafts
       SET current_markdown = ?, to_addresses_json = ?, subject = ?,
           status = 'APPROVED', decided_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(markdown, JSON.stringify(toAddresses), subject, now, now, draftId);
    return (await this.getDraft(draftId))!;
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
    const next = draft.humanFeedback
      ? `${draft.humanFeedback}\n---\n${trimmed}`
      : trimmed;
    const now = nowIso();
    this.prepare(
      `UPDATE drafts SET human_feedback = ?, updated_at = ? WHERE id = ?`,
    ).run(next, now, draftId);
    return (await this.getDraft(draftId))!;
  }

  async rejectDraft(draftId: string, humanFeedback: string): Promise<DraftRecord> {
    const draft = await this.requireDraft(draftId);
    assertDraftTransition(draft, "REJECTED_WITH_FEEDBACK");
    const feedback = humanFeedback.trim();
    if (!feedback) throw new Error("humanFeedback is required when rejecting a draft");
    const now = nowIso();
    this.prepare(
      `UPDATE drafts
       SET status = 'REJECTED_WITH_FEEDBACK', human_feedback = ?, decided_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(feedback, now, now, draftId);
    return (await this.getDraft(draftId))!;
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
    const stitched = parent
      ? stitchReplyHeadersFromParent(parent)
      : { inReplyTo: draft.inReplyTo, references: draft.references };

    const messageId =
      canonicalizeMessageId(input.messageId) ?? createOutboundMessageId();
    const finalSentMarkdown = input.finalSentMarkdown ?? draft.currentMarkdown;
    const now = nowIso();
    const rowId = createStateId("msg");

    this.withTransaction(() => {
      this.prepare(
        `INSERT INTO messages (
           id, thread_id, inbox_id, message_id, in_reply_to, references_json,
           direction, from_address, to_addresses_json, subject, date, body_markdown, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?)`,
      ).run(
        rowId,
        draft.threadId,
        draft.inboxId,
        messageId,
        stitched.inReplyTo,
        JSON.stringify(stitched.references),
        input.fromAddress ?? null,
        JSON.stringify(draft.toAddresses),
        draft.subject,
        input.date ?? now,
        finalSentMarkdown,
        now,
      );

      this.prepare(
        `UPDATE threads SET last_message_at = ?, updated_at = ? WHERE id = ?`,
      ).run(input.date ?? now, now, draft.threadId);

      this.prepare(
        `UPDATE drafts
         SET status = 'SENT',
             in_reply_to = ?,
             references_json = ?,
             final_sent_markdown = ?,
             created_message_id = ?,
             sent_message_row_id = ?,
             sent_at = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        stitched.inReplyTo,
        JSON.stringify(stitched.references),
        finalSentMarkdown,
        messageId,
        rowId,
        now,
        now,
        draftId,
      );
    });

    return {
      draft: (await this.getDraft(draftId))!,
      message: mapMessage(
        this.prepare(`SELECT * FROM messages WHERE id = ?`).get(rowId) as MessageRow,
      ),
    };
  }

  async listActiveDrafts(threadId: string): Promise<DraftRecord[]> {
    await this.requireThread(threadId);
    const rows = this.prepare(
      `SELECT * FROM drafts
       WHERE thread_id = ? AND status != 'SENT'
       ORDER BY updated_at DESC`,
    ).all(threadId) as DraftRow[];
    return rows.map(mapDraft).filter((d) => isActiveDraftStatus(d.status));
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

  private prepare(sql: string): SqliteStatement {
    return this.db.prepare(sql);
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
    const draft = await this.getDraft(id);
    if (!draft) throw new Error(`draft not found: ${id}`);
    return draft;
  }
}

function mapInbox(row: InboxRow): InboxRecord {
  return {
    id: row.id,
    address: row.address,
    displayName: row.display_name,
    createdAt: row.created_at,
    metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
  };
}

function mapThread(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    inboxId: row.inbox_id,
    subject: row.subject,
    rootMessageId: row.root_message_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    inboxId: row.inbox_id,
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    references: JSON.parse(row.references_json || "[]") as string[],
    direction: row.direction as MessageDirection,
    fromAddress: row.from_address,
    toAddresses: JSON.parse(row.to_addresses_json || "[]") as string[],
    subject: row.subject,
    date: row.date,
    bodyMarkdown: row.body_markdown,
    createdAt: row.created_at,
  };
}

function mapDraft(row: DraftRow): DraftRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    inboxId: row.inbox_id,
    status: row.status as DraftStatus,
    toAddresses: JSON.parse(row.to_addresses_json || "[]") as string[],
    subject: row.subject,
    originalDraftMarkdown: row.original_draft_markdown,
    currentMarkdown: row.current_markdown,
    finalSentMarkdown: row.final_sent_markdown,
    humanFeedback: row.human_feedback,
    inReplyTo: row.in_reply_to,
    references: JSON.parse(row.references_json || "[]") as string[],
    createdMessageId: row.created_message_id,
    sentMessageRowId: row.sent_message_row_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    sentAt: row.sent_at,
  };
}

/** Open SQLite state at `~/.envlo/state.db` (or custom path / `:memory:`). */
export async function openSqliteStateStore(
  options: OpenSqliteStateOptions = {},
): Promise<SqliteStateStore> {
  return SqliteStateStore.open(options);
}
