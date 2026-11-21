/**
 * SQLite DDL for the Envlo thread + draft approval store.
 * Applied idempotently via `CREATE TABLE IF NOT EXISTS`.
 */
export const STATE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inboxes (
  id TEXT PRIMARY KEY NOT NULL,
  address TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY NOT NULL,
  inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  subject TEXT,
  root_message_id TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_inbox ON threads(inbox_id);
CREATE INDEX IF NOT EXISTS idx_threads_root_message_id ON threads(root_message_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  in_reply_to TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address TEXT,
  to_addresses_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT,
  date TEXT,
  body_markdown TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (inbox_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages(in_reply_to);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN (
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED_WITH_FEEDBACK',
      'SENT'
    )
  ),
  to_addresses_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT,
  original_draft_markdown TEXT NOT NULL,
  current_markdown TEXT NOT NULL,
  final_sent_markdown TEXT,
  human_feedback TEXT,
  in_reply_to TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  created_message_id TEXT,
  sent_message_row_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  decided_at TEXT,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_drafts_thread_status ON drafts(thread_id, status);
CREATE INDEX IF NOT EXISTS idx_drafts_inbox ON drafts(inbox_id);
`;
