import type { Attachment } from "postal-mime";
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

export function normalizeAttachments(attachments: Attachment[]): IngestedAttachment[] {
  return attachments.map((attachment) => {
    const normalized: IngestedAttachment = {
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      disposition: attachment.disposition,
      content: toUint8Array(attachment.content),
    };

    if (attachment.contentId) {
      normalized.contentId = attachment.contentId;
    }

    return normalized;
  });
}
