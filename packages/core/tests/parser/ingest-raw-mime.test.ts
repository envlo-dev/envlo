import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ingestRawMime } from "../../src/parser/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/eml");

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe("ingestRawMime", () => {
  it("accepts string, Uint8Array, and ArrayBuffer inputs", async () => {
    const bytes = loadFixture("auth-unverified.eml");
    const asString = new TextDecoder().decode(bytes);
    const asBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const fromString = await ingestRawMime(asString);
    const fromUint8 = await ingestRawMime(bytes);
    const fromArrayBuffer = await ingestRawMime(asBuffer);

    expect(fromString.messageId).toBe("<auth-unverified-001@example.org>");
    expect(fromUint8.messageId).toBe(fromString.messageId);
    expect(fromArrayBuffer.messageId).toBe(fromString.messageId);
  });

  it("extracts Gmail reply threading and pass auth status", async () => {
    const ingested = await ingestRawMime(loadFixture("gmail-reply.eml"));

    expect(ingested.messageId).toBe("<gmail-reply-002@mail.gmail.com>");
    expect(ingested.inReplyTo).toBe("<gmail-root-001@mail.gmail.com>");
    expect(ingested.references).toEqual([
      "<gmail-root-001@mail.gmail.com>",
      "<gmail-mid-001b@mail.gmail.com>",
    ]);
    expect(ingested.from).toEqual({ name: "Customer Name", address: "customer@example.com" });
    expect(ingested.to).toEqual([{ name: "Envlo Agent", address: "agent@envlo.dev" }]);
    expect(ingested.replyTo).toEqual([{ name: "Customer Name", address: "customer@example.com" }]);
    expect(ingested.cc).toEqual([]);
    expect(ingested.bcc).toEqual([]);
    expect(ingested.subject).toBe("Re: Invoice question");
    expect(ingested.date).toBeTruthy();
    expect(ingested.text).toContain("updated invoice");
    expect(ingested.html).toContain("updated invoice");
    expect(ingested.senderAuthStatus).toBe("pass");
    expect(ingested.senderAuth).toMatchObject({
      status: "pass",
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
    });
  });

  it("extracts Microsoft 365 reply thread chain, attachment buffer, and pass auth", async () => {
    const ingested = await ingestRawMime(loadFixture("m365-reply.eml"));

    expect(ingested.messageId).toBe("<m365-reply-002@contoso.com>");
    expect(ingested.inReplyTo).toBe("<m365-root-001@contoso.com>");
    expect(ingested.references).toEqual(["<m365-root-001@contoso.com>"]);
    expect(ingested.from?.address).toBe("billing@contoso.com");
    expect(ingested.senderAuthStatus).toBe("pass");
    expect(ingested.attachments).toHaveLength(1);

    const pdf = ingested.attachments[0];
    expect(pdf?.filename).toBe("po-2048.pdf");
    expect(pdf?.mimeType).toBe("application/pdf");
    expect(pdf?.disposition).toBe("attachment");
    expect(pdf?.content).toBeInstanceOf(Uint8Array);
    expect(pdf?.content.byteLength).toBeGreaterThan(0);
  });

  it("extracts AWS SES inbound bodies and pass auth status", async () => {
    const ingested = await ingestRawMime(loadFixture("ses-inbound.eml"));

    expect(ingested.messageId).toBe("<ses-inbound-001@email.amazonses.com>");
    expect(ingested.inReplyTo).toBeNull();
    expect(ingested.references).toEqual([]);
    expect(ingested.from?.address).toBe("invoice@stripe.com");
    expect(ingested.to).toEqual([{ name: "", address: "agent@sandbox.envlo.dev" }]);
    expect(ingested.subject).toContain("receipt");
    expect(ingested.text).toContain("$42.00");
    expect(ingested.html).toContain("$42.00");
    expect(ingested.senderAuthStatus).toBe("pass");
  });

  it("extracts Resend transactional headers, reply-to, and pass auth status", async () => {
    const ingested = await ingestRawMime(loadFixture("resend-transactional.eml"));

    expect(ingested.messageId).toBe("<resend-tx-001@resend.dev>");
    expect(ingested.from?.address).toBe("noreply@updates.acme.app");
    expect(ingested.replyTo).toEqual([{ name: "", address: "support@acme.app" }]);
    expect(ingested.text).toContain("482913");
    expect(ingested.html).toContain("482913");
    expect(ingested.senderAuthStatus).toBe("pass");
  });

  it("marks spoofed auth headers as fail with per-method detail", async () => {
    const ingested = await ingestRawMime(loadFixture("auth-fail.eml"));
    expect(ingested.senderAuthStatus).toBe("fail");
    expect(ingested.senderAuth).toMatchObject({
      status: "fail",
      spf: "fail",
      dkim: "fail",
      dmarc: "fail",
    });
    expect(ingested.from?.address).toBe("spoof@paypal.com");
  });

  it("marks messages without auth headers as unverified", async () => {
    const ingested = await ingestRawMime(loadFixture("auth-unverified.eml"));
    expect(ingested.senderAuthStatus).toBe("unverified");
    expect(ingested.senderAuth).toEqual({
      status: "unverified",
      spf: null,
      dkim: null,
      dmarc: null,
    });
  });

  it("parses dense Gmail-style UTF-8 mail with multi-recipient, cc, and sender", async () => {
    const ingested = await ingestRawMime(loadFixture("gmail-dense-forward-chain.eml"));

    expect(ingested.messageId).toBe("<gmail-dense-003@mail.gmail.com>");
    expect(ingested.inReplyTo).toBe("<gmail-dense-002@mail.gmail.com>");
    expect(ingested.references).toEqual([
      "<gmail-dense-001@mail.gmail.com>",
      "<gmail-dense-002@mail.gmail.com>",
    ]);
    expect(ingested.from?.address).toBe("taro.yamada@example.co.jp");
    expect(ingested.from?.name).toContain("山田");
    expect(ingested.sender).toEqual({ name: "Mailing List", address: "list@example.co.jp" });
    expect(ingested.to).toHaveLength(2);
    expect(ingested.cc).toEqual([{ name: "Finance Desk", address: "finance@example.co.jp" }]);
    expect(ingested.subject).toMatch(/請求|Re:/);
    expect(ingested.text).toBeTruthy();
    expect(ingested.html).toBeTruthy();
    expect(ingested.senderAuth.status).toBe("pass");
    expect(ingested.date).toBeTruthy();
  });

  it("parses dense M365 Spanish HTML-table reply with encoded subject", async () => {
    const ingested = await ingestRawMime(loadFixture("m365-html-table.eml"));

    expect(ingested.messageId).toBe("<m365-dense-002@contoso.es>");
    expect(ingested.inReplyTo).toBe("<m365-dense-001@contoso.es>");
    expect(ingested.from?.address).toBe("pedidos@contoso.es");
    expect(ingested.cc[0]?.address).toBe("ana.garcia@contoso.es");
    expect(ingested.subject).toMatch(/Pedido|PO-7788/);
    expect(ingested.html).toContain("PO-7788");
    expect(ingested.text).toMatch(/aprobado|PO-7788/);
    expect(ingested.senderAuthStatus).toBe("pass");
  });

  it("separates inline CID images from file attachments", async () => {
    const ingested = await ingestRawMime(loadFixture("multipart-inline-and-attachment.eml"));

    expect(ingested.attachments).toHaveLength(2);

    const inline = ingested.attachments.find((a) => a.disposition === "inline");
    const file = ingested.attachments.find((a) => a.disposition === "attachment");

    expect(inline?.filename).toBe("logo.png");
    expect(inline?.contentId).toContain("logo@example.com");
    expect(inline?.content.byteLength).toBeGreaterThan(0);

    expect(file?.filename).toBe("report.pdf");
    expect(file?.mimeType).toBe("application/pdf");
    expect(file?.content.byteLength).toBeGreaterThan(0);
    expect(ingested.senderAuthStatus).toBe("pass");
  });

  it("treats softfail/neutral-only auth as unverified (not fail)", async () => {
    const ingested = await ingestRawMime(loadFixture("auth-softfail-only.eml"));
    expect(ingested.senderAuthStatus).toBe("unverified");
    expect(ingested.senderAuth).toMatchObject({
      status: "unverified",
      spf: "softfail",
      dkim: "neutral",
      dmarc: null,
    });
  });

  it("handles text-only mail with missing subject", async () => {
    const ingested = await ingestRawMime(loadFixture("text-only-empty-subject.eml"));
    expect(ingested.subject).toBeNull();
    expect(ingested.text).toContain("Plain text only");
    expect(ingested.html).toBeNull();
    expect(ingested.messageId).toBe("<text-only-001@example.com>");
  });

  it("handles html-only mail without text/plain", async () => {
    const ingested = await ingestRawMime(loadFixture("html-only.eml"));
    expect(ingested.html).toContain("HTML body without a text/plain");
    expect(ingested.text).toBeNull();
  });

  it("returns null messageId when header is absent", async () => {
    const ingested = await ingestRawMime(loadFixture("missing-message-id.eml"));
    expect(ingested.messageId).toBeNull();
    expect(ingested.subject).toBe("No Message-ID");
  });

  it("does not throw on truncated multipart and still extracts headers", async () => {
    const ingested = await ingestRawMime(loadFixture("malformed-truncation.eml"));
    expect(ingested.messageId).toBe("<malformed-001@example.com>");
    expect(ingested.from?.address).toBe("broken@example.com");
    expect(ingested.text ?? ingested.html ?? "").toContain("truncated");
  });
});
