import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ingestRawMime } from "../../src/parser/ingest-raw-mime.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

function load(rel: string): string {
  return readFileSync(join(fixturesDir, rel), "utf8");
}

function wrapHtmlAsMime(html: string, subject = "Order update"): string {
  return [
    "From: ship@shop.example.com",
    "To: sam@example.com",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
  ].join("\r\n");
}

function wrapTextAsMime(text: string, subject = "Re: Invoice"): string {
  return [
    "From: alice@example.com",
    "To: support@company.com",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
  ].join("\r\n");
}

describe("ingestRawMime markdown pipeline", () => {
  it("populates layout-flatten + compression metadata for transactional HTML", async () => {
    const html = load("html/transactional-layout-heavy.html");
    const ingested = await ingestRawMime(wrapHtmlAsMime(html));

    expect(ingested.safeMarkdown).toContain("Your order is on the way");
    expect(ingested.safeMarkdown).toContain("A-10422");
    expect(ingested.layoutTablesFlattened).toBeGreaterThanOrEqual(3);
    expect(ingested.markdownCompressionRatio).not.toBeNull();
    expect(ingested.markdownCompressionRatio!).toBeGreaterThanOrEqual(0.75);
    expect(ingested.strippedHiddenElementsCount).toBeGreaterThanOrEqual(1);
  });

  it("flattens nested layout tables from a real .eml fixture", async () => {
    const mime = load("eml/transactional-layout.eml");
    const ingested = await ingestRawMime(mime);
    expect(ingested.safeMarkdown).toContain("Your order is on the way");
    expect(ingested.safeMarkdown).toContain("Trail Bottle");
    expect(ingested.layoutTablesFlattened).toBeGreaterThanOrEqual(2);
    expect(ingested.safeMarkdown).not.toMatch(/^\| ---/m);
  });

  it("keeps SendGrid-style receipt fields through ingest", async () => {
    const html = load("html/esp-sendgrid-receipt.html");
    const ingested = await ingestRawMime(wrapHtmlAsMime(html, "Your receipt"));
    expect(ingested.safeMarkdown).toContain("SG-77821");
    expect(ingested.safeMarkdown).toContain("https://orders.northwind.example/SG-77821");
    expect(ingested.markdownCompressionRatio!).toBeGreaterThanOrEqual(0.75);
  });

  it("strips quoted history from plain-text replies into agent-facing body", async () => {
    const mime = wrapTextAsMime(load("text/reply-gmail-on-wrote.txt"));
    const ingested = await ingestRawMime(mime);
    expect(ingested.safeMarkdown).toBeNull();
    expect(ingested.spotlightedText).toContain("Sounds good — ship it");
    expect(ingested.spotlightedText).not.toContain("ship-by date");
  });

  it("can retain quoted history when ingest options opt in", async () => {
    const mime = wrapTextAsMime(load("text/reply-outlook-original-message.txt"));
    const stripped = await ingestRawMime(mime);
    const kept = await ingestRawMime(mime, {
      includeQuotedHistory: true,
      includeSignatures: true,
    });

    expect(stripped.spotlightedText).toContain("fixes the invoice amount");
    expect(stripped.spotlightedText).not.toContain("confirm the invoice amount");

    expect(kept.spotlightedText).toContain("fixes the invoice amount");
    expect(kept.spotlightedText).toContain("confirm the invoice amount");
    expect(kept.spotlightedText).toContain("-----Original Message-----");
  });

  it("strips Outlook HTML attribution blocks from safeMarkdown", async () => {
    const html = load("html/reply-outlook-html.html");
    const ingested = await ingestRawMime(wrapHtmlAsMime(html, "Re: Delivery"));
    expect(ingested.safeMarkdown).toContain("shipping Friday works");
    expect(ingested.safeMarkdown).not.toContain("OL-991");
    expect(ingested.safeMarkdown).not.toMatch(/\*\*From:\*\*/i);
  });
});
