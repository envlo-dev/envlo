import { ImapFlow } from "imapflow";
import type { EnvloMcpContext } from "../context.js";
import { ingestInboundMime } from "../ingest.js";
import { mcpLog } from "../log.js";
import { resolveInboxId } from "./resolve-inbox.js";
import type { InboundTransport } from "./types.js";
import {
  FileImapUidCursorStore,
  type ImapUidCursorStore,
} from "./uid-cursor.js";

/** Minimal surface we need from imapflow (injectable for tests). */
export type ImapFetchMessage = {
  uid: number;
  source?: Buffer | false | null;
  envelope?: {
    to?: Array<{ address?: string | null; name?: string | null }>;
    subject?: string | null;
  } | null;
};

export type ImapMailboxLock = {
  path: string;
  release(): void;
};

export type ImapMailboxInfo = {
  uidNext?: number;
  exists?: number;
};

export type ImapFlowClient = {
  usable: boolean;
  mailbox?: ImapMailboxInfo | false;
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  getMailboxLock(path: string): Promise<ImapMailboxLock>;
  fetch(
    range: string,
    query: { uid?: boolean; source?: boolean; envelope?: boolean },
    options?: { uid?: boolean },
  ): AsyncIterable<ImapFetchMessage>;
  messageFlagsAdd(
    range: string | number,
    flags: string[],
    options?: { uid?: boolean },
  ): Promise<boolean | undefined>;
  search?(
    query: Record<string, unknown>,
    options?: { uid?: boolean },
  ): Promise<number[]>;
  idle(options?: { whenFree?: boolean }): Promise<boolean | undefined>;
  on(event: "exists", listener: (count: number) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: () => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
};

export type ImapAdapterAuth = {
  user: string;
  /** App password / regular password. Omit when using accessToken (XOAUTH2). */
  pass?: string;
  /** OAuth2 access token (M365 / Gmail XOAUTH2). */
  accessToken?: string;
};

/** First connect with no cursor: skip history (default), unseen only, or all. */
export type ImapFirstRunMode = "skip" | "unseen" | "all";

export type ImapAdapterOptions = {
  context: EnvloMcpContext;
  host: string;
  port?: number;
  secure?: boolean;
  auth: ImapAdapterAuth;
  mailbox?: string;
  inboxId?: string;
  defaultInboxId?: string;
  autoCreateInbox?: boolean;
  markSeen?: boolean;
  pollIntervalMs?: number;
  maxReconnectMs?: number;
  /**
   * Behavior when no UID cursor exists yet.
   * - `skip` (default): seed cursor at uidNext-1, do not backfill
   * - `unseen`: fetch UNSEEN only once, then continue from max UID
   * - `all`: fetch `1:*` (legacy / explicit backfill)
   */
  firstRunMode?: ImapFirstRunMode;
  /** TLS rejectUnauthorized (default true). Set false for corporate MITM proxies. */
  tlsRejectUnauthorized?: boolean;
  cursorStore?: ImapUidCursorStore;
  createClient?: () => ImapFlowClient;
};

/**
 * Pull-mode inbound via IMAP IDLE (Gmail App Password / M365 / any IMAP).
 * Connects outbound through NAT — no public ports or tunnels.
 */
export class ImapAdapter implements InboundTransport {
  readonly kind = "imap" as const;
  private readonly options: ImapAdapterOptions;
  private readonly cursorStore: ImapUidCursorStore;
  private client: ImapFlowClient | null = null;
  private running = false;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private lastUid = 0;
  private reconnectAttempt = 0;
  private wakeIdle: (() => void) | null = null;
  private firstRunDone = false;
  /** Exposed for tests / /health. */
  readonly ingestedUids: number[] = [];

  constructor(options: ImapAdapterOptions) {
    this.options = options;
    this.cursorStore = options.cursorStore ?? new FileImapUidCursorStore();
  }

  getLastUid(): number {
    return this.lastUid;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.options.auth.pass && !this.options.auth.accessToken) {
      throw new Error(
        "ImapAdapter requires auth.pass or auth.accessToken (XOAUTH2)",
      );
    }
    this.running = true;
    this.stopping = false;
    const saved = this.cursorStore.get({
      host: this.options.host,
      user: this.options.auth.user,
      mailbox: this.options.mailbox ?? "INBOX",
    });
    this.lastUid = saved?.lastUid ?? 0;
    this.firstRunDone = this.lastUid > 0;
    this.loopPromise = this.runLoop();
    mcpLog("info", "imap.start", {
      host: this.options.host,
      mailbox: this.options.mailbox ?? "INBOX",
      lastUid: this.lastUid,
      firstRunMode: this.options.firstRunMode ?? "skip",
      auth: this.options.auth.accessToken ? "xoauth2" : "password",
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;
    this.wakeIdle?.();
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.logout();
      } catch {
        try {
          client.close();
        } catch {
          // ignore
        }
      }
    }
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
    mcpLog("info", "imap.stop", {
      host: this.options.host,
      lastUid: this.lastUid,
    });
  }

  private createClient(): ImapFlowClient {
    if (this.options.createClient) return this.options.createClient();
    const port = this.options.port ?? 993;
    const secure = this.options.secure ?? port === 993;
    const auth = this.options.auth.accessToken
      ? {
          user: this.options.auth.user,
          accessToken: this.options.auth.accessToken,
        }
      : {
          user: this.options.auth.user,
          pass: this.options.auth.pass!,
        };
    const tlsReject = this.options.tlsRejectUnauthorized;
    return new ImapFlow({
      host: this.options.host,
      port,
      secure,
      auth,
      logger: false,
      ...(tlsReject === false
        ? { tls: { rejectUnauthorized: false } }
        : {}),
    }) as unknown as ImapFlowClient;
  }

  private async runLoop(): Promise<void> {
    while (this.running && !this.stopping) {
      try {
        await this.session();
        this.reconnectAttempt = 0;
      } catch (err) {
        if (this.stopping || !this.running) break;
        const delay = Math.min(
          1000 * 2 ** this.reconnectAttempt,
          this.options.maxReconnectMs ?? 60_000,
        );
        this.reconnectAttempt += 1;
        mcpLog("warn", "imap.reconnect", {
          attempt: this.reconnectAttempt,
          delayMs: delay,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(delay);
      }
    }
  }

  private async session(): Promise<void> {
    const client = this.createClient();
    this.client = client;
    await client.connect();

    const mailbox = this.options.mailbox ?? "INBOX";
    const lock = await client.getMailboxLock(mailbox);

    const onExists = () => {
      this.wakeIdle?.();
    };
    client.on("exists", onExists);

    try {
      await this.fetchNew(client);
      while (this.running && !this.stopping && client.usable) {
        const idleDone = client.idle({ whenFree: true });
        const pollMs = this.options.pollIntervalMs ?? 60_000;
        const wakePromise = new Promise<"exists">((resolve) => {
          this.wakeIdle = () => resolve("exists");
        });
        const raced = await Promise.race([
          idleDone.then(() => "idle" as const),
          sleep(pollMs).then(() => "poll" as const),
          wakePromise,
          waitUntil(() => this.stopping || !this.running).then(
            () => "stop" as const,
          ),
        ]);
        this.wakeIdle = null;
        if (raced === "stop") break;
        await this.fetchNew(client);
      }
    } finally {
      client.off?.("exists", onExists);
      lock.release();
      try {
        await client.logout();
      } catch {
        client.close();
      }
      if (this.client === client) this.client = null;
    }
  }

  private async fetchNew(client: ImapFlowClient): Promise<void> {
    // First-run policy when no durable cursor.
    if (!this.firstRunDone && this.lastUid === 0) {
      const mode = this.options.firstRunMode ?? "skip";
      if (mode === "skip") {
        const uidNext =
          client.mailbox && typeof client.mailbox === "object"
            ? (client.mailbox.uidNext ?? 1)
            : 1;
        this.lastUid = Math.max(0, uidNext - 1);
        this.persistCursor();
        this.firstRunDone = true;
        mcpLog("info", "imap.first_run_skip", {
          seededLastUid: this.lastUid,
          uidNext,
        });
        return;
      }
      if (mode === "unseen") {
        await this.fetchUnseen(client);
        this.firstRunDone = true;
        return;
      }
      // mode === "all" falls through to 1:*
      this.firstRunDone = true;
    }

    const range = this.lastUid > 0 ? `${this.lastUid + 1}:*` : "1:*";
    await this.ingestRange(client, range);
  }

  private async fetchUnseen(client: ImapFlowClient): Promise<void> {
    if (!client.search) {
      mcpLog("warn", "imap.unseen_unsupported", {
        fallback: "skip",
      });
      const uidNext =
        client.mailbox && typeof client.mailbox === "object"
          ? (client.mailbox.uidNext ?? 1)
          : 1;
      this.lastUid = Math.max(0, uidNext - 1);
      this.persistCursor();
      return;
    }
    let uids: number[] = [];
    try {
      uids = await client.search({ seen: false }, { uid: true });
    } catch (err) {
      mcpLog("warn", "imap.unseen_search_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!uids.length) {
      const uidNext =
        client.mailbox && typeof client.mailbox === "object"
          ? (client.mailbox.uidNext ?? 1)
          : 1;
      this.lastUid = Math.max(0, uidNext - 1);
      this.persistCursor();
      return;
    }
    const range = uids.join(",");
    await this.ingestRange(client, range);
  }

  private async ingestRange(
    client: ImapFlowClient,
    range: string,
  ): Promise<void> {
    let maxUid = this.lastUid;
    let messages: ImapFetchMessage[];
    try {
      messages = [];
      for await (const message of client.fetch(
        range,
        { uid: true, source: true, envelope: true },
        { uid: true },
      )) {
        messages.push(message);
      }
    } catch (err) {
      mcpLog("debug", "imap.fetch_empty_or_error", {
        range,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    for (const message of messages) {
      if (!message.uid || message.uid <= this.lastUid) continue;
      // Always advance past UIDs we observed (even orphan / failed) to avoid loops.
      maxUid = Math.max(maxUid, message.uid);

      const source = message.source;
      if (!Buffer.isBuffer(source)) {
        mcpLog("warn", "imap.missing_source", { uid: message.uid });
        continue;
      }

      const inboxId = await this.resolveInboxForMessage(message);
      if (!inboxId) {
        mcpLog("warn", "imap.no_inbox", {
          uid: message.uid,
          to: message.envelope?.to?.map((t) => t.address).filter(Boolean),
        });
        continue;
      }

      try {
        this.ingestedUids.push(message.uid);
        const result = await ingestInboundMime(
          this.options.context,
          inboxId,
          source,
        );
        mcpLog("info", "imap.ingested", {
          uid: message.uid,
          inboxId,
          messageId: result.message.messageId,
          created: result.created,
        });

        if (this.options.markSeen !== false) {
          try {
            await client.messageFlagsAdd(message.uid, ["\\Seen"], {
              uid: true,
            });
          } catch (err) {
            mcpLog("warn", "imap.mark_seen_failed", {
              uid: message.uid,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        const idx = this.ingestedUids.lastIndexOf(message.uid);
        if (idx >= 0) this.ingestedUids.splice(idx, 1);
        mcpLog("error", "imap.ingest_failed", {
          uid: message.uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (maxUid > this.lastUid) {
      this.lastUid = maxUid;
      this.persistCursor();
    }
  }

  private persistCursor(): void {
    this.cursorStore.set({
      host: this.options.host,
      user: this.options.auth.user,
      mailbox: this.options.mailbox ?? "INBOX",
      lastUid: this.lastUid,
      updatedAtMs: Date.now(),
    });
  }

  private async resolveInboxForMessage(
    message: ImapFetchMessage,
  ): Promise<string | null> {
    if (this.options.inboxId) {
      const inbox = await this.options.context.state.getInbox(
        this.options.inboxId,
      );
      return inbox?.id ?? null;
    }
    const candidates =
      message.envelope?.to
        ?.map((t) => t.address)
        .filter((a): a is string => Boolean(a)) ?? [];
    return resolveInboxId(this.options.context, candidates, {
      ...(this.options.defaultInboxId !== undefined
        ? { defaultInboxId: this.options.defaultInboxId }
        : {}),
      ...(this.options.autoCreateInbox ? { autoCreate: true } : {}),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitUntil(predicate: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

export const IMAP_PRESETS = {
  gmail: { host: "imap.gmail.com", port: 993, secure: true },
  outlook: { host: "outlook.office365.com", port: 993, secure: true },
  office365: { host: "outlook.office365.com", port: 993, secure: true },
} as const;

export type ImapPresetName = keyof typeof IMAP_PRESETS;
