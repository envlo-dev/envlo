#!/usr/bin/env node
/**
 * `npx @envlo/mcp` / `envlo-mcp` entrypoint.
 *
 * Default: stdio MCP transport (Cursor, Claude Code).
 * `--http [port]` : Streamable HTTP (Playwright / remote).
 * `--local` : stub for upcoming IMAP/SMTP inbound (#13).
 * `--help` : usage on stderr (stdout stays clean for JSON-RPC).
 */
import { createMcpBanner } from "./banner.js";
import { createEnvloMcpContext } from "./context.js";
import { CURSOR_MCP_CONFIG_SNIPPET, readEnvloRuntimeConfig } from "./env.js";
import { mcpLog } from "./log.js";
import { listCoreTools } from "./tools-meta.js";
import { startHttpServer } from "./transports/http.js";
import { runStdioServer } from "./transports/stdio.js";

function printHelp(): void {
  const lines = [
    createMcpBanner(),
    "",
    "Usage:",
    "  envlo-mcp                 Start MCP over stdio (default)",
    "  envlo-mcp --http [port]   Streamable HTTP (default port 8787)",
    "  envlo-mcp --local         Local inbound stub (IMAP/SMTP — see #13)",
    "  envlo-mcp --help          Show this help",
    "",
    "Env:",
    "  ENVLO_STATE_PATH          SQLite state db path (default ~/.envlo/state.db)",
    "  ENVLO_STATE=memory        Use in-memory state (tests)",
    "  ENVLO_THREAD_META_PATH    Durable risk/OTP meta JSON",
    "  ENVLO_HTTP_HOST           HTTP bind host (default 127.0.0.1)",
    "  ENVLO_SENDER=console|resend  Outbound transport (default console)",
    "  ENVLO_FROM                From override / local magic-link From",
    "  RESEND_API_KEY            Required when ENVLO_SENDER=resend",
    "  ENVLO_WEBHOOK_URL         Approval webhook channel",
    "  ENVLO_SLACK_WEBHOOK       Slack incoming webhook channel",
    "  ENVLO_APPROVAL_SUPERVISOR + ENVLO_APPROVAL_BASE_URL  Magic-link channel",
    "  ENVLO_APPROVAL_MODE=local Require ENVLO_FROM for magic-link From",
    "",
    "Cursor / Claude Code (mcp.json):",
    CURSOR_MCP_CONFIG_SNIPPET,
    "",
    `Tools: ${listCoreTools().join(", ")}`,
    "(manage_draft_approval is intentionally not exposed)",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function parseArgs(argv: string[]): {
  help: boolean;
  http: boolean;
  local: boolean;
  port: number;
} {
  const help = argv.includes("--help") || argv.includes("-h");
  const local = argv.includes("--local");
  const httpIdx = argv.findIndex((a) => a === "--http");
  const http = httpIdx >= 0;
  let port = 8787;
  if (http && argv[httpIdx + 1] && !argv[httpIdx + 1]!.startsWith("-")) {
    port = Number.parseInt(argv[httpIdx + 1]!, 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid --http port: ${argv[httpIdx + 1]}`);
    }
  }
  return { help, http, local, port };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.local) {
    mcpLog("warn", "cli.local_stub", {
      message:
        "--local enables the local-dev posture (BYO sender / magic-link mode).",
      inbound:
        "IMAP/SMTP inbound transports land in #13 — use /webhooks/inbound or ingestInboundMime until then.",
    });
    if (!process.env.ENVLO_APPROVAL_MODE) {
      process.env.ENVLO_APPROVAL_MODE = "local";
    }
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

  const shutdown = async () => {
    await ctx.close();
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  if (args.http) {
    const httpServer = await startHttpServer({
      context: ctx,
      port: args.port,
      host: runtime.httpHost,
    });
    process.stderr.write(
      `${createMcpBanner()}\nStreamable HTTP listening on http://${httpServer.host}:${httpServer.port}/mcp\nSSE events: http://${httpServer.host}:${httpServer.port}/events\n`,
    );
    return;
  }

  // stdio: never write banner to stdout
  process.stderr.write(`${createMcpBanner()} (stdio)\n`);
  await runStdioServer(ctx);
}

main().catch((err) => {
  process.stderr.write(
    `envlo-mcp failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
