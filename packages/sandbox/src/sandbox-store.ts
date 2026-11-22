/**
 * Session / quota helpers over KV (testable without a full Worker).
 */
import {
  assertDailyInboundQuota,
  assertInboxQuota,
  FREE_EPHEMERAL_LIMITS,
  isExpired,
  SANDBOX_TTL_MS,
  SANDBOX_TTL_SECONDS,
  utcDayKey,
  type QuotaDecision,
  type QuotaFailure,
} from "./limits.js";
import {
  generateEphemeralLocalPart,
  inboxAddress,
  newSessionId,
} from "./inbox-id.js";
import {
  kvDailyInboundKey,
  kvInboxMetaKey,
  kvSessionInboxesKey,
  ringPutOptions,
  type InboxMeta,
} from "./ring-buffer.js";

export type ProvisionInboxInput = {
  sessionId?: string | null;
  preferredLocal?: string | null;
  domain: string;
  nowMs?: number;
};

export type ProvisionInboxResult =
  | {
      ok: true;
      sessionId: string;
      meta: InboxMeta;
      limits: typeof FREE_EPHEMERAL_LIMITS;
    }
  | { ok: false; status: number; error: QuotaFailure };

export async function listSessionInboxIds(
  kv: KVNamespace,
  sessionId: string,
): Promise<string[]> {
  const raw = await kv.get(kvSessionInboxesKey(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export async function provisionEphemeralInbox(
  kv: KVNamespace,
  input: ProvisionInboxInput,
): Promise<ProvisionInboxResult> {
  const nowMs = input.nowMs ?? Date.now();
  const sessionId = input.sessionId?.trim() || newSessionId();
  const existing = await listSessionInboxIds(kv, sessionId);

  // Drop expired from the session list before quota check.
  const liveIds: string[] = [];
  for (const id of existing) {
    const metaRaw = await kv.get(kvInboxMetaKey(id));
    if (!metaRaw) continue;
    const meta = JSON.parse(metaRaw) as InboxMeta;
    if (isExpired(Date.parse(meta.expiresAt), nowMs)) continue;
    liveIds.push(id);
  }

  const quota = assertInboxQuota(liveIds.length);
  if (!quota.ok) {
    return { ok: false, status: 429, error: quota };
  }

  const local =
    input.preferredLocal?.trim() || generateEphemeralLocalPart();
  const inboxId = local.toLowerCase();
  if (liveIds.includes(inboxId)) {
    return {
      ok: false,
      status: 409,
      error: {
        ok: false,
        code: "inbox_limit",
        message: `Inbox ${inboxId} already exists in this session`,
      },
    };
  }

  // Collision with another session's live inbox.
  const collisionRaw = await kv.get(kvInboxMetaKey(inboxId));
  if (collisionRaw) {
    const collision = JSON.parse(collisionRaw) as InboxMeta;
    if (!isExpired(Date.parse(collision.expiresAt), nowMs)) {
      return {
        ok: false,
        status: 409,
        error: {
          ok: false,
          code: "inbox_limit",
          message: `Inbox address already in use`,
        },
      };
    }
  }

  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + SANDBOX_TTL_MS).toISOString();
  const meta: InboxMeta = {
    inboxId,
    address: inboxAddress(inboxId, input.domain),
    sessionId,
    createdAt,
    expiresAt,
    lastSeq: 0,
    inboundCount: 0,
  };

  const nextList = [...liveIds, inboxId];
  const ttl = ringPutOptions(SANDBOX_TTL_SECONDS);
  await kv.put(kvInboxMetaKey(inboxId), JSON.stringify(meta), ttl);
  await kv.put(kvSessionInboxesKey(sessionId), JSON.stringify(nextList), ttl);

  return {
    ok: true,
    sessionId,
    meta,
    limits: FREE_EPHEMERAL_LIMITS,
  };
}

export async function getInboxMeta(
  kv: KVNamespace,
  inboxId: string,
  nowMs: number = Date.now(),
): Promise<{ meta: InboxMeta } | { error: QuotaFailure; status: number }> {
  const raw = await kv.get(kvInboxMetaKey(inboxId));
  if (!raw) {
    return {
      status: 404,
      error: { ok: false, code: "not_found", message: "inbox not found" },
    };
  }
  const meta = JSON.parse(raw) as InboxMeta;
  if (isExpired(Date.parse(meta.expiresAt), nowMs)) {
    return {
      status: 410,
      error: { ok: false, code: "expired", message: "inbox expired (2h TTL)" },
    };
  }
  return { meta };
}

export async function consumeDailyInboundQuota(
  kv: KVNamespace,
  scope: string,
  nowMs: number = Date.now(),
): Promise<QuotaDecision & { count: number }> {
  const day = utcDayKey(nowMs);
  const key = kvDailyInboundKey(day, scope);
  const raw = await kv.get(key);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const decision = assertDailyInboundQuota(current);
  if (!decision.ok) {
    return { ...decision, count: current };
  }
  const next = current + 1;
  await kv.put(key, String(next), ringPutOptions(86400 * 2));
  return { ok: true, count: next };
}
