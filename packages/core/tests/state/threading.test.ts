import { describe, expect, it } from "vitest";
import {
  canonicalizeMessageId,
  canonicalizeReferences,
  correlationMessageIds,
  selectParentMessage,
  stitchReplyHeadersFromParent,
} from "../../src/state/index.js";
import type { MessageRecord } from "../../src/state/index.js";

function msg(
  partial: Pick<MessageRecord, "messageId" | "references"> &
    Partial<MessageRecord>,
): MessageRecord {
  return {
    id: partial.id ?? "row",
    threadId: partial.threadId ?? "t1",
    inboxId: partial.inboxId ?? "i1",
    messageId: partial.messageId,
    inReplyTo: partial.inReplyTo ?? null,
    references: partial.references,
    direction: partial.direction ?? "inbound",
    fromAddress: partial.fromAddress ?? null,
    toAddresses: partial.toAddresses ?? [],
    subject: partial.subject ?? null,
    date: partial.date ?? null,
    bodyMarkdown: partial.bodyMarkdown ?? null,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("threading helpers", () => {
  it("canonicalizes Message-IDs to a single <id@domain> form", () => {
    expect(canonicalizeMessageId(" <a@x.com> ")).toBe("<a@x.com>");
    expect(canonicalizeMessageId("a@x.com")).toBe("<a@x.com>");
    expect(canonicalizeMessageId("<a@x.com>")).toBe("<a@x.com>");
    expect(canonicalizeReferences(["<a@x.com>", "<a@x.com>", "b@x.com"])).toEqual([
      "<a@x.com>",
      "<b@x.com>",
    ]);
    expect(canonicalizeReferences("<r1@x.com> <r2@x.com>")).toEqual([
      "<r1@x.com>",
      "<r2@x.com>",
    ]);
  });

  it("stitches In-Reply-To and References from a parent", () => {
    const stitched = stitchReplyHeadersFromParent({
      messageId: "<m2@x.com>",
      references: ["<m1@x.com>"],
    });
    expect(stitched.inReplyTo).toBe("<m2@x.com>");
    expect(stitched.references).toEqual(["<m1@x.com>", "<m2@x.com>"]);
  });

  it("does not duplicate parent Message-ID already in References", () => {
    const stitched = stitchReplyHeadersFromParent({
      messageId: "<m2@x.com>",
      references: ["<m1@x.com>", "<m2@x.com>"],
    });
    expect(stitched.references).toEqual(["<m1@x.com>", "<m2@x.com>"]);
  });

  it("orders correlation candidates In-Reply-To then References tip-first", () => {
    expect(
      correlationMessageIds({
        inReplyTo: "<tip@x.com>",
        references: ["<root@x.com>", "<mid@x.com>", "<tip@x.com>"],
      }),
    ).toEqual(["<tip@x.com>", "<mid@x.com>", "<root@x.com>"]);
  });

  it("selects explicit parent or falls back to latest message", () => {
    const messages = [
      msg({ messageId: "<m1@x.com>", references: [], date: "2026-01-01T00:00:00Z" }),
      msg({
        messageId: "<m2@x.com>",
        references: ["<m1@x.com>"],
        date: "2026-01-02T00:00:00Z",
      }),
    ];
    expect(selectParentMessage(messages)?.messageId).toBe("<m2@x.com>");
    expect(selectParentMessage(messages, "<m1@x.com>")?.messageId).toBe("<m1@x.com>");
    expect(() => selectParentMessage(messages, "<missing@x.com>")).toThrow(
      /not found/,
    );
  });
});
