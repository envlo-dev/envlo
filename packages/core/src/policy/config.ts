import {
  DEFAULT_AMOUNT_THRESHOLD,
  DEFAULT_APPROVAL_RULES,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_LOOP_MAX_OUTBOUND,
  DEFAULT_LOOP_WINDOW_MS,
  type OutboundPolicyConfig,
  type ResolvedOutboundPolicyConfig,
} from "./types.js";

/** Resolve policy config with Phase-1 defaults. */
export function resolveOutboundPolicyConfig(
  config: OutboundPolicyConfig = {},
): ResolvedOutboundPolicyConfig {
  return {
    requireApprovalIf: [...(config.requireApprovalIf ?? DEFAULT_APPROVAL_RULES)],
    escalateOnInjectionRisk: config.escalateOnInjectionRisk ?? "high",
    allowAutoSend: config.allowAutoSend ?? true,
    loopBreaker: {
      maxOutboundWithoutReply:
        config.loopBreaker?.maxOutboundWithoutReply ?? DEFAULT_LOOP_MAX_OUTBOUND,
      windowMs: config.loopBreaker?.windowMs ?? DEFAULT_LOOP_WINDOW_MS,
    },
    idempotency: {
      ttlMs: config.idempotency?.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS,
    },
    internalDomains: (config.internalDomains ?? []).map((d) =>
      d.trim().toLowerCase().replace(/^\./, ""),
    ),
    amountThreshold: config.amountThreshold ?? DEFAULT_AMOUNT_THRESHOLD,
  };
}
