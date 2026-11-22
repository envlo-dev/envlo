/**
 * 2-hour KV-backed ring buffer helpers.
 *
 * Messages are stored as individual KV entries with `expirationTtl: 7200`
 * so Cloudflare GC drops them after the Free Ephemeral Sandbox TTL even if
 * the Durable Object is hibernated. The Durable Object owns the monotonic
 * sequence to avoid races between email ingestion and WebSocket clients.
 */
import { SANDBOX_TTL_SECONDS } from "./limits.js";

export const RING_BUFFER_TTL_SECONDS = SANDBOX_TTL_SECONDS;

export type BufferedEmail = {
  seq: number;
  id: string;
  inboxId: string;
  from: string;
  to: string;
  subject: string;
  messageId: string | null;
  receivedAt: string;
  /** Raw MIME (may be truncated for oversize). */
  rawMime: string;
  rawSize: number;
  truncated: boolean;
};

export type InboxMeta = {
  inboxId: string;
  address: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  /** Last assigned sequence (0 = empty). */
  lastSeq: number;
  inboundCount: number;
};

export function kvInboxMetaKey(inboxId: string): string {
  return `inbox:${inboxId}:meta`;
}

export function kvInboxMessageKey(inboxId: string, seq: number): string {
  return `inbox:${inboxId}:msg:${seq}`;
}

export function kvSessionInboxesKey(sessionId: string): string {
  return `session:${sessionId}:inboxes`;
}

export function kvDailyInboundKey(day: string, scope: string): string {
  return `day:${day}:inbound:${scope}`;
}

export function kvApiKeyHashKey(hash: string): string {
  return `apikey:${hash}`;
}

export function kvStripeEventKey(eventId: string): string {
  return `stripe:evt:${eventId}`;
}

export type RingAppendResult = {
  message: BufferedEmail;
  meta: InboxMeta;
};

/**
 * Pure append into an in-memory view of the ring — used by the DO and tests.
 * KV persistence is applied by the caller with `expirationTtl`.
 */
export function appendToRing(
  meta: InboxMeta,
  input: Omit<BufferedEmail, "seq" | "inboxId">,
  nowIso: string = new Date().toISOString(),
): RingAppendResult {
  const seq = meta.lastSeq + 1;
  const message: BufferedEmail = {
    ...input,
    seq,
    inboxId: meta.inboxId,
    receivedAt: input.receivedAt || nowIso,
  };
  const nextMeta: InboxMeta = {
    ...meta,
    lastSeq: seq,
    inboundCount: meta.inboundCount + 1,
  };
  return { message, meta: nextMeta };
}

/** Messages with seq > afterSeq, sorted ascending (replay after disconnect). */
export function messagesAfter(
  messages: readonly BufferedEmail[],
  afterSeq: number,
): BufferedEmail[] {
  return messages
    .filter((m) => m.seq > afterSeq)
    .slice()
    .sort((a, b) => a.seq - b.seq);
}

export function ringPutOptions(
  ttlSeconds: number = RING_BUFFER_TTL_SECONDS,
): { expirationTtl: number } {
  // KV requires expirationTtl >= 60.
  return { expirationTtl: Math.max(60, ttlSeconds) };
}

/** Soft cap for DO hot cache / ring trim (ticket nice-to-have). */
export const RING_RECENT_CAP = 100;

/**
 * Rebuild messages from KV after Durable Object eviction/hibernation.
 * Reads seq (afterSeq+1)…lastSeq inclusive; skips missing/expired keys.
 */
export async function loadMessagesFromKv(
  kv: KVNamespace,
  inboxId: string,
  afterSeq: number,
  lastSeq: number,
): Promise<BufferedEmail[]> {
  const out: BufferedEmail[] = [];
  const start = Math.max(0, afterSeq) + 1;
  for (let seq = start; seq <= lastSeq; seq++) {
    const raw = await kv.get(kvInboxMessageKey(inboxId, seq));
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as BufferedEmail);
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export function trimRecent(
  messages: readonly BufferedEmail[],
  cap: number = RING_RECENT_CAP,
): BufferedEmail[] {
  if (messages.length <= cap) return [...messages];
  return messages.slice(-cap);
}
