import { describe, expect, it, vi } from "vitest";
import type { SandboxEnv } from "../src/env.js";
import { handleEmailMessage } from "../src/http.js";
import { provisionEphemeralInbox } from "../src/sandbox-store.js";
import { MemoryKv } from "./helpers/memory-kv.js";

function mockMessage(
  overrides: Partial<{
    from: string;
    to: string;
    rawSize: number;
    subject: string;
    messageId: string;
    raw: string;
  }> = {},
): ForwardableEmailMessage & { rejected?: string } {
  const raw = overrides.raw ?? "Subject: hi\r\n\r\nbody";
  const state: { rejected?: string } = {};
  const msg = {
    from: overrides.from ?? "sender@example.com",
    to: overrides.to ?? "box@sandbox.envlo.dev",
    rawSize: overrides.rawSize ?? raw.length,
    headers: new Headers({
      subject: overrides.subject ?? "hi",
      "message-id": overrides.messageId ?? "<m1@test>",
    }),
    raw: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(raw));
        c.close();
      },
    }),
    setReject(reason: string) {
      state.rejected = reason;
    },
    forward: vi.fn(),
    reply: vi.fn(),
    get rejected() {
      return state.rejected;
    },
  };
  return msg as unknown as ForwardableEmailMessage & { rejected?: string };
}

function mockInboxStub(ingests: unknown[]) {
  return {
    idFromName(name: string) {
      return { toString: () => name } as DurableObjectId;
    },
    get(id: DurableObjectId) {
      return {
        id,
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          if (body) ingests.push(body);
          return Response.json({ ok: true, message: { seq: 1 }, meta: {} });
        },
      } as DurableObjectStub;
    },
  } as DurableObjectNamespace;
}

async function makeEnv(kv: KVNamespace, ingests: unknown[] = []): Promise<{
  env: SandboxEnv;
  inboxId: string;
  sessionId: string;
}> {
  const provisioned = await provisionEphemeralInbox(kv, {
    domain: "sandbox.envlo.dev",
    preferredLocal: "box",
  });
  if (!provisioned.ok) throw new Error("provision failed");
  return {
    env: {
      SANDBOX_KV: kv,
      INBOX: mockInboxStub(ingests),
      SANDBOX_DOMAIN: "sandbox.envlo.dev",
      UPGRADE_ORIGIN: "https://envlo.dev",
      STRIPE_PAYMENT_LINK_URL: "https://buy.stripe.com/test",
      SESSION_SIGNING_SECRET: "s",
      API_KEY_PEPPER: "p",
      MAX_MIME_BYTES: "1024",
    },
    inboxId: provisioned.meta.inboxId,
    sessionId: provisioned.sessionId,
  };
}

describe("handleEmailMessage", () => {
  it("rejects unknown recipient and expired/missing inbox", async () => {
    const kv = new MemoryKv().asNamespace();
    const { env } = await makeEnv(kv);
    const unknown = mockMessage({ to: "nope@other.dev" });
    await handleEmailMessage(unknown, env);
    expect(unknown.rejected).toMatch(/Unknown sandbox recipient/);

    const missing = mockMessage({ to: "ghost@sandbox.envlo.dev" });
    await handleEmailMessage(missing, env);
    expect(missing.rejected).toMatch(/Unknown sandbox inbox/);
  });

  it("hard-rejects oversize MIME before ingest", async () => {
    const kv = new MemoryKv().asNamespace();
    const ingests: unknown[] = [];
    const { env } = await makeEnv(kv, ingests);
    const big = mockMessage({
      to: "box@sandbox.envlo.dev",
      rawSize: 10_000,
    });
    await handleEmailMessage(big, env);
    expect(big.rejected).toMatch(/too large/i);
    expect(ingests).toHaveLength(0);
  });

  it("enforces daily inbound quota then rejects", async () => {
    const kv = new MemoryKv().asNamespace();
    const ingests: unknown[] = [];
    const { env, sessionId } = await makeEnv(kv, ingests);
    const { consumeDailyInboundQuota } = await import("../src/sandbox-store.js");
    for (let i = 0; i < 100; i++) {
      await consumeDailyInboundQuota(kv, sessionId);
    }
    const msg = mockMessage({ to: "box@sandbox.envlo.dev" });
    await handleEmailMessage(msg, env);
    expect(msg.rejected).toMatch(/Daily inbound limit/);
    expect(ingests).toHaveLength(0);
  });

  it("forwards valid mail into the Durable Object ingest path", async () => {
    const kv = new MemoryKv().asNamespace();
    const ingests: unknown[] = [];
    const { env } = await makeEnv(kv, ingests);
    const msg = mockMessage({
      to: "box@sandbox.envlo.dev",
      subject: "ping",
      messageId: "<ping@test>",
      raw: "Subject: ping\r\nMessage-ID: <ping@test>\r\n\r\nhello",
    });
    await handleEmailMessage(msg, env);
    expect(msg.rejected).toBeUndefined();
    expect(ingests).toHaveLength(1);
    expect(ingests[0]).toMatchObject({
      to: "box@sandbox.envlo.dev",
      subject: "ping",
      messageId: "<ping@test>",
    });
  });
});
