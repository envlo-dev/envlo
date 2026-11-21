import { createStateId } from "../state/ids.js";

export type ApprovalTokenRecord = {
  token: string;
  draftId: string;
  threadId: string;
  inboxId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  usedAtMs: number | null;
};

export type ApprovalTokenStore = {
  issue(input: {
    draftId: string;
    threadId: string;
    inboxId: string;
    ttlMs?: number;
    nowMs?: number;
  }): ApprovalTokenRecord;
  peek(token: string, nowMs?: number): ApprovalTokenRecord | null;
  /** Mark one-time token used; returns null if missing/expired/already used. */
  consume(token: string, nowMs?: number): ApprovalTokenRecord | null;
  revoke(token: string): void;
  clear(): void;
};

export const DEFAULT_APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * In-memory one-time tokens for magic-link / reply-to-approve channels.
 */
export class MemoryApprovalTokenStore implements ApprovalTokenStore {
  private readonly tokens = new Map<string, ApprovalTokenRecord>();
  private readonly defaultTtlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.defaultTtlMs = options.ttlMs ?? DEFAULT_APPROVAL_TOKEN_TTL_MS;
  }

  issue(input: {
    draftId: string;
    threadId: string;
    inboxId: string;
    ttlMs?: number;
    nowMs?: number;
  }): ApprovalTokenRecord {
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
    return { ...record };
  }

  peek(token: string, nowMs: number = Date.now()): ApprovalTokenRecord | null {
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
    return { ...updated };
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  clear(): void {
    this.tokens.clear();
  }
}

/**
 * Extract an approval token from a plus-address Reply-To / Delivered-To
 * like `approve+appr_abc@envlo.dev` or bare token in a URL query.
 */
export function extractApprovalToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  const query = trimmed.match(/[?&]token=([A-Za-z0-9_-]+)/);
  if (query?.[1]) return query[1];

  const plus = trimmed.match(/approve\+([A-Za-z0-9_-]+)@/i);
  if (plus?.[1]) return plus[1];

  if (/^appr_[a-f0-9]+$/i.test(trimmed)) return trimmed;
  return null;
}
