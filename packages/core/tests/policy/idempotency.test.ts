import { describe, expect, it } from "vitest";
import {
  OutboundIdempotencyGuard,
  hashOutboundIdempotencyKey,
} from "../../src/policy/index.js";

describe("outbound idempotency", () => {
  it("hashes (inboxId, to, subject, markdownBody) deterministically", () => {
    const a = hashOutboundIdempotencyKey({
      inboxId: "Inbox_1",
      to: ["B@X.com", "a@x.com"],
      subject: "Hi",
      markdownBody: "Body",
      tool: "send_email",
    });
    const b = hashOutboundIdempotencyKey({
      inboxId: "inbox_1",
      to: ["a@x.com", "b@x.com"],
      subject: "Hi",
      markdownBody: "Body",
      tool: "send_email",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns cached draftId/outboundMessageId within 5 minutes", () => {
    const guard = new OutboundIdempotencyGuard({ ttlMs: 5 * 60 * 1000 });
    const ctx = {
      tool: "reply_to_thread" as const,
      inboxId: "inbox",
      to: ["user@acme.com"],
      subject: "Re: Hi",
      markdownBody: "Thanks",
      nowMs: 10_000,
    };

    expect(guard.lookup(ctx)).toBeNull();
    guard.remember(ctx, { draftId: "draft_1" });
    const hit = guard.lookup({ ...ctx, nowMs: 10_000 + 60_000 });
    expect(hit?.draftId).toBe("draft_1");
    expect(hit?.outboundMessageId).toBeNull();

    guard.update(
      OutboundIdempotencyGuard.keyFor(ctx),
      { outboundMessageId: "<out@envlo.dev>" },
      ctx.tool,
      ctx.inboxId,
      10_000 + 60_000,
    );
    const afterSend = guard.lookup({ ...ctx, nowMs: 10_000 + 90_000 });
    expect(afterSend?.outboundMessageId).toBe("<out@envlo.dev>");
  });

  it("expires entries after the TTL", () => {
    const guard = new OutboundIdempotencyGuard({ ttlMs: 1000 });
    const ctx = {
      tool: "send_email" as const,
      inboxId: "inbox",
      to: ["a@x.com"],
      subject: null,
      markdownBody: "x",
      nowMs: 0,
    };
    guard.remember(ctx, { draftId: "d" });
    expect(guard.lookup({ ...ctx, nowMs: 500 })?.draftId).toBe("d");
    expect(guard.lookup({ ...ctx, nowMs: 1001 })).toBeNull();
  });

  it("separates tools so send/reply/forward do not collide", () => {
    const base = {
      inboxId: "inbox",
      to: ["a@x.com"],
      subject: "S",
      markdownBody: "B",
    };
    const send = hashOutboundIdempotencyKey({ ...base, tool: "send_email" });
    const reply = hashOutboundIdempotencyKey({
      ...base,
      tool: "reply_to_thread",
    });
    expect(send).not.toBe(reply);
  });
});
