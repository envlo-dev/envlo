import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ConsoleDryRunSender } from "@envlo/core";
import {
  createEnvloMcpContext,
  ImapAdapter,
  MemoryImapUidCursorStore,
  type ImapFetchMessage,
  type ImapFlowClient,
} from "../src/index.js";

class MockImapClient extends EventEmitter implements ImapFlowClient {
  usable = false;
  mailbox: { uidNext: number; exists: number } = { uidNext: 1, exists: 0 };
  private messages: ImapFetchMessage[];
  readonly flagged: number[] = [];
  private idleResolvers: Array<() => void> = [];

  constructor(messages: ImapFetchMessage[] = [], uidNext = 1) {
    super();
    this.messages = messages;
    this.mailbox = {
      uidNext,
      exists: messages.length,
    };
  }

  pushMessage(message: ImapFetchMessage): void {
    this.messages.push(message);
    this.mailbox.exists = this.messages.length;
    this.mailbox.uidNext = Math.max(this.mailbox.uidNext, message.uid + 1);
    this.emit("exists", this.messages.length);
  }

  async connect(): Promise<void> {
    this.usable = true;
  }

  async logout(): Promise<void> {
    this.usable = false;
    for (const resolve of this.idleResolvers.splice(0)) resolve();
  }

  close(): void {
    this.usable = false;
    for (const resolve of this.idleResolvers.splice(0)) resolve();
  }

  async getMailboxLock(
    path: string,
  ): Promise<{ path: string; release: () => void }> {
    return { path, release: () => undefined };
  }

  async *fetch(
    range: string,
    _query: { uid?: boolean; source?: boolean; envelope?: boolean },
    _options?: { uid?: boolean },
  ): AsyncGenerator<ImapFetchMessage> {
    if (range.includes(",")) {
      const want = new Set(
        range.split(",").map((p) => Number.parseInt(p, 10)),
      );
      for (const message of this.messages) {
        if (want.has(message.uid)) yield message;
      }
      return;
    }
    const minUid = range.startsWith("1:")
      ? 1
      : Number.parseInt(range.split(":")[0] ?? "1", 10);
    for (const message of this.messages) {
      if (message.uid >= minUid) yield message;
    }
  }

  async messageFlagsAdd(
    range: string | number,
    _flags: string[],
    _options?: { uid?: boolean },
  ): Promise<boolean> {
    this.flagged.push(typeof range === "number" ? range : Number(range));
    return true;
  }

  idle(): Promise<boolean> {
    if (!this.usable) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.idleResolvers.push(() => resolve(true));
    });
  }
}

function mimeBuffer(subject: string, messageId: string, to: string): Buffer {
  return Buffer.from(
    [
      `From: user@acme.com`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "",
      "Hello IMAP",
    ].join("\r\n"),
    "utf8",
  );
}

describe("ImapAdapter", () => {
  it("first-run skip seeds cursor at uidNext-1 without backfill", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const cursorStore = new MemoryImapUidCursorStore();
    const client = new MockImapClient(
      [
        {
          uid: 50,
          source: mimeBuffer("Old", "<old@acme.com>", "agent@envlo.dev"),
          envelope: { to: [{ address: "agent@envlo.dev" }] },
        },
      ],
      51,
    );
    const adapter = new ImapAdapter({
      context: ctx,
      host: "imap.test",
      auth: { user: "u", pass: "p" },
      cursorStore,
      firstRunMode: "skip",
      pollIntervalMs: 50,
      createClient: () => client,
    });
    await adapter.start();
    await new Promise((r) => setTimeout(r, 80));
    expect(adapter.ingestedUids).toHaveLength(0);
    expect(adapter.getLastUid()).toBe(50);
    expect(
      cursorStore.get({
        host: "imap.test",
        user: "u",
        mailbox: "INBOX",
      })?.lastUid,
    ).toBe(50);
    await adapter.stop();
    await ctx.close();
  });

  it("fetches new UIDs, ingests MIME, marks seen, and persists cursor", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });
    const cursorStore = new MemoryImapUidCursorStore();
    const client = new MockImapClient([
      {
        uid: 10,
        source: mimeBuffer("First", "<imap-1@acme.com>", "agent@envlo.dev"),
        envelope: { to: [{ address: "agent@envlo.dev" }], subject: "First" },
      },
    ]);

    const adapter = new ImapAdapter({
      context: ctx,
      host: "imap.test",
      auth: { user: "u", pass: "p" },
      inboxId: inbox.id,
      cursorStore,
      firstRunMode: "all",
      pollIntervalMs: 50,
      createClient: () => client,
    });

    const wait = ctx.inboxBus.waitFor(
      (e) => e.type === "message.inbound",
      { timeoutMs: 5000 },
    );
    await adapter.start();
    const event = await wait;
    expect(event.type).toBe("message.inbound");
    expect(adapter.ingestedUids).toContain(10);
    await vi.waitFor(() => {
      expect(client.flagged).toContain(10);
      expect(
        cursorStore.get({
          host: "imap.test",
          user: "u",
          mailbox: "INBOX",
        })?.lastUid,
      ).toBe(10);
    });

    const wait2 = ctx.inboxBus.waitFor(
      (e) =>
        e.type === "message.inbound" &&
        e.message.messageId === "<imap-2@acme.com>",
      { timeoutMs: 5000 },
    );
    client.pushMessage({
      uid: 11,
      source: mimeBuffer("Second", "<imap-2@acme.com>", "agent@envlo.dev"),
      envelope: { to: [{ address: "agent@envlo.dev" }], subject: "Second" },
    });
    await wait2;
    expect(adapter.ingestedUids.filter((u) => u === 10)).toHaveLength(1);
    expect(adapter.ingestedUids).toContain(11);

    await adapter.stop();
    await ctx.close();
  });

  it("advances cursor when inbox cannot be resolved (no retry spam)", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const cursorStore = new MemoryImapUidCursorStore();
    const client = new MockImapClient([
      {
        uid: 7,
        source: mimeBuffer("Orphan", "<orphan@acme.com>", "nobody@envlo.dev"),
        envelope: { to: [{ address: "nobody@envlo.dev" }] },
      },
    ]);
    const adapter = new ImapAdapter({
      context: ctx,
      host: "imap.test",
      auth: { user: "u", pass: "p" },
      cursorStore,
      firstRunMode: "all",
      autoCreateInbox: false,
      pollIntervalMs: 50,
      createClient: () => client,
    });
    await adapter.start();
    await vi.waitFor(() => {
      expect(adapter.getLastUid()).toBe(7);
    });
    expect(adapter.ingestedUids).toHaveLength(0);
    await adapter.stop();
    await ctx.close();
  });

  it("resumes from cursor and ignores already-seen UIDs", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });
    const cursorStore = new MemoryImapUidCursorStore();
    cursorStore.set({
      host: "imap.test",
      user: "u",
      mailbox: "INBOX",
      lastUid: 5,
      updatedAtMs: Date.now(),
    });

    const client = new MockImapClient([
      {
        uid: 4,
        source: mimeBuffer("Old", "<old@acme.com>", "agent@envlo.dev"),
        envelope: { to: [{ address: "agent@envlo.dev" }] },
      },
      {
        uid: 6,
        source: mimeBuffer("New", "<new@acme.com>", "agent@envlo.dev"),
        envelope: { to: [{ address: "agent@envlo.dev" }] },
      },
    ]);

    const adapter = new ImapAdapter({
      context: ctx,
      host: "imap.test",
      auth: { user: "u", pass: "p" },
      inboxId: inbox.id,
      cursorStore,
      pollIntervalMs: 50,
      createClient: () => client,
    });

    const wait = ctx.inboxBus.waitFor(
      (e) =>
        e.type === "message.inbound" &&
        e.message.messageId === "<new@acme.com>",
      { timeoutMs: 5000 },
    );
    await adapter.start();
    await wait;
    expect(adapter.ingestedUids).toEqual([6]);
    await adapter.stop();
    await ctx.close();
  });
});
