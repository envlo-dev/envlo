import { describe, expect, it, vi } from "vitest";
import {
  ApprovalController,
  ConsoleDryRunSender,
  DraftLifecycleBus,
  InteractiveCliApprovalChannel,
  MagicLinkApprovalChannel,
  SlackApprovalChannel,
  WebhookApprovalChannel,
  buildSlackApprovalBlocks,
  buildSlackEditApproveModal,
  buildSlackRejectModal,
  handleSlackApprovalDecision,
  handleWebhookApprovalRequest,
  interpretSlackInteraction,
  parseApprovalReply,
  promptDraftApproval,
  waitForDraftDecision,
  extractApprovalToken,
  SLACK_ACTION_APPROVE,
  SLACK_ACTION_EDIT_APPROVE,
  SLACK_ACTION_REJECT,
} from "../../src/adapters/index.js";
import { MemoryStateStore } from "../../src/state/index.js";

async function pendingDraft() {
  const state = new MemoryStateStore();
  const events = new DraftLifecycleBus();
  const inbox = await state.createInbox({ address: "agent@envlo.dev" });
  const { thread } = await state.ingestMessage(inbox.id, {
    messageId: "<in@acme.com>",
    fromAddress: "user@acme.com",
    subject: "Help",
    bodyMarkdown: "Need help",
  });
  let draft = await state.createDraft({
    threadId: thread.id,
    markdown: "Working on it.",
    toAddresses: ["user@acme.com"],
    subject: "Re: Help",
  });
  draft = await state.submitDraftForApproval(draft.id);
  const controller = new ApprovalController({ state, events });
  return { state, events, inbox, thread, draft, controller };
}

describe("approval reply parsing", () => {
  it("parses APPROVE / REJECT / EDIT and bare feedback", () => {
    expect(parseApprovalReply({ text: "APPROVE" }).action.type).toBe("approve");
    expect(parseApprovalReply({ text: "LGTM" }).action.type).toBe("approve");

    const rejected = parseApprovalReply({
      text: "REJECT Please soften the tone",
    });
    expect(rejected.action).toEqual({
      type: "reject",
      feedback: "Please soften the tone",
    });

    const edited = parseApprovalReply({
      text: "EDIT\nHello — ETA tomorrow.",
    });
    expect(edited.action).toEqual({
      type: "edit_and_approve",
      edits: { markdown: "Hello — ETA tomorrow." },
    });

    expect(parseApprovalReply({ text: "Too curt." }).action).toEqual({
      type: "reject",
      feedback: "Too curt.",
    });
  });

  it("extracts tokens from plus-address and URLs", () => {
    expect(extractApprovalToken("approve+appr_abc123@envlo.dev")).toBe(
      "appr_abc123",
    );
    expect(
      extractApprovalToken("https://app.envlo.dev/a?token=appr_abc123&action=approve"),
    ).toBe("appr_abc123");
  });
});

describe("CLI / webhook approval channels", () => {
  it("Interactive CLI approve / reject / edit paths", async () => {
    const { controller, draft } = await pendingDraft();
    const lines = ["a"];
    let i = 0;
    const approved = await promptDraftApproval(controller, draft.id, {
      write: () => {},
      readLine: async () => lines[i++] ?? "",
    });
    expect(approved.status).toBe("APPROVED");

    const again = await pendingDraft();
    const rejectLines = ["r", "Needs more detail"];
    let j = 0;
    const rejected = await promptDraftApproval(again.controller, again.draft.id, {
      write: () => {},
      readLine: async () => rejectLines[j++] ?? "",
    });
    expect(rejected.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(rejected.humanFeedback).toBe("Needs more detail");

    const editCase = await pendingDraft();
    const editLines = ["e", "Edited body", "."];
    let k = 0;
    const edited = await promptDraftApproval(
      editCase.controller,
      editCase.draft.id,
      {
        write: () => {},
        readLine: async () => editLines[k++] ?? "",
      },
    );
    expect(edited.status).toBe("APPROVED");
    expect(edited.currentMarkdown).toBe("Edited body");
  });

  it("CLI channel notifyPending runs the prompt", async () => {
    const { controller, draft } = await pendingDraft();
    const channel = new InteractiveCliApprovalChannel({
      controller,
      io: {
        write: () => {},
        readLine: async () => "a",
      },
    });
    controller.addChannel(channel);
    await controller.notifyPending(draft.id);
    const updated = await controller.state.getDraft(draft.id);
    expect(updated?.status).toBe("APPROVED");
  });

  it("Webhook channel POSTs payload and handles decision callbacks", async () => {
    const { controller, draft } = await pendingDraft();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "ok",
      json: async () => ({}),
    }));
    const channel = new WebhookApprovalChannel({
      url: "https://hooks.example/envlo",
      fetch: fetchMock,
    });
    await channel.notifyPending(draft);
    expect(channel.delivered[0]?.draftId).toBe(draft.id);
    expect(fetchMock).toHaveBeenCalledOnce();

    const rejected = await handleWebhookApprovalRequest(controller, {
      action: "reject",
      draftId: draft.id,
      feedback: "Webhook says no",
    });
    expect(rejected.status).toBe("REJECTED_WITH_FEEDBACK");
  });
});

describe("Slack Block Kit approval", () => {
  it("builds Approve / Edit & Approve / Reject buttons", () => {
    const { draft } = {
      draft: {
        id: "draft_1",
        threadId: "t1",
        inboxId: "i1",
        status: "PENDING_APPROVAL" as const,
        toAddresses: ["a@x.com"],
        subject: "Hi",
        originalDraftMarkdown: "body",
        currentMarkdown: "body",
        finalSentMarkdown: null,
        humanFeedback: null,
        inReplyTo: null,
        references: [],
        createdMessageId: null,
        sentMessageRowId: null,
        createdAt: "",
        updatedAt: "",
        submittedAt: "",
        decidedAt: null,
        sentAt: null,
      },
    };
    const message = buildSlackApprovalBlocks(draft);
    const actions = message.blocks.find((b) => b.type === "actions") as {
      elements: Array<{ action_id: string }>;
    };
    expect(actions.elements.map((e) => e.action_id)).toEqual([
      SLACK_ACTION_APPROVE,
      SLACK_ACTION_EDIT_APPROVE,
      SLACK_ACTION_REJECT,
    ]);
    expect(buildSlackEditApproveModal(draft.id).callback_id).toBe(
      "envlo_edit_approve_submit",
    );
    expect(buildSlackRejectModal(draft.id).callback_id).toBe(
      "envlo_reject_submit",
    );
  });

  it("Reject with Feedback updates draft and wakes wait_for_email", async () => {
    const { controller, draft, events, thread } = await pendingDraft();
    const wake = waitForDraftDecision(events, { threadId: thread.id });

    const channel = new SlackApprovalChannel({
      webhookUrl: "https://hooks.slack.com/services/x",
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => "ok",
        json: async () => ({}),
      }),
    });
    await channel.notifyPending(draft);
    expect(channel.delivered).toHaveLength(1);

    // Button click → open reject modal
    const open = interpretSlackInteraction({
      actions: [{ action_id: SLACK_ACTION_REJECT, value: draft.id }],
    });
    expect(open).toEqual({
      kind: "open_modal",
      draftId: draft.id,
      modal: "reject",
    });

    // Modal submit → reject
    const decision = interpretSlackInteraction({
      type: "view_submission",
      view: {
        callback_id: "envlo_reject_submit",
        private_metadata: draft.id,
        state: {
          values: {
            feedback_block: { feedback: { value: "Too assertive" } },
          },
        },
      },
    });
    expect(decision.kind).toBe("decision");
    if (decision.kind !== "decision") throw new Error("expected decision");

    const rejected = await handleSlackApprovalDecision(
      controller,
      decision.draftId,
      decision.action,
    );
    expect(rejected.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(rejected.humanFeedback).toBe("Too assertive");

    const event = await wake;
    expect(event.type).toBe("draft.rejected");
    if (event.type === "draft.rejected") {
      expect(event.draft.id).toBe(draft.id);
      expect(event.source).toBe("slack");
    }
  });

  it("Approve button and Edit & Approve modal work", async () => {
    const first = await pendingDraft();
    const approve = interpretSlackInteraction({
      actions: [{ action_id: SLACK_ACTION_APPROVE, value: first.draft.id }],
    });
    expect(approve.kind).toBe("decision");
    if (approve.kind === "decision") {
      const d = await handleSlackApprovalDecision(
        first.controller,
        approve.draftId,
        approve.action,
      );
      expect(d.status).toBe("APPROVED");
    }

    const second = await pendingDraft();
    const edit = interpretSlackInteraction({
      type: "view_submission",
      view: {
        callback_id: "envlo_edit_approve_submit",
        private_metadata: second.draft.id,
        state: {
          values: {
            markdown_block: { markdown: { value: "Softer reply" } },
          },
        },
      },
    });
    expect(edit.kind).toBe("decision");
    if (edit.kind === "decision") {
      const d = await handleSlackApprovalDecision(
        second.controller,
        edit.draftId,
        edit.action,
      );
      expect(d.status).toBe("APPROVED");
      expect(d.currentMarkdown).toBe("Softer reply");
    }
  });
});

describe("Magic-link Reply-to-Approve", () => {
  it("sends cloud approval mail and handles click reject with wake", async () => {
    const { controller, draft, events } = await pendingDraft();
    const sender = new ConsoleDryRunSender({ log: () => {} });
    const channel = new MagicLinkApprovalChannel({
      controller,
      sender,
      supervisorEmail: "boss@acme.com",
      mode: "cloud",
      baseUrl: "https://app.envlo.dev/approvals",
    });

    const wake = waitForDraftDecision(events, { draftId: draft.id });
    await channel.notifyPending(draft);

    expect(channel.sent[0]?.from).toBe("approvals@envlo.dev");
    expect(channel.sent[0]?.to).toEqual(["boss@acme.com"]);
    expect(channel.sent[0]?.replyTo).toMatch(/^approve\+appr_.+@envlo\.dev$/);
    expect(channel.sent[0]?.html).toContain("Reject with Feedback");

    const token = extractApprovalToken(channel.sent[0]?.replyTo)!;
    const rejected = await channel.handleClick({
      token,
      action: "reject",
      feedback: "Please add an ETA",
    });
    expect(rejected.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(rejected.humanFeedback).toBe("Please add an ETA");

    const event = await wake;
    expect(event.type).toBe("draft.rejected");
  });

  it("local mode uses BYO from and reply parsing wakes waiters", async () => {
    const { controller, draft, events, thread } = await pendingDraft();
    const sender = new ConsoleDryRunSender({ log: () => {} });
    const channel = new MagicLinkApprovalChannel({
      controller,
      sender,
      supervisorEmail: "boss@acme.com",
      mode: "local",
      from: "approvals@localhost",
      baseUrl: "http://127.0.0.1:8787/approvals",
    });
    await channel.notifyPending(draft);
    expect(channel.sent[0]?.from).toBe("approvals@localhost");

    const wake = waitForDraftDecision(events, { threadId: thread.id });
    const rejected = await channel.handleInboundReply({
      to: channel.sent[0]?.replyTo,
      text: "Too vague — add numbers.",
    });
    expect(rejected.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(rejected.humanFeedback).toBe("Too vague — add numbers.");
    await expect(wake).resolves.toMatchObject({ type: "draft.rejected" });
  });

  it("inbound APPROVE and EDIT replies", async () => {
    const approveCase = await pendingDraft();
    const sender = new ConsoleDryRunSender({ log: () => {} });
    const channel = new MagicLinkApprovalChannel({
      controller: approveCase.controller,
      sender,
      supervisorEmail: "boss@acme.com",
      mode: "cloud",
      baseUrl: "https://app.envlo.dev/approvals",
    });
    await channel.notifyPending(approveCase.draft);
    const approved = await channel.handleInboundReply({
      to: channel.sent[0]?.replyTo,
      text: "APPROVE",
    });
    expect(approved.status).toBe("APPROVED");

    const editCase = await pendingDraft();
    const editChannel = new MagicLinkApprovalChannel({
      controller: editCase.controller,
      sender: new ConsoleDryRunSender({ log: () => {} }),
      supervisorEmail: "boss@acme.com",
      mode: "cloud",
      baseUrl: "https://app.envlo.dev/approvals",
    });
    await editChannel.notifyPending(editCase.draft);
    const edited = await editChannel.handleInboundReply({
      to: editChannel.sent[0]?.replyTo,
      text: "EDIT\nFinal copy from phone",
    });
    expect(edited.status).toBe("APPROVED");
    expect(edited.currentMarkdown).toBe("Final copy from phone");
  });
});
