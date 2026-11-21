import type { DraftRecord, EnvloStateStore } from "../state/types.js";
import { evaluateOutboundPolicy } from "./evaluate.js";
import {
  OutboundIdempotencyGuard,
  type IdempotencyStore,
} from "./idempotency.js";
import {
  LoopBreakerTrippedError,
  RunawayLoopBreaker,
} from "./loop-breaker.js";
import { primaryRecipient } from "./recipients.js";
import type {
  IdempotencyHit,
  OutboundPolicyConfig,
  OutboundPolicyContext,
  OutboundPolicyDecision,
} from "./types.js";

export type EnforceOutboundResult = {
  /** True when a prior send/draft within the TTL was returned. */
  idempotentReplay: boolean;
  cached: IdempotencyHit | null;
  decision: OutboundPolicyDecision | null;
  /** Draft created/submitted when not an idempotent replay. */
  draft: DraftRecord | null;
};

export type EnforceOutboundOptions = {
  config?: OutboundPolicyConfig;
  state: EnvloStateStore;
  idempotency?: OutboundIdempotencyGuard | IdempotencyStore;
  loopBreaker?: RunawayLoopBreaker;
  /**
   * When true, count draft attempts toward the loop breaker.
   * Default **false** — count successful sends via `OutboundPolicyEngine.sendApprovedDraft`
   * / `recordOutbound` instead (ticket: emails, not drafts).
   */
  recordLoopOnAttempt?: boolean;
};

function asGuard(
  value: OutboundIdempotencyGuard | IdempotencyStore | undefined,
  ttlMs: number,
): OutboundIdempotencyGuard {
  if (!value) return new OutboundIdempotencyGuard({ ttlMs });
  if (value instanceof OutboundIdempotencyGuard) return value;
  return new OutboundIdempotencyGuard({ store: value, ttlMs });
}

/**
 * Full outbound gate for MCP tool handlers:
 * 1. Idempotency lookup → return cached draftId / outboundMessageId
 * 2. Loop breaker → DENY (throws LoopBreakerTrippedError)
 * 3. evaluateOutboundPolicy → AUTO_SEND | REQUIRE_APPROVAL
 * 4. createDraft (+ submitForApproval when approval required)
 * 5. Remember idempotency key → draftId
 *
 * AUTO_SEND still creates a draft and submits only when approval is required.
 * Hosts that want true auto-send should call `approveDraft` + `markDraftSent`
 * after this returns disposition AUTO_SEND (keeps human-approval path explicit).
 */
export async function enforceOutboundPolicy(
  ctx: OutboundPolicyContext,
  options: EnforceOutboundOptions,
): Promise<EnforceOutboundResult> {
  const decisionPreview =
    options.config !== undefined
      ? evaluateOutboundPolicy(ctx, { config: options.config })
      : evaluateOutboundPolicy(ctx);
  const guard = asGuard(
    options.idempotency,
    decisionPreview.config.idempotency.ttlMs,
  );
  const loop =
    options.loopBreaker ??
    new RunawayLoopBreaker(decisionPreview.config.loopBreaker);

  const cached = guard.lookup(ctx);
  if (cached) {
    return {
      idempotentReplay: true,
      cached,
      decision: null,
      draft: cached.draftId ? await options.state.getDraft(cached.draftId) : null,
    };
  }

  const trip = loop.checkContext(
    ctx.inboxId,
    ctx.to,
    ctx.nowMs ?? Date.now(),
  );
  if (trip.tripped) {
    throw new LoopBreakerTrippedError(trip);
  }

  const decision =
    options.config !== undefined
      ? evaluateOutboundPolicy(ctx, { config: options.config })
      : evaluateOutboundPolicy(ctx);

  if (!ctx.threadId) {
    throw new Error(
      "enforceOutboundPolicy requires threadId to create a draft (ingest the inbound message first)",
    );
  }

  const draft = await options.state.createDraft({
    threadId: ctx.threadId,
    markdown: ctx.markdownBody,
    toAddresses: ctx.to,
    ...(ctx.subject !== undefined ? { subject: ctx.subject } : {}),
  });

  let next = await options.state.submitDraftForApproval(draft.id);
  if (decision.disposition === "AUTO_SEND") {
    // No human gate: advance PENDING_APPROVAL → APPROVED. Host still calls
    // markDraftSent / transport send (or autoSendApprovedDraft).
    next = await options.state.approveDraft(next.id);
  }

  if (options.recordLoopOnAttempt === true) {
    const recipient = primaryRecipient(ctx.to);
    if (recipient) {
      loop.recordOutbound(ctx.inboxId, recipient, ctx.nowMs ?? Date.now());
    }
  }

  const remembered = guard.remember(
    ctx,
    { draftId: next.id, outboundMessageId: null },
    decision.config.idempotency,
  );

  return {
    idempotentReplay: false,
    cached: remembered,
    decision,
    draft: next,
  };
}

/**
 * After a successful markDraftSent / transport send, update the idempotency
 * cache with the outbound Message-ID so retries return it.
 */
export function rememberOutboundMessageId(
  guard: OutboundIdempotencyGuard,
  ctx: OutboundPolicyContext,
  outboundMessageId: string,
): IdempotencyHit {
  const key = OutboundIdempotencyGuard.keyFor(ctx);
  return guard.update(
    key,
    { outboundMessageId },
    ctx.tool,
    ctx.inboxId,
    ctx.nowMs ?? Date.now(),
  );
}

/**
 * Convenience: when disposition is AUTO_SEND, approve + mark sent through the
 * state store and record the outbound Message-ID on the idempotency guard.
 */
export async function autoSendApprovedDraft(options: {
  state: EnvloStateStore;
  draftId: string;
  guard?: OutboundIdempotencyGuard;
  ctx?: OutboundPolicyContext;
  finalSentMarkdown?: string;
  messageId?: string;
}): Promise<{ draft: DraftRecord; outboundMessageId: string }> {
  const existing = await options.state.getDraft(options.draftId);
  if (!existing) throw new Error(`draft not found: ${options.draftId}`);

  // enforceOutboundPolicy already APPROVEs on AUTO_SEND; only approve when still pending.
  if (existing.status === "PENDING_APPROVAL") {
    await options.state.approveDraft(options.draftId);
  } else if (existing.status !== "APPROVED") {
    throw new Error(
      `autoSendApprovedDraft requires PENDING_APPROVAL or APPROVED (got ${existing.status})`,
    );
  }

  const sent = await options.state.markDraftSent(options.draftId, {
    ...(options.finalSentMarkdown !== undefined
      ? { finalSentMarkdown: options.finalSentMarkdown }
      : {}),
    ...(options.messageId !== undefined ? { messageId: options.messageId } : {}),
  });
  if (options.guard && options.ctx) {
    rememberOutboundMessageId(
      options.guard,
      options.ctx,
      sent.message.messageId,
    );
  }
  return { draft: sent.draft, outboundMessageId: sent.message.messageId };
}
