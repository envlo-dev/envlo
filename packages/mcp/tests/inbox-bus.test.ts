import { describe, expect, it } from "vitest";
import { InboxEventBus } from "../src/index.js";

describe("InboxEventBus", () => {
  it("resolves from history and clears it", async () => {
    const bus = new InboxEventBus();
    bus.emit({
      type: "message.inbound",
      inboxId: "i1",
      thread: {
        id: "t1",
        inboxId: "i1",
        subject: "s",
        rootMessageId: null,
        lastMessageAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      message: {
        id: "row1",
        threadId: "t1",
        inboxId: "i1",
        messageId: "<m@x>",
        inReplyTo: null,
        references: [],
        direction: "inbound",
        fromAddress: "a@b.com",
        toAddresses: ["i@x.com"],
        subject: "s",
        date: null,
        bodyMarkdown: "hi",
        createdAt: new Date().toISOString(),
      },
      mime: null,
      atMs: Date.now(),
    });

    const hit = await bus.waitFor((e) => e.type === "message.inbound", {
      timeoutMs: 50,
    });
    expect(hit.type).toBe("message.inbound");
    bus.clearHistory();
    expect(bus.history).toHaveLength(0);
  });

  it("times out and aborts", async () => {
    const bus = new InboxEventBus();
    await expect(
      bus.waitFor(() => false, { timeoutMs: 30 }),
    ).rejects.toThrow(/timed out/i);

    const controller = new AbortController();
    const pending = bus.waitFor(() => false, {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/i);
  });
});
