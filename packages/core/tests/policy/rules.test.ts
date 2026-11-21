import { describe, expect, it } from "vitest";
import {
  containsAmountOver,
  evaluateApprovalRule,
  evaluateOutboundPolicy,
  findAmounts,
  hasExternalRecipient,
  resolveOutboundPolicyConfig,
} from "../../src/policy/index.js";
import type { OutboundPolicyContext } from "../../src/policy/index.js";

function ctx(
  partial: Partial<OutboundPolicyContext> &
    Pick<OutboundPolicyContext, "markdownBody">,
): OutboundPolicyContext {
  return {
    tool: "send_email",
    inboxId: "inbox_1",
    to: ["user@acme.com"],
    inboxAddress: "agent@envlo.dev",
    injectionRisk: "low",
    hasAttachment: false,
    ...partial,
  };
}

describe("amount detection", () => {
  it("finds currency amounts and thresholds", () => {
    expect(findAmounts("Please pay $150 now").map((a) => a.value)).toEqual([
      150,
    ]);
    expect(containsAmountOver("Total USD 99.50", 100)).toBe(false);
    expect(containsAmountOver("Total USD 100", 100)).toBe(true);
    expect(containsAmountOver("Invoice for €1,250.00", 100)).toBe(true);
    expect(containsAmountOver("about 50 dollars", 100)).toBe(false);
    expect(containsAmountOver("Charge £50 please", 50)).toBe(true);
    expect(containsAmountOver("CAD 200 due", 200)).toBe(true);
  });
});

describe("external_recipient", () => {
  it("treats other domains as external; allowlists internalDomains", () => {
    expect(
      hasExternalRecipient(["a@acme.com"], "agent@envlo.dev", []),
    ).toBe(true);
    expect(
      hasExternalRecipient(["a@envlo.dev"], "agent@envlo.dev", []),
    ).toBe(false);
    expect(
      hasExternalRecipient(["a@acme.com"], "agent@envlo.dev", ["acme.com"]),
    ).toBe(false);
  });

  it("fail-closes on addresses without a domain", () => {
    expect(hasExternalRecipient(["not-an-email"], "agent@envlo.dev", [])).toBe(
      true,
    );
    expect(hasExternalRecipient(["@nodomain"], "agent@envlo.dev", [])).toBe(
      true,
    );
    expect(hasExternalRecipient(["local@"], "agent@envlo.dev", [])).toBe(true);
  });
});

describe("evaluateOutboundPolicy", () => {
  it("AUTO_SEND when nothing matches and allowAutoSend is true", () => {
    const decision = evaluateOutboundPolicy(
      ctx({
        to: ["peer@envlo.dev"],
        markdownBody: "Hello — no money here.",
      }),
    );
    expect(decision.disposition).toBe("AUTO_SEND");
    expect(decision.forcePendingApproval).toBe(false);
    expect(decision.matchedRules).toEqual([]);
  });

  it("REQUIRE_APPROVAL for external_recipient, attachment, and amount rules", () => {
    const external = evaluateOutboundPolicy(
      ctx({ markdownBody: "hi", to: ["x@evil.com"] }),
    );
    expect(external.matchedRules).toContain("external_recipient");
    expect(external.disposition).toBe("REQUIRE_APPROVAL");

    const attachment = evaluateOutboundPolicy(
      ctx({
        markdownBody: "hi",
        to: ["peer@envlo.dev"],
        hasAttachment: true,
      }),
    );
    expect(attachment.matchedRules).toContain("has_attachment");

    const amount = evaluateOutboundPolicy(
      ctx({
        markdownBody: "Please wire $500 today.",
        to: ["peer@envlo.dev"],
      }),
    );
    expect(amount.matchedRules).toContain("contains_amount_over_100");
  });

  it("escalates high injection risk to PENDING_APPROVAL and revokes AUTO_SEND", () => {
    const decision = evaluateOutboundPolicy(
      ctx({
        markdownBody: "ok",
        to: ["peer@envlo.dev"],
        injectionRisk: "high",
      }),
    );
    expect(decision.disposition).toBe("REQUIRE_APPROVAL");
    expect(decision.autoSendRevoked).toBe(true);
    expect(decision.matchedRules).toContain("high_injection_risk_thread");
    expect(decision.reasons.some((r) => r.code.includes("injection"))).toBe(
      true,
    );
  });

  it("honors escalateOnInjectionRisk medium vs off independently of the high rule", () => {
    const medium = evaluateOutboundPolicy(
      ctx({
        markdownBody: "ok",
        to: ["peer@envlo.dev"],
        injectionRisk: "medium",
      }),
      {
        config: {
          escalateOnInjectionRisk: "medium",
          requireApprovalIf: [],
        },
      },
    );
    expect(medium.disposition).toBe("REQUIRE_APPROVAL");
    expect(medium.matchedRules).not.toContain("high_injection_risk_thread");
    expect(medium.reasons.some((r) => r.code === "escalate.injection_risk")).toBe(
      true,
    );

    // escalate off: high rule still matches when listed.
    const highRule = evaluateOutboundPolicy(
      ctx({
        markdownBody: "ok",
        to: ["peer@envlo.dev"],
        injectionRisk: "high",
      }),
      {
        config: {
          escalateOnInjectionRisk: "off",
          requireApprovalIf: ["high_injection_risk_thread"],
        },
      },
    );
    expect(highRule.disposition).toBe("REQUIRE_APPROVAL");
    expect(highRule.matchedRules).toContain("high_injection_risk_thread");

    // escalate off + rule omitted → AUTO_SEND even on high risk.
    const off = evaluateOutboundPolicy(
      ctx({
        markdownBody: "ok",
        to: ["peer@envlo.dev"],
        injectionRisk: "high",
      }),
      {
        config: {
          escalateOnInjectionRisk: "off",
          requireApprovalIf: ["external_recipient"],
        },
      },
    );
    expect(off.disposition).toBe("AUTO_SEND");
    expect(off.autoSendRevoked).toBe(false);
  });

  it("escalate knob still fires when high_injection_risk_thread rule is omitted", () => {
    const decision = evaluateOutboundPolicy(
      ctx({
        markdownBody: "ok",
        to: ["peer@envlo.dev"],
        injectionRisk: "high",
      }),
      {
        config: {
          requireApprovalIf: ["has_attachment"],
          escalateOnInjectionRisk: "high",
        },
      },
    );
    expect(decision.disposition).toBe("REQUIRE_APPROVAL");
    expect(decision.autoSendRevoked).toBe(true);
    expect(decision.matchedRules).not.toContain("high_injection_risk_thread");
    expect(decision.reasons.some((r) => r.code === "escalate.injection_risk")).toBe(
      true,
    );
  });

  it("resolves Phase-1 defaults", () => {
    const config = resolveOutboundPolicyConfig();
    expect(config.requireApprovalIf).toHaveLength(4);
    expect(config.escalateOnInjectionRisk).toBe("high");
    expect(config.loopBreaker.maxOutboundWithoutReply).toBe(3);
    expect(config.idempotency.ttlMs).toBe(5 * 60 * 1000);
  });

  it("allowAutoSend=false forces REQUIRE_APPROVAL with no matched rules", () => {
    const decision = evaluateOutboundPolicy(
      ctx({
        to: ["peer@envlo.dev"],
        markdownBody: "Hello — no money here.",
      }),
      {
        config: {
          requireApprovalIf: [],
          escalateOnInjectionRisk: "off",
          allowAutoSend: false,
        },
      },
    );
    expect(decision.disposition).toBe("REQUIRE_APPROVAL");
    expect(decision.matchedRules).toEqual([]);
    expect(decision.forcePendingApproval).toBe(true);
    expect(
      decision.reasons.some((r) => r.code === "config.allowAutoSend"),
    ).toBe(true);
  });

  it("honors custom amountThreshold for contains_amount_over_100", () => {
    const under = evaluateOutboundPolicy(
      ctx({
        to: ["peer@envlo.dev"],
        markdownBody: "Quote is $250 total.",
      }),
      {
        config: {
          requireApprovalIf: ["contains_amount_over_100"],
          escalateOnInjectionRisk: "off",
          amountThreshold: 500,
        },
      },
    );
    expect(under.disposition).toBe("AUTO_SEND");
    expect(under.matchedRules).not.toContain("contains_amount_over_100");

    const over = evaluateOutboundPolicy(
      ctx({
        to: ["peer@envlo.dev"],
        markdownBody: "Quote is $250 total.",
      }),
      {
        config: {
          requireApprovalIf: ["contains_amount_over_100"],
          escalateOnInjectionRisk: "off",
          amountThreshold: 200,
        },
      },
    );
    expect(over.disposition).toBe("REQUIRE_APPROVAL");
    expect(over.matchedRules).toContain("contains_amount_over_100");
    expect(over.reasons[0]?.detail).toMatch(/>= 200/);
  });

  it("alwaysApplyInjectionEscalate=false skips the escalate knob", () => {
    const decision = evaluateOutboundPolicy(
      ctx({
        to: ["peer@envlo.dev"],
        markdownBody: "ok",
        injectionRisk: "high",
      }),
      {
        config: {
          requireApprovalIf: [],
          escalateOnInjectionRisk: "high",
        },
        alwaysApplyInjectionEscalate: false,
      },
    );
    expect(decision.disposition).toBe("AUTO_SEND");
    expect(decision.autoSendRevoked).toBe(false);
    expect(
      decision.reasons.some((r) => r.code === "escalate.injection_risk"),
    ).toBe(false);
  });

  it("evaluates individual rules with details", () => {
    const config = resolveOutboundPolicyConfig();
    const result = evaluateApprovalRule(
      "has_attachment",
      ctx({ markdownBody: "x", hasAttachment: true, to: ["a@envlo.dev"] }),
      config,
    );
    expect(result.matched).toBe(true);
    expect(result.detail).toMatch(/attachment/i);
  });
});
