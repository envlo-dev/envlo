import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { EnvloMcpContext } from "../context.js";
import type { ImapAdapter } from "../inbound/imap-adapter.js";
import {
  DEFAULT_MAX_MIME_BYTES,
  MimeTooLargeError,
  assertMimeSize,
  readMaxMimeBytes,
} from "../inbound/limits.js";
import { resolveInboxId } from "../inbound/resolve-inbox.js";
import type { SmtpCatchAllServer } from "../inbound/smtp-catchall.js";
import { parseInboundWebhookPayload } from "../inbound/webhook-payload.js";
import { ingestInboundMime } from "../ingest.js";
import { mcpLog } from "../log.js";
import { createEnvloMcpServer } from "../server.js";
import { ENVLO_MCP_VERSION } from "../banner.js";
import type { InboxBridgeEvent } from "../bridge/inbox-events.js";

export type InboundHealthStats = {
  smtp: { listening: boolean; host?: string; port?: number; ingestCount: number };
  imap: { running: boolean; lastUid: number | null };
};

export type HttpServerOptions = {
  context: EnvloMcpContext;
  port: number;
  host?: string;
  stateless?: boolean;
  webhookSecret?: string;
  webhookAutoCreateInbox?: boolean;
  defaultInboxId?: string;
  maxMimeBytes?: number;
  /** Optional live inbound stats for GET /health. */
  getInboundStats?: () => InboundHealthStats;
};

export type EnvloHttpServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) {
      throw new MimeTooLargeError(total, maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Streamable HTTP + health + SSE + inbound webhook (SES/Resend/raw).
 */
export async function startHttpServer(
  options: HttpServerOptions,
): Promise<EnvloHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const stateless = options.stateless ?? true;
  const maxMimeBytes =
    options.maxMimeBytes ?? readMaxMimeBytes() ?? DEFAULT_MAX_MIME_BYTES;

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);

      if (req.method === "GET" && url.pathname === "/health") {
        const inbound = options.getInboundStats?.();
        json(res, 200, {
          ok: true,
          name: "@envlo/mcp",
          version: ENVLO_MCP_VERSION,
          ...(inbound ? { inbound } : {}),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        handleSseEvents(options.context, req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/webhooks/inbound") {
        await handleInboundWebhook(options, req, res, url, maxMimeBytes);
        return;
      }

      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
        await handleMcp(options.context, req, res, stateless);
        return;
      }

      json(res, 404, { error: "not_found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mcpLog("error", "http.request_error", { error: message });
      if (!res.headersSent) {
        const status = err instanceof MimeTooLargeError ? 413 : 500;
        json(res, status, { error: message });
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, host, () => resolve());
  });

  const address = httpServer.address();
  const port =
    typeof address === "object" && address ? address.port : options.port;

  mcpLog("info", "http.listen", { host, port });

  return {
    port,
    host,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function buildInboundHealthStats(input: {
  smtp?: SmtpCatchAllServer | null;
  imap?: ImapAdapter | null;
}): InboundHealthStats {
  return {
    smtp: {
      listening: Boolean(input.smtp?.address),
      ...(input.smtp?.address
        ? { host: input.smtp.address.host, port: input.smtp.address.port }
        : {}),
      ingestCount: input.smtp?.ingestCount ?? 0,
    },
    imap: {
      running: Boolean(input.imap),
      lastUid: input.imap ? input.imap.getLastUid() : null,
    },
  };
}

function handleSseEvents(
  ctx: EnvloMcpContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const writeEvent = (event: InboxBridgeEvent) => {
    const type = event.type;
    const payload = JSON.stringify(event);
    res.write(`event: ${type}\ndata: ${payload}\n\n`);
  };

  const unsubscribe = ctx.inboxBus.subscribe(writeEvent);
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
}

async function handleMcp(
  ctx: EnvloMcpContext,
  req: IncomingMessage,
  res: ServerResponse,
  stateless: boolean,
): Promise<void> {
  const server = createEnvloMcpServer({ context: ctx });
  const transport = stateless
    ? new StreamableHTTPServerTransport()
    : new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

async function handleInboundWebhook(
  options: HttpServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  maxMimeBytes: number,
): Promise<void> {
  const ctx = options.context;
  const expectedSecret =
    options.webhookSecret ?? process.env.ENVLO_WEBHOOK_SECRET;
  if (expectedSecret) {
    const headerSecret =
      (req.headers["x-envlo-webhook-secret"] as string | undefined) ??
      bearerToken(req.headers.authorization);
    if (headerSecret !== expectedSecret) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
  }

  const raw = await readBody(req, maxMimeBytes);
  const contentType = req.headers["content-type"] ?? "";
  const parsed = parseInboundWebhookPayload(raw, contentType);

  if (parsed.snsSubscribeUrl) {
    mcpLog("info", "webhook.sns_subscribe", {
      url: parsed.snsSubscribeUrl,
    });
    // Auto-confirm when possible so SES inbound Just Works.
    try {
      const confirm = await fetch(parsed.snsSubscribeUrl);
      json(res, 200, {
        ok: true,
        sns: "subscription_confirmation",
        confirmed: confirm.ok,
        subscribeUrl: parsed.snsSubscribeUrl,
      });
    } catch (err) {
      json(res, 200, {
        ok: true,
        sns: "subscription_confirmation",
        confirmed: false,
        subscribeUrl: parsed.snsSubscribeUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  let inboxId =
    url.searchParams.get("inboxId") ??
    (req.headers["x-envlo-inbox-id"] as string | undefined) ??
    parsed.inboxId ??
    undefined;

  const addressHint =
    url.searchParams.get("address") ??
    url.searchParams.get("inboxAddress") ??
    (req.headers["x-envlo-inbox-address"] as string | undefined) ??
    parsed.address;

  if (!parsed.mime) {
    json(res, 400, {
      error: "no MIME payload found (expected raw RFC822 or known provider JSON)",
      provider: parsed.provider,
    });
    return;
  }

  const mimeBytes =
    typeof parsed.mime === "string"
      ? Buffer.byteLength(parsed.mime)
      : parsed.mime.byteLength;
  assertMimeSize(mimeBytes, maxMimeBytes);

  if (!inboxId) {
    const candidates = [addressHint].filter((v): v is string => Boolean(v));
    inboxId =
      (await resolveInboxId(ctx, candidates, {
        ...(options.defaultInboxId !== undefined
          ? { defaultInboxId: options.defaultInboxId }
          : {}),
        ...(options.webhookAutoCreateInbox ||
        process.env.ENVLO_WEBHOOK_AUTO_CREATE_INBOX === "1" ||
        process.env.ENVLO_WEBHOOK_AUTO_CREATE_INBOX === "true"
          ? { autoCreate: true }
          : {}),
      })) ?? undefined;
  }

  if (!inboxId) {
    json(res, 400, {
      error:
        "inboxId (or address / x-envlo-inbox-address) required to route inbound MIME",
    });
    return;
  }

  const inbox = await ctx.state.getInbox(inboxId);
  if (!inbox) {
    json(res, 404, { error: `inbox not found: ${inboxId}` });
    return;
  }

  const result = await ingestInboundMime(ctx, inboxId, parsed.mime);
  json(res, 200, {
    ok: true,
    threadId: result.thread.id,
    messageId: result.message.messageId,
    created: result.created,
    inboxId,
    provider: parsed.provider,
  });
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function json(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
