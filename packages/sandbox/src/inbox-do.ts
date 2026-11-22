/**
 * Per-inbox Durable Object: serializes ring append + WebSocket fan-out so
 * mail arriving before `wait_for_email` / during brief disconnects is buffered
 * without race conditions. KV is the durable source of truth for replay after
 * eviction; DO keeps a hot recent cache.
 */
import type { SandboxEnv } from "./env.js";
import { SANDBOX_TTL_SECONDS, isExpired } from "./limits.js";
import {
  RING_RECENT_CAP,
  appendToRing,
  kvInboxMessageKey,
  kvInboxMetaKey,
  loadMessagesFromKv,
  messagesAfter,
  ringPutOptions,
  trimRecent,
  type BufferedEmail,
  type InboxMeta,
} from "./ring-buffer.js";

export type IngestEmailRequest = {
  from: string;
  to: string;
  subject: string;
  messageId: string | null;
  rawMime: string;
  rawSize: number;
  truncated: boolean;
  receivedAt?: string;
};

export type InboxDoState = {
  meta: InboxMeta | null;
  recent: BufferedEmail[];
};

export class InboxDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: SandboxEnv;
  private meta: InboxMeta | null = null;
  private recent: BufferedEmail[] = [];
  private loaded = false;

  constructor(state: DurableObjectState, env: SandboxEnv) {
    this.state = state;
    this.env = env;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<InboxDoState>("snapshot");
    if (stored) {
      this.meta = stored.meta;
      this.recent = stored.recent ?? [];
    }

    // Rebuild hot cache from KV when DO storage is empty/stale after eviction.
    if (this.meta && this.recent.length === 0 && this.meta.lastSeq > 0) {
      const rebuilt = await loadMessagesFromKv(
        this.env.SANDBOX_KV,
        this.meta.inboxId,
        Math.max(0, this.meta.lastSeq - RING_RECENT_CAP),
        this.meta.lastSeq,
      );
      this.recent = trimRecent(rebuilt);
    } else if (!this.meta) {
      // Try meta from KV (init may have been lost from DO storage only).
      // Caller still needs /init for brand-new inboxes.
    }

    this.loaded = true;
  }

  private async hydrateMetaFromKv(inboxId: string): Promise<void> {
    if (this.meta) return;
    const raw = await this.env.SANDBOX_KV.get(kvInboxMetaKey(inboxId));
    if (!raw) return;
    try {
      this.meta = JSON.parse(raw) as InboxMeta;
      if (this.meta.lastSeq > 0 && this.recent.length === 0) {
        const rebuilt = await loadMessagesFromKv(
          this.env.SANDBOX_KV,
          this.meta.inboxId,
          Math.max(0, this.meta.lastSeq - RING_RECENT_CAP),
          this.meta.lastSeq,
        );
        this.recent = trimRecent(rebuilt);
      }
    } catch {
      /* ignore */
    }
  }

  private async persist(): Promise<void> {
    const snapshot: InboxDoState = {
      meta: this.meta,
      recent: trimRecent(this.recent),
    };
    await this.state.storage.put("snapshot", snapshot);
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const body = (await request.json()) as InboxMeta;
      this.meta = body;
      this.recent = [];
      await this.persist();
      await this.state.storage.setAlarm(Date.parse(body.expiresAt));
      return json({ ok: true, meta: body });
    }

    if (url.pathname === "/ingest" && request.method === "POST") {
      return this.handleIngest(request);
    }

    if (url.pathname === "/messages" && request.method === "GET") {
      const afterSeq =
        Number.parseInt(url.searchParams.get("afterSeq") || "0", 10) || 0;
      const inboxId =
        url.searchParams.get("inboxId") || this.meta?.inboxId || "";
      if (inboxId) await this.hydrateMetaFromKv(inboxId);

      // Prefer KV as source of truth so cold DO still replays full history.
      let msgs: BufferedEmail[] = [];
      if (this.meta) {
        msgs = await loadMessagesFromKv(
          this.env.SANDBOX_KV,
          this.meta.inboxId,
          afterSeq,
          this.meta.lastSeq,
        );
        if (msgs.length === 0) {
          msgs = messagesAfter(this.recent, afterSeq);
        }
      }
      return json({ ok: true, meta: this.meta, messages: msgs });
    }

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request, url);
    }

    if (url.pathname === "/meta" && request.method === "GET") {
      return json({
        ok: true,
        meta: this.meta,
        connections: this.state.getWebSockets().length,
        recentCount: this.recent.length,
      });
    }

    return json({ ok: false, error: "not_found" }, 404);
  }

  async alarm(): Promise<void> {
    await this.ensureLoaded();
    if (this.meta && isExpired(Date.parse(this.meta.expiresAt))) {
      this.meta = null;
      this.recent = [];
      await this.state.storage.deleteAll();
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.close(1000, "inbox expired");
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async handleIngest(request: Request): Promise<Response> {
    if (!this.meta) {
      return json({ ok: false, error: "inbox_not_initialized" }, 404);
    }
    if (isExpired(Date.parse(this.meta.expiresAt))) {
      return json({ ok: false, error: "expired" }, 410);
    }

    const body = (await request.json()) as IngestEmailRequest;
    const { message, meta } = appendToRing(this.meta, {
      id: body.messageId || `seq-${this.meta.lastSeq + 1}`,
      from: body.from,
      to: body.to,
      subject: body.subject,
      messageId: body.messageId,
      receivedAt: body.receivedAt || new Date().toISOString(),
      rawMime: body.rawMime,
      rawSize: body.rawSize,
      truncated: body.truncated,
    });

    this.meta = meta;
    this.recent = trimRecent([...this.recent, message]);
    await this.persist();

    const ttl = ringPutOptions(SANDBOX_TTL_SECONDS);
    await this.env.SANDBOX_KV.put(
      kvInboxMessageKey(meta.inboxId, message.seq),
      JSON.stringify(message),
      ttl,
    );
    await this.env.SANDBOX_KV.put(
      kvInboxMetaKey(meta.inboxId),
      JSON.stringify(meta),
      ttl,
    );

    const payload = JSON.stringify({ type: "email", message });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* drop broken socket */
      }
    }

    return json({ ok: true, message, meta });
  }

  private async handleWebSocket(
    request: Request,
    url: URL,
  ): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ ok: false, error: "expected_websocket" }, 426);
    }

    const inboxIdParam = url.searchParams.get("inboxId");
    if (inboxIdParam) await this.hydrateMetaFromKv(inboxIdParam);

    if (!this.meta) {
      return json({ ok: false, error: "inbox_not_initialized" }, 404);
    }
    if (isExpired(Date.parse(this.meta.expiresAt))) {
      return json({ ok: false, error: "expired" }, 410);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const afterSeq =
      Number.parseInt(url.searchParams.get("afterSeq") || "0", 10) || 0;

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ afterSeq, inboxId: this.meta.inboxId });

    // KV-backed replay so brief disconnect + DO hibernation still catch up.
    let replay = await loadMessagesFromKv(
      this.env.SANDBOX_KV,
      this.meta.inboxId,
      afterSeq,
      this.meta.lastSeq,
    );
    if (replay.length === 0) {
      replay = messagesAfter(this.recent, afterSeq);
    }
    for (const message of replay) {
      server.send(JSON.stringify({ type: "email", message }));
    }
    server.send(
      JSON.stringify({
        type: "hello",
        inboxId: this.meta.inboxId,
        address: this.meta.address,
        lastSeq: this.meta.lastSeq,
        expiresAt: this.meta.expiresAt,
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await this.ensureLoaded();
    if (typeof message !== "string") return;
    let parsed: { type?: string; afterSeq?: number };
    try {
      parsed = JSON.parse(message) as { type?: string; afterSeq?: number };
    } catch {
      return;
    }
    if (parsed.type === "ack" && typeof parsed.afterSeq === "number") {
      ws.serializeAttachment({
        afterSeq: parsed.afterSeq,
        inboxId: this.meta?.inboxId,
      });
      return;
    }
    if (parsed.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close(wasClean ? code : 1000, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      /* ignore */
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Stub-friendly helper used in unit tests (no CF runtime). */
export function createInboxDoLogic() {
  let meta: InboxMeta | null = null;
  let recent: BufferedEmail[] = [];
  const broadcasts: string[] = [];

  return {
    get meta() {
      return meta;
    },
    get recent() {
      return recent;
    },
    get broadcasts() {
      return broadcasts;
    },
    init(next: InboxMeta) {
      meta = next;
      recent = [];
    },
    ingest(input: IngestEmailRequest): BufferedEmail {
      if (!meta) throw new Error("not initialized");
      const { message, meta: next } = appendToRing(meta, {
        id: input.messageId || `seq-${meta.lastSeq + 1}`,
        from: input.from,
        to: input.to,
        subject: input.subject,
        messageId: input.messageId,
        receivedAt: input.receivedAt || new Date().toISOString(),
        rawMime: input.rawMime,
        rawSize: input.rawSize,
        truncated: input.truncated,
      });
      meta = next;
      recent = trimRecent([...recent, message]);
      broadcasts.push(JSON.stringify({ type: "email", message }));
      return message;
    },
    replay(afterSeq: number): BufferedEmail[] {
      return messagesAfter(recent, afterSeq);
    },
  };
}
