import { describe, expect, it } from "vitest";
import {
  assertDailyInboundQuota,
  assertInboxQuota,
  FREE_EPHEMERAL_LIMITS,
  isExpired,
  utcDayKey,
} from "../src/limits.js";

describe("FREE_EPHEMERAL_LIMITS", () => {
  it("matches ticket quotas", () => {
    expect(FREE_EPHEMERAL_LIMITS.maxInboxes).toBe(3);
    expect(FREE_EPHEMERAL_LIMITS.ttlSeconds).toBe(7200);
    expect(FREE_EPHEMERAL_LIMITS.maxInboundEmailsPerDay).toBe(100);
  });

  it("enforces inbox cap", () => {
    expect(assertInboxQuota(0).ok).toBe(true);
    expect(assertInboxQuota(2).ok).toBe(true);
    expect(assertInboxQuota(3).ok).toBe(false);
    expect(assertInboxQuota(3)).toMatchObject({ code: "inbox_limit" });
  });

  it("enforces daily inbound cap", () => {
    expect(assertDailyInboundQuota(99).ok).toBe(true);
    expect(assertDailyInboundQuota(100).ok).toBe(false);
    expect(assertDailyInboundQuota(100)).toMatchObject({
      code: "daily_inbound_limit",
    });
  });

  it("detects expiry and formats UTC day", () => {
    expect(isExpired(Date.now() - 1)).toBe(true);
    expect(isExpired(Date.now() + 60_000)).toBe(false);
    expect(utcDayKey(Date.parse("2026-11-21T23:59:00.000Z"))).toBe(
      "2026-11-21",
    );
  });
});
