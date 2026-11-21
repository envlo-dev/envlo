import type { InjectionRisk } from "./types.js";

/**
 * Side-effecting tools that must not run freely on high-risk untrusted email.
 * Keep in sync with `@envlo/mcp` CORE_TOOL_NAMES side-effect subset.
 */
export const SIDE_EFFECT_TOOL_NAMES = [
  "reply_to_thread",
  "send_email",
  "forward_thread",
] as const;

export type SideEffectToolName = (typeof SIDE_EFFECT_TOOL_NAMES)[number];

const SIDE_EFFECT_SET = new Set<string>(SIDE_EFFECT_TOOL_NAMES);

export function isSideEffectTool(toolName: string): boolean {
  return SIDE_EFFECT_SET.has(toolName);
}

export type ToolRiskPolicyOptions = {
  /**
   * Medium-risk behavior when side effects are not deferred to approval.
   * Default true = block all side effects on medium (fail-closed).
   * false = allow `reply_to_thread` only.
   */
  strictMedium?: boolean;
  /**
   * When true (recommended with `@envlo/core/policy`), high/medium risk
   * **allow** side-effect tools so hosts can create `PENDING_APPROVAL` drafts
   * instead of hard-denying. Policy then revokes AUTO_SEND.
   *
   * When false (legacy default), high/medium hard-deny side effects.
   */
  allowPendingApproval?: boolean;
};

/**
 * Tool policy for a given injection risk:
 * - low → allow
 * - high / medium + `allowPendingApproval` → allow (host must run outbound policy)
 * - high without that flag → block all side-effect tools
 * - medium + strictMedium → block (unless allowPendingApproval)
 * - medium + soft → allow reply_to_thread only
 */
export function isToolAllowedForRisk(
  toolName: string,
  risk: InjectionRisk,
  options: ToolRiskPolicyOptions = {},
): boolean {
  if (!isSideEffectTool(toolName)) return true;
  if (risk === "low") return true;

  // Phase-1 policy path: escalate to human approval instead of hard deny.
  if (options.allowPendingApproval) return true;

  if (risk === "high") return false;
  // medium
  const strictMedium = options.strictMedium ?? true;
  if (strictMedium) return false;
  // Soft medium: still block send/forward, allow reply_to_thread.
  return toolName === "reply_to_thread";
}

export function filterToolsForRisk<T extends string>(
  toolNames: readonly T[],
  risk: InjectionRisk,
  options?: ToolRiskPolicyOptions,
): T[] {
  return toolNames.filter((name) => isToolAllowedForRisk(name, risk, options));
}

export class ToolPolicyDeniedError extends Error {
  readonly toolName: string;
  readonly risk: InjectionRisk;

  constructor(toolName: string, risk: InjectionRisk) {
    super(
      `Tool "${toolName}" denied: injection_risk=${risk}. Side effects require human approval or lower risk.`,
    );
    this.name = "ToolPolicyDeniedError";
    this.toolName = toolName;
    this.risk = risk;
  }
}

export function assertToolAllowedForRisk(
  toolName: string,
  risk: InjectionRisk,
  options?: ToolRiskPolicyOptions,
): void {
  if (!isToolAllowedForRisk(toolName, risk, options)) {
    throw new ToolPolicyDeniedError(toolName, risk);
  }
}
