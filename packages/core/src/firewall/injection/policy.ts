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

/**
 * Tool policy for a given injection risk:
 * - high → block all side-effect tools (read-only)
 * - medium → block send/forward; allow reply only with caution (still blocked by default)
 * - low → allow
 *
 * Medium blocks the same side effects as high for fail-closed Phase-1 agents.
 * Callers that want softer medium behavior can pass `strictMedium: false`.
 */
export function isToolAllowedForRisk(
  toolName: string,
  risk: InjectionRisk,
  options: { strictMedium?: boolean } = {},
): boolean {
  if (!isSideEffectTool(toolName)) return true;
  if (risk === "low") return true;
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
  options?: { strictMedium?: boolean },
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
  options?: { strictMedium?: boolean },
): void {
  if (!isToolAllowedForRisk(toolName, risk, options)) {
    throw new ToolPolicyDeniedError(toolName, risk);
  }
}
