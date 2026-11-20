import {
  resolveOutboundAttachment,
  resolveOutboundAttachments,
} from "./outbound.js";
import type {
  OutboundAttachmentBytes,
  OutboundAttachmentRef,
  ResolveOutboundOptions,
} from "./types.js";

/**
 * Shared outbound attachment resolution for MCP / agent tools:
 * `reply_to_thread`, `send_email`, and `forward_thread`.
 *
 * Accepts sandboxed `filePath` values (under `~/.envlo/attachments` by default)
 * or `https` URLs (size-capped, allowlisted, private-host blocked).
 */
export async function resolveAttachmentsForReply(
  refs: OutboundAttachmentRef[],
  options: ResolveOutboundOptions = {},
): Promise<OutboundAttachmentBytes[]> {
  return resolveOutboundAttachments(refs, options);
}

export async function resolveAttachmentsForSend(
  refs: OutboundAttachmentRef[],
  options: ResolveOutboundOptions = {},
): Promise<OutboundAttachmentBytes[]> {
  return resolveOutboundAttachments(refs, options);
}

export async function resolveAttachmentsForForward(
  refs: OutboundAttachmentRef[],
  options: ResolveOutboundOptions = {},
): Promise<OutboundAttachmentBytes[]> {
  return resolveOutboundAttachments(refs, options);
}

/** Single-ref convenience used by thin tool wrappers. */
export async function resolveAttachmentForOutboundTool(
  ref: OutboundAttachmentRef,
  options: ResolveOutboundOptions = {},
): Promise<OutboundAttachmentBytes> {
  return resolveOutboundAttachment(ref, options);
}
