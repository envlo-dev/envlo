import { describe, expect, it } from "vitest";
import {
  authenticateRequest,
  isAuthSuccess,
  sessionOwnsInbox,
} from "../src/auth.js";
import { formatLiveApiKey } from "../src/keys.js";
import { signSessionToken } from "../src/session-token.js";
import {
  fulfillConciergeCheckout,
  revokeConciergeKeysForEmail,
} from "../src/stripe.js";
import { MemoryKv } from "./helpers/memory-kv.js";

describe("authenticateRequest", () => {
  const secret = "session-secret";
  const pepper = "pepper";

  it("accepts X-Envlo-Session, cookie, and ?token=", async () => {
    const kv = new MemoryKv().asNamespace();
    const token = await signSessionToken(
      { sid: "sess_a", inboxId: "box1", exp: Date.now() + 60_000 },
      secret,
    );

    const headerAuth = await authenticateRequest(
      new Request("https://x/v1", {
        headers: { "X-Envlo-Session": token },
      }),
      { kv, sessionSecret: secret, apiKeyPepper: pepper, inboxId: "box1" },
    );
    expect(isAuthSuccess(headerAuth)).toBe(true);

    const cookieAuth = await authenticateRequest(
      new Request("https://x/v1", {
        headers: { Cookie: `envlo_session=${encodeURIComponent(token)}` },
      }),
      { kv, sessionSecret: secret, apiKeyPepper: pepper },
    );
    expect(isAuthSuccess(cookieAuth)).toBe(true);

    const queryAuth = await authenticateRequest(
      new Request(`https://x/ws?token=${encodeURIComponent(token)}`),
      { kv, sessionSecret: secret, apiKeyPepper: pepper, inboxId: "box1" },
    );
    expect(isAuthSuccess(queryAuth)).toBe(true);
  });

  it("accepts Bearer envlo_live_ key and rejects revoked", async () => {
    const kv = new MemoryKv().asNamespace();
    const key = formatLiveApiKey("us", "1".repeat(32));
    await fulfillConciergeCheckout(
      {
        id: "evt_auth",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_auth",
            customer_email: "a@b.com",
            metadata: { region: "us" },
          },
        },
      },
      {
        kv,
        pepper,
        defaultRegion: "us",
        generateKey: async () => key,
      },
    );

    const ok = await authenticateRequest(
      new Request("https://x/v1/me", {
        headers: { Authorization: `Bearer ${key}` },
      }),
      { kv, sessionSecret: secret, apiKeyPepper: pepper },
    );
    expect(ok).toMatchObject({ ok: true, kind: "api_key" });

    await revokeConciergeKeysForEmail(kv, "a@b.com", "charge.refunded");
    const revoked = await authenticateRequest(
      new Request("https://x/v1/me", {
        headers: { Authorization: `Bearer ${key}` },
      }),
      { kv, sessionSecret: secret, apiKeyPepper: pepper },
    );
    expect(revoked).toEqual({
      ok: false,
      status: 403,
      error: "api_key_revoked",
    });
  });

  it("enforces sessionOwnsInbox", async () => {
    const tokenPayload = { sid: "sess_1", inboxId: "box1", exp: 1 };
    expect(
      sessionOwnsInbox(
        { ok: true, kind: "session", payload: tokenPayload },
        { sessionId: "sess_1", inboxId: "box1" },
      ),
    ).toBe(true);
    expect(
      sessionOwnsInbox(
        { ok: true, kind: "session", payload: tokenPayload },
        { sessionId: "sess_1", inboxId: "box2" },
      ),
    ).toBe(false);
    expect(
      sessionOwnsInbox(
        {
          ok: true,
          kind: "api_key",
          keyHash: "x",
          record: {
            email: "a@b.com",
            region: "us",
            plan: "concierge_pro",
            stripeEventId: "e",
            checkoutSessionId: "c",
            createdAt: new Date().toISOString(),
            redactedKey: "r",
            status: "active",
          },
        },
        { sessionId: "other", inboxId: "box9" },
      ),
    ).toBe(true);
  });
});
