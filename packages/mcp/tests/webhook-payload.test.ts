import { describe, expect, it } from "vitest";
import { parseInboundWebhookPayload } from "../src/index.js";

describe("parseInboundWebhookPayload", () => {
  it("passes through raw MIME", () => {
    const raw = Buffer.from("From: a@b.com\n\nHi");
    const parsed = parseInboundWebhookPayload(raw, "message/rfc822");
    expect(parsed.provider).toBe("raw");
    expect(parsed.mime).toEqual(raw);
  });

  it("parses Envlo JSON { raw, inboxId }", () => {
    const parsed = parseInboundWebhookPayload(
      Buffer.from(
        JSON.stringify({
          raw: "Subject: x\n\nbody",
          inboxId: "inbox_1",
          address: "a@envlo.dev",
        }),
      ),
      "application/json",
    );
    expect(parsed.provider).toBe("json");
    expect(parsed.mime).toContain("Subject: x");
    expect(parsed.inboxId).toBe("inbox_1");
    expect(parsed.address).toBe("a@envlo.dev");
  });

  it("handles SES SNS SubscriptionConfirmation", () => {
    const parsed = parseInboundWebhookPayload(
      Buffer.from(
        JSON.stringify({
          Type: "SubscriptionConfirmation",
          SubscribeURL: "https://sns.example/confirm",
        }),
      ),
      "application/json",
    );
    expect(parsed.provider).toBe("ses_sns");
    expect(parsed.snsSubscribeUrl).toBe("https://sns.example/confirm");
    expect(parsed.mime).toBeNull();
  });

  it("unwraps SES SNS Notification content", () => {
    const parsed = parseInboundWebhookPayload(
      Buffer.from(
        JSON.stringify({
          Type: "Notification",
          Message: JSON.stringify({
            content: "From: x@y.com\nTo: agent@envlo.dev\n\nHello SES",
            mail: { destination: ["agent@envlo.dev"] },
          }),
        }),
      ),
      "application/json",
    );
    expect(parsed.provider).toBe("ses_sns");
    expect(parsed.mime).toContain("Hello SES");
    expect(parsed.address).toBe("agent@envlo.dev");
  });

  it("unwraps Resend-style payload", () => {
    const parsed = parseInboundWebhookPayload(
      Buffer.from(
        JSON.stringify({
          type: "email.received",
          data: {
            to: ["agent@envlo.dev"],
            raw: "Subject: Resend\n\nHi",
          },
        }),
      ),
      "application/json",
    );
    expect(parsed.provider).toBe("resend");
    expect(parsed.mime).toContain("Resend");
    expect(parsed.address).toBe("agent@envlo.dev");
  });
});
