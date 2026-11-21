import type { ApprovalController } from "../adapters/approval-controller.js";
import { deliverApprovedDraft } from "../adapters/deliver.js";
import type { DraftLifecycleBus } from "../adapters/events.js";
import type { OutboundMailAttachment, OutboundSender } from "../adapters/types.js";
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
  /** Optional BYO sender used by `sendApprovedDraft` when `from` is set. */
  sender?: OutboundSender;
  /** Default From address for transport sends. */
  from?: string;
  /** When set, `enforce` auto-notifies on REQUIRE_APPROVAL. */
  approval?: ApprovalController;
  events?: DraftLifecycleBus;
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
  readonly sender: OutboundSender | undefined;
  readonly from: string | undefined;
  readonly approval: ApprovalController | undefined;
  readonly events: DraftLifecycleBus | undefined;

  constructor(options: OutboundPolicyEngineOptions = {}) {
    this.config = resolveOutboundPolicyConfig(options.config);
    this.loopBreaker =
      options.loopBreaker ?? new RunawayLoopBreaker(this.config.loopBreaker);
    this.idempotency =
      options.idempotency ??
      new OutboundIdempotencyGuard({ ttlMs: this.config.idempotency.ttlMs });
    this.sender = options.sender;
    this.from = options.from;
    this.approval = options.approval;
    this.events = options.events;
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

  /**
   * Gate + create/submit draft using shared loop/idempotency stores.
   * When an `ApprovalController` is configured and disposition is
   * REQUIRE_APPROVAL, fans out `notifyPending` automatically.
   */
  async enforce(
    ctx: OutboundPolicyContext,
    state: EnvloStateStore,
  ): Promise<EnforceOutboundResult> {
    this.assertToolAllowed(ctx.tool, ctx.injectionRisk ?? "low");
    const result = await enforceOutboundPolicy(ctx, {
      state,
      config: optionsConfig(this.config),
      idempotency: this.idempotency,
      loopBreaker: this.loopBreaker,
      recordLoopOnAttempt: false,
    });

    if (
      this.approval &&
      result.decision?.disposition === "REQUIRE_APPROVAL" &&
      result.draft &&
      !result.idempotentReplay
    ) {
      await this.approval.notifyPending(result.draft.id);
    }

    return result;
  }

  /**
   * Send an approved draft. When `sender` (+ `from`) is available, transport
   * via `deliverApprovedDraft`; otherwise state-only `markDraftSent`.
   */
  async sendApprovedDraft(options: {
    state: EnvloStateStore;
    draftId: string;
    ctx: OutboundPolicyContext;
    finalSentMarkdown?: string;
    messageId?: string;
    sender?: OutboundSender;
    from?: string;
    html?: string;
    attachments?: OutboundMailAttachment[];
  }): Promise<{ draft: DraftRecord; outboundMessageId: string }> {
    const sender = options.sender ?? this.sender;
    const from = options.from ?? this.from;

    if (sender && from) {
      const delivered = await deliverApprovedDraft({
        state: options.state,
        sender,
        draftId: options.draftId,
        from,
        ...(options.finalSentMarkdown !== undefined
          ? { text: options.finalSentMarkdown }
          : {}),
        ...(options.html !== undefined ? { html: options.html } : {}),
        ...(options.attachments !== undefined
          ? { attachments: options.attachments }
          : {}),
        ...(this.events ? { events: this.events } : {}),
      });

      rememberOutboundMessageId(
        this.idempotency,
        options.ctx,
        delivered.send.messageId,
      );

      const recipient = primaryRecipient(options.ctx.to);
      if (recipient) {
        this.loopBreaker.recordOutbound(
          options.ctx.inboxId,
          recipient,
          options.ctx.nowMs ?? Date.now(),
        );
      }

      return {
        draft: delivered.draft,
        outboundMessageId: delivered.send.messageId,
      };
    }

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
      this.loopBreaker.recordOutbound(
        options.ctx.inboxId,
        recipient,
        options.ctx.nowMs ?? Date.now(),
      );
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
