import type { InjectionRisk } from "../firewall/injection/types.js";
import { containsAmountOver } from "./amounts.js";
import { hasExternalRecipient } from "./recipients.js";
import type {
  ApprovalRuleId,
  OutboundPolicyContext,
  ResolvedOutboundPolicyConfig,
} from "./types.js";

export type RuleEvaluation = {
  id: ApprovalRuleId;
  matched: boolean;
  detail: string;
};

function injectionMeetsEscalate(
  risk: InjectionRisk,
  escalate: ResolvedOutboundPolicyConfig["escalateOnInjectionRisk"],
): boolean {
  if (escalate === "off") return false;
  if (escalate === "high") return risk === "high";
  // medium: escalate medium and high
  return risk === "medium" || risk === "high";
}

/**
 * Evaluate a single built-in approval rule against the outbound context.
 */
export function evaluateApprovalRule(
  rule: ApprovalRuleId,
  ctx: OutboundPolicyContext,
  config: ResolvedOutboundPolicyConfig,
): RuleEvaluation {
  const risk = ctx.injectionRisk ?? "low";

  switch (rule) {
    case "external_recipient": {
      const matched = hasExternalRecipient(
        ctx.to,
        ctx.inboxAddress,
        config.internalDomains,
      );
      return {
        id: rule,
        matched,
        detail: matched
          ? "Recipient domain is outside inbox/internal domains"
          : "All recipients are internal",
      };
    }
    case "has_attachment": {
      const matched = Boolean(ctx.hasAttachment);
      return {
        id: rule,
        matched,
        detail: matched
          ? "Outbound includes an attachment"
          : "No attachment on outbound",
      };
    }
    case "contains_amount_over_100": {
      const matched = containsAmountOver(ctx.markdownBody, config.amountThreshold);
      return {
        id: rule,
        matched,
        detail: matched
          ? `Body contains an amount >= ${config.amountThreshold}`
          : `No amount >= ${config.amountThreshold} detected`,
      };
    }
    case "high_injection_risk_thread": {
      // Declarative rule: strictly risk === "high" (independent of escalateOnInjectionRisk).
      const matched = risk === "high";
      return {
        id: rule,
        matched,
        detail: matched
          ? `Thread injection_risk=${risk} (high_injection_risk_thread)`
          : `Thread injection_risk=${risk} is not high`,
      };
    }
    default: {
      const _exhaustive: never = rule;
      return { id: _exhaustive, matched: false, detail: "unknown rule" };
    }
  }
}

/** Evaluate all configured requireApprovalIf rules. */
export function evaluateApprovalRules(
  ctx: OutboundPolicyContext,
  config: ResolvedOutboundPolicyConfig,
): RuleEvaluation[] {
  return config.requireApprovalIf.map((rule) =>
    evaluateApprovalRule(rule, ctx, config),
  );
}

/**
 * Standalone injection escalate check (also covered by high_injection_risk_thread
 * when that rule is enabled). Used to set `autoSendRevoked` even if the rule
 * list was customized to omit it.
 */
export function shouldEscalateForInjection(
  risk: InjectionRisk,
  escalate: ResolvedOutboundPolicyConfig["escalateOnInjectionRisk"],
): boolean {
  return injectionMeetsEscalate(risk, escalate);
}
