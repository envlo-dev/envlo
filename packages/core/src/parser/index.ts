export { ingestRawMime } from "./ingest-raw-mime.js";
export { evaluateSenderAuth, evaluateSenderAuthStatus } from "./sender-auth.js";
export { parseReferencesHeader, normalizeMessageId } from "./references.js";

export type {
  RawMimeInput,
  SenderAuthStatus,
  AuthMethodOutcome,
  MimeAddress,
  IngestedAttachment,
  IngestedMime,
  SenderAuth,
  AuthMethodResult,
  SenderAuthDetails,
} from "./types.js";
