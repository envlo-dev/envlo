import { describe, expect, it } from "vitest";
import { consumeProvisionRateLimit } from "../src/rate-limit.js";
import { MemoryKv } from "./helpers/memory-kv.js";

describe("provision rate limit", () => {
  it("allows up to max then rejects", async () => {
    const kv = new MemoryKv().asNamespace();
    const now = Date.parse("2026-11-21T12:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      const r = await consumeProvisionRateLimit(kv, "1.2.3.4", {
        nowMs: now,
        maxRequests: 5,
        windowSeconds: 60,
      });
      expect(r.ok).toBe(true);
    }
    const over = await consumeProvisionRateLimit(kv, "1.2.3.4", {
      nowMs: now,
      maxRequests: 5,
      windowSeconds: 60,
    });
    expect(over.ok).toBe(false);
  });
});
