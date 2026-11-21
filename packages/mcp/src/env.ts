import {
  ConsoleDryRunSender,
  MagicLinkApprovalChannel,
  ResendSender,
  SlackApprovalChannel,
  WebhookApprovalChannel,
  type ApprovalChannel,
  type ApprovalController,
  type OutboundSender,
} from "@envlo/core";
import { mcpLog } from "./log.js";

export type EnvloRuntimeConfig = {
  stateDriver: "sqlite" | "memory";
  statePath: string | undefined;
  httpHost: string;
  senderKind: string;
  fromOverride: string | undefined;
  /** Path for durable thread meta (risk / OTP). */
  threadMetaPath: string | undefined;
};

export function readEnvloRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnvloRuntimeConfig {
  return {
    stateDriver: env.ENVLO_STATE === "memory" ? "memory" : "sqlite",
    statePath: env.ENVLO_STATE_PATH || undefined,
    httpHost: env.ENVLO_HTTP_HOST ?? "127.0.0.1",
    senderKind: (env.ENVLO_SENDER ?? "console").toLowerCase(),
    fromOverride: env.ENVLO_FROM || undefined,
    threadMetaPath: env.ENVLO_THREAD_META_PATH || undefined,
  };
}

/**
 * Build BYO sender from env (`ENVLO_SENDER=console|resend`).
 * SES/SMTP require injected clients — fall back to console with a warning.
 */
export function createSenderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OutboundSender {
  const kind = (env.ENVLO_SENDER ?? "console").toLowerCase();
  if (kind === "console" || kind === "dry-run" || kind === "dryrun") {
    return new ConsoleDryRunSender();
  }
  if (kind === "resend") {
    const apiKey = env.RESEND_API_KEY ?? env.ENVLO_RESEND_API_KEY;
    if (!apiKey) {
      mcpLog(
        "warn",
        "ENVLO_SENDER=resend but RESEND_API_KEY missing; using console",
        {},
      );
      return new ConsoleDryRunSender();
    }
    return new ResendSender({ apiKey });
  }
  if (kind === "ses" || kind === "smtp") {
    mcpLog(
      "warn",
      `ENVLO_SENDER=${kind} requires an injected client; using console dry-run`,
      {},
    );
    return new ConsoleDryRunSender();
  }
  mcpLog("warn", `Unknown ENVLO_SENDER=${kind}; using console`, {});
  return new ConsoleDryRunSender();
}

/**
 * Optional approval channels from env:
 * - ENVLO_WEBHOOK_URL → WebhookApprovalChannel
 * - ENVLO_SLACK_WEBHOOK → SlackApprovalChannel
 * - ENVLO_APPROVAL_SUPERVISOR + ENVLO_APPROVAL_BASE_URL → MagicLinkApprovalChannel
 */
export function createApprovalChannelsFromEnv(
  controller: ApprovalController,
  sender: OutboundSender,
  env: NodeJS.ProcessEnv = process.env,
): ApprovalChannel[] {
  const channels: ApprovalChannel[] = [];

  if (env.ENVLO_WEBHOOK_URL) {
    channels.push(
      new WebhookApprovalChannel({
        url: env.ENVLO_WEBHOOK_URL,
        ...(env.ENVLO_WEBHOOK_AUTH_HEADER
          ? {
              headers: {
                Authorization: env.ENVLO_WEBHOOK_AUTH_HEADER,
              },
            }
          : {}),
      }),
    );
  }

  if (env.ENVLO_SLACK_WEBHOOK) {
    channels.push(
      new SlackApprovalChannel({
        webhookUrl: env.ENVLO_SLACK_WEBHOOK,
        ...(env.ENVLO_SLACK_CHANNEL
          ? { channel: env.ENVLO_SLACK_CHANNEL }
          : {}),
      }),
    );
  }

  const supervisor = env.ENVLO_APPROVAL_SUPERVISOR;
  const baseUrl = env.ENVLO_APPROVAL_BASE_URL;
  if (supervisor && baseUrl) {
    const mode = env.ENVLO_APPROVAL_MODE === "local" ? "local" : "cloud";
    const from = env.ENVLO_FROM?.trim();
    if (mode === "local" && !from) {
      mcpLog(
        "warn",
        "ENVLO_APPROVAL_MODE=local requires ENVLO_FROM; skipping magic-link channel",
        {},
      );
    } else {
      channels.push(
        new MagicLinkApprovalChannel({
          controller,
          sender,
          supervisorEmail: supervisor,
          baseUrl,
          mode,
          ...(mode === "local" && from ? { from } : {}),
        }),
      );
    }
  }

  return channels;
}

/** Cursor / Claude Code MCP config snippet for docs / --help. */
export const CURSOR_MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "envlo": {
      "command": "npx",
      "args": ["@envlo/mcp"]
    }
  }
}`;
