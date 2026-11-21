import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../../src/state/index.js";
import {
  LoopBreakerTrippedError,
  OutboundIdempotencyGuard,
  OutboundPolicyEngine,
  RunawayLoopBreaker,
  autoSendApprovedDraft,
  enforceOutboundPolicy,
  evaluateOutboundPolicy,
} from "../../src/policy/index.js";

async function seededThread() {
  const state = new MemoryStateStore();
  const inbox = await state.createInbox({ address: "agent@envlo.dev" });
  const { thread } = await state.ingestMessage(inbox.id, {
    messageId: "<in@acme.com>",
    fromAddress: "user@acme.com",
    subject: "Help",
    bodyMarkdown: "Need help",
  });
  return { state, inbox, thread };
}

describe("enforceOutboundPolicy", () => {
  it("high-injection-risk threads escalate to PENDING_APPROVAL", async () => {
    const { state, inbox, thread } = await seededThread();
    const result = await enforceOutboundPolicy(
      {
        tool: "reply_to_thread",
        inboxId: inbox.id,
        threadId: thread.id,
        to: ["user@acme.com"],
        subject: "Re: Help",
        markdownBody: "Working on it.",
        inboxAddress: "agent@envlo.dev",
        injectionRisk: "high",
        hasAttachment: false,
      },
      {
        state,
        config: {
          requireApprovalIf: ["high_injection_risk_thread"],
          internalDomains: ["acme.com"],
        },
      },
    );

    expect(result.idempotentReplay).toBe(false);
    expect(result.decision?.disposition).toBe("REQUIRE_APPROVAL");
    expect(result.decision?.autoSendRevoked).toBe(true);
    expect(result.draft?.status).toBe("PENDING_APPROVAL");

    const view = await state.readThread(thread.id);
    expect(view?.activeDrafts[0]?.status).toBe("PENDING_APPROVAL");
  });

  it("returns cached draftId within 5 minutes without double-creating", async () => {
    const { state, inbox, thread } = await seededThread();
    const guard = new OutboundIdempotencyGuard();
    const ctx = {
      tool: "reply_to_thread" as const,
      inboxId: inbox.id,
      threadId: thread.id,
      to: ["user@acme.com"],
      subject: "Re: Help",
      markdownBody: "Same body",
      inboxAddress: "agent@envlo.dev",
      injectionRisk: "low" as const,
      nowMs: 50_000,
    };

    const first = await enforceOutboundPolicy(ctx, {
      state,
      idempotency: guard,
      config: { requireApprovalIf: [], escalateOnInjectionRisk: "off" },
    });
    expect(first.draft?.status).toBe("APPROVED");

    const second = await enforceOutboundPolicy(
      { ...ctx, nowMs: 50_000 + 60_000 },
      {
        state,
        idempotency: guard,
        config: { requireApprovalIf: [], escalateOnInjectionRisk: "off" },
      },
    );
    expect(second.idempotentReplay).toBe(true);
    expect(second.cached?.draftId).toBe(first.draft?.id);
    expect(second.draft?.id).toBe(first.draft?.id);

    const drafts = await state.listActiveDrafts(thread.id);
    expect(drafts).toHaveLength(1);
  });

  it("autoSendApprovedDraft fills outboundMessageId on the cache", async () => {
    const { state, inbox, thread } = await seededThread();
    const guard = new OutboundIdempotencyGuard();
    const ctx = {
      tool: "send_email" as const,
      inboxId: inbox.id,
      threadId: thread.id,
      to: ["peer@envlo.dev"],
      subject: "Ping",
      markdownBody: "Hello peer",
      inboxAddress: "agent@envlo.dev",
      injectionRisk: "low" as const,
    };

    const prepared = await enforceOutboundPolicy(ctx, {
      state,
      idempotency: guard,
      config: { requireApprovalIf: [], escalateOnInjectionRisk: "off" },
    });
    expect(prepared.draft?.status).toBe("APPROVED");

    const sent = await autoSendApprovedDraft({
      state,
      draftId: prepared.draft!.id,
      guard,
      ctx,
      messageId: "<out@envlo.dev>",
    });
    expect(sent.outboundMessageId).toBe("<out@envlo.dev>");

    const replay = await enforceOutboundPolicy(ctx, {
      state,
      idempotency: guard,
      config: { requireApprovalIf: [], escalateOnInjectionRisk: "off" },
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.cached?.outboundMessageId).toBe("<out@envlo.dev>");
  });

  it("does not trip the loop breaker on draft attempts alone", async () => {
    const { state, inbox, thread } = await seededThread();
    const loop = new RunawayLoopBreaker({ maxOutboundWithoutReply: 3 });
    const t0 = 100_000;

    for (let i = 0; i < 5; i += 1) {
      const result = await enforceOutboundPolicy(
        {
          tool: "send_email",
          inboxId: inbox.id,
          threadId: thread.id,
          to: ["user@acme.com"],
          subject: `Msg ${i}`,
          markdownBody: `Body ${i}`,
          inboxAddress: "agent@envlo.dev",
          injectionRisk: "low",
          nowMs: t0 + i * 1000,
        },
        {
          state,
          loopBreaker: loop,
          config: {
            requireApprovalIf: [],
            escalateOnInjectionRisk: "off",
            internalDomains: ["acme.com"],
          },
        },
      );
      expect(result.draft?.status).toBe("APPROVED");
    }
    expect(loop.isPaused("inbox", "user@acme.com")).toBe(false);
  });

  it("OutboundPolicyEngine trips after 3 successful sends and auto-pauses", async () => {
    const { state, inbox, thread } = await seededThread();
    const engine = new OutboundPolicyEngine({
      config: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
        internalDomains: ["acme.com"],
      },
    });
    const t0 = 200_000;

    for (let i = 0; i < 3; i += 1) {
      const ctx = {
        tool: "send_email" as const,
        inboxId: inbox.id,
        threadId: thread.id,
        to: ["user@acme.com"],
        subject: `Send ${i}`,
        markdownBody: `Sent body ${i}`,
        inboxAddress: "agent@envlo.dev",
        injectionRisk: "low" as const,
        nowMs: t0 + i * 1000,
      };
      const prepared = await engine.enforce(ctx, state);
      await engine.sendApprovedDraft({
        state,
        draftId: prepared.draft!.id,
        ctx,
        messageId: `<out-${i}@envlo.dev>`,
      });
    }

    expect(engine.isRecipientPaused(inbox.id, "user@acme.com")).toBe(true);

    await expect(
      engine.enforce(
        {
          tool: "send_email",
          inboxId: inbox.id,
          threadId: thread.id,
          to: ["user@acme.com"],
          subject: "Send 3",
          markdownBody: "Blocked",
          inboxAddress: "agent@envlo.dev",
          injectionRisk: "low",
          nowMs: t0 + 4000,
        },
        state,
      ),
    ).rejects.toThrow(LoopBreakerTrippedError);

    // Inbound reply clears pause.
    engine.recordInbound(inbox.id, "user@acme.com", t0 + 5000);
    expect(engine.isRecipientPaused(inbox.id, "user@acme.com")).toBe(false);
  });

  it("allows high-risk tools when engine defers to PENDING_APPROVAL", async () => {
    const { state, inbox, thread } = await seededThread();
    const engine = new OutboundPolicyEngine({
      config: { internalDomains: ["acme.com"] },
    });
    expect(() =>
      engine.assertToolAllowed("reply_to_thread", "high"),
    ).not.toThrow();

    const result = await engine.enforce(
      {
        tool: "reply_to_thread",
        inboxId: inbox.id,
        threadId: thread.id,
        to: ["user@acme.com"],
        markdownBody: "Cautious reply",
        inboxAddress: "agent@envlo.dev",
        injectionRisk: "high",
      },
      state,
    );
    expect(result.draft?.status).toBe("PENDING_APPROVAL");
  });

  it("pure evaluate matches enforce disposition for amount + attachment", () => {
    const decision = evaluateOutboundPolicy({
      tool: "forward_thread",
      inboxId: "i",
      to: ["peer@envlo.dev"],
      markdownBody: "Forwarding the $250 quote",
      hasAttachment: true,
      inboxAddress: "agent@envlo.dev",
      injectionRisk: "low",
    });
    expect(decision.matchedRules).toEqual(
      expect.arrayContaining(["has_attachment", "contains_amount_over_100"]),
    );
    expect(decision.disposition).toBe("REQUIRE_APPROVAL");
  });

  it("OutboundPolicyEngine replays identical enforce via shared idempotency", async () => {
    const { state, inbox, thread } = await seededThread();
    const engine = new OutboundPolicyEngine({
      config: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
        internalDomains: ["acme.com"],
      },
    });
    const ctx = {
      tool: "reply_to_thread" as const,
      inboxId: inbox.id,
      threadId: thread.id,
      to: ["user@acme.com"],
      subject: "Re: Help",
      markdownBody: "Same engine body",
      inboxAddress: "agent@envlo.dev",
      injectionRisk: "low" as const,
      nowMs: 80_000,
    };

    const first = await engine.enforce(ctx, state);
    expect(first.idempotentReplay).toBe(false);
    expect(first.draft?.status).toBe("APPROVED");

    const second = await engine.enforce({ ...ctx, nowMs: 80_000 + 30_000 }, state);
    expect(second.idempotentReplay).toBe(true);
    expect(second.draft?.id).toBe(first.draft?.id);
    expect(await state.listActiveDrafts(thread.id)).toHaveLength(1);
  });

  it("creates a second draft after idempotency TTL expires", async () => {
    const { state, inbox, thread } = await seededThread();
    const guard = new OutboundIdempotencyGuard({ ttlMs: 1000 });
    const base = {
      tool: "send_email" as const,
      inboxId: inbox.id,
      threadId: thread.id,
      to: ["peer@envlo.dev"],
      subject: "TTL",
      markdownBody: "Expires soon",
      inboxAddress: "agent@envlo.dev",
      injectionRisk: "low" as const,
    };
    const config = {
      requireApprovalIf: [] as const,
      escalateOnInjectionRisk: "off" as const,
      idempotency: { ttlMs: 1000 },
    };

    const first = await enforceOutboundPolicy(
      { ...base, nowMs: 0 },
      { state, idempotency: guard, config },
    );
    const expired = await enforceOutboundPolicy(
      { ...base, nowMs: 1001 },
      { state, idempotency: guard, config },
    );

    expect(expired.idempotentReplay).toBe(false);
    expect(expired.draft?.id).not.toBe(first.draft?.id);
    expect(await state.listActiveDrafts(thread.id)).toHaveLength(2);
  });

  it("throws when threadId is missing", async () => {
    const { state, inbox } = await seededThread();
    await expect(
      enforceOutboundPolicy(
        {
          tool: "send_email",
          inboxId: inbox.id,
          to: ["peer@envlo.dev"],
          markdownBody: "No thread",
          inboxAddress: "agent@envlo.dev",
          injectionRisk: "low",
        },
        {
          state,
          config: { requireApprovalIf: [], escalateOnInjectionRisk: "off" },
        },
      ),
    ).rejects.toThrow(/threadId/);
  });

  it("autoSendApprovedDraft rejects drafts not pending or approved", async () => {
    const { state, thread } = await seededThread();
    const draft = await state.createDraft({
      threadId: thread.id,
      markdown: "raw draft",
      toAddresses: ["peer@envlo.dev"],
    });
    expect(draft.status).toBe("DRAFT");

    await expect(
      autoSendApprovedDraft({ state, draftId: draft.id }),
    ).rejects.toThrow(/PENDING_APPROVAL or APPROVED/);

    const pending = await state.submitDraftForApproval(draft.id);
    const approved = await state.approveDraft(pending.id);
    const sent = await state.markDraftSent(approved.id, {
      messageId: "<already-sent@envlo.dev>",
    });
    expect(sent.draft.status).toBe("SENT");

    await expect(
      autoSendApprovedDraft({ state, draftId: sent.draft.id }),
    ).rejects.toThrow(/PENDING_APPROVAL or APPROVED/);
  });

  it("human approval path: PENDING → approve → sendApprovedDraft", async () => {
    const { state, inbox, thread } = await seededThread();
    const engine = new OutboundPolicyEngine({
      config: { internalDomains: ["acme.com"] },
    });
    const ctx = {
      tool: "reply_to_thread" as const,
      inboxId: inbox.id,
      threadId: thread.id,
      to: ["user@acme.com"],
      subject: "Re: Help",
      markdownBody: "Needs a human",
      inboxAddress: "agent@envlo.dev",
      injectionRisk: "high" as const,
      nowMs: 300_000,
    };

    const prepared = await engine.enforce(ctx, state);
    expect(prepared.draft?.status).toBe("PENDING_APPROVAL");

    await state.approveDraft(prepared.draft!.id);
    const sent = await engine.sendApprovedDraft({
      state,
      draftId: prepared.draft!.id,
      ctx,
      messageId: "<human-approved@envlo.dev>",
    });
    expect(sent.outboundMessageId).toBe("<human-approved@envlo.dev>");
    expect(sent.draft.status).toBe("SENT");
  });

  it("loop breaker buckets on the primary To recipient only", async () => {
    const breaker = new RunawayLoopBreaker({ maxOutboundWithoutReply: 3 });
    const t0 = 400_000;
    breaker.recordOutbound("inbox", "primary@acme.com", t0);
    breaker.recordOutbound("inbox", "primary@acme.com", t0 + 1);
    breaker.recordOutbound("inbox", "primary@acme.com", t0 + 2);

    expect(
      breaker.checkContext(
        "inbox",
        ["primary@acme.com", "cc@other.com"],
        t0 + 3,
      ).tripped,
    ).toBe(true);
    expect(
      breaker.checkContext("inbox", ["cc@other.com", "primary@acme.com"], t0 + 3)
        .tripped,
    ).toBe(false);
    expect(breaker.listPausedRecipients("inbox")).toEqual(["primary@acme.com"]);
  });

  it("recordLoopOnAttempt=true counts draft attempts toward the breaker", async () => {
    const { state, inbox, thread } = await seededThread();
    const loop = new RunawayLoopBreaker({ maxOutboundWithoutReply: 3 });
    const t0 = 500_000;
    const config = {
      requireApprovalIf: [] as const,
      escalateOnInjectionRisk: "off" as const,
      internalDomains: ["acme.com"],
    };

    for (let i = 0; i < 3; i += 1) {
      await enforceOutboundPolicy(
        {
          tool: "send_email",
          inboxId: inbox.id,
          threadId: thread.id,
          to: ["user@acme.com"],
          subject: `Attempt ${i}`,
          markdownBody: `Attempt body ${i}`,
          inboxAddress: "agent@envlo.dev",
          injectionRisk: "low",
          nowMs: t0 + i,
        },
        { state, loopBreaker: loop, config, recordLoopOnAttempt: true },
      );
    }

    expect(loop.isPaused(inbox.id, "user@acme.com")).toBe(true);
    await expect(
      enforceOutboundPolicy(
        {
          tool: "send_email",
          inboxId: inbox.id,
          threadId: thread.id,
          to: ["user@acme.com"],
          subject: "Blocked attempt",
          markdownBody: "nope",
          inboxAddress: "agent@envlo.dev",
          injectionRisk: "low",
          nowMs: t0 + 10,
        },
        { state, loopBreaker: loop, config, recordLoopOnAttempt: true },
      ),
    ).rejects.toThrow(LoopBreakerTrippedError);
  });
});
