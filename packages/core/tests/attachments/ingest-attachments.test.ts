import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalAttachmentStore,
  toAttachmentRefs,
} from "../../src/attachments/index.js";
import { ingestRawMime } from "../../src/parser/ingest-raw-mime.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/eml/attachments",
);

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function loadFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8");
}

describe("ingestRawMime attachment cache", () => {
  it("defaults to inline buffers without persistence", async () => {
    const raw = await loadFixture("pdf-and-exe.eml");
    const ingested = await ingestRawMime(raw);
    expect(ingested.attachments.length).toBeGreaterThanOrEqual(2);
    expect(ingested.attachments.every((a) => a.cacheStatus === "inline-buffer")).toBe(
      true,
    );
    expect(ingested.attachments.every((a) => a.localFilePath === null)).toBe(true);
  });

  it("persists allowlisted files and rejects executables when enabled", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-ingest-att-"));
    tempDirs.push(rootDir);
    const store = new LocalAttachmentStore({ rootDir });
    const raw = await loadFixture("pdf-and-exe.eml");

    const ingested = await ingestRawMime(raw, {
      persistAttachments: true,
      attachmentTier: "pro",
      attachmentStore: store,
      includeAttachmentContent: false,
    });

    const pdf = ingested.attachments.find((a) => a.filename === "invoice.pdf");
    const exe = ingested.attachments.find((a) => a.filename === "payload.exe");

    expect(pdf?.cacheStatus).toBe("stored");
    expect(pdf?.localFilePath).toContain(rootDir);
    expect(pdf?.localFilePath?.endsWith(".pdf")).toBe(true);
    expect(pdf?.content.byteLength).toBe(0);
    expect(pdf?.sizeBytes).toBeGreaterThan(0);
    expect(pdf?.mimeType).toBe("application/pdf");

    expect(exe?.cacheStatus).toBe("rejected");
    expect(exe?.localFilePath).toBeNull();
    expect(exe?.rejectReason).toMatch(/denied-extension/);

    const refs = toAttachmentRefs(
      ingested.attachments.map((a) => ({
        id: a.attachmentId ?? "x",
        filename: a.filename ?? "attachment",
        mimeType: a.mimeType,
        localFilePath: a.localFilePath,
        remoteUrl: a.remoteUrl,
        sizeBytes: a.sizeBytes,
        disposition: a.disposition,
        contentId: a.contentId ?? null,
        cacheStatus: a.cacheStatus,
        rejectReason: a.rejectReason,
      })),
    );
    expect(refs.every((r) => !("content" in r))).toBe(true);
    expect(JSON.stringify(refs)).not.toMatch(/JVBERi/);
  });

  it("defaults to stripping content bytes when persistAttachments is true", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-ingest-default-"));
    tempDirs.push(rootDir);
    const store = new LocalAttachmentStore({ rootDir });
    const raw = await loadFixture("pdf-and-exe.eml");

    const ingested = await ingestRawMime(raw, {
      persistAttachments: true,
      attachmentStore: store,
    });

    const pdf = ingested.attachments.find((a) => a.filename === "invoice.pdf");
    const exe = ingested.attachments.find((a) => a.filename === "payload.exe");
    expect(pdf?.cacheStatus).toBe("stored");
    expect(pdf?.content.byteLength).toBe(0);
    expect(exe?.cacheStatus).toBe("rejected");
    expect(exe?.content.byteLength).toBe(0);
  });

  it("rejects invoice.pdf.exe double-extension via ingest", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-ingest-double-"));
    tempDirs.push(rootDir);
    const store = new LocalAttachmentStore({ rootDir });
    const raw = await loadFixture("double-ext-exe.eml");

    const ingested = await ingestRawMime(raw, {
      persistAttachments: true,
      attachmentStore: store,
    });

    expect(ingested.attachments).toHaveLength(1);
    expect(ingested.attachments[0]?.filename).toBe("invoice.pdf.exe");
    expect(ingested.attachments[0]?.cacheStatus).toBe("rejected");
    expect(ingested.attachments[0]?.rejectReason).toMatch(/denied-extension/);
    expect(ingested.attachments[0]?.content.byteLength).toBe(0);
  });

  it("honors attachmentMaxBytes override on ingest", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-ingest-cap-"));
    tempDirs.push(rootDir);
    const store = new LocalAttachmentStore({ rootDir });
    const raw = await loadFixture("pdf-and-exe.eml");

    const ingested = await ingestRawMime(raw, {
      persistAttachments: true,
      attachmentTier: "pro",
      attachmentMaxBytes: 4,
      attachmentStore: store,
    });

    const pdf = ingested.attachments.find((a) => a.filename === "invoice.pdf");
    expect(pdf?.cacheStatus).toBe("rejected");
    expect(pdf?.rejectReason).toMatch(/oversize/);
    expect(pdf?.localFilePath).toBeNull();
    expect(pdf?.content.byteLength).toBe(0);
  });

  it("persists png/csv/txt packs without Base64 in agent refs", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-ingest-pack-"));
    tempDirs.push(rootDir);
    const store = new LocalAttachmentStore({ rootDir });
    const raw = await loadFixture("images-and-csv.eml");

    const ingested = await ingestRawMime(raw, {
      persistAttachments: true,
      attachmentStore: store,
    });

    const names = ingested.attachments.map((a) => a.filename).sort();
    expect(names).toEqual(["chart.png", "notes.txt", "rows.csv"]);
    expect(ingested.attachments.every((a) => a.cacheStatus === "stored")).toBe(true);
    expect(ingested.attachments.every((a) => a.localFilePath?.startsWith(rootDir))).toBe(
      true,
    );
    expect(ingested.attachments.every((a) => a.content.byteLength === 0)).toBe(true);
  });
});
