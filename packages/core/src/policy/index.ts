export {
  DEFAULT_APPROVAL_RULES,
  DEFAULT_LOOP_MAX_OUTBOUND,
  DEFAULT_LOOP_WINDOW_MS,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_AMOUNT_THRESHOLD,
} from "./types.js";
export type {
  OutboundToolName,
  ApprovalRuleId,
  EscalateOnInjectionRisk,
  OutboundDisposition,
  PolicyReason,
  LoopBreakerConfig,
  IdempotencyConfig,
  OutboundPolicyConfig,
  OutboundPolicyContext,
  OutboundPolicyDecision,
  ResolvedOutboundPolicyConfig,
  IdempotencyHit,
  IdempotencyRecordInput,
  LoopBreakerTrip,
} from "./types.js";

export { resolveOutboundPolicyConfig } from "./config.js";
export { findAmounts, containsAmountOver } from "./amounts.js";
export type { AmountMatch } from "./amounts.js";
export {
  domainOfAddress,
  normalizeAddress,
  hasExternalRecipient,
  primaryRecipient,
} from "./recipients.js";
export {
  evaluateApprovalRule,
  evaluateApprovalRules,
  shouldEscalateForInjection,
} from "./rules.js";
export type { RuleEvaluation } from "./rules.js";
export { hashOutboundIdempotencyKey } from "./hash.js";
export type { OutboundIdempotencyPayload } from "./hash.js";
export {
  MemoryIdempotencyStore,
  OutboundIdempotencyGuard,
} from "./idempotency.js";
export type {
  IdempotencyStore,
  IdempotencyGuardOptions,
} from "./idempotency.js";
export {
  RunawayLoopBreaker,
  LoopBreakerTrippedError,
} from "./loop-breaker.js";
export { evaluateOutboundPolicy } from "./evaluate.js";
export type { EvaluateOutboundPolicyOptions } from "./evaluate.js";
export {
  enforceOutboundPolicy,
  rememberOutboundMessageId,
  autoSendApprovedDraft,
} from "./orchestrate.js";
export type {
  EnforceOutboundResult,
  EnforceOutboundOptions,
} from "./orchestrate.js";
export { OutboundPolicyEngine } from "./engine.js";
export type { OutboundPolicyEngineOptions } from "./engine.js";
