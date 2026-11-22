import { describe, expect, it } from "vitest";
import {
  consumeDailyInboundQuota,
  getInboxMeta,
  provisionEphemeralInbox,
} from "../src/sandbox-store.js";
import { SANDBOX_TTL_MS } from "../src/limits.js";
import { MemoryKv } from "./helpers/memory-kv.js";

describe("ephemeral sandbox store", () => {
  it("provisions inbox with zero login and 2h expiry", async () => {
    const kv = new MemoryKv().asNamespace();
    const now = Date.parse("2026-11-21T12:00:00.000Z");
    const result = await provisionEphemeralInbox(kv, {
      domain: "sandbox.envlo.dev",
      nowMs: now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionId.startsWith("sess_")).toBe(true);
    expect(result.meta.address).toMatch(/@sandbox\.envlo\.dev$/);
    expect(Date.parse(result.meta.expiresAt) - now).toBe(SANDBOX_TTL_MS);
    expect(result.limits.maxInboxes).toBe(3);
  });

  it("caps at 3 inboxes per session", async () => {
    const kv = new MemoryKv().asNamespace();
    const now = Date.now();
    const first = await provisionEphemeralInbox(kv, {
      domain: "sandbox.envlo.dev",
      nowMs: now,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    for (let i = 0; i < 2; i++) {
      const r = await provisionEphemeralInbox(kv, {
        sessionId: first.sessionId,
        domain: "sandbox.envlo.dev",
        nowMs: now,
      });
      expect(r.ok).toBe(true);
    }

    const fourth = await provisionEphemeralInbox(kv, {
      sessionId: first.sessionId,
      domain: "sandbox.envlo.dev",
      nowMs: now,
    });
    expect(fourth.ok).toBe(false);
    if (fourth.ok) return;
    expect(fourth.status).toBe(429);
    expect(fourth.error.code).toBe("inbox_limit");
  });

  it("returns 410 for expired inbox", async () => {
    const kv = new MemoryKv().asNamespace();
    const created = await provisionEphemeralInbox(kv, {
      domain: "sandbox.envlo.dev",
      preferredLocal: "expired1",
      nowMs: Date.parse("2026-11-21T00:00:00.000Z"),
    });
    expect(created.ok).toBe(true);
    const looked = await getInboxMeta(
      kv,
      "expired1",
      Date.parse("2026-11-21T03:00:00.000Z"),
    );
    expect("error" in looked).toBe(true);
    if (!("error" in looked)) return;
    expect(looked.status).toBe(410);
    expect(looked.error.code).toBe("expired");
  });

  it("enforces 100 inbound emails/day", async () => {
    const kv = new MemoryKv().asNamespace();
    const now = Date.parse("2026-11-21T10:00:00.000Z");
    for (let i = 0; i < 100; i++) {
      const r = await consumeDailyInboundQuota(kv, "sess_day", now);
      expect(r.ok).toBe(true);
    }
    const over = await consumeDailyInboundQuota(kv, "sess_day", now);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.code).toBe("daily_inbound_limit");
  });

  it("rejects preferred-local collision while live", async () => {
    const kv = new MemoryKv().asNamespace();
    const now = Date.now();
    const first = await provisionEphemeralInbox(kv, {
      domain: "sandbox.envlo.dev",
      preferredLocal: "taken",
      nowMs: now,
    });
    expect(first.ok).toBe(true);
    const clash = await provisionEphemeralInbox(kv, {
      domain: "sandbox.envlo.dev",
      preferredLocal: "taken",
      nowMs: now,
    });
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.status).toBe(409);
  });

  it("returns not_found for missing inbox meta", async () => {
    const kv = new MemoryKv().asNamespace();
    const looked = await getInboxMeta(kv, "missing");
    expect("error" in looked).toBe(true);
    if (!("error" in looked)) return;
    expect(looked.status).toBe(404);
    expect(looked.error.code).toBe("not_found");
  });
});
