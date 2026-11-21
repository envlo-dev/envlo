import { describe, expect, it } from "vitest";
import {
  DraftTransitionError,
  MemoryStateStore,
  assertDraftEditable,
  assertDraftTransition,
} from "../../src/state/index.js";
import type { DraftRecord } from "../../src/state/index.js";

function draft(status: DraftRecord["status"]): DraftRecord {
  return {
    id: "d1",
    threadId: "t1",
    inboxId: "i1",
    status,
    toAddresses: [],
    subject: null,
    originalDraftMarkdown: "hi",
    currentMarkdown: "hi",
    finalSentMarkdown: null,
    humanFeedback: null,
    inReplyTo: null,
    references: [],
    createdMessageId: null,
    sentMessageRowId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    submittedAt: null,
    decidedAt: null,
    sentAt: null,
  };
}

describe("draft approval state machine", () => {
  it("allows DRAFT → PENDING → APPROVED → SENT and PENDING → REJECTED", () => {
    expect(() => assertDraftTransition(draft("DRAFT"), "PENDING_APPROVAL")).not.toThrow();
    expect(() =>
      assertDraftTransition(draft("PENDING_APPROVAL"), "APPROVED"),
    ).not.toThrow();
    expect(() => assertDraftTransition(draft("APPROVED"), "SENT")).not.toThrow();
    expect(() =>
      assertDraftTransition(draft("PENDING_APPROVAL"), "REJECTED_WITH_FEEDBACK"),
    ).not.toThrow();
    expect(() =>
      assertDraftTransition(draft("REJECTED_WITH_FEEDBACK"), "PENDING_APPROVAL"),
    ).not.toThrow();
  });

  it("rejects illegal transitions", () => {
    expect(() => assertDraftTransition(draft("DRAFT"), "SENT")).toThrow(
      DraftTransitionError,
    );
    expect(() => assertDraftTransition(draft("SENT"), "DRAFT")).toThrow(
      DraftTransitionError,
    );
    expect(() => assertDraftTransition(draft("APPROVED"), "DRAFT")).toThrow(
      DraftTransitionError,
    );
  });

  it("only allows edits in DRAFT / REJECTED_WITH_FEEDBACK", () => {
    expect(() => assertDraftEditable(draft("DRAFT"))).not.toThrow();
    expect(() => assertDraftEditable(draft("REJECTED_WITH_FEEDBACK"))).not.toThrow();
    expect(() => assertDraftEditable(draft("PENDING_APPROVAL"))).toThrow(
      DraftTransitionError,
    );
    expect(() => assertDraftEditable(draft("APPROVED"))).toThrow(DraftTransitionError);
  });

  it("runs the full approval lifecycle on the memory store", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<root@customer.com>",
      fromAddress: "customer@example.com",
      subject: "Help",
      bodyMarkdown: "Need help",
    });

    let draftRec = await store.createDraft({
      threadId: thread.id,
      markdown: "Thanks — looking into it.",
      toAddresses: ["customer@example.com"],
    });
    expect(draftRec.status).toBe("DRAFT");
    expect(draftRec.originalDraftMarkdown).toBe("Thanks — looking into it.");

    draftRec = await store.submitDraftForApproval(draftRec.id);
    expect(draftRec.status).toBe("PENDING_APPROVAL");
    expect(draftRec.submittedAt).toBeTruthy();

    draftRec = await store.rejectDraft(draftRec.id, "Be more specific about ETA.");
    expect(draftRec.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(draftRec.humanFeedback).toBe("Be more specific about ETA.");

    draftRec = await store.updateDraft(draftRec.id, {
      markdown: "Thanks — ETA is tomorrow 10am.",
    });
    expect(draftRec.currentMarkdown).toContain("tomorrow");
    expect(draftRec.originalDraftMarkdown).toBe("Thanks — looking into it.");
    expect(draftRec.humanFeedback).toBe("Be more specific about ETA.");

    draftRec = await store.submitDraftForApproval(draftRec.id);
    draftRec = await store.approveDraft(draftRec.id);
    expect(draftRec.status).toBe("APPROVED");

    const sent = await store.markDraftSent(draftRec.id, {
      finalSentMarkdown: "Thanks — ETA is tomorrow 10am. — Agent",
    });
    expect(sent.draft.status).toBe("SENT");
    expect(sent.draft.finalSentMarkdown).toContain("Agent");
    expect(sent.message.direction).toBe("outbound");
    expect(sent.message.inReplyTo).toBe("<root@customer.com>");
    expect(sent.message.references).toEqual(["<root@customer.com>"]);

    const view = await store.readThread(thread.id);
    expect(view?.activeDrafts).toEqual([]);
    expect(view?.messages).toHaveLength(2);
  });

  it("requires humanFeedback and blocks edits while pending approval", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<r@x.com>",
      bodyMarkdown: "hi",
    });
    const draftRec = await store.createDraft({
      threadId: thread.id,
      markdown: "Reply",
    });
    await store.submitDraftForApproval(draftRec.id);

    await expect(store.rejectDraft(draftRec.id, "   ")).rejects.toThrow(
      /humanFeedback/,
    );
    await expect(
      store.updateDraft(draftRec.id, { markdown: "sneaky edit" }),
    ).rejects.toThrow(DraftTransitionError);
  });

  it("rejects approve/reject/send from illegal store statuses", async () => {
    const store = new MemoryStateStore();
    const inbox = await store.createInbox({ address: "agent@envlo.dev" });
    const { thread } = await store.ingestMessage(inbox.id, {
      messageId: "<r@x.com>",
      bodyMarkdown: "hi",
    });
    const draftRec = await store.createDraft({
      threadId: thread.id,
      markdown: "Reply",
    });

    await expect(store.approveDraft(draftRec.id)).rejects.toThrow(DraftTransitionError);
    await expect(store.rejectDraft(draftRec.id, "nope")).rejects.toThrow(
      DraftTransitionError,
    );
    await expect(store.markDraftSent(draftRec.id)).rejects.toThrow(DraftTransitionError);

    await store.submitDraftForApproval(draftRec.id);
    await expect(store.markDraftSent(draftRec.id)).rejects.toThrow(DraftTransitionError);
  });
});
