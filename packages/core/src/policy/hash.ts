import { createHash } from "node:crypto";
import { normalizeAddress } from "./recipients.js";
import type { OutboundToolName } from "./types.js";

export type OutboundIdempotencyPayload = {
  inboxId: string;
  to: string[];
  subject?: string | null;
  markdownBody: string;
  /** Include tool so send vs reply vs forward don't collide. */
  tool?: OutboundToolName;
};

/**
 * Deterministic hash of (inboxId, to, subject, markdownBody[, tool])
 * for the 5-minute outbound idempotency guard.
 */
export function hashOutboundIdempotencyKey(
  payload: OutboundIdempotencyPayload,
): string {
  const to = [...payload.to].map(normalizeAddress).filter(Boolean).sort();
  const canonical = JSON.stringify({
    inboxId: payload.inboxId.trim().toLowerCase(),
    to,
    subject: (payload.subject ?? "").trim(),
    markdownBody: payload.markdownBody,
    tool: payload.tool ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
