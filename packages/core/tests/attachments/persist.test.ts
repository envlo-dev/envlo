import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalAttachmentStore,
  MemoryAttachmentStore,
  S3AttachmentStore,
  persistAttachment,
  toAttachmentRef,
  SANDBOX_MAX_ATTACHMENT_BYTES,
  PRO_MAX_ATTACHMENT_BYTES,
} from "../../src/attachments/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function tempStore() {
  const rootDir = await mkdtemp(join(tmpdir(), "envlo-att-"));
  tempDirs.push(rootDir);
  return new LocalAttachmentStore({ rootDir });
}

describe("persistAttachment", () => {
  it("stores allowlisted files under the sandboxed local root", async () => {
    const store = await tempStore();
    const content = new TextEncoder().encode("%PDF-1.4 demo");
    const result = await persistAttachment(
      {
        filename: "po.pdf",
        mimeType: "application/pdf",
        disposition: "attachment",
        content,
      },
      { store, tier: "pro" },
    );

    expect(result.cacheStatus).toBe("stored");
    expect(result.localFilePath).toBeTruthy();
    expect(result.localFilePath).toContain(store.rootDir);
    expect(result.localFilePath?.endsWith(".pdf")).toBe(true);
    expect(result.sizeBytes).toBe(content.byteLength);
    expect(result.rejectReason).toBeNull();

    const onDisk = await readFile(result.localFilePath!);
    expect(Buffer.from(onDisk).equals(Buffer.from(content))).toBe(true);

    const agent = toAttachmentRef(result);
    expect(agent).not.toHaveProperty("content");
    expect(agent.localFilePath).toBe(result.localFilePath);
  });

  it("rejects .exe / .js / .scr even with spoofed MIME and drops bytes", async () => {
    const store = new MemoryAttachmentStore();
    const exe = await persistAttachment(
      {
        filename: "malware.exe",
        mimeType: "application/pdf",
        content: new Uint8Array([1, 2, 3]),
      },
      { store, includeContent: true },
    );
    expect(exe.cacheStatus).toBe("rejected");
    expect(exe.localFilePath).toBeNull();
    expect(exe.rejectReason).toMatch(/denied-extension/);
    expect(exe.content.byteLength).toBe(0);

    const js = await persistAttachment(
      {
        filename: "hook.js",
        mimeType: "text/plain",
        content: new TextEncoder().encode("alert(1)"),
      },
      { store, includeContent: true },
    );
    expect(js.cacheStatus).toBe("rejected");
    expect(js.content.byteLength).toBe(0);

    const scr = await persistAttachment(
      {
        filename: "screen.scr",
        mimeType: "application/octet-stream",
        content: new Uint8Array([4, 5, 6]),
      },
      { store, includeContent: true },
    );
    expect(scr.cacheStatus).toBe("rejected");
    expect(scr.rejectReason).toMatch(/denied-extension:\.scr/);
    expect(scr.content.byteLength).toBe(0);
  });

  it("sandbox oversize → metadata-only (1MB); pro oversize → rejected (5MB)", async () => {
    const store = new MemoryAttachmentStore();
    const sandboxBlob = new Uint8Array(SANDBOX_MAX_ATTACHMENT_BYTES + 10);
    const sandbox = await persistAttachment(
      {
        filename: "big.pdf",
        mimeType: "application/pdf",
        content: sandboxBlob,
      },
      { store, tier: "sandbox" },
    );
    expect(sandbox.cacheStatus).toBe("metadata-only");
    expect(sandbox.localFilePath).toBeNull();
    expect(sandbox.content.byteLength).toBe(0);
    expect(sandbox.sizeBytes).toBe(sandboxBlob.byteLength);

    const proBlob = new Uint8Array(PRO_MAX_ATTACHMENT_BYTES + 10);
    const pro = await persistAttachment(
      {
        filename: "huge.pdf",
        mimeType: "application/pdf",
        content: proBlob,
      },
      { store, tier: "pro" },
    );
    expect(pro.cacheStatus).toBe("rejected");
    expect(pro.rejectReason).toMatch(/oversize/);
  });

  it("persists via injected S3-compatible client and round-trips get/delete", async () => {
    const objects = new Map<string, Uint8Array>();
    const store = new S3AttachmentStore({
      bucket: "envlo-test",
      publicUrlBase: "https://cdn.example/envlo-test/",
      client: {
        async putObject({ key, body }) {
          objects.set(key, body);
          return { url: `https://cdn.example/envlo-test/${key}` };
        },
        async getObject({ key }) {
          const found = objects.get(key);
          if (!found) throw new Error("missing");
          return found;
        },
        async deleteObject({ key }) {
          objects.delete(key);
        },
      },
    });

    const content = new TextEncoder().encode("a,b,c\n1,2,3\n");
    const result = await persistAttachment(
      { filename: "rows.csv", mimeType: "text/csv", content },
      { store, tier: "pro" },
    );
    expect(result.cacheStatus).toBe("stored");
    expect(result.localFilePath).toBeNull();
    expect(result.remoteUrl).toContain("https://cdn.example/envlo-test/attachments/");
    expect(result.remoteUrl?.endsWith(".csv")).toBe(true);
    expect(objects.size).toBe(1);

    const loaded = await store.get(result.id);
    expect(loaded && Buffer.from(loaded).equals(Buffer.from(content))).toBe(true);
    await store.delete(result.id);
    expect(objects.size).toBe(0);
    expect(await store.get(result.id)).toBeNull();
  });

  it("persists xlsx and docx office documents", async () => {
    const store = new MemoryAttachmentStore();
    const xlsx = await persistAttachment(
      {
        filename: "sheet.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: new TextEncoder().encode("PK-xlsx"),
      },
      { store },
    );
    expect(xlsx.cacheStatus).toBe("stored");
    expect(xlsx.localFilePath).toMatch(/\.xlsx$/);

    const docx = await persistAttachment(
      {
        filename: "brief.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: new TextEncoder().encode("PK-docx"),
      },
      { store },
    );
    expect(docx.cacheStatus).toBe("stored");
    expect(docx.localFilePath).toMatch(/\.docx$/);
  });

  it("uses a custom idGenerator when provided", async () => {
    const store = new MemoryAttachmentStore();
    const result = await persistAttachment(
      {
        filename: "note.txt",
        mimeType: "text/plain",
        content: new TextEncoder().encode("id-test"),
      },
      { store, idGenerator: () => "fixed-id-0001" },
    );
    expect(result.id).toBe("fixed-id-0001");
    expect(result.localFilePath).toBe("memory://fixed-id-0001.txt");
  });

  it("defaults to omitting content bytes; opt-in keeps them for stored files", async () => {
    const store = new MemoryAttachmentStore();
    const content = new TextEncoder().encode("hello");
    const stripped = await persistAttachment(
      { filename: "note.txt", mimeType: "text/plain", content },
      { store },
    );
    expect(stripped.cacheStatus).toBe("stored");
    expect(stripped.content.byteLength).toBe(0);
    expect(stripped.localFilePath).toMatch(/^memory:\/\//);

    const kept = await persistAttachment(
      { filename: "note2.txt", mimeType: "text/plain", content },
      { store, includeContent: true },
    );
    expect(kept.content.byteLength).toBe(content.byteLength);
  });

  it("round-trips get/delete on the local store", async () => {
    const store = await tempStore();
    const content = new TextEncoder().encode("roundtrip");
    const result = await persistAttachment(
      { filename: "note.txt", mimeType: "text/plain", content },
      { store },
    );
    const loaded = await store.get(result.id);
    expect(loaded && Buffer.from(loaded).equals(Buffer.from(content))).toBe(true);
    await store.delete(result.id);
    expect(await store.get(result.id)).toBeNull();
  });
});
