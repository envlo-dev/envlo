import type { DraftLifecycleEvent, IngestedMime } from "@envlo/core";
import {
  WAIT_FOR_EMAIL_MAX_MS,
  type InboxBridgeEvent,
  type InboxEventBus,
  type InboundMessageEvent,
} from "./inbox-events.js";
import type { WaitForEmailArgs } from "../schemas.js";

export type WaitForEmailResult = {
  matched: boolean;
  reason: "inbound" | "draft_rejected" | "timeout" | "aborted";
  waitedMs: number;
  /** Effective timeout after the 20s hard cap. */
  timeoutMs: number;
  inboxId: string;
  threadId: string | null;
  messageId: string | null;
  trueOriginalSender: IngestedMime["trueOriginalSender"] | null;
  senderAuthStatus: IngestedMime["senderAuthStatus"] | null;
  senderAuth: IngestedMime["senderAuth"] | null;
  extractedOtp: string | null;
  verificationUrl: string | null;
  subject: string | null;
  fromAddress: string | null;
  spotlightedText: string | null;
  injectionRisk: IngestedMime["injectionRisk"] | null;
  draftFeedbackEvent: DraftLifecycleEvent | null;
  mime: IngestedMime | null;
};

export function clampWaitTimeoutMs(value: number | undefined): number {
  const raw = value ?? WAIT_FOR_EMAIL_MAX_MS;
  return Math.min(Math.max(1, raw), WAIT_FOR_EMAIL_MAX_MS);
}

function matchesInbound(
  event: InboundMessageEvent,
  args: WaitForEmailArgs,
): boolean {
  if (event.inboxId !== args.inboxId) return false;
  if (args.threadId && event.thread.id !== args.threadId) return false;
  if (args.fromContains) {
    const from =
      event.mime?.trueOriginalSender?.address ??
      event.mime?.from?.address ??
      event.message.fromAddress ??
      "";
    if (!from.toLowerCase().includes(args.fromContains.toLowerCase())) {
      return false;
    }
  }
  if (args.subjectContains) {
    const subject = event.mime?.subject ?? event.message.subject ?? "";
    if (!subject.toLowerCase().includes(args.subjectContains.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function isRejectForWait(
  event: DraftLifecycleEvent,
  args: WaitForEmailArgs,
): boolean {
  if (event.type !== "draft.rejected") return false;
  if (args.threadId && event.draft.threadId !== args.threadId) return false;
  // Rejects for drafts in this inbox (when thread filter omitted).
  if (!args.threadId && event.draft.inboxId !== args.inboxId) return false;
  return true;
}

/**
 * `wait_for_email` — wakes on inbound mail OR REJECTED_WITH_FEEDBACK,
 * hard-capped at 20s. Honors AbortSignal from the MCP request extra.
 */
export async function waitForEmail(
  bus: InboxEventBus,
  args: WaitForEmailArgs,
  options: { signal?: AbortSignal } = {},
): Promise<WaitForEmailResult> {
  const timeoutMs = clampWaitTimeoutMs(args.timeoutMs);
  const started = Date.now();

  if (options.signal?.aborted) {
    return abortedResult(args, timeoutMs, 0);
  }

  const predicate = (event: InboxBridgeEvent): boolean => {
    if (event.type === "message.inbound") {
      return matchesInbound(event, args);
    }
    if (event.type === "draft.rejected") {
      return isRejectForWait(event, args);
    }
    return false;
  };

  try {
    const event = await bus.waitFor(predicate, {
      timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const waitedMs = Date.now() - started;

    if (event.type === "message.inbound") {
      return {
        matched: true,
        reason: "inbound",
        waitedMs,
        timeoutMs,
        inboxId: args.inboxId,
        threadId: event.thread.id,
        messageId: event.message.messageId,
        trueOriginalSender: event.mime?.trueOriginalSender ?? null,
        senderAuthStatus: event.mime?.senderAuthStatus ?? null,
        senderAuth: event.mime?.senderAuth ?? null,
        extractedOtp: event.mime?.extractedOtp ?? null,
        verificationUrl: event.mime?.verificationUrl ?? null,
        subject: event.mime?.subject ?? event.message.subject,
        fromAddress:
          event.mime?.replyToAddress ??
          event.mime?.from?.address ??
          event.message.fromAddress,
        spotlightedText: event.mime?.spotlightedText ?? null,
        injectionRisk: event.mime?.injectionRisk ?? null,
        draftFeedbackEvent: null,
        mime: event.mime,
      };
    }

    if (event.type === "draft.rejected") {
      return {
        matched: true,
        reason: "draft_rejected",
        waitedMs,
        timeoutMs,
        inboxId: args.inboxId,
        threadId: event.draft.threadId,
        messageId: event.draft.createdMessageId,
        trueOriginalSender: null,
        senderAuthStatus: null,
        senderAuth: null,
        extractedOtp: null,
        verificationUrl: null,
        subject: event.draft.subject,
        fromAddress: null,
        spotlightedText: null,
        injectionRisk: null,
        draftFeedbackEvent: event,
        mime: null,
      };
    }

    // Unreachable given predicate, but keep exhaustiveness.
    return timeoutResult(args, timeoutMs, Date.now() - started);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(message)) {
      return timeoutResult(args, timeoutMs, Date.now() - started);
    }
    if (/aborted/i.test(message) || options.signal?.aborted) {
      return abortedResult(args, timeoutMs, Date.now() - started);
    }
    throw err;
  }
}

function timeoutResult(
  args: WaitForEmailArgs,
  timeoutMs: number,
  waitedMs: number,
): WaitForEmailResult {
  return {
    matched: false,
    reason: "timeout",
    waitedMs,
    timeoutMs,
    inboxId: args.inboxId,
    threadId: args.threadId ?? null,
    messageId: null,
    trueOriginalSender: null,
    senderAuthStatus: null,
    senderAuth: null,
    extractedOtp: null,
    verificationUrl: null,
    subject: null,
    fromAddress: null,
    spotlightedText: null,
    injectionRisk: null,
    draftFeedbackEvent: null,
    mime: null,
  };
}

function abortedResult(
  args: WaitForEmailArgs,
  timeoutMs: number,
  waitedMs: number,
): WaitForEmailResult {
  return {
    ...timeoutResult(args, timeoutMs, waitedMs),
    reason: "aborted",
  };
}
