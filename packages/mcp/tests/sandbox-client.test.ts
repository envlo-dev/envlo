import { describe, expect, it, vi } from "vitest";
import { createEnvloMcpContext } from "../src/context.js";
import {
  readSandboxBridgeConfig,
  startSandboxBridge,
} from "../src/inbound/sandbox-client.js";

describe("sandbox bridge config", () => {
  it("reads ENVLO_SANDBOX_URL", () => {
    expect(readSandboxBridgeConfig({})).toBeNull();
    const cfg = readSandboxBridgeConfig({
      ENVLO_SANDBOX_URL: "https://sandbox.envlo.dev/",
      ENVLO_SANDBOX_INBOX_ID: "abc",
      ENVLO_SANDBOX_SESSION_TOKEN: "tok",
    });
    expect(cfg).toEqual({
      baseUrl: "https://sandbox.envlo.dev",
      inboxId: "abc",
      sessionToken: "tok",
      autoProvision: true,
    });
  });
});

describe("sandbox bridge runtime", () => {
  it("requires ids when auto-provision is disabled", async () => {
    const ctx = await createEnvloMcpContext({ stateDriver: "memory" });
    await expect(
      startSandboxBridge(ctx, {
        baseUrl: "https://sandbox.envlo.dev",
        autoProvision: false,
      }),
    ).rejects.toThrow(/SESSION_TOKEN/);
    await ctx.close();
  });

  it("reuses existing inbox + session without provisioning", async () => {
    const ctx = await createEnvloMcpContext({ stateDriver: "memory" });
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    class FakeWebSocket {
      readyState = 1;
      constructor(_url: string) {
        setTimeout(() => {
          for (const fn of listeners.open ?? []) fn({});
        }, 0);
      }
      addEventListener(type: string, fn: (...args: unknown[]) => void) {
        (listeners[type] ??= []).push(fn);
      }
      send() {}
      close() {}
    }

    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/v1/sandbox/inboxes/reuse1")) {
        return new Response(
          JSON.stringify({
            ok: true,
            inbox: { address: "reuse1@sandbox.envlo.dev" },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const bridge = await startSandboxBridge(ctx, {
      baseUrl: "https://sandbox.envlo.dev",
      inboxId: "reuse1",
      sessionToken: "evlo1.reuse.token",
      autoProvision: false,
      fetchImpl,
      webSocket: FakeWebSocket as unknown as typeof WebSocket,
    });

    expect(bridge.address).toBe("reuse1@sandbox.envlo.dev");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await bridge.stop();
    await ctx.close();
  });

  it("provisions, creates local inbox, streams MIME into wait bus", async () => {
    const ctx = await createEnvloMcpContext({ stateDriver: "memory" });
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    let lastUrl = "";

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      constructor(url: string) {
        lastUrl = url;
        setTimeout(() => {
          for (const fn of listeners.open ?? []) fn({});
          const mime = [
            "From: bot@example.com",
            "To: box@sandbox.envlo.dev",
            "Subject: hello sandbox",
            "Message-ID: <sbx-1@test>",
            "",
            "hi from sandbox",
          ].join("\r\n");
          for (const fn of listeners.message ?? []) {
            fn({
              data: JSON.stringify({
                type: "email",
                message: {
                  seq: 1,
                  rawMime: mime,
                  to: "box@sandbox.envlo.dev",
                  from: "bot@example.com",
                  subject: "hello sandbox",
                },
              }),
            });
          }
        }, 0);
      }
      addEventListener(type: string, fn: (...args: unknown[]) => void) {
        (listeners[type] ??= []).push(fn);
      }
      send() {}
      close() {
        for (const fn of listeners.close ?? []) fn({});
      }
    }

    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/v1/sandbox/inboxes")) {
        return new Response(
          JSON.stringify({
            ok: true,
            sessionToken: "evlo1.test.token",
            inbox: {
              id: "box",
              address: "box@sandbox.envlo.dev",
              websocketPath: "/v1/sandbox/inboxes/box/ws",
            },
          }),
          { status: 201 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const waitPromise = ctx.inboxBus.waitFor(
      (e) => e.type === "message.inbound",
      { timeoutMs: 2000 },
    );

    const bridge = await startSandboxBridge(ctx, {
      baseUrl: "https://sandbox.envlo.dev",
      fetchImpl,
      webSocket: FakeWebSocket as unknown as typeof WebSocket,
    });

    const event = await waitPromise;
    expect(event.type).toBe("message.inbound");
    if (event.type === "message.inbound") {
      expect(event.mime?.subject).toBe("hello sandbox");
    }
    expect(lastUrl).toContain("token=");
    expect(bridge.address).toBe("box@sandbox.envlo.dev");

    await bridge.stop();
    await ctx.close();
  });
});
