import {
  assertToolAllowedForRisk,
  type ToolRiskPolicyOptions,
} from "../firewall/injection/policy.js";
import type { InjectionRisk } from "../firewall/injection/types.js";
import type { DraftRecord, EnvloStateStore } from "../state/types.js";
import { resolveOutboundPolicyConfig } from "./config.js";
import { evaluateOutboundPolicy } from "./evaluate.js";
import { OutboundIdempotencyGuard } from "./idempotency.js";
import {
  LoopBreakerTrippedError,
  RunawayLoopBreaker,
} from "./loop-breaker.js";
import {
  autoSendApprovedDraft,
  enforceOutboundPolicy,
  rememberOutboundMessageId,
  type EnforceOutboundResult,
} from "./orchestrate.js";
import { primaryRecipient } from "./recipients.js";
import type {
  IdempotencyHit,
  OutboundPolicyConfig,
  OutboundPolicyContext,
  OutboundPolicyDecision,
  ResolvedOutboundPolicyConfig,
} from "./types.js";

export type OutboundPolicyEngineOptions = {
  config?: OutboundPolicyConfig;
  /**
   * Shared loop breaker (required for accumulation across calls).
   * Created automatically when omitted.
   */
  loopBreaker?: RunawayLoopBreaker;
  /**
   * Shared idempotency guard (required for 5-min dedupe across calls).
   * Created automatically when omitted.
   */
  idempotency?: OutboundIdempotencyGuard;
};

/**
 * Long-lived outbound policy engine: holds shared loop-breaker + idempotency
 * state so retries and send counting work across tool invocations.
 *
 * Prefer this over calling `enforceOutboundPolicy` with fresh stores each time.
 */
export class OutboundPolicyEngine {
  readonly config: ResolvedOutboundPolicyConfig;
  readonly loopBreaker: RunawayLoopBreaker;
  readonly idempotency: OutboundIdempotencyGuard;

  constructor(options: OutboundPolicyEngineOptions = {}) {
    this.config = resolveOutboundPolicyConfig(options.config);
    this.loopBreaker =
      options.loopBreaker ?? new RunawayLoopBreaker(this.config.loopBreaker);
    this.idempotency =
      options.idempotency ??
      new OutboundIdempotencyGuard({ ttlMs: this.config.idempotency.ttlMs });
  }

  /** Pure decision (no store mutation). */
  evaluate(ctx: OutboundPolicyContext): OutboundPolicyDecision {
    return evaluateOutboundPolicy(ctx, { config: optionsConfig(this.config) });
  }

  /**
   * Allow side-effect tools under high/medium risk so drafts can enter
   * PENDING_APPROVAL (Phase-1 #10). Legacy hard-deny remains available via
   * `assertToolAllowedForRisk` without `allowPendingApproval`.
   */
  assertToolAllowed(
    toolName: string,
    risk: InjectionRisk,
    options: ToolRiskPolicyOptions = {},
  ): void {
    assertToolAllowedForRisk(toolName, risk, {
      allowPendingApproval: true,
      ...options,
    });
  }

  /** Gate + create/submit draft using shared loop/idempotency stores. */
  async enforce(
    ctx: OutboundPolicyContext,
    state: EnvloStateStore,
  ): Promise<EnforceOutboundResult> {
    this.assertToolAllowed(ctx.tool, ctx.injectionRisk ?? "low");
    return enforceOutboundPolicy(ctx, {
      state,
      config: optionsConfig(this.config),
      idempotency: this.idempotency,
      loopBreaker: this.loopBreaker,
      // Count emails on successful send, not draft attempts.
      recordLoopOnAttempt: false,
    });
  }

  /**
   * Mark draft sent and record the send against the loop breaker + idempotency.
   */
  async sendApprovedDraft(options: {
    state: EnvloStateStore;
    draftId: string;
    ctx: OutboundPolicyContext;
    finalSentMarkdown?: string;
    messageId?: string;
  }): Promise<{ draft: DraftRecord; outboundMessageId: string }> {
    const sent = await autoSendApprovedDraft({
      state: options.state,
      draftId: options.draftId,
      guard: this.idempotency,
      ctx: options.ctx,
      ...(options.finalSentMarkdown !== undefined
        ? { finalSentMarkdown: options.finalSentMarkdown }
        : {}),
      ...(options.messageId !== undefined ? { messageId: options.messageId } : {}),
    });

    const recipient = primaryRecipient(options.ctx.to);
    if (recipient) {
      const trip = this.loopBreaker.recordOutbound(
        options.ctx.inboxId,
        recipient,
        options.ctx.nowMs ?? Date.now(),
      );
      // Pause is recorded; next enforce will throw if still paused.
      void trip;
    }

    return sent;
  }

  /** Clear pause / reset streak when inbound mail arrives from a recipient. */
  recordInbound(
    inboxId: string,
    fromAddress: string,
    atMs: number = Date.now(),
  ): void {
    this.loopBreaker.recordInbound(inboxId, fromAddress, atMs);
  }

  isRecipientPaused(inboxId: string, recipient: string): boolean {
    return this.loopBreaker.isPaused(inboxId, recipient);
  }

  listPausedRecipients(inboxId: string): string[] {
    return this.loopBreaker.listPausedRecipients(inboxId);
  }

  rememberOutboundMessageId(
    ctx: OutboundPolicyContext,
    outboundMessageId: string,
  ): IdempotencyHit {
    return rememberOutboundMessageId(this.idempotency, ctx, outboundMessageId);
  }
}

/** Convert resolved config back to OutboundPolicyConfig for evaluate/enforce. */
function optionsConfig(
  resolved: ResolvedOutboundPolicyConfig,
): OutboundPolicyConfig {
  return {
    requireApprovalIf: [...resolved.requireApprovalIf],
    escalateOnInjectionRisk: resolved.escalateOnInjectionRisk,
    allowAutoSend: resolved.allowAutoSend,
    loopBreaker: { ...resolved.loopBreaker },
    idempotency: { ...resolved.idempotency },
    internalDomains: [...resolved.internalDomains],
    amountThreshold: resolved.amountThreshold,
  };
}

export { LoopBreakerTrippedError };
