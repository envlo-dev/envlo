/**
 * Free Ephemeral Sandbox quotas (Section 2 / ticket #14).
 */
export const SANDBOX_TTL_SECONDS = 7200; // 2 hours
export const SANDBOX_TTL_MS = SANDBOX_TTL_SECONDS * 1000;

export const FREE_EPHEMERAL_LIMITS = {
  maxInboxes: 3,
  ttlSeconds: SANDBOX_TTL_SECONDS,
  maxInboundEmailsPerDay: 100,
} as const;

export type FreeEphemeralLimits = typeof FREE_EPHEMERAL_LIMITS;

export type QuotaFailure = {
  ok: false;
  code: QuotaErrorCode;
  message: string;
};

export type QuotaDecision = { ok: true } | QuotaFailure;

export type QuotaErrorCode =
  | "inbox_limit"
  | "daily_inbound_limit"
  | "expired"
  | "not_found";

export function assertInboxQuota(
  currentCount: number,
  limits: FreeEphemeralLimits = FREE_EPHEMERAL_LIMITS,
): QuotaDecision {
  if (currentCount >= limits.maxInboxes) {
    return {
      ok: false,
      code: "inbox_limit",
      message: `Free sandbox allows at most ${limits.maxInboxes} ephemeral inboxes`,
    };
  }
  return { ok: true };
}

export function assertDailyInboundQuota(
  currentCount: number,
  limits: FreeEphemeralLimits = FREE_EPHEMERAL_LIMITS,
): QuotaDecision {
  if (currentCount >= limits.maxInboundEmailsPerDay) {
    return {
      ok: false,
      code: "daily_inbound_limit",
      message: `Free sandbox allows at most ${limits.maxInboundEmailsPerDay} inbound emails/day`,
    };
  }
  return { ok: true };
}

export function isExpired(
  expiresAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs >= expiresAtMs;
}

/** UTC day key for daily counters (`YYYY-MM-DD`). */
export function utcDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
