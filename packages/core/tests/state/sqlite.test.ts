import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isNodeSqliteAvailable,
  openSqliteStateStore,
  openStateStore,
} from "../../src/state/index.js";
import type { EnvloStateStore } from "../../src/state/index.js";

const tempDirs: string[] = [];
const stores: EnvloStateStore[] = [];

afterEach(async () => {
  while (stores.length > 0) {
    const store = stores.pop();
    await store?.close?.();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const sqliteOk = await isNodeSqliteAvailable();

describe.skipIf(!sqliteOk)("SqliteStateStore", () => {
  async function openTempStore() {
    const dir = await mkdtemp(join(tmpdir(), "envlo-state-"));
    tempDirs.push(dir);
    const store = await openSqliteStateStore({ path: join(dir, "state.db") });
    stores.push(store);
    return store;
  }

  it("persists schema to a file and survives reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envlo-state-reopen-"));
    tempDirs.push(dir);
    const path = join(dir, "state.db");

    const store1 = await openSqliteStateStore({ path });
    stores.push(store1);
    const inbox = await store1.createInbox({ address: "persist@envlo.dev" });
    const { thread } = await store1.ingestMessage(inbox.id, {
      messageId: "<persist@x.com>",
      subject: "Persist me",
      bodyMarkdown: "hello",
    });
    await store1.close();
    stores.pop();

    const store2 = await openSqliteStateStore({ path });
    stores.push(store2);
    expect(await store2.getInbox(inbox.id)).toMatchObject({
      address: "persist@envlo.dev",
    });
    const view = await store2.readThread(thread.id);
    expect(view?.messages).toHaveLength(1);
    expect(view?.messages[0]?.messageId).toBe("<persist@x.com>");
  });

  it("runs multi-turn stitching + approval FSM end-to-end", async () => {
    const store = await openTempStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });

    await store.ingestMessage(inbox.id, {
      messageId: "<m1@acme.com>",
      fromAddress: "a@acme.com",
      subject: "Thread",
      bodyMarkdown: "one",
      date: "2026-04-01T10:00:00.000Z",
    });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<m2@acme.com>",
      inReplyTo: "<m1@acme.com>",
      references: ["<m1@acme.com>"],
      fromAddress: "a@acme.com",
      subject: "Re: Thread",
      bodyMarkdown: "two",
      date: "2026-04-01T11:00:00.000Z",
    });

    let draft = await store.createDraft({
      threadId: thread.id,
      markdown: "Draft v1",
      toAddresses: ["a@acme.com"],
    });
    expect(draft.inReplyTo).toBe("<m2@acme.com>");
    expect(draft.references).toEqual(["<m1@acme.com>", "<m2@acme.com>"]);

    draft = await store.submitDraftForApproval(draft.id);
    draft = await store.rejectDraft(draft.id, "Tone down.");
    expect(draft.humanFeedback).toBe("Tone down.");

    const viewRejected = await store.readThread(thread.id);
    expect(viewRejected?.activeDrafts).toHaveLength(1);
    expect(viewRejected?.activeDrafts[0]?.status).toBe("REJECTED_WITH_FEEDBACK");

    draft = await store.updateDraft(draft.id, { markdown: "Draft v2 softer" });
    draft = await store.submitDraftForApproval(draft.id);
    draft = await store.approveDraft(draft.id);
    const sent = await store.markDraftSent(draft.id, {
      finalSentMarkdown: "Draft v2 softer\n\n— Envlo",
      messageId: "<out@envlo.dev>",
    });

    expect(sent.draft.status).toBe("SENT");
    expect(sent.draft.finalSentMarkdown).toContain("Envlo");
    expect(sent.draft.originalDraftMarkdown).toBe("Draft v1");
    expect(sent.message.messageId).toBe("<out@envlo.dev>");
    expect(sent.message.references).toEqual(["<m1@acme.com>", "<m2@acme.com>"]);

    const view = await store.readThread(thread.id);
    expect(view?.activeDrafts).toEqual([]);
    expect(view?.messages.map((m) => m.messageId)).toEqual([
      "<m1@acme.com>",
      "<m2@acme.com>",
      "<out@envlo.dev>",
    ]);
  });

  it("supports :memory: sqlite and openStateStore(driver=sqlite)", async () => {
    const mem = await openSqliteStateStore({ path: ":memory:" });
    stores.push(mem);
    await mem.createInbox({ address: "mem@envlo.dev" });
    expect(await mem.listInboxes()).toHaveLength(1);

    const viaFactory = await openStateStore({
      driver: "sqlite",
      path: ":memory:",
    });
    stores.push(viaFactory);
    expect(viaFactory.kind).toBe("sqlite");
  });

  it("creates state.db with mode 0o600 and keeps it after reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envlo-state-mode-"));
    tempDirs.push(dir);
    const path = join(dir, "state.db");
    const store = await openSqliteStateStore({ path });
    stores.push(store);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await store.close();
    stores.pop();

    const store2 = await openSqliteStateStore({ path });
    stores.push(store2);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("correlates bare and angle-bracketed Message-IDs", async () => {
    const store = await openTempStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    const root = await store.ingestMessage(inbox.id, {
      messageId: "root@x.com",
      bodyMarkdown: "root",
    });
    expect(root.message.messageId).toBe("<root@x.com>");

    const child = await store.ingestMessage(inbox.id, {
      messageId: "<child@x.com>",
      inReplyTo: "root@x.com",
      references: ["root@x.com"],
      bodyMarkdown: "child",
    });
    expect(child.thread.id).toBe(root.thread.id);
    expect(child.message.inReplyTo).toBe("<root@x.com>");
  });

  it("rolls back markDraftSent when Message-ID collides (transaction)", async () => {
    const store = await openTempStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    await store.ingestMessage(inbox.id, {
      messageId: "<taken@x.com>",
      bodyMarkdown: "already used",
    });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<parent@x.com>",
      bodyMarkdown: "parent",
    });

    let draft = await store.createDraft({
      threadId: thread.id,
      markdown: "Outbound",
    });
    draft = await store.submitDraftForApproval(draft.id);
    draft = await store.approveDraft(draft.id);

    await expect(
      store.markDraftSent(draft.id, { messageId: "<taken@x.com>" }),
    ).rejects.toThrow();

    const after = await store.getDraft(draft.id);
    expect(after?.status).toBe("APPROVED");
    expect(after?.sentAt).toBeNull();
    const messages = await store.listMessages(thread.id);
    expect(messages.every((m) => m.direction === "inbound")).toBe(true);
  });

  it("rejects duplicate inbox addresses", async () => {
    const store = await openTempStore();
    await store.createInbox({ address: "dup@envlo.dev" });
    await expect(store.createInbox({ address: "dup@envlo.dev" })).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("openStateStore drivers", () => {
  it("can force memory driver explicitly", async () => {
    const store = await openStateStore({ driver: "memory" });
    expect(store.kind).toBe("memory");
    await store.createInbox({ address: "forced-memory@envlo.dev" });
    expect(await store.listInboxes()).toHaveLength(1);
  });

  it("defaults to sqlite and fails loudly when unavailable", async () => {
    if (await isNodeSqliteAvailable()) {
      const store = await openStateStore({ path: ":memory:" });
      stores.push(store);
      expect(store.kind).toBe("sqlite");
      return;
    }
    await expect(openStateStore({ path: ":memory:" })).rejects.toThrow(/node:sqlite/);
  });
});
