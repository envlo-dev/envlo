import { describe, expect, it } from "vitest";
import {
  LoopBreakerTrippedError,
  RunawayLoopBreaker,
} from "../../src/policy/index.js";

describe("RunawayLoopBreaker", () => {
  it("trips and auto-pauses after ≥3 sends to the same recipient without reply", () => {
    const breaker = new RunawayLoopBreaker({
      maxOutboundWithoutReply: 3,
      windowMs: 10 * 60 * 1000,
    });
    const t0 = 1_000_000;

    breaker.recordOutbound("inbox", "user@acme.com", t0);
    breaker.recordOutbound("inbox", "user@acme.com", t0 + 60_000);
    const trip = breaker.recordOutbound("inbox", "user@acme.com", t0 + 120_000);

    expect(trip.tripped).toBe(true);
    expect(trip.paused).toBe(true);
    expect(trip.outboundCount).toBe(3);
    expect(breaker.isPaused("inbox", "user@acme.com")).toBe(true);
    expect(breaker.listPausedRecipients("inbox")).toEqual(["user@acme.com"]);
    // Pause persists even before more sends.
    expect(breaker.check("inbox", "user@acme.com", t0 + 180_000).tripped).toBe(true);
    expect(() => {
      throw new LoopBreakerTrippedError(trip);
    }).toThrow(/auto-paused/);
  });

  it("clears pause when an inbound reply arrives from that recipient", () => {
    const breaker = new RunawayLoopBreaker({ maxOutboundWithoutReply: 3 });
    const t0 = 2_000_000;
    breaker.recordOutbound("inbox", "user@acme.com", t0);
    breaker.recordOutbound("inbox", "user@acme.com", t0 + 1);
    breaker.recordOutbound("inbox", "user@acme.com", t0 + 2);
    expect(breaker.isPaused("inbox", "user@acme.com")).toBe(true);

    breaker.recordInbound("inbox", "user@acme.com", t0 + 4);
    expect(breaker.isPaused("inbox", "user@acme.com")).toBe(false);
    expect(breaker.check("inbox", "user@acme.com", t0 + 5).tripped).toBe(false);

    breaker.recordOutbound("inbox", "user@acme.com", t0 + 6);
    expect(breaker.check("inbox", "user@acme.com", t0 + 7).outboundCount).toBe(1);
  });

  it("does not trip across different recipients or after the window", () => {
    const breaker = new RunawayLoopBreaker({
      maxOutboundWithoutReply: 3,
      windowMs: 10_000,
    });
    const t0 = 3_000_000;
    breaker.recordOutbound("inbox", "a@acme.com", t0);
    breaker.recordOutbound("inbox", "a@acme.com", t0 + 1);
    breaker.recordOutbound("inbox", "a@acme.com", t0 + 2);
    expect(breaker.check("inbox", "b@acme.com", t0 + 3).tripped).toBe(false);

    // Outside window — old outbounds pruned; pause still holds until inbound.
    expect(breaker.isPaused("inbox", "a@acme.com")).toBe(true);
    breaker.recordInbound("inbox", "a@acme.com", t0 + 20_000);
    expect(breaker.check("inbox", "a@acme.com", t0 + 20_000).tripped).toBe(false);
  });
});
