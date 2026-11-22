export type { InboundTransport, InboundTransportHandle } from "./types.js";
export {
  normalizeMailboxAddress,
  resolveInboxId,
  type ResolveInboxOptions,
} from "./resolve-inbox.js";
export {
  ImapAdapter,
  IMAP_PRESETS,
  type ImapAdapterOptions,
  type ImapAdapterAuth,
  type ImapFlowClient,
  type ImapFetchMessage,
  type ImapFirstRunMode,
  type ImapMailboxLock,
  type ImapPresetName,
} from "./imap-adapter.js";
export {
  SmtpCatchAllServer,
  isPortFree,
  type SmtpCatchAllOptions,
  type SmtpCatchAllListenInfo,
} from "./smtp-catchall.js";
export {
  startLocalInbound,
  readLocalInboundConfig,
  type LocalInboundConfig,
  type LocalInboundRuntime,
  type ImapConnectionConfig,
} from "./local-runtime.js";
export {
  FileImapUidCursorStore,
  MemoryImapUidCursorStore,
  imapCursorKey,
  defaultImapCursorPath,
  type ImapUidCursor,
  type ImapUidCursorStore,
} from "./uid-cursor.js";
export {
  DEFAULT_MAX_MIME_BYTES,
  MimeTooLargeError,
  assertMimeSize,
  readMaxMimeBytes,
} from "./limits.js";
export {
  parseInboundWebhookPayload,
  type ParsedInboundWebhook,
} from "./webhook-payload.js";
export {
  readSandboxBridgeConfig,
  startSandboxBridge,
  type SandboxBridgeConfig,
  type SandboxBridgeHandle,
} from "./sandbox-client.js";
