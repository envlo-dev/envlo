import { resolveOutboundPolicyConfig } from "./config.js";
import {
  evaluateApprovalRules,
  shouldEscalateForInjection,
} from "./rules.js";
import type {
  ApprovalRuleId,
  OutboundPolicyConfig,
  OutboundPolicyContext,
  OutboundPolicyDecision,
  PolicyReason,
} from "./types.js";

export type EvaluateOutboundPolicyOptions = {
  config?: OutboundPolicyConfig;
  /**
   * When true (default), also escalate via `escalateOnInjectionRisk` even if
   * `high_injection_risk_thread` was removed from `requireApprovalIf`.
   */
  alwaysApplyInjectionEscalate?: boolean;
};

/**
 * Evaluate declarative outbound policy for send_email / reply_to_thread /
 * forward_thread. Does not mutate state — host/orchestrator applies the decision.
 *
 * Decision order:
 * 1. Built-in requireApprovalIf rules
 * 2. Injection escalate (revokes AUTO_SEND → REQUIRE_APPROVAL)
 * 3. allowAutoSend=false → REQUIRE_APPROVAL
 * 4. else AUTO_SEND
 *
 * Loop breaker / idempotency are applied by `enforceOutboundPolicy` (or host)
 * around this pure evaluator.
 */
export function evaluateOutboundPolicy(
  ctx: OutboundPolicyContext,
  options: EvaluateOutboundPolicyOptions = {},
): OutboundPolicyDecision {
  const config = resolveOutboundPolicyConfig(options.config);
  const risk = ctx.injectionRisk ?? "low";
  const alwaysInject = options.alwaysApplyInjectionEscalate ?? true;

  const ruleResults = evaluateApprovalRules(ctx, config);
  const matchedRules: ApprovalRuleId[] = ruleResults
    .filter((r) => r.matched)
    .map((r) => r.id);

  const reasons: PolicyReason[] = ruleResults
    .filter((r) => r.matched)
    .map((r) => ({
      code: `rule.${r.id}`,
      detail: r.detail,
    }));

  let autoSendRevoked = false;
  const injectEscalate =
    alwaysInject &&
    shouldEscalateForInjection(risk, config.escalateOnInjectionRisk);

  // Escalate knob is separate from the high_injection_risk_thread rule.
  if (injectEscalate && !matchedRules.includes("high_injection_risk_thread")) {
    autoSendRevoked = true;
    reasons.push({
      code: "escalate.injection_risk",
      detail: `escalateOnInjectionRisk=${config.escalateOnInjectionRisk} revoked AUTO_SEND (risk=${risk})`,
    });
  } else if (matchedRules.includes("high_injection_risk_thread")) {
    autoSendRevoked = true;
  }

  let disposition: OutboundPolicyDecision["disposition"] = "AUTO_SEND";

  if (matchedRules.length > 0 || injectEscalate) {
    disposition = "REQUIRE_APPROVAL";
  } else if (!config.allowAutoSend) {
    disposition = "REQUIRE_APPROVAL";
    reasons.push({
      code: "config.allowAutoSend",
      detail: "allowAutoSend=false forces PENDING_APPROVAL",
    });
  }

  if (disposition === "AUTO_SEND") {
    reasons.push({
      code: "disposition.auto_send",
      detail: "No approval rules matched; AUTO_SEND permitted",
    });
  }

  return {
    disposition,
    autoSendRevoked,
    matchedRules,
    reasons,
    forcePendingApproval: disposition === "REQUIRE_APPROVAL",
    config,
  };
}
