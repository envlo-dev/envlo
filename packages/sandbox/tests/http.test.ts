import { describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "../src/crypto-util.js";
import type { SandboxEnv } from "../src/env.js";
import { handleHttpRequest } from "../src/http.js";
import { MemoryKv } from "./helpers/memory-kv.js";

function mockExecutionContext(): ExecutionContext {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    // test helper
    async drain() {
      await Promise.all(pending);
    },
  } as ExecutionContext & { drain(): Promise<void> };
}

function mockInboxNamespace(): DurableObjectNamespace {
  const state = new Map<
    string,
    { meta: unknown; messages: unknown[]; sockets: number }
  >();

  return {
    idFromName(name: string) {
      return { name, toString: () => name } as DurableObjectId;
    },
    idFromString(id: string) {
      return { name: id, toString: () => id } as DurableObjectId;
    },
    newUniqueId() {
      return { name: "unique", toString: () => "unique" } as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const key = String(id);
      if (!state.has(key)) {
        state.set(key, { meta: null, messages: [], sockets: 0 });
      }
      const box = state.get(key)!;
      return {
        id,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req =
            input instanceof Request ? input : new Request(String(input), init);
          const url = new URL(req.url);
          if (url.pathname === "/init") {
            box.meta = await req.json();
            return Response.json({ ok: true, meta: box.meta });
          }
          if (url.pathname === "/ingest") {
            const body = (await req.json()) as Record<string, unknown>;
            const seq = box.messages.length + 1;
            const message = { seq, ...body };
            box.messages.push(message);
            return Response.json({ ok: true, message, meta: box.meta });
          }
          if (url.pathname === "/messages") {
            const after =
              Number.parseInt(url.searchParams.get("afterSeq") || "0", 10) || 0;
            return Response.json({
              ok: true,
              meta: box.meta,
              messages: box.messages.filter(
                (m) => (m as { seq: number }).seq > after,
              ),
            });
          }
          if (url.pathname === "/meta") {
            return Response.json({
              ok: true,
              meta: box.meta,
              connections: box.sockets,
            });
          }
          if (url.pathname === "/ws") {
            return Response.json({ ok: true, websocket: true });
          }
          return Response.json({ ok: false }, { status: 404 });
        },
      } as DurableObjectStub;
    },
    jurisdiction() {
      return this;
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
    DEFAULT_KEY_REGION: "us",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    RESEND_API_KEY: "re_test",
    RESEND_FROM: "Envlo <welcome@envlo.dev>",
    API_KEY_PEPPER: "pepper",
    SESSION_SIGNING_SECRET: "session-secret",
  };
}

describe("HTTP gateway", () => {
  it("health + upgrade redirect", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const health = await handleHttpRequest(
      new Request("https://sandbox.envlo.dev/health"),
      env,
      mockExecutionContext(),
    );
    expect(health.status).toBe(200);
    const upgrade = await handleHttpRequest(
      new Request("https://envlo.dev/upgrade"),
      env,
      mockExecutionContext(),
    );
    expect(upgrade.status).toBe(302);
    expect(upgrade.headers.get("location")).toBe(
      "https://buy.stripe.com/test_concierge",
    );
  });

  it("provisions instant inbox with zero login", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const res = await handleHttpRequest(
      new Request("https://sandbox.envlo.dev/v1/sandbox/inboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      env,
      mockExecutionContext(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      sessionToken: string;
      inbox: { id: string; address: string; websocketPath: string };
      limits: { maxInboxes: number };
    };
    expect(body.ok).toBe(true);
    expect(body.sessionToken.startsWith("evlo1.")).toBe(true);
    expect(body.inbox.address).toMatch(/@sandbox\.envlo\.dev$/);
    expect(body.inbox.websocketPath).toContain("/ws");
    expect(body.limits.maxInboxes).toBe(3);

    // Authenticated meta
    const meta = await handleHttpRequest(
      new Request(
        `https://sandbox.envlo.dev/v1/sandbox/inboxes/${body.inbox.id}`,
        { headers: { "X-Envlo-Session": body.sessionToken } },
      ),
      env,
      mockExecutionContext(),
    );
    expect(meta.status).toBe(200);

    // Unauthenticated rejected
    const denied = await handleHttpRequest(
      new Request(
        `https://sandbox.envlo.dev/v1/sandbox/inboxes/${body.inbox.id}`,
      ),
      env,
      mockExecutionContext(),
    );
    expect(denied.status).toBe(401);
  });

  it("Stripe checkout provisions live key and emails welcome", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const fetches: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      fetches.push(String(url));
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }) as typeof fetch;

    try {
      const payload = JSON.stringify({
        id: "evt_http_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_http_1",
            customer_email: "founder@envlo.dev",
            metadata: { region: "us" },
          },
        },
      });
      const t = Math.floor(Date.now() / 1000);
      const sig = await hmacSha256Hex(
        env.STRIPE_WEBHOOK_SECRET!,
        `${t}.${payload}`,
      );
      const ctx = mockExecutionContext() as ExecutionContext & {
        drain(): Promise<void>;
      };
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
        ctx,
      );
      expect(res.status).toBe(200);
      await ctx.drain();
      expect(fetches.some((u) => u.includes("api.resend.com"))).toBe(true);

      // Idempotent replay should not 500.
      const res2 = await handleHttpRequest(
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
      expect(res2.status).toBe(200);

      const stored = await env.SANDBOX_KV.get("stripe:evt:evt_http_1");
      expect(stored).toBeTruthy();
      const dedupe = JSON.parse(stored!) as {
        keyHash: string;
        region: string;
        apiKey?: string;
      };
      expect(dedupe.region).toBe("us");
      expect(dedupe.apiKey).toBeUndefined();
      expect(dedupe.keyHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("authenticates Concierge Pro key via /v1/me", async () => {
    const env = makeEnv(new MemoryKv().asNamespace());
    const { fulfillConciergeCheckout } = await import("../src/stripe.js");
    const { formatLiveApiKey } = await import("../src/keys.js");
    const known = formatLiveApiKey("us", "f".repeat(32));
    await fulfillConciergeCheckout(
      {
        id: "evt_me",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_me",
            customer_email: "pro@envlo.dev",
            metadata: { region: "us" },
          },
        },
      },
      {
        kv: env.SANDBOX_KV,
        pepper: "pepper",
        defaultRegion: "us",
        generateKey: async () => known,
      },
    );

    const me = await handleHttpRequest(
      new Request("https://envlo.dev/v1/me", {
        headers: { Authorization: `Bearer ${known}` },
      }),
      env,
      mockExecutionContext(),
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { plan: string; status: string };
    expect(body.plan).toBe("concierge_pro");
    expect(body.status).toBe("active");
  });
});
