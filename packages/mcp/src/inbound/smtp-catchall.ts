import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { SMTPServer, type SMTPServerOptions, type SMTPServerSession } from "smtp-server";
import type { EnvloMcpContext } from "../context.js";
import { ingestInboundMime } from "../ingest.js";
import { mcpLog } from "../log.js";
import {
  DEFAULT_MAX_MIME_BYTES,
  MimeTooLargeError,
  assertMimeSize,
} from "./limits.js";
import { normalizeMailboxAddress, resolveInboxId } from "./resolve-inbox.js";
import type { InboundTransport } from "./types.js";

export type SmtpCatchAllOptions = {
  context: EnvloMcpContext;
  host?: string;
  port?: number;
  defaultInboxId?: string;
  autoCreateInbox?: boolean;
  /** Max DATA size in bytes (default 25 MiB). */
  maxMimeBytes?: number;
  resolveInboxId?: (rcptTo: string[]) => Promise<string | null>;
};

export type SmtpCatchAllListenInfo = {
  host: string;
  port: number;
};

/**
 * Local / CI SMTP catch-all — apps send to 127.0.0.1:1025 with no internet.
 */
export class SmtpCatchAllServer implements InboundTransport {
  readonly kind = "smtp" as const;
  private readonly options: SmtpCatchAllOptions;
  private readonly maxMimeBytes: number;
  private server: SMTPServer | null = null;
  private netServer: NetServer | null = null;
  private listenInfo: SmtpCatchAllListenInfo | null = null;
  ingestCount = 0;
  lastError: string | null = null;

  constructor(options: SmtpCatchAllOptions) {
    this.options = options;
    this.maxMimeBytes = options.maxMimeBytes ?? DEFAULT_MAX_MIME_BYTES;
  }

  get address(): SmtpCatchAllListenInfo | null {
    return this.listenInfo;
  }

  async start(): Promise<void> {
    if (this.server) return;

    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 1025;

    const smtpOptions: SMTPServerOptions = {
      disabledCommands: ["AUTH", "STARTTLS"],
      authOptional: true,
      hideSTARTTLS: true,
      allowInsecureAuth: true,
      banner: "Envlo local SMTP catch-all",
      logger: false,
      size: this.maxMimeBytes,
      onConnect: (session, callback) => {
        const remote = session.remoteAddress ?? "";
        if (
          host === "127.0.0.1" &&
          remote &&
          remote !== "127.0.0.1" &&
          remote !== "::1" &&
          remote !== "::ffff:127.0.0.1"
        ) {
          callback(new Error("Only local connections allowed"));
          return;
        }
        callback();
      },
      onRcptTo: (address, _session, callback) => {
        if (!address.address || !address.address.includes("@")) {
          callback(new Error("Invalid recipient"));
          return;
        }
        callback();
      },
      onData: (stream, session, callback) => {
        void this.handleData(stream, session)
          .then(() => callback())
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.lastError = message;
            mcpLog("error", "smtp.data_failed", { error: message });
            // smtp-server maps Error → 451; use 552-ish wording for SIZE.
            const smtpErr =
              err instanceof MimeTooLargeError
                ? Object.assign(new Error(message), {
                    responseCode: 552,
                  })
                : err instanceof Error
                  ? err
                  : new Error(message);
            callback(smtpErr);
          });
      },
    };

    const server = new SMTPServer(smtpOptions);
    this.server = server;

    const net = await new Promise<NetServer>((resolve, reject) => {
      server.once("error", reject);
      const listening = server.listen(port, host, () => {
        resolve(listening);
      });
    });
    this.netServer = net;
    const bound = net.address();
    const boundPort =
      typeof bound === "object" && bound ? bound.port : port;

    this.listenInfo = { host, port: boundPort };
    mcpLog("info", "smtp.listen", {
      host,
      port: boundPort,
      maxMimeBytes: this.maxMimeBytes,
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.listenInfo = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        try {
          this.netServer?.close();
        } catch {
          // ignore
        }
        resolve();
      }, 500);
      server.close(() => {
        clearTimeout(force);
        resolve();
      });
    });
    this.netServer = null;
    mcpLog("info", "smtp.stop", {});
  }

  private async handleData(
    stream: NodeJS.ReadableStream,
    session: SMTPServerSession,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.byteLength;
      if (total > this.maxMimeBytes) {
        // Drain remaining so smtp-server can finish the session.
        stream.resume?.();
        throw new MimeTooLargeError(total, this.maxMimeBytes);
      }
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks);
    if (raw.byteLength === 0) {
      throw new Error("Empty SMTP DATA");
    }
    assertMimeSize(raw.byteLength, this.maxMimeBytes);

    const rcptTo =
      session.envelope.rcptTo?.map((r) => r.address).filter(Boolean) ?? [];
    const inboxId = await this.resolveInbox(rcptTo);
    if (!inboxId) {
      throw new Error(
        `No Envlo inbox for recipients: ${rcptTo.map(normalizeMailboxAddress).join(", ") || "(none)"}`,
      );
    }

    const result = await ingestInboundMime(this.options.context, inboxId, raw);
    this.ingestCount += 1;
    mcpLog("info", "smtp.ingested", {
      inboxId,
      messageId: result.message.messageId,
      created: result.created,
      rcptTo,
      bytes: raw.byteLength,
    });
  }

  private async resolveInbox(rcptTo: string[]): Promise<string | null> {
    if (this.options.resolveInboxId) {
      return this.options.resolveInboxId(rcptTo);
    }
    return resolveInboxId(this.options.context, rcptTo, {
      ...(this.options.defaultInboxId !== undefined
        ? { defaultInboxId: this.options.defaultInboxId }
        : {}),
      ...(this.options.autoCreateInbox ? { autoCreate: true } : {}),
    });
  }
}

export async function isPortFree(
  host: string,
  port: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => {
      probe.close(() => resolve(true));
    });
  });
}
