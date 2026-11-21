import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultThreadMetaPath,
  FileThreadMetaStore,
  MemoryThreadMetaStore,
} from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("ThreadMetaStore", () => {
  it("defaultThreadMetaPath points under ~/.envlo", () => {
    expect(defaultThreadMetaPath()).toContain(".envlo");
    expect(defaultThreadMetaPath()).toContain("thread-meta.json");
  });

  it("MemoryThreadMetaStore keeps max risk and last OTP/url", () => {
    const store = new MemoryThreadMetaStore();
    store.rememberInbound({
      threadId: "t1",
      messageId: "m1",
      injectionRisk: "low",
      extractedOtp: "111111",
      verificationUrl: "https://a.example/v1",
    });
    store.rememberInbound({
      threadId: "t1",
      messageId: "m2",
      injectionRisk: "high",
      extractedOtp: null,
      verificationUrl: null,
    });

    const thread = store.getThread("t1");
    expect(thread?.injectionRisk).toBe("high");
    expect(thread?.lastOtp).toBe("111111");
    expect(thread?.lastVerificationUrl).toBe("https://a.example/v1");
    expect(store.getMessage("m1")?.extractedOtp).toBe("111111");
    expect(store.getMessage("m2")?.extractedOtp).toBeNull();

    store.clear();
    expect(store.getThread("t1")).toBeNull();
    expect(store.getMessage("m1")).toBeNull();
  });

  it("FileThreadMetaStore survives reload and ignores corrupt JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "envlo-meta-"));
    tempDirs.push(dir);
    const path = join(dir, "meta.json");

    const a = new FileThreadMetaStore({ path });
    a.rememberInbound({
      threadId: "t1",
      messageId: "<m1@x>",
      injectionRisk: "medium",
      extractedOtp: "999999",
      verificationUrl: "https://verify.example",
    });

    const b = new FileThreadMetaStore({ path });
    expect(b.getThread("t1")?.injectionRisk).toBe("medium");
    expect(b.getMessage("<m1@x>")?.extractedOtp).toBe("999999");
    expect(b.getMessage("<m1@x>")?.verificationUrl).toBe(
      "https://verify.example",
    );

    b.clear();
    expect(b.getThread("t1")).toBeNull();

    writeFileSync(path, "{not-json", "utf8");
    const c = new FileThreadMetaStore({ path });
    expect(c.getThread("t1")).toBeNull();
  });

  it("does not downgrade thread risk on later low-risk inbound", () => {
    const store = new MemoryThreadMetaStore();
    store.rememberInbound({
      threadId: "t",
      messageId: "a",
      injectionRisk: "high",
      extractedOtp: null,
      verificationUrl: null,
    });
    store.rememberInbound({
      threadId: "t",
      messageId: "b",
      injectionRisk: "low",
      extractedOtp: "123456",
      verificationUrl: null,
    });
    expect(store.getThread("t")?.injectionRisk).toBe("high");
    expect(store.getThread("t")?.lastOtp).toBe("123456");
  });
});
