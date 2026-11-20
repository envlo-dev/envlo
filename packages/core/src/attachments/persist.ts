import { createAttachmentId } from "./ids.js";
import { policyForTier, resolveMaxBytes } from "./policy.js";
import { LocalAttachmentStore } from "./store-local.js";
import {
  evaluateAttachmentAllowlist,
  sanitizeFilename,
} from "./whitelist.js";
import type {
  AttachmentInput,
  AttachmentRef,
  AttachmentStore,
  PersistAttachmentResult,
  PersistAttachmentsOptions,
} from "./types.js";

function emptyBytes(): Uint8Array {
  return new Uint8Array(0);
}

function toRef(result: PersistAttachmentResult, includeContent: boolean): PersistAttachmentResult {
  if (includeContent) return result;
  return { ...result, content: emptyBytes() };
}

/**
 * Persist a single attachment through allowlist + tier size policy into `store`.
 */
export async function persistAttachment(
  input: AttachmentInput,
  options: PersistAttachmentsOptions = {},
): Promise<PersistAttachmentResult> {
  const tier = options.tier ?? "pro";
  const policy = policyForTier(tier);
  const maxBytes = resolveMaxBytes(tier, options.maxBytes);
  // Default false: agent-facing results should be path/URL refs, not Base64 bodies.
  const includeContent = options.includeContent ?? false;
  const store: AttachmentStore = options.store ?? new LocalAttachmentStore();
  const id = (options.idGenerator ?? createAttachmentId)();

  const filename = sanitizeFilename(input.filename);
  const allow = evaluateAttachmentAllowlist(filename, input.mimeType);
  const disposition = input.disposition ?? null;
  const contentId = input.contentId ?? null;
  const sizeBytes = input.content.byteLength;

  if (!allow.allowed) {
    // Rejected = drop bytes entirely (never return malware payloads to callers).
    return {
      id,
      filename,
      mimeType: input.mimeType || "application/octet-stream",
      localFilePath: null,
      remoteUrl: null,
      sizeBytes,
      disposition,
      contentId,
      cacheStatus: "rejected",
      rejectReason: allow.reason,
      content: emptyBytes(),
    };
  }

  if (sizeBytes > maxBytes) {
    if (policy.metadataOnlyWhenOversize || tier === "sandbox") {
      return {
        id,
        filename,
        mimeType: allow.mimeType,
        localFilePath: null,
        remoteUrl: null,
        sizeBytes,
        disposition,
        contentId,
        cacheStatus: "metadata-only",
        rejectReason: `oversize:${sizeBytes}>${maxBytes}`,
        content: emptyBytes(),
      };
    }
    return {
      id,
      filename,
      mimeType: allow.mimeType,
      localFilePath: null,
      remoteUrl: null,
      sizeBytes,
      disposition,
      contentId,
      cacheStatus: "rejected",
      rejectReason: `oversize:${sizeBytes}>${maxBytes}`,
      content: emptyBytes(),
    };
  }

  const stored = await store.put({
    id,
    filename,
    mimeType: allow.mimeType,
    content: input.content,
    extension: allow.extension,
  });

  return toRef(
    {
      id: stored.id,
      filename,
      mimeType: allow.mimeType,
      localFilePath: stored.localFilePath,
      remoteUrl: stored.remoteUrl,
      sizeBytes: stored.sizeBytes,
      disposition,
      contentId,
      cacheStatus: "stored",
      rejectReason: null,
      content: includeContent ? input.content : emptyBytes(),
    },
    includeContent,
  );
}

/**
 * Persist many attachments (e.g. postal-mime results) through the cache pipeline.
 */
export async function persistAttachments(
  inputs: AttachmentInput[],
  options: PersistAttachmentsOptions = {},
): Promise<PersistAttachmentResult[]> {
  const out: PersistAttachmentResult[] = [];
  for (const input of inputs) {
    out.push(await persistAttachment(input, options));
  }
  return out;
}

/** Strip bytes for LLM / MCP tool payloads. */
export function toAttachmentRef(attachment: PersistAttachmentResult | AttachmentRef): AttachmentRef {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    localFilePath: attachment.localFilePath,
    remoteUrl: attachment.remoteUrl,
    sizeBytes: attachment.sizeBytes,
    disposition: attachment.disposition,
    contentId: attachment.contentId,
    cacheStatus: attachment.cacheStatus,
    rejectReason: attachment.rejectReason,
  };
}

export function toAttachmentRefs(
  attachments: Array<PersistAttachmentResult | AttachmentRef>,
): AttachmentRef[] {
  return attachments.map(toAttachmentRef);
}
