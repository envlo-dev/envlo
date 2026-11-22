import { describe, expect, it } from "vitest";
import {
  bytesToUtf8,
  headerValue,
  readStreamLimited,
} from "../src/mime.js";

describe("mime helpers", () => {
  it("reads stream with truncation", async () => {
    const data = new TextEncoder().encode("abcdefghij");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.slice(0, 4));
        controller.enqueue(data.slice(4));
        controller.close();
      },
    });
    const result = await readStreamLimited(stream, 6);
    expect(bytesToUtf8(result.bytes)).toBe("abcdef");
    expect(result.truncated).toBe(true);
    expect(result.rawSize).toBe(10);
  });

  it("extracts unfolded headers", () => {
    const raw = [
      "From: A <a@x.com>",
      "Subject: Hello",
      " World",
      "Message-ID: <id@x>",
      "",
      "body",
    ].join("\r\n");
    expect(headerValue(raw, "subject")).toBe("Hello World");
    expect(headerValue(raw, "message-id")).toBe("<id@x>");
  });
});
