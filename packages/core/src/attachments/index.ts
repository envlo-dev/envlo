export {
  PRO_MAX_ATTACHMENT_BYTES,
  SANDBOX_MAX_ATTACHMENT_BYTES,
  policyForTier,
  resolveMaxBytes,
} from "./policy.js";
export {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  DENIED_EXTENSIONS,
  evaluateAttachmentAllowlist,
  extensionOf,
  mimeForExtension,
  sanitizeFilename,
} from "./whitelist.js";
export type { AttachmentAllowDecision } from "./whitelist.js";
export { createAttachmentId } from "./ids.js";
export {
  DEFAULT_ATTACHMENTS_DIR_NAME,
  defaultAttachmentsRoot,
  resolveUnderAllowedRoots,
} from "./paths.js";
export { LocalAttachmentStore } from "./store-local.js";
export { MemoryAttachmentStore } from "./store-memory.js";
export { S3AttachmentStore } from "./store-s3.js";
export {
  persistAttachment,
  persistAttachments,
  toAttachmentRef,
  toAttachmentRefs,
} from "./persist.js";
export {
  resolveOutboundAttachment,
  resolveOutboundAttachments,
} from "./outbound.js";
export {
  resolveAttachmentsForReply,
  resolveAttachmentsForSend,
  resolveAttachmentsForForward,
  resolveAttachmentForOutboundTool,
} from "./outbound-tools.js";
export { isBlockedAttachmentHost } from "./ssrf.js";

export type {
  AttachmentTier,
  AttachmentCacheStatus,
  AttachmentRef,
  OutboundAttachmentBytes,
  AttachmentInput,
  PersistAttachmentResult,
  AttachmentPolicy,
  AttachmentStore,
  AttachmentStorePutInput,
  AttachmentStorePutResult,
  S3CompatibleClient,
  LocalAttachmentStoreOptions,
  S3AttachmentStoreOptions,
  PersistAttachmentsOptions,
  OutboundAttachmentRef,
  OutboundRedirectMode,
  ResolveOutboundOptions,
} from "./types.js";
