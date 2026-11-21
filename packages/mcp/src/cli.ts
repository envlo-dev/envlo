#!/usr/bin/env node
/**
 * `npx @envlo/mcp` / `envlo-mcp` entrypoint.
 *
 * Default: stdio MCP transport (Cursor, Claude Code).
 * `--http [port]` : Streamable HTTP (Playwright / remote / webhooks).
 * `--local` : zero-tunnel inbound — SMTP :1025 + optional IMAP IDLE + HTTP webhook.
 * `--smtp-port [n]` / `--no-smtp` / `--no-http` : local inbound toggles.
 */
import { createMcpBanner } from "./banner.js";
import { parseArgs } from "./cli-args.js";
import { createEnvloMcpContext } from "./context.js";
import { CURSOR_MCP_CONFIG_SNIPPET, readEnvloRuntimeConfig } from "./env.js";
import {
  readLocalInboundConfig,
  startLocalInbound,
} from "./inbound/local-runtime.js";
import { listCoreTools } from "./tools-meta.js";
import {
  buildInboundHealthStats,
  startHttpServer,
} from "./transports/http.js";
import { runStdioServer } from "./transports/stdio.js";

function printHelp(): void {
  const lines = [
    createMcpBanner(),
    "",
    "Usage:",
    "  envlo-mcp                      Start MCP over stdio (default)",
    "  envlo-mcp --http [port]        Streamable HTTP (default port 8787)",
    "  envlo-mcp --local              SMTP :1025 + IMAP IDLE + HTTP webhook",
    "  envlo-mcp --local --smtp-port 1025",
    "  envlo-mcp --local --no-http    Inbound without webhook listener",
    "  envlo-mcp --help               Show this help",
    "",
    "Inbound transports (Section 4.1 / ticket #13):",
    "  1. IMAP IDLE pull  — ENVLO_IMAP_* (works behind NAT, no tunnel)",
    "  2. Local SMTP      — 127.0.0.1:1025 catch-all for local/CI apps",
    "  3. Webhook         — POST /webhooks/inbound (SES SNS / Resend / raw MIME)",
    "",
    "Env (inbound):",
    "  ENVLO_IMAP_PRESET=gmail|outlook",
    "  ENVLO_IMAP_HOST / PORT / USER / PASS | ACCESS_TOKEN (XOAUTH2)",
    "  ENVLO_IMAP_FIRST_RUN=skip|unseen|all   (default skip — no mailbox flood)",
    "  ENVLO_IMAP_TLS_REJECT_UNAUTHORIZED=0   (corporate MITM proxies)",
    "  ENVLO_SMTP_PORT / ENVLO_SMTP_DISABLE=1 / ENVLO_LOCAL_HTTP=0",
    "  ENVLO_MAX_MIME_BYTES           (default 26214400)",
    "  ENVLO_DEFAULT_INBOX_ID / ENVLO_WEBHOOK_SECRET",
    "",
    "Cursor / Claude Code (mcp.json):",
    CURSOR_MCP_CONFIG_SNIPPET,
    "",
    `Tools: ${listCoreTools().join(", ")}`,
    "(manage_draft_approval is intentionally not exposed)",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.local && !process.env.ENVLO_APPROVAL_MODE) {
    process.env.ENVLO_APPROVAL_MODE = "local";
  }

  const runtime = readEnvloRuntimeConfig();
  const ctx = await createEnvloMcpContext({
    stateDriver: runtime.stateDriver,
    ...(runtime.statePath !== undefined ? { statePath: runtime.statePath } : {}),
    ...(runtime.fromOverride !== undefined
      ? { fromOverride: runtime.fromOverride }
      : {}),
    ...(runtime.threadMetaPath !== undefined
      ? { threadMetaPath: runtime.threadMetaPath }
      : {}),
    bootstrapSenderFromEnv: true,
    bootstrapApprovalChannelsFromEnv: true,
  });

  let stopInbound: (() => Promise<void>) | null = null;
  let inboundRuntime: Awaited<ReturnType<typeof startLocalInbound>> | null =
    null;

  if (args.local) {
    const inboundConfig = readLocalInboundConfig(process.env, {
      ...(args.smtpPort !== undefined ? { smtpPort: args.smtpPort } : {}),
      ...(args.disableSmtp ? { disableSmtp: true } : {}),
      ...(args.http ? { httpPort: args.httpPort } : {}),
      ...(args.disableHttp ? { disableHttp: true } : {}),
    });
    // Explicit --http wins over ENVLO_LOCAL_HTTP=0.
    if (args.http) {
      inboundConfig.http = true;
      inboundConfig.httpPort = args.httpPort;
    }

    inboundRuntime = await startLocalInbound(ctx, inboundConfig);
    stopInbound = inboundRuntime.stop;
    const smtpInfo = inboundRuntime.smtp?.address;
    process.stderr.write(
      `${createMcpBanner()}\n--local inbound ready` +
        (smtpInfo
          ? ` | SMTP ${smtpInfo.host}:${smtpInfo.port}`
          : " | SMTP off") +
        (inboundRuntime.imap ? " | IMAP IDLE on" : " | IMAP off") +
        "\n",
    );

    if (inboundConfig.http) {
      const httpServer = await startHttpServer({
        context: ctx,
        port: inboundConfig.httpPort,
        host: runtime.httpHost,
        ...(process.env.ENVLO_WEBHOOK_SECRET
          ? { webhookSecret: process.env.ENVLO_WEBHOOK_SECRET }
          : {}),
        ...(process.env.ENVLO_DEFAULT_INBOX_ID
          ? { defaultInboxId: process.env.ENVLO_DEFAULT_INBOX_ID }
          : {}),
        maxMimeBytes: inboundConfig.maxMimeBytes,
        webhookAutoCreateInbox:
          process.env.ENVLO_WEBHOOK_AUTO_CREATE_INBOX === "1" ||
          process.env.ENVLO_WEBHOOK_AUTO_CREATE_INBOX === "true",
        getInboundStats: () =>
          buildInboundHealthStats({
            smtp: inboundRuntime?.smtp ?? null,
            imap: inboundRuntime?.imap ?? null,
          }),
      });
      process.stderr.write(
        `Webhook/MCP HTTP http://${httpServer.host}:${httpServer.port}/mcp\n` +
          `POST http://${httpServer.host}:${httpServer.port}/webhooks/inbound\n`,
      );

      const shutdown = async () => {
        if (stopInbound) await stopInbound();
        await httpServer.close();
        await ctx.close();
      };
      process.on("SIGINT", () => {
        void shutdown().finally(() => process.exit(0));
      });
      process.on("SIGTERM", () => {
        void shutdown().finally(() => process.exit(0));
      });
      // Keep alive for HTTP (+ inbound). Stdio not started alongside local HTTP.
      return;
    }
  }

  const shutdown = async () => {
    if (stopInbound) await stopInbound();
    await ctx.close();
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  if (args.http && !args.local) {
    const httpServer = await startHttpServer({
      context: ctx,
      port: args.httpPort,
      host: runtime.httpHost,
      ...(process.env.ENVLO_WEBHOOK_SECRET
        ? { webhookSecret: process.env.ENVLO_WEBHOOK_SECRET }
        : {}),
      ...(process.env.ENVLO_DEFAULT_INBOX_ID
        ? { defaultInboxId: process.env.ENVLO_DEFAULT_INBOX_ID }
        : {}),
      webhookAutoCreateInbox:
        process.env.ENVLO_WEBHOOK_AUTO_CREATE_INBOX === "1" ||
        process.env.ENVLO_WEBHOOK_AUTO_CREATE_INBOX === "true",
    });
    process.stderr.write(
      `${createMcpBanner()}\nStreamable HTTP listening on http://${httpServer.host}:${httpServer.port}/mcp\nSSE events: http://${httpServer.host}:${httpServer.port}/events\nWebhook: POST http://${httpServer.host}:${httpServer.port}/webhooks/inbound\n`,
    );
    return;
  }

  process.stderr.write(`${createMcpBanner()} (stdio)\n`);
  await runStdioServer(ctx);
  await shutdown();
}

main().catch((err) => {
  process.stderr.write(
    `envlo-mcp failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
