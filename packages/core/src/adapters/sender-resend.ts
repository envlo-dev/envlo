import { bytesToBase64 } from "./base64.js";
import { bareMessageId, ensureMessageId } from "./message-id.js";
import type {
  FetchLike,
  OutboundMail,
  OutboundSendResult,
  OutboundSender,
} from "./types.js";

export type ResendSenderOptions = {
  apiKey: string;
  /** Defaults to `https://api.resend.com/emails`. */
  endpoint?: string;
  fetch?: FetchLike;
  messageIdDomain?: string;
};

/**
 * Resend HTTP API sender. Inject `fetch` for tests — no SDK dependency.
 */
export class ResendSender implements OutboundSender {
  readonly kind = "resend" as const;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly messageIdDomain: string;

  constructor(options: ResendSenderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("ResendSender requires a non-empty apiKey");
    }
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? "https://api.resend.com/emails";
    this.fetchImpl =
      options.fetch ??
      ((globalThis.fetch as FetchLike | undefined) as FetchLike);
    if (typeof this.fetchImpl !== "function") {
      throw new Error("ResendSender requires fetch (global or injected)");
    }
    this.messageIdDomain = options.messageIdDomain ?? "resend.envlo.local";
  }

  async send(mail: OutboundMail): Promise<OutboundSendResult> {
    const customHeaders: Record<string, string> = { ...(mail.headers ?? {}) };
    if (mail.inReplyTo) {
      customHeaders["In-Reply-To"] = mail.inReplyTo;
    }
    if (mail.references?.length) {
      customHeaders.References = mail.references.join(" ");
    }

    const body: Record<string, unknown> = {
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
    };
    if (mail.cc?.length) body.cc = mail.cc;
    if (mail.bcc?.length) body.bcc = mail.bcc;
    if (mail.replyTo) body.reply_to = mail.replyTo;
    if (mail.text !== undefined) body.text = mail.text;
    if (mail.html !== undefined) body.html = mail.html;
    if (Object.keys(customHeaders).length > 0) {
      body.headers = customHeaders;
    }
    if (mail.attachments?.length) {
      body.attachments = mail.attachments.map((a) => ({
        filename: a.filename,
        content: bytesToBase64(a.content),
        content_type: a.contentType,
      }));
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`ResendSender failed (${response.status}): ${raw}`);
    }
    let providerId: string | null = null;
    try {
      const parsed = JSON.parse(raw) as { id?: string };
      providerId = parsed.id ?? null;
    } catch {
      providerId = null;
    }
    return {
      messageId: ensureMessageId(
        providerId ? `<${bareMessageId(providerId)}@${this.messageIdDomain}>` : null,
        this.messageIdDomain,
      ),
      providerId,
    };
  }
}
