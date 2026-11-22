import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../src/crypto-util.js";
import { parseLiveApiKey } from "../src/keys.js";
import {
  fulfillConciergeCheckout,
  parseStripeEvent,
  resolveCustomerEmail,
  resolveRegionFromSession,
  revokeConciergeKeysForEmail,
  verifyStripeSignature,
  type StripeEvent,
} from "../src/stripe.js";
import { kvApiKeyHashKey } from "../src/ring-buffer.js";
import { MemoryKv } from "./helpers/memory-kv.js";

async function sign(body: string, secret: string, t: number): Promise<string> {
  const sig = await hmacSha256Hex(secret, `${t}.${body}`);
  return `t=${t},v1=${sig}`;
}

describe("Stripe webhook verification", () => {
  it("accepts valid signatures within tolerance", async () => {
    const body = '{"id":"evt_1","type":"checkout.session.completed"}';
    const secret = "whsec_test";
    const t = Math.floor(Date.now() / 1000);
    const header = await sign(body, secret, t);
    expect(await verifyStripeSignature(body, header, secret, t)).toBe(true);
  });

  it("rejects bad signatures and stale timestamps", async () => {
    const body = "{}";
    const secret = "whsec_test";
    const t = Math.floor(Date.now() / 1000);
    expect(
      await verifyStripeSignature(body, "t=1,v1=deadbeef", secret, t),
    ).toBe(false);
    const stale = await sign(body, secret, t - 10_000);
    expect(await verifyStripeSignature(body, stale, secret, t)).toBe(false);
  });
});

describe("Concierge Pro fulfillment", () => {
  const baseEvent = (overrides?: Partial<StripeEvent["data"]["object"]>): StripeEvent => ({
    id: "evt_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        customer_email: "founder@example.com",
        metadata: { region: "eu" },
        ...overrides,
      },
    },
  });

  it("provisions envlo_live_eu_ key and is idempotent without storing plaintext", async () => {
    const kv = new MemoryKv().asNamespace();
    const event = baseEvent();
    const first = await fulfillConciergeCheckout(event, {
      kv,
      pepper: "p",
      defaultRegion: "us",
    });
    expect(first).not.toBeNull();
    expect(first!.fresh).toBe(true);
    expect(parseLiveApiKey(first!.apiKey!)?.region).toBe("eu");
    expect(first!.email).toBe("founder@example.com");

    const second = await fulfillConciergeCheckout(event, {
      kv,
      pepper: "p",
      defaultRegion: "us",
    });
    expect(second!.fresh).toBe(false);
    expect(second!.apiKey).toBeUndefined();
    expect(second!.keyHash).toBe(first!.keyHash);
  });

  it("resolves email and region helpers", () => {
    expect(
      resolveCustomerEmail({
        id: "cs",
        customer_details: { email: " a@b.com " },
      }),
    ).toBe("a@b.com");
    expect(
      resolveRegionFromSession({
        id: "cs",
        currency: "eur",
      }),
    ).toBe("eu");
    expect(
      resolveRegionFromSession({
        id: "cs",
        locale: "de-DE",
      }),
    ).toBe("eu");
  });

  it("ignores non-checkout events", async () => {
    const kv = new MemoryKv().asNamespace();
    const result = await fulfillConciergeCheckout(
      { id: "evt_x", type: "invoice.paid", data: { object: { id: "in_1" } } },
      { kv, pepper: "", defaultRegion: "us" },
    );
    expect(result).toBeNull();
  });

  it("parses event JSON", () => {
    const raw = JSON.stringify(baseEvent());
    expect(parseStripeEvent(raw).id).toBe("evt_test_1");
  });

  it("revokes keys on subscription cancel", async () => {
    const kv = new MemoryKv().asNamespace();
    const first = await fulfillConciergeCheckout(baseEvent(), {
      kv,
      pepper: "p",
      defaultRegion: "us",
    });
    const result = await revokeConciergeKeysForEmail(
      kv,
      "founder@example.com",
      "customer.subscription.deleted",
    );
    expect(result.revoked).toBe(1);
    const raw = await kv.get(kvApiKeyHashKey(first!.keyHash));
    expect(JSON.parse(raw!).status).toBe("revoked");
  });
});
