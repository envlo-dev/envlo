import type { Attachment } from "postal-mime";
import {
  persistAttachments,
  type AttachmentStore,
  type PersistAttachmentResult,
} from "../attachments/index.js";
import type { IngestedAttachment } from "./types.js";

function toUint8Array(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

function asInlineBuffer(attachment: Attachment): IngestedAttachment {
  const content = toUint8Array(attachment.content);
  const normalized: IngestedAttachment = {
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    disposition: attachment.disposition,
    content,
    attachmentId: null,
    localFilePath: null,
    remoteUrl: null,
    sizeBytes: content.byteLength,
    cacheStatus: "inline-buffer",
    rejectReason: null,
  };
  if (attachment.contentId) {
    normalized.contentId = attachment.contentId;
  }
  return normalized;
}

function fromPersisted(result: PersistAttachmentResult): IngestedAttachment {
  const normalized: IngestedAttachment = {
    filename: result.filename,
    mimeType: result.mimeType,
    disposition: result.disposition,
    content: result.content,
    attachmentId: result.id,
    localFilePath: result.localFilePath,
    remoteUrl: result.remoteUrl,
    sizeBytes: result.sizeBytes,
    cacheStatus: result.cacheStatus,
    rejectReason: result.rejectReason,
  };
  if (result.contentId) {
    normalized.contentId = result.contentId;
  }
  return normalized;
}

/** Normalize postal-mime attachments as inline buffers (no disk/S3 persistence). */
export function normalizeAttachments(attachments: Attachment[]): IngestedAttachment[] {
  return attachments.map(asInlineBuffer);
}

export type NormalizeAndPersistOptions = {
  tier?: "sandbox" | "pro";
  maxBytes?: number;
  store?: AttachmentStore;
  includeContent?: boolean;
};

/**
 * Normalize then run the sandboxed attachment cache pipeline
 * (allowlist + tier caps + local/S3 store).
 */
export async function normalizeAndPersistAttachments(
  attachments: Attachment[],
  options: NormalizeAndPersistOptions = {},
): Promise<IngestedAttachment[]> {
  const inputs = attachments.map((attachment) => ({
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    disposition: attachment.disposition,
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
    content: toUint8Array(attachment.content),
  }));

  const persisted = await persistAttachments(inputs, {
    ...(options.tier !== undefined ? { tier: options.tier } : {}),
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    ...(options.store !== undefined ? { store: options.store } : {}),
    includeContent: options.includeContent ?? false,
  });

  return persisted.map(fromPersisted);
}
