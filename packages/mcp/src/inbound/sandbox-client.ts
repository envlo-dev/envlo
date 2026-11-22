/**
 * Cloudflare ephemeral sandbox bridge (ticket #14).
 *
 * When `ENVLO_SANDBOX_URL` is set, provision (or reuse) a sandbox inbox and
 * stream WebSocket mail into `ingestInboundMime` → InboxEventBus so
 * `wait_for_email` wakes without a tunnel.
 */
import type { EnvloMcpContext } from "../context.js";
import { ingestInboundMime } from "../ingest.js";
import { mcpLog } from "../log.js";
import type { InboundTransportHandle } from "./types.js";

export type SandboxBridgeConfig = {
  baseUrl: string;
  /** Reuse an existing session token instead of provisioning. */
  sessionToken?: string;
  inboxId?: string;
  /** When true (default), POST /v1/sandbox/inboxes if inboxId omitted. */
  autoProvision?: boolean;
  /** WebSocket implementation (injectable for tests). */
  webSocket?: typeof WebSocket;
  fetchImpl?: typeof fetch;
};

export type SandboxBridgeHandle = InboundTransportHandle & {
  inboxId: string;
  address: string;
  sessionToken: string;
  getLastSeq: () => number;
};

type ProvisionResponse = {
  ok: boolean;
  sessionToken?: string;
  sessionId?: string;
  inbox?: {
    id: string;
    address: string;
    websocketPath: string;
  };
  error?: string;
  message?: string;
};

type SandboxWsEmail = {
  type: "email";
  message: {
    seq: number;
    rawMime: string;
    to: string;
    from: string;
    subject: string;
  };
};

type SandboxWsHello = {
  type: "hello";
  inboxId: string;
  address: string;
  lastSeq: number;
};

export function readSandboxBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): SandboxBridgeConfig | null {
  const baseUrl = (env.ENVLO_SANDBOX_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) return null;
  return {
    baseUrl,
    ...(env.ENVLO_SANDBOX_SESSION_TOKEN
      ? { sessionToken: env.ENVLO_SANDBOX_SESSION_TOKEN }
      : {}),
    ...(env.ENVLO_SANDBOX_INBOX_ID
      ? { inboxId: env.ENVLO_SANDBOX_INBOX_ID }
      : {}),
    autoProvision: env.ENVLO_SANDBOX_AUTO_PROVISION !== "0",
  };
}

/**
 * Start sandbox → MCP ingest bridge.
 */
export async function startSandboxBridge(
  ctx: EnvloMcpContext,
  config: SandboxBridgeConfig,
): Promise<SandboxBridgeHandle> {
  const fetchImpl = config.fetchImpl ?? fetch;

  let sessionToken = config.sessionToken || "";
  let inboxId = config.inboxId || "";
  let address = "";
  let websocketPath = "";

  if (!inboxId || !sessionToken) {
    if (config.autoProvision === false) {
      throw new Error(
        "ENVLO_SANDBOX_INBOX_ID + ENVLO_SANDBOX_SESSION_TOKEN required when auto-provision is disabled",
      );
    }
    const res = await fetchImpl(`${config.baseUrl}/v1/sandbox/inboxes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as ProvisionResponse;
    if (!res.ok || !body.ok || !body.inbox || !body.sessionToken) {
      throw new Error(
        `sandbox provision failed: ${body.error || body.message || res.status}`,
      );
    }
    inboxId = body.inbox.id;
    address = body.inbox.address;
    sessionToken = body.sessionToken;
    websocketPath = body.inbox.websocketPath;
  } else {
    const metaRes = await fetchImpl(
      `${config.baseUrl}/v1/sandbox/inboxes/${encodeURIComponent(inboxId)}`,
      { headers: { "X-Envlo-Session": sessionToken } },
    );
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as {
        inbox?: { address?: string };
      };
      address = meta.inbox?.address || address;
    }
    websocketPath = `/v1/sandbox/inboxes/${inboxId}/ws`;
  }

  const localAddress = address || `${inboxId}@sandbox.envlo.dev`;
  let localInbox = await ctx.state.getInboxByAddress(localAddress);
  if (!localInbox) {
    localInbox = await ctx.state.createInbox({ address: localAddress });
  }
  const localInboxId = localInbox.id;

  let lastSeq = 0;
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const WebSocketImpl = config.webSocket ?? WebSocket;
  const wsUrl = toWebSocketUrl(config.baseUrl, websocketPath);

  const connectWithToken = () => {
    if (closed) return;
    const url = `${wsUrl}?afterSeq=${lastSeq}&token=${encodeURIComponent(sessionToken)}`;
    ws = new WebSocketImpl(url);

    ws.addEventListener("open", () => {
      mcpLog("info", "sandbox.ws_open", { inboxId, localInboxId });
      ws?.send(JSON.stringify({ type: "ack", afterSeq: lastSeq }));
    });

    ws.addEventListener("message", (event) => {
      void (async () => {
        try {
          const data =
            typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);
          const parsed = JSON.parse(data) as SandboxWsEmail | SandboxWsHello;
          if (parsed.type === "hello") {
            lastSeq = Math.max(lastSeq, parsed.lastSeq);
            return;
          }
          if (parsed.type !== "email") return;
          lastSeq = Math.max(lastSeq, parsed.message.seq);
          await ingestInboundMime(ctx, localInboxId, parsed.message.rawMime);
          ws?.send(JSON.stringify({ type: "ack", afterSeq: lastSeq }));
          mcpLog("info", "sandbox.ingested", {
            inboxId: localInboxId,
            seq: parsed.message.seq,
            subject: parsed.message.subject,
          });
        } catch (err) {
          mcpLog("error", "sandbox.ingest_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    });

    ws.addEventListener("close", () => {
      if (closed) return;
      mcpLog("warn", "sandbox.ws_closed", { inboxId });
      reconnectTimer = setTimeout(connectWithToken, 1500);
    });

    ws.addEventListener("error", () => {
      mcpLog("warn", "sandbox.ws_error", { inboxId });
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    });
  };

  connectWithToken();

  return {
    kind: "sandbox",
    inboxId: localInboxId,
    address: localAddress,
    sessionToken,
    getLastSeq: () => lastSeq,
    async stop() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close(1000, "bridge stop");
      } catch {
        /* ignore */
      }
    },
  };
}

function toWebSocketUrl(baseUrl: string, path: string): string {
  const u = new URL(path, baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
