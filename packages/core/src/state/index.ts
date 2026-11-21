export { createStateId, createOutboundMessageId, nowIso } from "./ids.js";
export { DEFAULT_STATE_DB_NAME, defaultStateDbPath, stateDbParentDir } from "./paths.js";
export { STATE_SCHEMA_SQL } from "./schema.js";
export {
  DraftTransitionError,
  assertDraftTransition,
  assertDraftEditable,
  isActiveDraftStatus,
} from "./drafts.js";
export {
  canonicalizeMessageId,
  canonicalizeReferences,
  correlationMessageIds,
  selectParentMessage,
  sortMessagesChronologically,
  stitchReplyHeadersFromParent,
} from "./threading.js";
export { MemoryStateStore } from "./store-memory.js";
export { SqliteStateStore, openSqliteStateStore } from "./store-sqlite.js";
export { isNodeSqliteAvailable, loadNodeSqlite } from "./sqlite-driver.js";
export { ACTIVE_DRAFT_STATUSES } from "./types.js";

export type {
  DraftStatus,
  MessageDirection,
  InboxRecord,
  ThreadRecord,
  MessageRecord,
  DraftRecord,
  CreateInboxInput,
  IngestMessageInput,
  CreateDraftInput,
  UpdateDraftInput,
  MarkDraftSentInput,
  ThreadView,
  StitchedReplyHeaders,
  EnvloStateStore,
  OpenSqliteStateOptions,
} from "./types.js";

import { MemoryStateStore } from "./store-memory.js";
import { openSqliteStateStore } from "./store-sqlite.js";
import type { EnvloStateStore, OpenSqliteStateOptions } from "./types.js";

export type OpenStateStoreOptions = OpenSqliteStateOptions & {
  /**
   * Storage backend.
   * - `sqlite` (default): durable `~/.envlo/state.db` via `node:sqlite` — fails loudly if unavailable
   * - `memory`: explicit in-memory store for tests / Workers
   */
  driver?: "sqlite" | "memory";
};

/**
 * Open the Envlo thread/draft state store.
 * Defaults to durable SQLite (`~/.envlo/state.db`). Pass `driver: "memory"`
 * only when you intentionally want non-persistent state.
 */
export async function openStateStore(
  options: OpenStateStoreOptions = {},
): Promise<EnvloStateStore> {
  const driver = options.driver ?? "sqlite";
  if (driver === "memory") {
    return new MemoryStateStore();
  }
  return openSqliteStateStore(options);
}
