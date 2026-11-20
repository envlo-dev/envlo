import type { AttachmentPolicy, AttachmentTier } from "./types.js";

export const PRO_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB
export const SANDBOX_MAX_ATTACHMENT_BYTES = 1 * 1024 * 1024; // 1MB

export function policyForTier(tier: AttachmentTier): AttachmentPolicy {
  if (tier === "sandbox") {
    return {
      tier: "sandbox",
      maxBytes: SANDBOX_MAX_ATTACHMENT_BYTES,
      metadataOnlyWhenOversize: true,
    };
  }
  return {
    tier: "pro",
    maxBytes: PRO_MAX_ATTACHMENT_BYTES,
    metadataOnlyWhenOversize: false,
  };
}

export function resolveMaxBytes(
  tier: AttachmentTier,
  override?: number,
): number {
  if (override !== undefined) return override;
  return policyForTier(tier).maxBytes;
}
