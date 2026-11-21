import type { EnvloMcpContext } from "../context.js";
import { mcpLog } from "../log.js";
import { readMaxMimeBytes } from "./limits.js";
import {
  IMAP_PRESETS,
  ImapAdapter,
  type ImapAdapterOptions,
  type ImapFirstRunMode,
  type ImapPresetName,
} from "./imap-adapter.js";
import { SmtpCatchAllServer } from "./smtp-catchall.js";
import type { InboundTransportHandle } from "./types.js";

export type LocalInboundConfig = {
  smtp: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpAutoCreateInbox: boolean;
  maxMimeBytes: number;
  defaultInboxId: string | undefined;
  /** When true (default under --local), also start HTTP for webhook. */
  http: boolean;
  httpPort: number;
  imap: ImapConnectionConfig | null;
};

export type ImapConnectionConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string | undefined;
  accessToken: string | undefined;
  mailbox: string;
  inboxId: string | undefined;
  autoCreateInbox: boolean;
  firstRunMode: ImapFirstRunMode;
  tlsRejectUnauthorized: boolean;
};

export type LocalInboundRuntime = {
  handles: InboundTransportHandle[];
  smtp: SmtpCatchAllServer | null;
  imap: ImapAdapter | null;
  stop: () => Promise<void>;
};

function parseFirstRunMode(raw: string | undefined): ImapFirstRunMode {
  const v = (raw ?? "skip").toLowerCase();
  if (v === "all" || v === "unseen" || v === "skip") return v;
  return "skip";
}

/**
 * Read IMAP + SMTP inbound config from env.
 */
export function readLocalInboundConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: {
    smtpPort?: number;
    disableSmtp?: boolean;
    httpPort?: number;
    disableHttp?: boolean;
  } = {},
): LocalInboundConfig {
  const presetName = (env.ENVLO_IMAP_PRESET ?? "").toLowerCase() as
    | ImapPresetName
    | "";
  const preset =
    presetName && presetName in IMAP_PRESETS
      ? IMAP_PRESETS[presetName]
      : null;

  const host = env.ENVLO_IMAP_HOST || preset?.host || "";
  const user = env.ENVLO_IMAP_USER || env.ENVLO_IMAP_USERNAME || "";
  const pass = env.ENVLO_IMAP_PASS || env.ENVLO_IMAP_PASSWORD || undefined;
  const accessToken =
    env.ENVLO_IMAP_ACCESS_TOKEN || env.ENVLO_IMAP_OAUTH_TOKEN || undefined;

  let imap: ImapConnectionConfig | null = null;
  if (host && user && (pass || accessToken)) {
    const port = Number.parseInt(
      env.ENVLO_IMAP_PORT || String(preset?.port ?? 993),
      10,
    );
    const secure =
      env.ENVLO_IMAP_SECURE === "0" || env.ENVLO_IMAP_SECURE === "false"
        ? false
        : (preset?.secure ?? true);
    imap = {
      host,
      port: Number.isFinite(port) ? port : 993,
      secure,
      user,
      pass,
      accessToken,
      mailbox: env.ENVLO_IMAP_MAILBOX || "INBOX",
      inboxId: env.ENVLO_IMAP_INBOX_ID || undefined,
      autoCreateInbox:
        env.ENVLO_IMAP_AUTO_CREATE_INBOX === "1" ||
        env.ENVLO_IMAP_AUTO_CREATE_INBOX === "true",
      firstRunMode: parseFirstRunMode(env.ENVLO_IMAP_FIRST_RUN),
      tlsRejectUnauthorized: !(
        env.ENVLO_IMAP_TLS_REJECT_UNAUTHORIZED === "0" ||
        env.ENVLO_IMAP_TLS_REJECT_UNAUTHORIZED === "false"
      ),
    };
  }

  const smtpPortRaw =
    overrides.smtpPort ?? Number.parseInt(env.ENVLO_SMTP_PORT || "1025", 10);
  const smtpPort = Number.isFinite(smtpPortRaw) ? smtpPortRaw : 1025;

  const httpPortRaw =
    overrides.httpPort ?? Number.parseInt(env.ENVLO_HTTP_PORT || "8787", 10);
  const httpPort = Number.isFinite(httpPortRaw) ? httpPortRaw : 8787;

  return {
    smtp: overrides.disableSmtp ? false : env.ENVLO_SMTP_DISABLE !== "1",
    smtpHost: env.ENVLO_SMTP_HOST || "127.0.0.1",
    smtpPort,
    smtpAutoCreateInbox: (() => {
      const v = env.ENVLO_SMTP_AUTO_CREATE_INBOX;
      if (v === undefined) return true;
      return v === "1" || v === "true";
    })(),
    maxMimeBytes: readMaxMimeBytes(env),
    defaultInboxId: env.ENVLO_DEFAULT_INBOX_ID || undefined,
    http: overrides.disableHttp
      ? false
      : env.ENVLO_LOCAL_HTTP === "0" || env.ENVLO_LOCAL_HTTP === "false"
        ? false
        : true,
    httpPort,
    imap,
  };
}

/**
 * Start --local inbound transports (SMTP catch-all + optional IMAP IDLE).
 */
export async function startLocalInbound(
  ctx: EnvloMcpContext,
  config: LocalInboundConfig,
): Promise<LocalInboundRuntime> {
  const handles: InboundTransportHandle[] = [];
  let smtp: SmtpCatchAllServer | null = null;
  let imap: ImapAdapter | null = null;

  if (config.smtp) {
    smtp = new SmtpCatchAllServer({
      context: ctx,
      host: config.smtpHost,
      port: config.smtpPort,
      autoCreateInbox: config.smtpAutoCreateInbox,
      maxMimeBytes: config.maxMimeBytes,
      ...(config.defaultInboxId !== undefined
        ? { defaultInboxId: config.defaultInboxId }
        : {}),
    });
    await smtp.start();
    handles.push({
      kind: "smtp",
      stop: () => smtp!.stop(),
    });
    mcpLog("info", "local.smtp_ready", {
      host: smtp.address?.host,
      port: smtp.address?.port,
    });
  }

  if (config.imap) {
    const auth = config.imap.accessToken
      ? { user: config.imap.user, accessToken: config.imap.accessToken }
      : { user: config.imap.user, pass: config.imap.pass! };
    const imapOpts: ImapAdapterOptions = {
      context: ctx,
      host: config.imap.host,
      port: config.imap.port,
      secure: config.imap.secure,
      auth,
      mailbox: config.imap.mailbox,
      autoCreateInbox: config.imap.autoCreateInbox,
      firstRunMode: config.imap.firstRunMode,
      tlsRejectUnauthorized: config.imap.tlsRejectUnauthorized,
      ...(config.imap.inboxId !== undefined
        ? { inboxId: config.imap.inboxId }
        : {}),
      ...(config.defaultInboxId !== undefined
        ? { defaultInboxId: config.defaultInboxId }
        : {}),
    };
    imap = new ImapAdapter(imapOpts);
    await imap.start();
    handles.push({
      kind: "imap",
      stop: () => imap!.stop(),
    });
    mcpLog("info", "local.imap_ready", {
      host: config.imap.host,
      mailbox: config.imap.mailbox,
      firstRunMode: config.imap.firstRunMode,
    });
  } else {
    mcpLog("info", "local.imap_skipped", {
      reason:
        "Set ENVLO_IMAP_HOST + ENVLO_IMAP_USER + (ENVLO_IMAP_PASS or ENVLO_IMAP_ACCESS_TOKEN)",
    });
  }

  const stop = async () => {
    for (const handle of [...handles].reverse()) {
      try {
        await handle.stop();
      } catch (err) {
        mcpLog("warn", "local.stop_error", {
          kind: handle.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  return { handles, smtp, imap, stop };
}
