export type {
  OutboundSenderKind,
  OutboundMailAttachment,
  OutboundMail,
  OutboundSendResult,
  OutboundSender,
  FetchLike,
  SesCompatibleClient,
  SmtpTransport,
  ApprovalChannelKind,
  ApprovalAction,
  ApprovalDecisionSource,
  DraftLifecycleEvent,
  ApprovalChannel,
  PendingApprovalPayload,
} from "./types.js";

export { ensureMessageId, bareMessageId } from "./message-id.js";
export { bytesToBase64 } from "./base64.js";
export {
  ConsoleDryRunSender,
  type ConsoleDryRunSenderOptions,
} from "./sender-console.js";
export { ResendSender, type ResendSenderOptions } from "./sender-resend.js";
export { SesSender, type SesSenderOptions } from "./sender-ses.js";
export { SmtpSender, type SmtpSenderOptions } from "./sender-smtp.js";
export {
  draftToOutboundMail,
  toPendingApprovalPayload,
  type DraftToOutboundMailOptions,
} from "./draft-mail.js";
export {
  deliverApprovedDraft,
  type DeliverDraftOptions,
} from "./deliver.js";
export {
  DraftLifecycleBus,
  defaultDraftLifecycleBus,
  type DraftLifecycleHandler,
} from "./events.js";
export {
  MemoryApprovalTokenStore,
  extractApprovalToken,
  DEFAULT_APPROVAL_TOKEN_TTL_MS,
  type ApprovalTokenRecord,
  type ApprovalTokenStore,
} from "./tokens.js";
export {
  ApprovalController,
  type ApprovalControllerOptions,
  type NotifyPendingResult,
} from "./approval-controller.js";
export {
  InteractiveCliApprovalChannel,
  promptDraftApproval,
  formatDraftApprovalPrompt,
  type CliPromptIo,
  type InteractiveCliApprovalChannelOptions,
} from "./approval-cli.js";
export {
  WebhookApprovalChannel,
  handleWebhookApprovalRequest,
  webhookRequestToAction,
  type WebhookNotifierOptions,
  type WebhookApprovalRequest,
} from "./approval-webhook.js";
export {
  SlackApprovalChannel,
  buildSlackApprovalBlocks,
  buildSlackEditApproveModal,
  buildSlackRejectModal,
  interpretSlackInteraction,
  handleSlackApprovalDecision,
  SLACK_ACTION_APPROVE,
  SLACK_ACTION_EDIT_APPROVE,
  SLACK_ACTION_REJECT,
  type SlackBlock,
  type SlackApprovalMessage,
  type SlackApprovalChannelOptions,
  type SlackInteractionPayload,
  type SlackInteractionResult,
} from "./approval-slack.js";
export {
  MagicLinkApprovalChannel,
  type MagicLinkApprovalChannelOptions,
  type MagicLinkMode,
  type MagicLinkClickAction,
  type MagicLinkClickRequest,
} from "./approval-magic-link.js";
export {
  renderMagicLinkFormPage,
  handleMagicLinkHttpRequest,
  type MagicLinkFormPageOptions,
  type MagicLinkHttpRequest,
  type MagicLinkHttpResponse,
} from "./approval-magic-link-forms.js";
export { parseApprovalReply, type ParsedApprovalReply } from "./reply-parse.js";
export { waitForDraftDecision } from "./wait-wake.js";
export {
  FileApprovalTokenStore,
  defaultApprovalTokensPath,
  type FileApprovalTokenStoreOptions,
} from "./tokens-file.js";
