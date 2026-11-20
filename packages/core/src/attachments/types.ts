/** Product tier controlling attachment size policy. */
export type AttachmentTier = "sandbox" | "pro";

/** How an attachment was handled by the cache pipeline. */
export type AttachmentCacheStatus =
  | "stored"
  | "metadata-only"
  | "rejected"
  | "inline-buffer";

/**
 * Agent-safe attachment reference — paths/URLs instead of Base64 bodies.
 * Prefer this shape in LLM / MCP tool results.
 */
export type AttachmentRef = {
  id: string;
  filename: string;
  mimeType: string;
  /** Absolute local path when stored on disk; null for S3-only / rejected / metadata. */
  localFilePath: string | null;
  /** Remote object URL when using an S3 (or compatible) store. */
  remoteUrl: string | null;
  sizeBytes: number;
  disposition: "attachment" | "inline" | null;
  contentId: string | null;
  cacheStatus: AttachmentCacheStatus;
  /** Why the attachment was rejected or metadata-only. */
  rejectReason: string | null;
};

/** Binary payload ready to attach on outbound send/reply/forward. */
export type OutboundAttachmentBytes = {
  filename: string;
  mimeType: string;
  content: Uint8Array;
  sizeBytes: number;
  source: "filePath" | "url" | "bytes";
};

/** Inbound attachment before / during cache persistence. */
export type AttachmentInput = {
  filename: string | null;
  mimeType: string;
  disposition?: "attachment" | "inline" | null;
  contentId?: string;
  content: Uint8Array;
};

export type PersistAttachmentResult = AttachmentRef & {
  /** Raw bytes when retained (internal / tests); omit for agent context. */
  content: Uint8Array;
};

export type AttachmentPolicy = {
  tier: AttachmentTier;
  /** Max bytes for full persistence (sandbox 1MB, pro 5MB by default). */
  maxBytes: number;
  /**
   * When over `maxBytes` on sandbox, keep metadata only (no bytes on disk).
   * Pro rejects oversized attachments by default.
   */
  metadataOnlyWhenOversize: boolean;
};

export type AttachmentStorePutInput = {
  id: string;
  filename: string;
  mimeType: string;
  content: Uint8Array;
  extension: string;
};

export type AttachmentStorePutResult = {
  id: string;
  localFilePath: string | null;
  remoteUrl: string | null;
  sizeBytes: number;
};

/**
 * Pluggable persistence backend (local disk, memory, S3-compatible, …).
 */
export type AttachmentStore = {
  readonly kind: "local" | "memory" | "s3" | string;
  put(input: AttachmentStorePutInput): Promise<AttachmentStorePutResult>;
  get(id: string): Promise<Uint8Array | null>;
  delete?(id: string): Promise<void>;
};

/** Minimal S3-compatible client surface (inject AWS SDK / R2 / MinIO wrapper). */
export type S3CompatibleClient = {
  putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<{ url?: string } | void>;
  getObject(input: { bucket: string; key: string }): Promise<Uint8Array>;
  deleteObject?(input: { bucket: string; key: string }): Promise<void>;
};

export type LocalAttachmentStoreOptions = {
  /** Defaults to `~/.envlo/attachments`. */
  rootDir?: string;
};

export type S3AttachmentStoreOptions = {
  client: S3CompatibleClient;
  bucket: string;
  /** Key prefix inside the bucket (default `attachments/`). */
  keyPrefix?: string;
  /** Optional public/base URL prefix for `remoteUrl`. */
  publicUrlBase?: string;
};

export type PersistAttachmentsOptions = {
  tier?: AttachmentTier;
  store?: AttachmentStore;
  /** Override max bytes (defaults from tier). */
  maxBytes?: number;
  /**
   * Keep `content` on **stored** results only (default false).
   * Rejected / metadata-only attachments always drop bytes.
   */
  includeContent?: boolean;
  /** Custom id generator (default crypto random). */
  idGenerator?: () => string;
};

export type OutboundAttachmentRef = {
  /** Absolute path under an allowed root (sandbox cache or configured allowlist). */
  filePath?: string;
  /** https URL to download (size-capped, MIME-checked). */
  url?: string;
  /** Inline bytes (tests / advanced callers). */
  content?: Uint8Array;
  filename?: string;
  mimeType?: string;
};

/**
 * How outbound URL redirects are handled.
 * - `safe` (default): follow manually and re-check each hop's host/protocol
 * - `follow`: trust `fetch` redirect following (trusted networks / tests)
 * - `error`: reject any redirect
 */
export type OutboundRedirectMode = "safe" | "follow" | "error";

export type ResolveOutboundOptions = {
  tier?: AttachmentTier;
  maxBytes?: number;
  /**
   * Directories outbound `filePath` may read from.
   * Defaults to `[~/.envlo/attachments]`.
   */
  allowedRoots?: string[];
  /** Max download size for URL refs (default = tier max). */
  maxDownloadBytes?: number;
  /** Fetch implementation (default global `fetch`). */
  fetch?: typeof fetch;
  /**
   * Block private / link-local / loopback URL hosts (default true).
   */
  blockPrivateHosts?: boolean;
  /**
   * Only allow `https:` URLs (default true). Set false to also allow `http:`.
   */
  httpsOnly?: boolean;
  /**
   * Redirect policy for URL fetches (default `safe`).
   */
  redirect?: OutboundRedirectMode;
  /** Max redirect hops when `redirect: "safe"` (default 5). */
  maxRedirects?: number;
};
