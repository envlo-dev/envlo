import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApprovalController,
  ConsoleDryRunSender,
  DraftLifecycleBus,
  FileApprovalTokenStore,
  MagicLinkApprovalChannel,
  WebhookApprovalChannel,
  handleMagicLinkHttpRequest,
  renderMagicLinkFormPage,
  waitForDraftDecision,
} from "../../src/adapters/index.js";
import { OutboundPolicyEngine } from "../../src/policy/index.js";
import { MemoryStateStore } from "../../src/state/index.js";

async function pendingSetup() {
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

describe("gap fixes 1/2/5 + nice-to-haves", () => {
  it("OutboundPolicyEngine.sendApprovedDraft transports via OutboundSender", async () => {
    const { state, inbox, thread } = await pendingSetup();
    const sender = new ConsoleDryRunSender({ log: () => {} });
    const engine = new OutboundPolicyEngine({
      config: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
        internalDomains: ["acme.com"],
      },
      sender,
      from: "agent@envlo.dev",
    });

    const ctx = {
      tool: "send_email" as const,
      inboxId: inbox.id,
      threadId: thread.id,
      to: ["user@acme.com"],
      subject: "Ping",
      markdownBody: "Hello via sender",
      inboxAddress: "agent@envlo.dev",
      injectionRisk: "low" as const,
    };
    const prepared = await engine.enforce(ctx, state);
    expect(prepared.draft?.status).toBe("APPROVED");

    const sent = await engine.sendApprovedDraft({
      state,
      draftId: prepared.draft!.id,
      ctx,
    });
    expect(sent.draft.status).toBe("SENT");
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.text).toContain("Hello via sender");
    expect(sent.outboundMessageId).toMatch(/^</);
  });

  it("enforce auto-notifies ApprovalController on REQUIRE_APPROVAL", async () => {
    const state = new MemoryStateStore();
    const events = new DraftLifecycleBus();
    const inbox = await state.createInbox({ address: "agent@envlo.dev" });
    const { thread } = await state.ingestMessage(inbox.id, {
      messageId: "<in@acme.com>",
      fromAddress: "user@acme.com",
      bodyMarkdown: "hi",
    });
    const controller = new ApprovalController({ state, events });
    const webhook = new WebhookApprovalChannel({
      url: "https://hooks.example/x",
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => "ok",
        json: async () => ({}),
      }),
    });
    controller.addChannel(webhook);

    const engine = new OutboundPolicyEngine({
      config: { internalDomains: ["acme.com"] },
      approval: controller,
    });
    const result = await engine.enforce(
      {
        tool: "reply_to_thread",
        inboxId: inbox.id,
        threadId: thread.id,
        to: ["user@acme.com"],
        markdownBody: "needs approval",
        inboxAddress: "agent@envlo.dev",
        injectionRisk: "high",
      },
      state,
    );
    expect(result.draft?.status).toBe("PENDING_APPROVAL");
    expect(webhook.delivered).toHaveLength(1);
  });

  it("magic-link GET renders form; POST reject applies decision", async () => {
    const { controller, draft, events } = await pendingSetup();
    const channel = new MagicLinkApprovalChannel({
      controller,
      sender: new ConsoleDryRunSender({ log: () => {} }),
      supervisorEmail: "boss@acme.com",
      mode: "cloud",
      baseUrl: "https://app.envlo.dev/approvals",
    });
    await channel.notifyPending(draft);
    const issuedToken = channel.sent[0]?.headers?.["X-Envlo-Approval-Token"];
    expect(issuedToken).toBeTruthy();
    if (!issuedToken) throw new Error("expected approval token header");

    const formHtml = renderMagicLinkFormPage({
      token: issuedToken,
      action: "reject",
      draft,
    });
    expect(formHtml).toContain("Feedback");
    expect(formHtml).toContain(issuedToken);

    const get = await handleMagicLinkHttpRequest(channel, {
      method: "GET",
      url: `https://app.envlo.dev/approvals?token=${issuedToken}&action=reject`,
    });
    expect(get.status).toBe(200);
    expect(get.body).toContain("textarea");

    const wake = waitForDraftDecision(events, { draftId: draft.id });
    const post = await handleMagicLinkHttpRequest(channel, {
      method: "POST",
      url: "https://app.envlo.dev/approvals",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${issuedToken}&action=reject&feedback=${encodeURIComponent("Please soften")}`,
    });
    expect(post.status).toBe(200);
    expect(post.body).toContain("REJECTED_WITH_FEEDBACK");
    await expect(wake).resolves.toMatchObject({ type: "draft.rejected" });
  });

  it("approve/reject decisions are idempotent on replay", async () => {
    const { controller, draft } = await pendingSetup();
    const first = await controller.approve(draft.id, "webhook");
    expect(first.status).toBe("APPROVED");
    const second = await controller.approve(draft.id, "webhook");
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("APPROVED");

    const again = await pendingSetup();
    await again.controller.reject(again.draft.id, "nope", "slack");
    const replay = await again.controller.reject(
      again.draft.id,
      "different",
      "slack",
    );
    expect(replay.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(replay.humanFeedback).toBe("nope");
  });

  it("supports approve-with-note and comment-only", async () => {
    const { controller, draft, events } = await pendingSetup();
    const commented = await controller.comment(
      draft.id,
      "Looks close — fix ETA",
      "webhook",
    );
    expect(commented.status).toBe("PENDING_APPROVAL");
    expect(commented.humanFeedback).toContain("Looks close");
    expect(events.history.some((e) => e.type === "draft.comment")).toBe(true);

    const approved = await controller.approve(
      draft.id,
      "webhook",
      "Ship it",
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.humanFeedback).toContain("Ship it");
  });

  it("notifyPending continues when one channel fails", async () => {
    const { controller, draft } = await pendingSetup();
    const ok = new WebhookApprovalChannel({
      url: "https://ok.example",
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => "ok",
        json: async () => ({}),
      }),
    });
    const bad = new WebhookApprovalChannel({
      url: "https://bad.example",
      fetch: async () => ({
        ok: false,
        status: 500,
        text: async () => "boom",
        json: async () => ({}),
      }),
    });
    controller.addChannel(bad);
    controller.addChannel(ok);

    const result = await controller.notifyPending(draft.id);
    expect(result.channelErrors).toHaveLength(1);
    expect(ok.delivered).toHaveLength(1);
  });

  it("waitForDraftDecision wakes on approve by default", async () => {
    const { controller, draft, events } = await pendingSetup();
    const wake = waitForDraftDecision(events, { draftId: draft.id });
    await controller.approve(draft.id, "cli");
    await expect(wake).resolves.toMatchObject({ type: "draft.approved" });
  });

  it("FileApprovalTokenStore persists across instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "envlo-tokens-"));
    const path = join(dir, "tokens.json");
    const a = new FileApprovalTokenStore({ path });
    const issued = a.issue({
      draftId: "d1",
      threadId: "t1",
      inboxId: "i1",
    });
    const b = new FileApprovalTokenStore({ path });
    expect(b.peek(issued.token)?.draftId).toBe("d1");
    expect(b.consume(issued.token)?.draftId).toBe("d1");
    expect(b.peek(issued.token)).toBeNull();
  });

  it("magic-link reply strips quoted history before parsing", async () => {
    const { controller, draft } = await pendingSetup();
    const channel = new MagicLinkApprovalChannel({
      controller,
      sender: new ConsoleDryRunSender({ log: () => {} }),
      supervisorEmail: "boss@acme.com",
      mode: "cloud",
      baseUrl: "https://app.envlo.dev/approvals",
    });
    await channel.notifyPending(draft);
    const replyTo = channel.sent[0]?.replyTo;

    const rejected = await channel.handleInboundReply({
      to: replyTo,
      text: [
        "Too curt for a customer.",
        "",
        "On Mon, someone wrote:",
        "> An Envlo agent draft needs your approval.",
        "> APPROVE",
      ].join("\n"),
    });
    expect(rejected.status).toBe("REJECTED_WITH_FEEDBACK");
    expect(rejected.humanFeedback).toContain("Too curt");
    expect(rejected.humanFeedback).not.toContain("An Envlo agent draft");
  });

  it("throws AggregateError when every notify channel fails", async () => {
    const { controller, draft } = await pendingSetup();
    controller.addChannel(
      new WebhookApprovalChannel({
        url: "https://bad.example",
        fetch: async () => ({
          ok: false,
          status: 500,
          text: async () => "no",
          json: async () => ({}),
        }),
      }),
    );
    await expect(controller.notifyPending(draft.id)).rejects.toBeInstanceOf(
      AggregateError,
    );
  });
});
