import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { EnvloMcpContext } from "../context.js";
import { ingestInboundMime } from "../ingest.js";
import { mcpLog } from "../log.js";
import { createEnvloMcpServer } from "../server.js";
import { ENVLO_MCP_VERSION } from "../banner.js";
import type { InboxBridgeEvent } from "../bridge/inbox-events.js";

export type HttpServerOptions = {
  context: EnvloMcpContext;
  port: number;
  host?: string;
  /**
   * When true (default), create a fresh MCP server+transport per /mcp request
   * (stateless — ideal for Playwright).
   */
  stateless?: boolean;
};

export type EnvloHttpServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Streamable HTTP transport + health + SSE event mirror + inbound webhook stub.
 */
export async function startHttpServer(
  options: HttpServerOptions,
): Promise<EnvloHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const stateless = options.stateless ?? true;

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);

      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, {
          ok: true,
          name: "@envlo/mcp",
          version: ENVLO_MCP_VERSION,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        handleSseEvents(options.context, req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/webhooks/inbound") {
        await handleInboundWebhook(options.context, req, res, url);
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
        json(res, 500, { error: message });
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

/**
 * SSE mirror of InboxEventBus — hosts / Playwright can subscribe without
 * blocking on wait_for_email. Ticket mentions WS; SSE needs no extra deps.
 */
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
  // Stateless: omit sessionIdGenerator. Stateful: generate UUIDs.
  const transport = stateless
    ? new StreamableHTTPServerTransport()
    : new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

async function handleInboundWebhook(
  ctx: EnvloMcpContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const inboxId =
    url.searchParams.get("inboxId") ??
    (req.headers["x-envlo-inbox-id"] as string | undefined);
  if (!inboxId) {
    json(res, 400, { error: "inboxId query/header required" });
    return;
  }
  const inbox = await ctx.state.getInbox(inboxId);
  if (!inbox) {
    json(res, 404, { error: `inbox not found: ${inboxId}` });
    return;
  }

  const raw = await readBody(req);
  const contentType = req.headers["content-type"] ?? "";
  let mimeInput: string | Uint8Array = raw;

  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(raw.toString("utf8")) as {
      raw?: string;
      eml?: string;
    };
    mimeInput = parsed.raw ?? parsed.eml ?? raw.toString("utf8");
  }

  const result = await ingestInboundMime(ctx, inboxId, mimeInput);
  json(res, 200, {
    ok: true,
    threadId: result.thread.id,
    messageId: result.message.messageId,
    created: result.created,
  });
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
