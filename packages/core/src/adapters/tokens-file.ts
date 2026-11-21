import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { createStateId } from "../state/ids.js";
import {
  DEFAULT_APPROVAL_TOKEN_TTL_MS,
  type ApprovalTokenRecord,
  type ApprovalTokenStore,
} from "./tokens.js";

export type FileApprovalTokenStoreOptions = {
  /** Defaults to `~/.envlo/approval-tokens.json`. */
  path?: string;
  ttlMs?: number;
};

export function defaultApprovalTokensPath(): string {
  return `${homedir()}/.envlo/approval-tokens.json`;
}

/**
 * Durable JSON token store for local / `--local` magic-link flows.
 * Survives process restarts (unlike `MemoryApprovalTokenStore`).
 */
export class FileApprovalTokenStore implements ApprovalTokenStore {
  private readonly path: string;
  private readonly defaultTtlMs: number;
  private loaded = false;
  private readonly tokens = new Map<string, ApprovalTokenRecord>();

  constructor(options: FileApprovalTokenStoreOptions = {}) {
    this.path = options.path ?? defaultApprovalTokensPath();
    this.defaultTtlMs = options.ttlMs ?? DEFAULT_APPROVAL_TOKEN_TTL_MS;
  }

  issue(input: {
    draftId: string;
    threadId: string;
    inboxId: string;
    ttlMs?: number;
    nowMs?: number;
  }): ApprovalTokenRecord {
    this.ensureLoaded();
    const nowMs = input.nowMs ?? Date.now();
    const record: ApprovalTokenRecord = {
      token: createStateId("appr"),
      draftId: input.draftId,
      threadId: input.threadId,
      inboxId: input.inboxId,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + (input.ttlMs ?? this.defaultTtlMs),
      usedAtMs: null,
    };
    this.tokens.set(record.token, record);
    this.persist();
    return { ...record };
  }

  peek(token: string, nowMs: number = Date.now()): ApprovalTokenRecord | null {
    this.ensureLoaded();
    const found = this.tokens.get(token);
    if (!found) return null;
    if (found.usedAtMs !== null) return null;
    if (found.expiresAtMs <= nowMs) return null;
    return { ...found };
  }

  consume(token: string, nowMs: number = Date.now()): ApprovalTokenRecord | null {
    const found = this.peek(token, nowMs);
    if (!found) return null;
    const updated: ApprovalTokenRecord = { ...found, usedAtMs: nowMs };
    this.tokens.set(token, updated);
    this.persist();
    return { ...updated };
  }

  revoke(token: string): void {
    this.ensureLoaded();
    this.tokens.delete(token);
    this.persist();
  }

  clear(): void {
    this.tokens.clear();
    this.persist();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      if (existsSync(this.path)) {
        const raw = readFileSync(this.path, "utf8");
        const parsed = JSON.parse(raw) as { tokens?: ApprovalTokenRecord[] };
        for (const record of parsed.tokens ?? []) {
          this.tokens.set(record.token, record);
        }
      }
    } catch {
      // Corrupt / missing file → start empty.
    }
    this.loaded = true;
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const payload = JSON.stringify(
      { tokens: [...this.tokens.values()] },
      null,
      2,
    );
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, payload, "utf8");
    renameSync(tmp, this.path);
  }
}
