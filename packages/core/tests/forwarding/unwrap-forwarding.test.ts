import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unwrapForwarding } from "../../src/forwarding/index.js";
import { ingestRawMime } from "../../src/parser/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/eml");

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe("unwrapForwarding / auto-forward unwrapper", () => {
  it("unwraps Gmail auto-forward: outer From is support, original is customer", async () => {
    const mail = await ingestRawMime(loadFixture("gmail-auto-forward.eml"));

    expect(mail.from?.address).toBe("support@company.com");
    expect(mail.trueOriginalSender).toEqual({
      name: "Alice Customer",
      address: "alice@customer.example",
    });
    expect(mail.replyToAddress).toBe("alice@customer.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("gmail-inline");
    expect(unwrapped.forwarderAddress).toBe("support@company.com");
    expect(unwrapped.trueOriginalSender?.address).toBe("alice@customer.example");
    expect(unwrapped.replyToAddress).toBe("alice@customer.example");
  });

  it("unwraps Microsoft 365 auto-forward From/Sent/To block", async () => {
    const mail = await ingestRawMime(loadFixture("m365-auto-forward.eml"));

    expect(mail.from?.address).toBe("support@contoso.com");
    expect(mail.trueOriginalSender).toEqual({
      name: "Bob Buyer",
      address: "bob@buyer.example",
    });
    expect(mail.replyToAddress).toBe("bob@buyer.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("m365-inline");
    expect(unwrapped.forwarderAddress).toBe("support@contoso.com");
  });

  it("unwraps localized French M365 forward labels (Envoyé/À/Objet)", async () => {
    const mail = await ingestRawMime(loadFixture("m365-french-forward.eml"));

    expect(mail.from?.address).toBe("support@contoso.fr");
    expect(mail.trueOriginalSender).toEqual({
      name: "Claire Client",
      address: "claire@client.example",
    });
    expect(mail.replyToAddress).toBe("claire@client.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("m365-inline");
  });

  it("unwraps Apple Mail Begin forwarded message blocks", async () => {
    const mail = await ingestRawMime(loadFixture("apple-mail-forward.eml"));

    expect(mail.trueOriginalSender).toEqual({
      name: "Ike Appleuser",
      address: "ike@icloud.example",
    });
    expect(mail.replyToAddress).toBe("ike@icloud.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("apple-inline");
  });

  it("unwraps Gmail HTML-only forwards without a text/plain part", async () => {
    const mail = await ingestRawMime(loadFixture("gmail-html-only-forward.eml"));

    expect(mail.text).toBeNull();
    expect(mail.html).toBeTruthy();
    expect(mail.trueOriginalSender).toEqual({
      name: "HTML Customer",
      address: "html.customer@example.com",
    });
    expect(mail.replyToAddress).toBe("html.customer@example.com");
  });

  it("unwraps nested message/rfc822 attachments", async () => {
    const mail = await ingestRawMime(loadFixture("rfc822-attached-forward.eml"));

    expect(mail.from?.address).toBe("support@company.com");
    expect(mail.attachments.some((a) => a.mimeType.includes("rfc822"))).toBe(true);
    expect(mail.trueOriginalSender).toEqual({
      name: "Nested Customer",
      address: "nested@customer.example",
    });
    expect(mail.replyToAddress).toBe("nested@customer.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("rfc822-attachment");
  });

  it("treats Resent-From as forwarder and keeps outer From as original", async () => {
    const mail = await ingestRawMime(loadFixture("resent-forward.eml"));

    expect(mail.from?.address).toBe("dana@customers.example");
    expect(mail.trueOriginalSender?.address).toBe("dana@customers.example");
    expect(mail.replyToAddress).toBe("dana@customers.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("resent");
    expect(unwrapped.forwarderAddress).toBe("forwarder@company.com");
  });

  it("does not treat Gmail X-Forwarded-For alone as the customer sender", async () => {
    const mail = await ingestRawMime(loadFixture("x-forwarded-headers-only.eml"));

    // Without an inline/rfc822 original, we cannot invent a customer address.
    // X-Forwarded-For is the company mailbox hop, not the customer.
    expect(mail.from?.address).toBe("support@company.com");
    expect(mail.trueOriginalSender?.address).toBe("support@company.com");
    expect(mail.replyToAddress).toBe("support@company.com");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("none");
    expect(unwrapped.forwarderAddress).toBe("support@company.com");
  });

  it("does not mis-detect a normal reply with quoted Outlook headers", async () => {
    const mail = await ingestRawMime(loadFixture("reply-with-quoted-m365-headers.eml"));

    expect(mail.from?.address).toBe("alice@customer.example");
    expect(mail.subject).toMatch(/^Re:/i);
    expect(mail.trueOriginalSender?.address).toBe("alice@customer.example");
    expect(mail.replyToAddress).toBe("alice@customer.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("none");
  });

  it("unwraps Yahoo Forwarded Message blocks", async () => {
    const mail = await ingestRawMime(loadFixture("yahoo-forward.eml"));

    expect(mail.trueOriginalSender).toEqual({
      name: "Yuki Customer",
      address: "yuki@yahoo.example",
    });
    expect(mail.replyToAddress).toBe("yuki@yahoo.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("yahoo-inline");
  });

  it("unwraps localized Spanish M365 forward labels (Enviado/Para/Asunto)", async () => {
    const mail = await ingestRawMime(loadFixture("m365-spanish-forward.eml"));

    expect(mail.from?.address).toBe("support@contoso.es");
    expect(mail.trueOriginalSender).toEqual({
      name: "Diego Cliente",
      address: "diego@cliente.example",
    });
    expect(mail.replyToAddress).toBe("diego@cliente.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("m365-inline");
  });

  it("unwraps localized German M365 forward labels (Gesendet/An/Betreff)", async () => {
    const mail = await ingestRawMime(loadFixture("m365-german-forward.eml"));

    expect(mail.from?.address).toBe("support@contoso.de");
    expect(mail.trueOriginalSender).toEqual({
      name: "Greta Kunde",
      address: "greta@kunde.example",
    });
    expect(mail.replyToAddress).toBe("greta@kunde.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("m365-inline");
  });

  it("unwraps multi-hop Gmail forwards to the innermost original sender", async () => {
    const mail = await ingestRawMime(loadFixture("gmail-multi-hop-forward.eml"));

    expect(mail.from?.address).toBe("support@company.com");
    expect(mail.trueOriginalSender).toEqual({
      name: "Nest Customer",
      address: "nest@customer.example",
    });
    expect(mail.replyToAddress).toBe("nest@customer.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("gmail-inline");
    expect(unwrapped.trueOriginalSender?.address).not.toBe("partner@relay.example");
  });

  it("unwraps X-Original-From when no inline forward block is present", async () => {
    const mail = await ingestRawMime(loadFixture("x-original-from-only.eml"));

    expect(mail.from?.address).toBe("support@company.com");
    expect(mail.trueOriginalSender).toEqual({
      name: "Original Customer",
      address: "original@customer.example",
    });
    expect(mail.replyToAddress).toBe("original@customer.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("x-original-from");
  });

  it("does not mis-detect HTML-only replies with quoted Outlook headers", async () => {
    const mail = await ingestRawMime(loadFixture("reply-html-only-m365-headers.eml"));

    expect(mail.text).toBeNull();
    expect(mail.html).toBeTruthy();
    expect(mail.from?.address).toBe("alice@customer.example");
    expect(mail.subject).toMatch(/^Re:/i);
    expect(mail.trueOriginalSender?.address).toBe("alice@customer.example");
    expect(mail.replyToAddress).toBe("alice@customer.example");

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("none");
  });

  it("falls back to outer From when the message is not forwarded", async () => {
    const mail = await ingestRawMime(loadFixture("ses-inbound.eml"));

    expect(mail.trueOriginalSender?.address).toBe(mail.from?.address);
    expect(mail.replyToAddress).toBe(mail.from?.address);

    const unwrapped = await unwrapForwarding(mail);
    expect(unwrapped.detection).toBe("none");
  });
});
