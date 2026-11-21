import { z } from "zod";
import { WAIT_FOR_EMAIL_MAX_MS } from "./bridge/inbox-events.js";

export { WAIT_FOR_EMAIL_MAX_MS }; // re-export for callers / docs

const attachmentRefSchema = z
  .object({
    filePath: z.string().min(1).optional(),
    url: z.string().url().optional(),
    filename: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
  })
  .strict();

export const createInboxInputSchema = {
  address: z.string().email().describe("Inbox email address"),
  displayName: z.string().min(1).optional().describe("Optional display name"),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export const listInboxesInputSchema = {};

export const listMessagesInputSchema = {
  threadId: z.string().min(1),
};

export const readThreadInputSchema = {
  threadId: z.string().min(1),
};

export const waitForEmailInputSchema = {
  inboxId: z.string().min(1),
  /**
   * Wait budget in ms. Values above 20_000 are clamped at runtime
   * (ticket #12 hard cap) — do not reject at schema validation.
   * Default 20_000.
   */
  timeoutMs: z.number().int().positive().optional(),
  /** When set, also wake on REJECTED_WITH_FEEDBACK for this thread. */
  threadId: z.string().min(1).optional(),
  fromContains: z.string().min(1).optional(),
  subjectContains: z.string().min(1).optional(),
};

export const replyToThreadInputSchema = {
  threadId: z.string().min(1),
  markdown: z.string().min(1),
  to: z.array(z.string().email()).min(1).optional(),
  subject: z.string().optional(),
  attachments: z.array(attachmentRefSchema).optional(),
  idempotencyKey: z.string().min(1).optional(),
};

export const sendEmailInputSchema = {
  inboxId: z.string().min(1),
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  markdown: z.string().min(1),
  /** Existing thread; when omitted a seed thread is created. */
  threadId: z.string().min(1).optional(),
  attachments: z.array(attachmentRefSchema).optional(),
  idempotencyKey: z.string().min(1).optional(),
};

export const forwardThreadInputSchema = {
  threadId: z.string().min(1),
  to: z.array(z.string().email()).min(1),
  /** Preface above the forwarded body (optional). */
  markdown: z.string().optional(),
  subject: z.string().optional(),
  attachments: z.array(attachmentRefSchema).optional(),
  idempotencyKey: z.string().min(1).optional(),
};

/** Runtime zod objects for handlers (MCP registerTool also accepts shapes). */
export const createInboxArgs = z.object(createInboxInputSchema);
export const listInboxesArgs = z.object(listInboxesInputSchema);
export const listMessagesArgs = z.object(listMessagesInputSchema);
export const readThreadArgs = z.object(readThreadInputSchema);
export const waitForEmailArgs = z.object(waitForEmailInputSchema);
export const replyToThreadArgs = z.object(replyToThreadInputSchema);
export const sendEmailArgs = z.object(sendEmailInputSchema);
export const forwardThreadArgs = z.object(forwardThreadInputSchema);

export type CreateInboxArgs = z.infer<typeof createInboxArgs>;
export type ListMessagesArgs = z.infer<typeof listMessagesArgs>;
export type ReadThreadArgs = z.infer<typeof readThreadArgs>;
export type WaitForEmailArgs = z.infer<typeof waitForEmailArgs>;
export type ReplyToThreadArgs = z.infer<typeof replyToThreadArgs>;
export type SendEmailArgs = z.infer<typeof sendEmailArgs>;
export type ForwardThreadArgs = z.infer<typeof forwardThreadArgs>;
