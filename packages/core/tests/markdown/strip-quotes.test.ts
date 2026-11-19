import { describe, expect, it } from "vitest";
import { plainTextToAgentMarkdown, stripQuotedReply } from "../../src/markdown/index.js";

const REPLY = `Thanks for confirming the tracking number.

On Tue, Nov 10, 2026 at 9:00 AM Support <support@acme.com> wrote:
> Where is my package?
> Order A-100

--
Sam Rivera
`;

describe("stripQuotedReply", () => {
  it("strips quoted history and signatures by default", () => {
    const result = stripQuotedReply(REPLY);
    expect(result.text).toContain("Thanks for confirming");
    expect(result.text).not.toContain("Where is my package?");
    expect(result.text).not.toContain("Sam Rivera");
    expect(result.quotesStripped).toBe(true);
    expect(result.signatureStripped).toBe(true);
  });

  it("keeps quotes when includeQuotedHistory is true", () => {
    const result = stripQuotedReply(REPLY, {
      includeQuotedHistory: true,
      includeSignatures: false,
    });
    expect(result.text).toContain("Where is my package?");
    expect(result.text).not.toMatch(/Sam Rivera/);
  });

  it("strips mobile signatures", () => {
    const text = `Looks good to me.\n\nSent from my iPhone\n`;
    const result = stripQuotedReply(text);
    expect(result.text).toContain("Looks good to me");
    expect(result.text).not.toMatch(/Sent from my iPhone/i);
  });

  it("leaves non-reply bodies unchanged", () => {
    const text = "Invoice #42 is attached. Please review when you can.";
    const result = stripQuotedReply(text);
    expect(result.text).toBe(text);
    expect(result.quotesStripped).toBe(false);
  });

  it("plainTextToAgentMarkdown reports compression", () => {
    const result = plainTextToAgentMarkdown(REPLY);
    expect(result.markdown).toContain("Thanks for confirming");
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore);
    expect(result.compressionRatio).toBeGreaterThan(0.3);
  });
});
