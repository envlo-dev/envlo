import type { InjectionRisk } from "../firewall/injection/types.js";

/** Side-effecting outbound tools gated by this policy engine. */
export type OutboundToolName =
  | "send_email"
  | "reply_to_thread"
  | "forward_thread";

/**
 * Built-in declarative approval triggers (Section 4.2).
 * Any match forces REQUIRE_APPROVAL (PENDING_APPROVAL) instead of AUTO_SEND.
 */
export type ApprovalRuleId =
  | "external_recipient"
  | "has_attachment"
  | "contains_amount_over_100"
  | "high_injection_risk_thread";

/** Injection-risk floor that revokes AUTO_SEND on a thread. */
export type EscalateOnInjectionRisk = "high" | "medium" | "off";

export type OutboundDisposition =
  /** Safe to create draft, approve, and send without human gate. */
  | "AUTO_SEND"
  /** Create/submit draft into PENDING_APPROVAL (human OOB approval). */
  | "REQUIRE_APPROVAL"
  /** Hard block (loop breaker tripped, etc.). */
  | "DENY";

export type PolicyReason = {
  code: string;
  detail: string;
};

export type LoopBreakerConfig = {
  /** Max outbound messages to the same recipient in the window (default 3). */
  maxOutboundWithoutReply?: number;
  /** Sliding window in ms (default 10 minutes). */
  windowMs?: number;
};

export type IdempotencyConfig = {
  /** Cache TTL in ms (default 5 minutes). */
  ttlMs?: number;
};

/**
 * Declarative outbound policy configuration.
 * Defaults match Phase-1 ticket: escalate on `high`, all four approval rules on.
 */
export type OutboundPolicyConfig = {
  /**
   * Rules that force human approval. Default: all built-in rules.
   */
  requireApprovalIf?: ApprovalRuleId[];
  /**
   * Revoke AUTO_SEND when thread injection risk meets/exceeds this level.
   * Default `"high"`. `"medium"` also escalates medium-risk threads.
   * `"off"` disables injection-based escalation (rules may still fire).
   */
  escalateOnInjectionRisk?: EscalateOnInjectionRisk;
  /**
   * When true (default), disposition may be AUTO_SEND if nothing else fires.
   * When false, every outbound requires approval.
   */
  allowAutoSend?: boolean;
  loopBreaker?: LoopBreakerConfig;
  idempotency?: IdempotencyConfig;
  /**
   * Domains treated as internal for `external_recipient`
   * (plus the inbox's own domain).
   */
  internalDomains?: string[];
  /**
   * Money threshold for `contains_amount_over_100` (default 100).
   * Kept configurable so agents can tighten without a new rule id.
   */
  amountThreshold?: number;
};

export type OutboundPolicyContext = {
  tool: OutboundToolName;
  inboxId: string;
  /** Recipient addresses (To). */
  to: string[];
  subject?: string | null;
  markdownBody: string;
  hasAttachment?: boolean;
  /**
   * Aggregate / tip injection risk for the thread (from ingest).
   * Defaults to `"low"` when omitted.
   */
  injectionRisk?: InjectionRisk;
  /** Inbox From address — used for external_recipient domain compare. */
  inboxAddress?: string | null;
  threadId?: string | null;
  /** Optional client-supplied idempotency key (else derived from payload). */
  idempotencyKey?: string;
  /** Clock override for tests. */
  nowMs?: number;
};

export type OutboundPolicyDecision = {
  disposition: OutboundDisposition;
  /** True when injection escalate revoked what would have been AUTO_SEND. */
  autoSendRevoked: boolean;
  /** Built-in rules that matched. */
  matchedRules: ApprovalRuleId[];
  reasons: PolicyReason[];
  /**
   * Convenience: true when the host must drive drafts into PENDING_APPROVAL
   * (disposition === REQUIRE_APPROVAL).
   */
  forcePendingApproval: boolean;
  /** Effective config snapshot used for this decision. */
  config: ResolvedOutboundPolicyConfig;
};

export type ResolvedOutboundPolicyConfig = {
  requireApprovalIf: ApprovalRuleId[];
  escalateOnInjectionRisk: EscalateOnInjectionRisk;
  allowAutoSend: boolean;
  loopBreaker: { maxOutboundWithoutReply: number; windowMs: number };
  idempotency: { ttlMs: number };
  internalDomains: string[];
  amountThreshold: number;
};

/** Cached result of a prior outbound within the idempotency window. */
export type IdempotencyHit = {
  key: string;
  tool: OutboundToolName;
  inboxId: string;
  draftId: string | null;
  outboundMessageId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export type IdempotencyRecordInput = {
  key: string;
  tool: OutboundToolName;
  inboxId: string;
  draftId?: string | null;
  outboundMessageId?: string | null;
  nowMs?: number;
};

export type LoopBreakerTrip = {
  tripped: boolean;
  inboxId: string;
  recipient: string;
  outboundCount: number;
  maxOutboundWithoutReply: number;
  windowMs: number;
  lastInboundAtMs: number | null;
  oldestCountedOutboundAtMs: number | null;
  /** True when this inbox↔recipient pair is auto-paused. */
  paused: boolean;
  pausedAtMs: number | null;
};

export const DEFAULT_APPROVAL_RULES: readonly ApprovalRuleId[] = [
  "external_recipient",
  "has_attachment",
  "contains_amount_over_100",
  "high_injection_risk_thread",
] as const;

export const DEFAULT_LOOP_MAX_OUTBOUND = 3;
export const DEFAULT_LOOP_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_AMOUNT_THRESHOLD = 100;
