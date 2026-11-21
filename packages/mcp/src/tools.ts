import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvloMcpContext } from "./context.js";
import { waitForEmail } from "./bridge/wait.js";
import { mcpLog } from "./log.js";
import {
  buildForwardMarkdown,
  ensureSendThread,
  runOutboundTool,
} from "./outbound.js";
import { toolError, toolJson } from "./result.js";
import {
  createInboxInputSchema,
  forwardThreadInputSchema,
  listInboxesInputSchema,
  listMessagesInputSchema,
  readThreadInputSchema,
  replyToThreadInputSchema,
  sendEmailInputSchema,
  waitForEmailInputSchema,
  type CreateInboxArgs,
  type ForwardThreadArgs,
  type ListMessagesArgs,
  type ReadThreadArgs,
  type ReplyToThreadArgs,
  type SendEmailArgs,
  type WaitForEmailArgs,
} from "./schemas.js";

type ToolExtra = { signal: AbortSignal };

async function withToolLog<T>(
  tool: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    mcpLog("info", "tool.ok", { tool, durationMs: Date.now() - started });
    return result;
  } catch (err) {
    mcpLog("error", "tool.error", {
      tool,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Register the 8 Phase-1 core tools. Never registers `manage_draft_approval`.
 */
export function registerCoreTools(
  server: McpServer,
  ctx: EnvloMcpContext,
): void {
  server.registerTool(
    "create_inbox",
    {
      title: "Create inbox",
      description: "Create a new Envlo agent inbox address.",
      inputSchema: createInboxInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args: CreateInboxArgs) =>
      withToolLog("create_inbox", async () => {
        try {
          const inbox = await ctx.state.createInbox({
            address: args.address,
            ...(args.displayName !== undefined
              ? { displayName: args.displayName }
              : {}),
            ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
          });
          return toolJson({ inbox });
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "list_inboxes",
    {
      title: "List inboxes",
      description: "List all Envlo inboxes in the local state store.",
      inputSchema: listInboxesInputSchema,
      annotations: { readOnlyHint: true },
    },
    async () =>
      withToolLog("list_inboxes", async () => {
        try {
          const inboxes = await ctx.state.listInboxes();
          return toolJson({ inboxes });
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "list_messages",
    {
      title: "List messages",
      description:
        "List messages in a thread (chronological), including extracted OTP / verification URL when known.",
      inputSchema: listMessagesInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args: ListMessagesArgs) =>
      withToolLog("list_messages", async () => {
        try {
          const messages = await ctx.state.listMessages(args.threadId);
          const enriched = messages.map((message) => {
            const meta = ctx.threadMeta.getMessage(message.messageId);
            return {
              ...message,
              extractedOtp: meta?.extractedOtp ?? null,
              verificationUrl: meta?.verificationUrl ?? null,
              injectionRisk: meta?.injectionRisk ?? null,
            };
          });
          const threadMeta = ctx.threadMeta.getThread(args.threadId);
          return toolJson({
            threadId: args.threadId,
            messages: enriched,
            threadInjectionRisk: threadMeta?.injectionRisk ?? null,
          });
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "read_thread",
    {
      title: "Read thread",
      description:
        "Read a thread projection including messages and activeDrafts (non-SENT).",
      inputSchema: readThreadInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args: ReadThreadArgs) =>
      withToolLog("read_thread", async () => {
        try {
          const view = await ctx.state.readThread(args.threadId);
          if (!view) return toolError(`thread not found: ${args.threadId}`);
          const threadMeta = ctx.threadMeta.getThread(args.threadId);
          return toolJson({
            ...view,
            injectionRisk: threadMeta?.injectionRisk ?? null,
            lastOtp: threadMeta?.lastOtp ?? null,
            lastVerificationUrl: threadMeta?.lastVerificationUrl ?? null,
          });
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "wait_for_email",
    {
      title: "Wait for email",
      description:
        "Block until inbound mail arrives or a draft is REJECTED_WITH_FEEDBACK (max 20s). Returns trueOriginalSender, senderAuthStatus, and draftFeedbackEvent. timeoutMs values above 20000 are clamped.",
      inputSchema: waitForEmailInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args: WaitForEmailArgs, extra: ToolExtra) =>
      withToolLog("wait_for_email", async () => {
        try {
          const result = await waitForEmail(ctx.inboxBus, args, {
            signal: extra.signal,
          });
          return toolJson(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "reply_to_thread",
    {
      title: "Reply to thread",
      description:
        "Draft and (when policy allows) send a reply. High-risk / policy hits go to PENDING_APPROVAL — agents cannot self-approve.",
      inputSchema: replyToThreadInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args: ReplyToThreadArgs) =>
      withToolLog("reply_to_thread", async () => {
        try {
          const view = await ctx.state.readThread(args.threadId);
          if (!view) return toolError(`thread not found: ${args.threadId}`);

          const to =
            args.to ??
            (view.messages
              .filter((m) => m.direction === "inbound")
              .map((m) => m.fromAddress)
              .filter((a): a is string => Boolean(a)).length
              ? [
                  view.messages
                    .filter((m) => m.direction === "inbound")
                    .map((m) => m.fromAddress)
                    .filter((a): a is string => Boolean(a))
                    .at(-1)!,
                ]
              : []);
          if (to.length === 0) {
            return toolError(
              "reply_to_thread requires `to` when the thread has no inbound fromAddress",
            );
          }

          const result = await runOutboundTool(ctx, {
            tool: "reply_to_thread",
            inboxId: view.thread.inboxId,
            threadId: args.threadId,
            to,
            markdownBody: args.markdown,
            ...(args.subject !== undefined ? { subject: args.subject } : {}),
            ...(args.attachments
              ? {
                  attachments: args.attachments.map((a) => ({
                    ...(a.filePath !== undefined
                      ? { filePath: a.filePath }
                      : {}),
                    ...(a.url !== undefined ? { url: a.url } : {}),
                    ...(a.filename !== undefined
                      ? { filename: a.filename }
                      : {}),
                    ...(a.mimeType !== undefined
                      ? { mimeType: a.mimeType }
                      : {}),
                  })),
                }
              : {}),
            ...(args.idempotencyKey !== undefined
              ? { idempotencyKey: args.idempotencyKey }
              : {}),
          });
          return toolJson(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "send_email",
    {
      title: "Send email",
      description:
        "Send a new email from an inbox. Creates a seed thread when threadId is omitted. Policy may require human approval.",
      inputSchema: sendEmailInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args: SendEmailArgs) =>
      withToolLog("send_email", async () => {
        try {
          const threadId = await ensureSendThread(ctx, {
            inboxId: args.inboxId,
            to: args.to,
            subject: args.subject,
            ...(args.threadId !== undefined
              ? { threadId: args.threadId }
              : {}),
          });
          const result = await runOutboundTool(ctx, {
            tool: "send_email",
            inboxId: args.inboxId,
            threadId,
            to: args.to,
            subject: args.subject,
            markdownBody: args.markdown,
            ...(args.attachments
              ? {
                  attachments: args.attachments.map((a) => ({
                    ...(a.filePath !== undefined
                      ? { filePath: a.filePath }
                      : {}),
                    ...(a.url !== undefined ? { url: a.url } : {}),
                    ...(a.filename !== undefined
                      ? { filename: a.filename }
                      : {}),
                    ...(a.mimeType !== undefined
                      ? { mimeType: a.mimeType }
                      : {}),
                  })),
                }
              : {}),
            ...(args.idempotencyKey !== undefined
              ? { idempotencyKey: args.idempotencyKey }
              : {}),
          });
          return toolJson({ ...result, threadId });
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "forward_thread",
    {
      title: "Forward thread",
      description:
        "Forward the latest thread content to new recipients. Policy may require human approval.",
      inputSchema: forwardThreadInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args: ForwardThreadArgs) =>
      withToolLog("forward_thread", async () => {
        try {
          const view = await ctx.state.readThread(args.threadId);
          if (!view) return toolError(`thread not found: ${args.threadId}`);
          const latest = view.messages.at(-1);
          const markdown = buildForwardMarkdown({
            ...(args.markdown !== undefined
              ? { preface: args.markdown }
              : {}),
            fromAddress: latest?.fromAddress ?? null,
            subject: latest?.subject ?? view.thread.subject,
            date: latest?.date ?? null,
            body: latest?.bodyMarkdown ?? null,
          });
          const subject =
            args.subject ??
            (view.thread.subject
              ? view.thread.subject.toLowerCase().startsWith("fwd:")
                ? view.thread.subject
                : `Fwd: ${view.thread.subject}`
              : "Fwd: (no subject)");

          const result = await runOutboundTool(ctx, {
            tool: "forward_thread",
            inboxId: view.thread.inboxId,
            threadId: args.threadId,
            to: args.to,
            subject,
            markdownBody: markdown,
            ...(args.attachments
              ? {
                  attachments: args.attachments.map((a) => ({
                    ...(a.filePath !== undefined
                      ? { filePath: a.filePath }
                      : {}),
                    ...(a.url !== undefined ? { url: a.url } : {}),
                    ...(a.filename !== undefined
                      ? { filename: a.filename }
                      : {}),
                    ...(a.mimeType !== undefined
                      ? { mimeType: a.mimeType }
                      : {}),
                  })),
                }
              : {}),
            ...(args.idempotencyKey !== undefined
              ? { idempotencyKey: args.idempotencyKey }
              : {}),
          });
          return toolJson(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }),
  );
}
