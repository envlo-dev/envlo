import { describe, expect, it } from "vitest";
import {
  appendToRing,
  messagesAfter,
  ringPutOptions,
  RING_BUFFER_TTL_SECONDS,
  type InboxMeta,
} from "../src/ring-buffer.js";

function meta(partial?: Partial<InboxMeta>): InboxMeta {
  return {
    inboxId: "abc123",
    address: "abc123@sandbox.envlo.dev",
    sessionId: "sess_1",
    createdAt: "2026-11-21T00:00:00.000Z",
    expiresAt: "2026-11-21T02:00:00.000Z",
    lastSeq: 0,
    inboundCount: 0,
    ...partial,
  };
}

describe("ring buffer", () => {
  it("assigns monotonic seq without races in serial append", () => {
    let m = meta();
    const a = appendToRing(m, {
      id: "1",
      from: "a@x.com",
      to: m.address,
      subject: "one",
      messageId: "<1>",
      receivedAt: "2026-11-21T00:00:01.000Z",
      rawMime: "raw1",
      rawSize: 4,
      truncated: false,
    });
    m = a.meta;
    const b = appendToRing(m, {
      id: "2",
      from: "b@x.com",
      to: m.address,
      subject: "two",
      messageId: "<2>",
      receivedAt: "2026-11-21T00:00:02.000Z",
      rawMime: "raw2",
      rawSize: 4,
      truncated: false,
    });
    expect(a.message.seq).toBe(1);
    expect(b.message.seq).toBe(2);
    expect(b.meta.lastSeq).toBe(2);
    expect(b.meta.inboundCount).toBe(2);
  });

  it("replays only messages after cursor", () => {
    const msgs = [
      { seq: 1 },
      { seq: 2 },
      { seq: 3 },
    ] as never;
    expect(messagesAfter(msgs, 0).map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(messagesAfter(msgs, 1).map((m) => m.seq)).toEqual([2, 3]);
    expect(messagesAfter(msgs, 3)).toEqual([]);
  });

  it("uses 2h expirationTtl", () => {
    expect(RING_BUFFER_TTL_SECONDS).toBe(7200);
    expect(ringPutOptions()).toEqual({ expirationTtl: 7200 });
    expect(ringPutOptions(30)).toEqual({ expirationTtl: 60 });
  });
});
