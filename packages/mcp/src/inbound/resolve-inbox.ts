import type { EnvloMcpContext } from "../context.js";

/**
 * Normalize an email address for inbox lookup (strip display name / angle brackets).
 */
export function normalizeMailboxAddress(raw: string): string {
  const trimmed = raw.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  const addr = (angle?.[1] ?? trimmed).trim().toLowerCase();
  // Strip smtp: / mailto: prefixes some clients send.
  return addr.replace(/^(smtp:|mailto:)/i, "");
}

export type ResolveInboxOptions = {
  /**
   * When true and no inbox matches, create one for the first candidate address.
   * Default false.
   */
  autoCreate?: boolean;
  /** Explicit fallback inbox id when addresses do not match. */
  defaultInboxId?: string;
};

/**
 * Resolve an Envlo inbox from candidate addresses (SMTP RCPT, MIME To, etc.).
 */
export async function resolveInboxId(
  ctx: EnvloMcpContext,
  candidates: string[],
  options: ResolveInboxOptions = {},
): Promise<string | null> {
  const seen = new Set<string>();
  for (const raw of candidates) {
    const address = normalizeMailboxAddress(raw);
    if (!address || !address.includes("@") || seen.has(address)) continue;
    seen.add(address);
    const existing = await ctx.state.getInboxByAddress(address);
    if (existing) return existing.id;
  }

  if (options.defaultInboxId) {
    const fallback = await ctx.state.getInbox(options.defaultInboxId);
    if (fallback) return fallback.id;
  }

  if (options.autoCreate) {
    for (const address of seen) {
      const created = await ctx.state.createInbox({ address });
      return created.id;
    }
  }

  return null;
}
