import { hashOutboundIdempotencyKey } from "./hash.js";
import type {
  IdempotencyConfig,
  IdempotencyHit,
  IdempotencyRecordInput,
  OutboundPolicyContext,
  OutboundToolName,
} from "./types.js";
import { DEFAULT_IDEMPOTENCY_TTL_MS } from "./types.js";

/**
 * Pluggable 5-minute outbound idempotency cache.
 * Memory implementation is the default; hosts may wrap Redis later.
 */
export type IdempotencyStore = {
  get(key: string, nowMs?: number): IdempotencyHit | null;
  set(input: IdempotencyRecordInput, ttlMs?: number): IdempotencyHit;
  delete?(key: string): void;
  clear?(): void;
};

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyHit>();

  get(key: string, nowMs: number = Date.now()): IdempotencyHit | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAtMs <= nowMs) {
      this.entries.delete(key);
      return null;
    }
    return { ...hit };
  }

  set(input: IdempotencyRecordInput, ttlMs: number = DEFAULT_IDEMPOTENCY_TTL_MS): IdempotencyHit {
    const nowMs = input.nowMs ?? Date.now();
    const hit: IdempotencyHit = {
      key: input.key,
      tool: input.tool,
      inboxId: input.inboxId,
      draftId: input.draftId ?? null,
      outboundMessageId: input.outboundMessageId ?? null,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };
    this.entries.set(input.key, hit);
    return { ...hit };
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Test helper. */
  get size(): number {
    return this.entries.size;
  }
}

export type IdempotencyGuardOptions = {
  store?: IdempotencyStore;
  ttlMs?: number;
};

/**
 * Deterministic 5-minute outbound idempotency guard for
 * send_email / reply_to_thread / forward_thread.
 */
export class OutboundIdempotencyGuard {
  private readonly store: IdempotencyStore;
  private readonly ttlMs: number;

  constructor(options: IdempotencyGuardOptions = {}) {
    this.store = options.store ?? new MemoryIdempotencyStore();
    this.ttlMs = options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  }

  static keyFor(
    ctx: Pick<
      OutboundPolicyContext,
      "inboxId" | "to" | "subject" | "markdownBody" | "tool" | "idempotencyKey"
    >,
  ): string {
    if (ctx.idempotencyKey?.trim()) return ctx.idempotencyKey.trim();
    return hashOutboundIdempotencyKey({
      inboxId: ctx.inboxId,
      to: ctx.to,
      subject: ctx.subject ?? null,
      markdownBody: ctx.markdownBody,
      tool: ctx.tool,
    });
  }

  lookup(
    ctx: Pick<
      OutboundPolicyContext,
      "inboxId" | "to" | "subject" | "markdownBody" | "tool" | "idempotencyKey" | "nowMs"
    >,
  ): IdempotencyHit | null {
    const key = OutboundIdempotencyGuard.keyFor(ctx);
    return this.store.get(key, ctx.nowMs ?? Date.now());
  }

  remember(
    ctx: Pick<
      OutboundPolicyContext,
      "inboxId" | "to" | "subject" | "markdownBody" | "tool" | "idempotencyKey" | "nowMs"
    >,
    ids: { draftId?: string | null; outboundMessageId?: string | null },
    config?: IdempotencyConfig,
  ): IdempotencyHit {
    const key = OutboundIdempotencyGuard.keyFor(ctx);
    const input: IdempotencyRecordInput = {
      key,
      tool: ctx.tool,
      inboxId: ctx.inboxId,
      draftId: ids.draftId ?? null,
      outboundMessageId: ids.outboundMessageId ?? null,
    };
    if (ctx.nowMs !== undefined) {
      input.nowMs = ctx.nowMs;
    }
    return this.store.set(input, config?.ttlMs ?? this.ttlMs);
  }

  /** Update an existing cache entry (e.g. fill outboundMessageId after send). */
  update(
    key: string,
    patch: { draftId?: string | null; outboundMessageId?: string | null },
    tool: OutboundToolName,
    inboxId: string,
    nowMs: number = Date.now(),
  ): IdempotencyHit {
    const existing = this.store.get(key, nowMs);
    return this.store.set(
      {
        key,
        tool,
        inboxId,
        draftId: patch.draftId ?? existing?.draftId ?? null,
        outboundMessageId:
          patch.outboundMessageId ?? existing?.outboundMessageId ?? null,
        nowMs: existing?.createdAtMs ?? nowMs,
      },
      existing ? Math.max(1, existing.expiresAtMs - nowMs) : this.ttlMs,
    );
  }
}
