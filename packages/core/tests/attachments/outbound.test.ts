import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalAttachmentStore,
  persistAttachment,
  resolveAttachmentsForForward,
  resolveAttachmentsForReply,
  resolveAttachmentsForSend,
  resolveOutboundAttachment,
} from "../../src/attachments/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("resolveOutboundAttachment", () => {
  it("reads sandboxed local filePath for reply/send/forward helpers", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-out-"));
    tempDirs.push(rootDir);
    const store = new LocalAttachmentStore({ rootDir });
    const stored = await persistAttachment(
      {
        filename: "quote.pdf",
        mimeType: "application/pdf",
        content: new TextEncoder().encode("%PDF-1.4"),
      },
      { store },
    );

    const ref = {
      filePath: stored.localFilePath!,
      filename: stored.filename,
      mimeType: stored.mimeType,
    };
    const viaReply = await resolveAttachmentsForReply([ref], {
      allowedRoots: [rootDir],
    });
    const viaSend = await resolveAttachmentsForSend([ref], {
      allowedRoots: [rootDir],
    });
    const viaForward = await resolveAttachmentsForForward([ref], {
      allowedRoots: [rootDir],
    });

    for (const batch of [viaReply, viaSend, viaForward]) {
      expect(batch).toHaveLength(1);
      expect(batch[0]?.source).toBe("filePath");
      expect(batch[0]?.filename).toBe("quote.pdf");
      expect(batch[0]?.mimeType).toBe("application/pdf");
      expect(batch[0]?.sizeBytes).toBeGreaterThan(0);
    }
  });

  it("blocks path traversal outside allowed roots", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-out-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "envlo-out-outside-"));
    tempDirs.push(rootDir, outsideDir);
    const outside = join(outsideDir, "secret.txt");
    await writeFile(outside, "nope");

    await expect(
      resolveOutboundAttachment(
        { filePath: outside, filename: "secret.txt", mimeType: "text/plain" },
        { allowedRoots: [rootDir] },
      ),
    ).rejects.toThrow(/escapes allowed attachment roots/);
  });

  it("fetches https URLs with size + MIME checks", async () => {
    const body = new TextEncoder().encode("col1,col2\n");
    const resolved = await resolveOutboundAttachment(
      {
        url: "https://cdn.example.com/files/report.csv",
        filename: "report.csv",
      },
      {
        fetch: (async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/csv" },
          })) as typeof fetch,
        blockPrivateHosts: true,
      },
    );
    expect(resolved.source).toBe("url");
    expect(resolved.filename).toBe("report.csv");
    expect(resolved.mimeType).toBe("text/csv");
    expect(resolved.sizeBytes).toBe(body.byteLength);
  });

  it("requires https by default; http allowed when httpsOnly=false", async () => {
    await expect(
      resolveOutboundAttachment(
        { url: "http://cdn.example.com/a.pdf", filename: "a.pdf" },
        {
          fetch: (async () => new Response("%PDF", { status: 200 })) as typeof fetch,
        },
      ),
    ).rejects.toThrow(/must be https/);

    const body = new TextEncoder().encode("%PDF");
    const resolved = await resolveOutboundAttachment(
      { url: "http://cdn.example.com/a.pdf", filename: "a.pdf" },
      {
        httpsOnly: false,
        fetch: (async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/pdf" },
          })) as typeof fetch,
      },
    );
    expect(resolved.source).toBe("url");
  });

  it("blocks private / loopback URL hosts by default", async () => {
    await expect(
      resolveOutboundAttachment(
        { url: "https://127.0.0.1/secret.pdf", filename: "secret.pdf" },
        {
          fetch: (async () => new Response("%PDF", { status: 200 })) as typeof fetch,
        },
      ),
    ).rejects.toThrow(/host is blocked/);
  });

  it("blocks redirects to private hosts in safe mode", async () => {
    const fetchMock = (async (_input: RequestInfo | URL) => {
      const href = String(_input);
      if (href.includes("cdn.example.com")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://169.254.169.254/latest/meta-data" },
        });
      }
      return new Response("should-not-fetch", { status: 200 });
    }) as typeof fetch;

    await expect(
      resolveOutboundAttachment(
        { url: "https://cdn.example.com/report.pdf", filename: "report.pdf" },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow(/host is blocked/);
  });

  it("follows safe public→public redirects including relative Location", async () => {
    const body = new TextEncoder().encode("%PDF-1.4");
    const fetchMock = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href === "https://cdn.example.com/start") {
        return new Response(null, {
          status: 302,
          headers: { Location: "/files/final.pdf" },
        });
      }
      if (href === "https://cdn.example.com/files/final.pdf") {
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const resolved = await resolveOutboundAttachment(
      { url: "https://cdn.example.com/start", filename: "final.pdf" },
      { fetch: fetchMock },
    );
    expect(resolved.source).toBe("url");
    expect(resolved.mimeType).toBe("application/pdf");
    expect(resolved.sizeBytes).toBe(body.byteLength);
  });

  it("rejects redirects when redirect mode is error", async () => {
    const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      // Simulate fetch implementations that surface redirect as an error,
      // or return a redirect status when redirect:"error" isn't enforced by the mock.
      return new Response(null, {
        status: 302,
        headers: { Location: "https://cdn.example.com/next.pdf" },
      });
    }) as typeof fetch;

    await expect(
      resolveOutboundAttachment(
        { url: "https://cdn.example.com/start.pdf", filename: "start.pdf" },
        { fetch: fetchMock, redirect: "error" },
      ),
    ).rejects.toThrow(/fetch failed \(302\)/);
  });

  it("stops after maxRedirects in safe mode", async () => {
    let hops = 0;
    const fetchMock = (async () => {
      hops += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: `https://cdn.example.com/hop-${hops}` },
      });
    }) as typeof fetch;

    await expect(
      resolveOutboundAttachment(
        { url: "https://cdn.example.com/start", filename: "a.pdf" },
        { fetch: fetchMock, maxRedirects: 2 },
      ),
    ).rejects.toThrow(/max redirects/);
    expect(hops).toBe(3);
  });

  it("can opt into follow redirects without hop re-checks", async () => {
    const body = new TextEncoder().encode("a,b\n");
    const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("follow");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    }) as typeof fetch;

    const resolved = await resolveOutboundAttachment(
      { url: "https://cdn.example.com/rows.csv", filename: "rows.csv" },
      { fetch: fetchMock, redirect: "follow" },
    );
    expect(resolved.sizeBytes).toBe(body.byteLength);
  });

  it("appends a safe extension when URL has no filename extension", async () => {
    const body = new TextEncoder().encode("%PDF");
    const resolved = await resolveOutboundAttachment(
      { url: "https://cdn.example.com/download" },
      {
        fetch: (async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/pdf" },
          })) as typeof fetch,
      },
    );
    expect(resolved.filename).toBe("download.pdf");
    expect(resolved.mimeType).toBe("application/pdf");
  });

  it("rejects oversize filePath and URL payloads", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-out-size-"));
    tempDirs.push(rootDir);
    const bigPath = join(rootDir, "big.pdf");
    await writeFile(bigPath, "x".repeat(100));

    await expect(
      resolveOutboundAttachment(
        { filePath: bigPath, filename: "big.pdf", mimeType: "application/pdf" },
        { allowedRoots: [rootDir], maxBytes: 10 },
      ),
    ).rejects.toThrow(/over size cap/);

    await expect(
      resolveOutboundAttachment(
        { url: "https://cdn.example.com/big.pdf", filename: "big.pdf" },
        {
          maxBytes: 10,
          fetch: (async () =>
            new Response("x".repeat(100), {
              status: 200,
              headers: { "content-type": "application/pdf" },
            })) as typeof fetch,
        },
      ),
    ).rejects.toThrow(/over size cap/);
  });

  it("rejects filePath outside the default ~/.envlo/attachments jail", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "envlo-out-default-jail-"));
    tempDirs.push(outsideDir);
    const outside = join(outsideDir, "note.txt");
    await writeFile(outside, "hello");

    await expect(
      resolveOutboundAttachment({
        filePath: outside,
        filename: "note.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toThrow(/escapes allowed attachment roots/);
  });

  it("rejects outbound dangerous extensions", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "envlo-out-"));
    tempDirs.push(rootDir);
    const evil = join(rootDir, "payload.exe");
    await writeFile(evil, "MZ");

    await expect(
      resolveOutboundAttachment(
        { filePath: evil, filename: "payload.exe" },
        { allowedRoots: [rootDir] },
      ),
    ).rejects.toThrow(/blocked/);
  });

  it("requires exactly one of filePath / url / content", async () => {
    await expect(resolveOutboundAttachment({})).rejects.toThrow(/exactly one/);
    await expect(
      resolveOutboundAttachment({
        filePath: "/tmp/a.pdf",
        url: "https://example.com/a.pdf",
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it("accepts inline content bytes for advanced callers", async () => {
    const content = new TextEncoder().encode("hello agent");
    const resolved = await resolveOutboundAttachment({
      content,
      filename: "note.txt",
      mimeType: "text/plain",
    });
    expect(resolved.source).toBe("bytes");
    expect(resolved.filename).toBe("note.txt");
    expect(resolved.sizeBytes).toBe(content.byteLength);
  });
});
