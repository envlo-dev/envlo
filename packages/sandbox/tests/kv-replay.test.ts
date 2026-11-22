import { describe, expect, it } from "vitest";
import {
  kvInboxMessageKey,
  loadMessagesFromKv,
  ringPutOptions,
  trimRecent,
  type BufferedEmail,
} from "../src/ring-buffer.js";
import { MemoryKv } from "./helpers/memory-kv.js";

function msg(seq: number): BufferedEmail {
  return {
    seq,
    id: `m${seq}`,
    inboxId: "box",
    from: "a@x.com",
    to: "box@sandbox.envlo.dev",
    subject: `s${seq}`,
    messageId: `<${seq}>`,
    receivedAt: "2026-11-21T00:00:00.000Z",
    rawMime: `raw${seq}`,
    rawSize: 4,
    truncated: false,
  };
}

describe("KV ring replay", () => {
  it("rebuilds messages afterSeq from KV", async () => {
    const kv = new MemoryKv().asNamespace();
    for (const m of [msg(1), msg(2), msg(3)]) {
      await kv.put(
        kvInboxMessageKey("box", m.seq),
        JSON.stringify(m),
        ringPutOptions(7200),
      );
    }
    const all = await loadMessagesFromKv(kv, "box", 0, 3);
    expect(all.map((m) => m.seq)).toEqual([1, 2, 3]);
    const after = await loadMessagesFromKv(kv, "box", 1, 3);
    expect(after.map((m) => m.seq)).toEqual([2, 3]);
  });

  it("trims hot cache", () => {
    const many = Array.from({ length: 5 }, (_, i) => msg(i + 1));
    expect(trimRecent(many, 3).map((m) => m.seq)).toEqual([3, 4, 5]);
  });
});
