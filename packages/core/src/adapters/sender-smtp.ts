import { ensureMessageId } from "./message-id.js";
import type {
  OutboundMail,
  OutboundSendResult,
  OutboundSender,
  SmtpTransport,
} from "./types.js";

export type SmtpSenderOptions = {
  transport: SmtpTransport;
  messageIdDomain?: string;
};

/**
 * SMTP sender via an injected transport (e.g. nodemailer `createTransport`).
 * Node-oriented — inject the transport; `@envlo/core` does not bundle nodemailer.
 */
export class SmtpSender implements OutboundSender {
  readonly kind = "smtp" as const;
  private readonly transport: SmtpTransport;
  private readonly messageIdDomain: string;

  constructor(options: SmtpSenderOptions) {
    this.transport = options.transport;
    this.messageIdDomain = options.messageIdDomain ?? "smtp.envlo.local";
  }

  async send(mail: OutboundMail): Promise<OutboundSendResult> {
    const result = await this.transport.sendMail({
      from: mail.from,
      to: mail.to,
      ...(mail.cc?.length ? { cc: mail.cc } : {}),
      ...(mail.bcc?.length ? { bcc: mail.bcc } : {}),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      subject: mail.subject,
      ...(mail.text !== undefined ? { text: mail.text } : {}),
      ...(mail.html !== undefined ? { html: mail.html } : {}),
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      ...(mail.references?.length
        ? { references: mail.references.join(" ") }
        : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
    });
    return {
      messageId: ensureMessageId(result.messageId, this.messageIdDomain),
      providerId: result.messageId ?? null,
    };
  }
}
