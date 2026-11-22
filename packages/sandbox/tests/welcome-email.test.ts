import { describe, expect, it } from "vitest";
import { formatLiveApiKey } from "../src/keys.js";
import {
  buildWelcomeEmail,
  sendWelcomeEmailViaResend,
} from "../src/welcome-email.js";

describe("founder welcome note", () => {
  it("includes plaintext regional key", () => {
    const apiKey = formatLiveApiKey("us", "d".repeat(32));
    const mail = buildWelcomeEmail({
      to: "founder@example.com",
      apiKey,
      region: "us",
      from: "Envlo <welcome@envlo.dev>",
    });
    expect(mail.subject).toContain("Concierge Pro");
    expect(mail.text).toContain(apiKey);
    expect(mail.html).toContain(apiKey);
  });

  it("posts to Resend API", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    };
    const apiKey = formatLiveApiKey("eu", "e".repeat(32));
    const result = await sendWelcomeEmailViaResend(
      {
        to: "founder@example.com",
        apiKey,
        region: "eu",
        from: "Envlo <welcome@envlo.dev>",
      },
      "re_test",
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.id).toBe("email_123");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.to).toEqual(["founder@example.com"]);
    expect(body.text).toContain(apiKey);
  });
});
