import { ensureMessageId } from "./message-id.js";
import type {
  OutboundMail,
  OutboundSendResult,
  OutboundSender,
  SesCompatibleClient,
} from "./types.js";

export type SesSenderOptions = {
  client: SesCompatibleClient;
  messageIdDomain?: string;
};

/**
 * AWS SES sender via an injected client (AWS SDK v3 wrapper, LocalStack, …).
 * `@envlo/core` does not bundle the AWS SDK.
 */
export class SesSender implements OutboundSender {
  readonly kind = "ses" as const;
  private readonly client: SesCompatibleClient;
  private readonly messageIdDomain: string;

  constructor(options: SesSenderOptions) {
    this.client = options.client;
    this.messageIdDomain = options.messageIdDomain ?? "ses.envlo.local";
  }

  async send(mail: OutboundMail): Promise<OutboundSendResult> {
    const result = await this.client.sendEmail({
      from: mail.from,
      to: mail.to,
      ...(mail.cc?.length ? { cc: mail.cc } : {}),
      ...(mail.bcc?.length ? { bcc: mail.bcc } : {}),
      ...(mail.replyTo ? { replyTo: [mail.replyTo] } : {}),
      subject: mail.subject,
      ...(mail.text !== undefined ? { text: mail.text } : {}),
      ...(mail.html !== undefined ? { html: mail.html } : {}),
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      ...(mail.references?.length
        ? { references: mail.references.join(" ") }
        : {}),
    });
    return {
      messageId: ensureMessageId(
        result.messageId.includes("@")
          ? result.messageId
          : `<${result.messageId}@${this.messageIdDomain}>`,
        this.messageIdDomain,
      ),
      providerId: result.messageId,
    };
  }
}
