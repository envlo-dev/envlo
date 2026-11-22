import { describe, expect, it } from "vitest";
import { createInboxDoLogic } from "../src/inbox-do.js";
import type { InboxMeta } from "../src/ring-buffer.js";

describe("InboxDurableObject logic", () => {
  it("buffers mail before websocket connect and replays afterSeq", () => {
    const logic = createInboxDoLogic();
    const meta: InboxMeta = {
      inboxId: "box1",
      address: "box1@sandbox.envlo.dev",
      sessionId: "sess_x",
      createdAt: "2026-11-21T00:00:00.000Z",
      expiresAt: "2026-11-21T02:00:00.000Z",
      lastSeq: 0,
      inboundCount: 0,
    };
    logic.init(meta);

    logic.ingest({
      from: "a@example.com",
      to: meta.address,
      subject: "before connect",
      messageId: "<m1>",
      rawMime: "Subject: before connect\r\n\r\nhi",
      rawSize: 30,
      truncated: false,
    });
    logic.ingest({
      from: "b@example.com",
      to: meta.address,
      subject: "still before",
      messageId: "<m2>",
      rawMime: "Subject: still before\r\n\r\nhi",
      rawSize: 28,
      truncated: false,
    });

    expect(logic.recent).toHaveLength(2);
    expect(logic.broadcasts).toHaveLength(2);

    // Client connects late with afterSeq=0 → full replay.
    expect(logic.replay(0).map((m) => m.subject)).toEqual([
      "before connect",
      "still before",
    ]);
    // After ack of seq 1, only second message.
    expect(logic.replay(1).map((m) => m.messageId)).toEqual(["<m2>"]);
  });

  it("keeps sequence monotonic across reconnect window", () => {
    const logic = createInboxDoLogic();
    logic.init({
      inboxId: "box2",
      address: "box2@sandbox.envlo.dev",
      sessionId: "sess_y",
      createdAt: "2026-11-21T00:00:00.000Z",
      expiresAt: "2026-11-21T02:00:00.000Z",
      lastSeq: 0,
      inboundCount: 0,
    });
    const first = logic.ingest({
      from: "a@x.com",
      to: "box2@sandbox.envlo.dev",
      subject: "1",
      messageId: null,
      rawMime: "x",
      rawSize: 1,
      truncated: false,
    });
    // Simulate disconnect; more mail arrives.
    const second = logic.ingest({
      from: "a@x.com",
      to: "box2@sandbox.envlo.dev",
      subject: "2",
      messageId: null,
      rawMime: "y",
      rawSize: 1,
      truncated: false,
    });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(logic.meta?.lastSeq).toBe(2);
  });
});
