import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ImapUidCursor = {
  host: string;
  user: string;
  mailbox: string;
  /** Last successfully ingested UID (inclusive). */
  lastUid: number;
  updatedAtMs: number;
};

export type ImapUidCursorStore = {
  get(key: { host: string; user: string; mailbox: string }): ImapUidCursor | null;
  set(cursor: ImapUidCursor): void;
  clear(): void;
};

export function imapCursorKey(input: {
  host: string;
  user: string;
  mailbox: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.host.trim().toLowerCase()}|${input.user.trim().toLowerCase()}|${input.mailbox}`,
    )
    .digest("hex")
    .slice(0, 16);
}

export function defaultImapCursorPath(key: string): string {
  return join(homedir(), ".envlo", "imap-cursors", `${key}.json`);
}

export class FileImapUidCursorStore implements ImapUidCursorStore {
  private readonly dir: string;

  constructor(options: { dir?: string } = {}) {
    this.dir = options.dir ?? join(homedir(), ".envlo", "imap-cursors");
  }

  get(key: {
    host: string;
    user: string;
    mailbox: string;
  }): ImapUidCursor | null {
    const path = join(this.dir, `${imapCursorKey(key)}.json`);
    try {
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8")) as ImapUidCursor;
    } catch {
      return null;
    }
  }

  set(cursor: ImapUidCursor): void {
    mkdirSync(this.dir, { recursive: true });
    const path = join(
      this.dir,
      `${imapCursorKey({
        host: cursor.host,
        user: cursor.user,
        mailbox: cursor.mailbox,
      })}.json`,
    );
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cursor, null, 2), "utf8");
    renameSync(tmp, path);
  }

  clear(): void {
    // no-op for file store (tests use Memory)
  }
}

export class MemoryImapUidCursorStore implements ImapUidCursorStore {
  private readonly map = new Map<string, ImapUidCursor>();

  get(key: {
    host: string;
    user: string;
    mailbox: string;
  }): ImapUidCursor | null {
    const found = this.map.get(imapCursorKey(key));
    return found ? { ...found } : null;
  }

  set(cursor: ImapUidCursor): void {
    this.map.set(
      imapCursorKey({
        host: cursor.host,
        user: cursor.user,
        mailbox: cursor.mailbox,
      }),
      { ...cursor },
    );
  }

  clear(): void {
    this.map.clear();
  }
}

/** Ensure dirname helper is used when callers write custom paths. */
export function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
