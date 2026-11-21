import { ensureMessageId } from "./message-id.js";
import type { OutboundMail, OutboundSendResult, OutboundSender } from "./types.js";

export type ConsoleDryRunSenderOptions = {
  /** Message-ID domain (default `envlo.local`). */
  messageIdDomain?: string;
  /** Override logger (default `console.info`). */
  log?: (line: string) => void;
};

/**
 * Default keyless sandbox sender — logs the outbound mail and returns a
 * synthetic Message-ID without contacting a network.
 */
export class ConsoleDryRunSender implements OutboundSender {
  readonly kind = "console" as const;
  private readonly messageIdDomain: string;
  private readonly log: (line: string) => void;
  readonly sent: OutboundMail[] = [];

  constructor(options: ConsoleDryRunSenderOptions = {}) {
    this.messageIdDomain = options.messageIdDomain ?? "envlo.local";
    this.log = options.log ?? ((line) => console.info(line));
  }

  async send(mail: OutboundMail): Promise<OutboundSendResult> {
    this.sent.push(mail);
    const messageId = ensureMessageId(undefined, this.messageIdDomain);
    this.log(
      [
        "[envlo:console-dry-run]",
        `from=${mail.from}`,
        `to=${mail.to.join(",")}`,
        `subject=${JSON.stringify(mail.subject)}`,
        `messageId=${messageId}`,
        `textChars=${mail.text?.length ?? 0}`,
        `htmlChars=${mail.html?.length ?? 0}`,
      ].join(" "),
    );
    return { messageId, providerId: null, dryRun: true };
  }
}
