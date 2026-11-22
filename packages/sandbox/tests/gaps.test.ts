import { describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "../src/crypto-util.js";
import type { SandboxEnv } from "../src/env.js";
import { resolveSandboxConfig } from "../src/env.js";
import { handleHttpRequest } from "../src/http.js";
import { formatLiveApiKey } from "../src/keys.js";
import { clientIpFromRequest } from "../src/rate-limit.js";
import { fulfillConciergeCheckout } from "../src/stripe.js";
import { MemoryKv } from "./helpers/memory-kv.js";

function mockExecutionContext(): ExecutionContext & { drain(): Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    async drain() {
      await Promise.all(pending);
    },
  } as ExecutionContext & { drain(): Promise<void> };
}

function mockInboxNamespace(): DurableObjectNamespace {
  return {
    idFromName(name: string) {
      return { toString: () => name } as DurableObjectId;
    },
    get(id: DurableObjectId) {
      return {
        id,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req =
            input instanceof Request ? input : new Request(String(input), init);
          const url = new URL(req.url);
          if (url.pathname === "/init") {
            return Response.json({ ok: true });
          }
          if (url.pathname === "/messages") {
            return Response.json({ ok: true, messages: [], meta: null });
          }
          if (url.pathname === "/meta") {
            return Response.json({ ok: true, connections: 0 });
          }
          if (url.pathname === "/ws") {
            // undici forbids Response status 101 in Node; DO returns 101 in Workers.
            return Response.json({ ok: true, websocket: true });
          }
          return Response.json({ ok: false }, { status: 404 });
        },
      } as DurableObjectStub;
    },
  } as DurableObjectNamespace;
}

function makeEnv(kv: KVNamespace): SandboxEnv {
  return {
    SANDBOX_KV: kv,
    INBOX: mockInboxNamespace(),
    SANDBOX_DOMAIN: "sandbox.envlo.dev",
    UPGRADE_ORIGIN: "https://envlo.dev",
    STRIPE_PAYMENT_LINK_URL: "https://buy.stripe.com/test_concierge",
    DEFAULT_KEY_REGION: "eu",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    RESEND_API_KEY: "re_test",
    RESEND_FROM: "Envlo <welcome@envlo.dev>",
    API_KEY_PEPPER: "pepper",
    SESSION_SIGNING_SECRET: "session-secret",
    MAX_MIME_BYTES: "2048",
  };
}

describe("sandbox gap coverage", () => {
  it("resolveSandboxConfig applies defaults and MAX_MIME_BYTES", () => {
    const cfg = resolveSandboxConfig({
      SANDBOX_KV: new MemoryKv().asNamespace(),
      INBOX: mockInboxNamespace(),
      SANDBOX_DOMAIN: "",
      UPGRADE_ORIGIN: "",
      STRIPE_PAYMENT_LINK_URL: "",
      MAX_MIME_BYTES: "2048",
    });
    expect(cfg.sandboxDomain).toBe("sandbox.envlo.dev");
    expect(cfg.defaultKeyRegion).toBe("us");
    expect(cfg.maxMimeBytes).toBe(2048);
    expect(cfg.sessionSigningSecret).toBe("dev-session-secret");
  });

  it("clientIpFromRequest prefers CF-Connecting-IP", () => {
    expect(
      clientIpFromRequest(
        new Request("https://x", {
          headers: {
            "CF-Connecting-IP": "9.9.9.9",
            "X-Forwarded-For": "1.1.1.1, 2.2.2.2",
          },
        }),
      ),
    ).toBe("9.9.9.9");
    expect(
      clientIpFromRequest(
        new Request("https://x", {
          headers: { "X-Forwarded-For": "1.1.1.1, 2.2.2.2" },
        }),
      ),
    ).toBe("1.1.1.1");
  });

  it("rate-limits burst provisions with 429", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await handleHttpRequest(
        new Request("https://sandbox.envlo.dev/v1/sandbox/inboxes", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "CF-Connecting-IP": "8.8.8.8",
          },
          body: "{}",
        }),
        env,
        mockExecutionContext(),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("rejects foreign inbox-scoped session tokens", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const a = await handleHttpRequest(
      new Request("https://sandbox.envlo.dev/v1/sandbox/inboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localPart: "alice" }),
      }),
      env,
      mockExecutionContext(),
    );
    const aBody = (await a.json()) as {
      sessionToken: string;
      inbox: { id: string };
    };

    const b = await handleHttpRequest(
      new Request("https://sandbox.envlo.dev/v1/sandbox/inboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localPart: "bob" }),
      }),
      env,
      mockExecutionContext(),
    );
    const bBody = (await b.json()) as { sessionToken: string };

    // Inbox-scoped token for bob cannot authenticate against alice → 401
    const denied = await handleHttpRequest(
      new Request(
        `https://sandbox.envlo.dev/v1/sandbox/inboxes/${aBody.inbox.id}/messages`,
        { headers: { "X-Envlo-Session": bBody.sessionToken } },
      ),
      env,
      mockExecutionContext(),
    );
    expect(denied.status).toBe(401);

    // Session-wide token for another sid → 403 via sessionOwnsInbox
    const { signSessionToken } = await import("../src/session-token.js");
    const foreign = await signSessionToken(
      { sid: "sess_other", exp: Date.now() + 60_000 },
      env.SESSION_SIGNING_SECRET!,
    );
    const forbidden = await handleHttpRequest(
      new Request(
        `https://sandbox.envlo.dev/v1/sandbox/inboxes/${aBody.inbox.id}/messages`,
        { headers: { "X-Envlo-Session": foreign } },
      ),
      env,
      mockExecutionContext(),
    );
    expect(forbidden.status).toBe(403);
  });

  it("Stripe subscription.deleted webhook revokes keys", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const key = formatLiveApiKey("eu", "2".repeat(32));
    await fulfillConciergeCheckout(
      {
        id: "evt_before_revoke",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_before",
            customer_email: "founder@envlo.dev",
            metadata: { region: "eu" },
          },
        },
      },
      {
        kv: env.SANDBOX_KV,
        pepper: "pepper",
        defaultRegion: "eu",
        generateKey: async () => key,
      },
    );

    const payload = JSON.stringify({
      id: "evt_sub_del",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          customer_email: "founder@envlo.dev",
        },
      },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256Hex(
      env.STRIPE_WEBHOOK_SECRET!,
      `${t}.${payload}`,
    );
    const res = await handleHttpRequest(
      new Request("https://envlo.dev/webhooks/stripe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Stripe-Signature": `t=${t},v1=${sig}`,
        },
        body: payload,
      }),
      env,
      mockExecutionContext(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revoked: number };
    expect(body.revoked).toBe(1);

    const me = await handleHttpRequest(
      new Request("https://envlo.dev/v1/me", {
        headers: { Authorization: `Bearer ${key}` },
      }),
      env,
      mockExecutionContext(),
    );
    expect(me.status).toBe(403);
  });

  it("does not re-email welcome on Stripe event replay", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const fetches: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      fetches.push(String(url));
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }) as typeof fetch;

    try {
      const payload = JSON.stringify({
        id: "evt_once",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_once",
            customer_email: "once@envlo.dev",
            metadata: { region: "us" },
          },
        },
      });
      const t = Math.floor(Date.now() / 1000);
      const sig = await hmacSha256Hex(
        env.STRIPE_WEBHOOK_SECRET!,
        `${t}.${payload}`,
      );
      const headers = {
        "content-type": "application/json",
        "Stripe-Signature": `t=${t},v1=${sig}`,
      };
      const ctx1 = mockExecutionContext();
      await handleHttpRequest(
        new Request("https://envlo.dev/webhooks/stripe", {
          method: "POST",
          headers,
          body: payload,
        }),
        env,
        ctx1,
      );
      await ctx1.drain();

      const ctx2 = mockExecutionContext();
      await handleHttpRequest(
        new Request("https://envlo.dev/webhooks/stripe", {
          method: "POST",
          headers,
          body: payload,
        }),
        env,
        ctx2,
      );
      await ctx2.drain();

      expect(fetches.filter((u) => u.includes("api.resend.com"))).toHaveLength(
        1,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts WS upgrade auth via ?token= query", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const created = await handleHttpRequest(
      new Request("https://sandbox.envlo.dev/v1/sandbox/inboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localPart: "wstok" }),
      }),
      env,
      mockExecutionContext(),
    );
    const body = (await created.json()) as {
      sessionToken: string;
      inbox: { id: string };
    };
    const ws = await handleHttpRequest(
      new Request(
        `https://sandbox.envlo.dev/v1/sandbox/inboxes/${body.inbox.id}/ws?token=${encodeURIComponent(body.sessionToken)}`,
        { headers: { Upgrade: "websocket" } },
      ),
      env,
      mockExecutionContext(),
    );
    expect(ws.status).toBe(200);
    const wsBody = (await ws.json()) as { websocket?: boolean };
    expect(wsBody.websocket).toBe(true);
  });
});
