import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../../src/state/index.js";

describe("thread correlation + read_thread activeDrafts", () => {
  it("correlates multi-turn mail via In-Reply-To and References", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({
      address: "agent@sandbox.envlo.dev",
      displayName: "Agent",
    });

    const root = await store.ingestMessage(inbox.id, {
      messageId: "<root@acme.com>",
      fromAddress: "alice@acme.com",
      toAddresses: ["agent@sandbox.envlo.dev"],
      subject: "Invoice question",
      bodyMarkdown: "Can you check PO-1?",
      date: "2026-03-01T10:00:00.000Z",
    });

    const reply = await store.ingestMessage(inbox.id, {
      messageId: "<reply1@acme.com>",
      inReplyTo: "<root@acme.com>",
      references: ["<root@acme.com>"],
      fromAddress: "alice@acme.com",
      subject: "Re: Invoice question",
      bodyMarkdown: "Also need the PDF.",
      date: "2026-03-01T11:00:00.000Z",
    });

    const followup = await store.ingestMessage(inbox.id, {
      messageId: "<reply2@acme.com>",
      inReplyTo: "<reply1@acme.com>",
      references: ["<root@acme.com>", "<reply1@acme.com>"],
      fromAddress: "alice@acme.com",
      subject: "Re: Invoice question",
      bodyMarkdown: "Ping.",
      date: "2026-03-01T12:00:00.000Z",
    });

    expect(reply.thread.id).toBe(root.thread.id);
    expect(followup.thread.id).toBe(root.thread.id);

    const orphan = await store.ingestMessage(inbox.id, {
      messageId: "<other@acme.com>",
      subject: "Unrelated",
      bodyMarkdown: "Hi",
    });
    expect(orphan.thread.id).not.toBe(root.thread.id);

    const view = await store.readThread(root.thread.id);
    expect(view?.messages.map((m) => m.messageId)).toEqual([
      "<root@acme.com>",
      "<reply1@acme.com>",
      "<reply2@acme.com>",
    ]);
  });

  it("auto-stitches outbound reply headers from the thread tip", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    await store.ingestMessage(inbox.id, {
      messageId: "<m1@x.com>",
      subject: "Hello",
      bodyMarkdown: "Hi",
    });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<m2@x.com>",
      inReplyTo: "<m1@x.com>",
      references: ["<m1@x.com>"],
      subject: "Re: Hello",
      bodyMarkdown: "Follow-up",
    });

    const headers = await store.stitchReplyHeaders(thread.id);
    expect(headers.inReplyTo).toBe("<m2@x.com>");
    expect(headers.references).toEqual(["<m1@x.com>", "<m2@x.com>"]);

    const draft = await store.createDraft({
      threadId: thread.id,
      markdown: "Got it.",
      toAddresses: ["user@x.com"],
    });
    expect(draft.inReplyTo).toBe("<m2@x.com>");
    expect(draft.references).toEqual(["<m1@x.com>", "<m2@x.com>"]);
  });

  it("exposes rejected drafts with humanFeedback in read_thread activeDrafts", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<ask@x.com>",
      subject: "Q",
      bodyMarkdown: "?",
    });

    const draft = await store.createDraft({
      threadId: thread.id,
      markdown: "Short answer.",
    });
    await store.submitDraftForApproval(draft.id);
    await store.rejectDraft(draft.id, "Add a citation.");

    const view = await store.readThread(thread.id);
    expect(view?.activeDrafts).toHaveLength(1);
    expect(view?.activeDrafts[0]?.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(view?.activeDrafts[0]?.humanFeedback).toBe("Add a citation.");
    expect(view?.activeDrafts[0]?.originalDraftMarkdown).toBe("Short answer.");
  });

  it("is idempotent for duplicate Message-IDs in an inbox", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    const first = await store.ingestMessage(inbox.id, {
      messageId: "<dup@x.com>",
      bodyMarkdown: "one",
    });
    const second = await store.ingestMessage(inbox.id, {
      messageId: "<dup@x.com>",
      bodyMarkdown: "two",
    });
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect((await store.listMessages(first.thread.id))).toHaveLength(1);
  });

  it("correlates when only References matches (missing In-Reply-To)", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    const root = await store.ingestMessage(inbox.id, {
      messageId: "<root@x.com>",
      bodyMarkdown: "root",
    });
    const child = await store.ingestMessage(inbox.id, {
      messageId: "<child@x.com>",
      references: ["<root@x.com>"],
      bodyMarkdown: "child",
    });
    expect(child.thread.id).toBe(root.thread.id);
  });

  it("treats bare and angle-bracketed Message-IDs as the same identity", async () => {
    const store = new MemoryStateStore();
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

  it("re-stitches outbound headers at send when new mail arrived", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    await store.ingestMessage(inbox.id, {
      messageId: "<m1@x.com>",
      bodyMarkdown: "one",
      date: "2026-05-01T10:00:00.000Z",
    });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<m2@x.com>",
      inReplyTo: "<m1@x.com>",
      references: ["<m1@x.com>"],
      bodyMarkdown: "two",
      date: "2026-05-01T11:00:00.000Z",
    });

    let draft = await store.createDraft({
      threadId: thread.id,
      markdown: "Reply draft",
    });
    expect(draft.inReplyTo).toBe("<m2@x.com>");
    expect(draft.references).toEqual(["<m1@x.com>", "<m2@x.com>"]);

    await store.ingestMessage(inbox.id, {
      messageId: "<m3@x.com>",
      inReplyTo: "<m2@x.com>",
      references: ["<m1@x.com>", "<m2@x.com>"],
      bodyMarkdown: "three arrived while drafting",
      date: "2026-05-01T12:00:00.000Z",
    });

    draft = await store.submitDraftForApproval(draft.id);
    draft = await store.approveDraft(draft.id);
    const sent = await store.markDraftSent(draft.id, {
      messageId: "<out@envlo.dev>",
    });

    expect(sent.message.inReplyTo).toBe("<m3@x.com>");
    expect(sent.message.references).toEqual([
      "<m1@x.com>",
      "<m2@x.com>",
      "<m3@x.com>",
    ]);
    expect(sent.draft.inReplyTo).toBe("<m3@x.com>");
  });

  it("rejects duplicate inbox addresses", async () => {
    const store = new MemoryStateStore();
    await store.createInbox({ address: "agent@envlo.dev" });
    await expect(store.createInbox({ address: "Agent@envlo.dev" })).rejects.toThrow(
      /already exists/,
    );
  });

  it("stitches createDraft against an explicit mid-thread parent", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    await store.ingestMessage(inbox.id, {
      messageId: "<m1@x.com>",
      bodyMarkdown: "one",
      date: "2026-06-01T10:00:00.000Z",
    });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<m2@x.com>",
      inReplyTo: "<m1@x.com>",
      references: ["<m1@x.com>"],
      bodyMarkdown: "two",
      date: "2026-06-01T11:00:00.000Z",
    });
    await store.ingestMessage(inbox.id, {
      messageId: "<m3@x.com>",
      inReplyTo: "<m2@x.com>",
      references: ["<m1@x.com>", "<m2@x.com>"],
      bodyMarkdown: "three",
      date: "2026-06-01T12:00:00.000Z",
    });

    const draft = await store.createDraft({
      threadId: thread.id,
      markdown: "Reply to m1",
      inReplyTo: "<m1@x.com>",
    });
    expect(draft.inReplyTo).toBe("<m1@x.com>");
    expect(draft.references).toEqual(["<m1@x.com>"]);

    const tipHeaders = await store.stitchReplyHeaders(thread.id);
    expect(tipHeaders.inReplyTo).toBe("<m3@x.com>");
  });

  it("orders listInboxes and listThreads deterministically", async () => {
    const store = new MemoryStateStore();
    const first = await store.createInbox({ address: "a@envlo.dev" });
    const second = await store.createInbox({ address: "b@envlo.dev" });
    const inboxes = await store.listInboxes();
    expect(inboxes.map((i) => i.id)).toEqual([first.id, second.id]);

    const older = await store.ingestMessage(first.id, {
      messageId: "<old@x.com>",
      bodyMarkdown: "old",
      date: "2026-01-01T00:00:00.000Z",
    });
    const newer = await store.ingestMessage(first.id, {
      messageId: "<new@x.com>",
      bodyMarkdown: "new",
      date: "2026-02-01T00:00:00.000Z",
    });
    // Unrelated second thread tip is newer than first thread's tip.
    expect(newer.thread.id).not.toBe(older.thread.id);
    const threads = await store.listThreads(first.id);
    expect(threads[0]?.id).toBe(newer.thread.id);
    expect(threads[1]?.id).toBe(older.thread.id);
  });

  it("throws not-found for missing inbox/thread/draft ids", async () => {
    const store = new MemoryStateStore();
    await expect(store.listThreads("missing-inbox")).rejects.toThrow(/inbox not found/);
    await expect(store.listMessages("missing-thread")).rejects.toThrow(/thread not found/);
    await expect(store.stitchReplyHeaders("missing-thread")).rejects.toThrow(
      /thread not found/,
    );
    await expect(
      store.createDraft({ threadId: "missing-thread", markdown: "x" }),
    ).rejects.toThrow(/thread not found/);
    await expect(store.submitDraftForApproval("missing-draft")).rejects.toThrow(
      /draft not found/,
    );
    expect(await store.getInbox("missing")).toBeNull();
    expect(await store.getThread("missing")).toBeNull();
    expect(await store.getDraft("missing")).toBeNull();
    expect(await store.readThread("missing")).toBeNull();
  });
});
