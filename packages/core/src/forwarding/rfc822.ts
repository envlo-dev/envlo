import PostalMime from "postal-mime";
import { firstAddress } from "../parser/addresses.js";
import type { IngestedMime, MimeAddress } from "../parser/types.js";

function isRfc822Attachment(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized === "message/rfc822" ||
    normalized.startsWith("message/rfc822") ||
    normalized === "message/global" // occasional RFC 6532 nested messages
  );
}

/**
 * Some forwarders attach the original as `message/rfc822` instead of inlining it.
 * Parse the first such attachment and return its `From`.
 */
export async function parseRfc822AttachmentSender(
  mail: IngestedMime,
): Promise<MimeAddress | null> {
  const attachment = mail.attachments.find((item) => isRfc822Attachment(item.mimeType));
  if (!attachment || attachment.content.byteLength === 0) return null;

  try {
    const nested = await PostalMime.parse(attachment.content, {
      attachmentEncoding: "arraybuffer",
    });
    return firstAddress(nested.from);
  } catch {
    return null;
  }
}
