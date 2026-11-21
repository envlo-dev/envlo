/**
 * Normalize inbound webhook bodies from Envlo clients, SES SNS, and Resend.
 */

export type ParsedInboundWebhook = {
  /** Raw RFC822 when available. */
  mime: string | Uint8Array | null;
  inboxId: string | undefined;
  address: string | undefined;
  /**
   * SNS SubscriptionConfirmation — caller should HTTP GET SubscribeURL
   * (or return it to the operator).
   */
  snsSubscribeUrl: string | undefined;
  /** Provider hint for logs. */
  provider: "raw" | "json" | "ses_sns" | "resend" | "unknown";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  obj: Record<string, unknown> | null,
  ...keys: string[]
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

/**
 * Extract MIME + routing hints from a webhook body.
 *
 * Supported shapes:
 * - Raw RFC822 bytes / text
 * - `{ raw | eml, inboxId?, address? }`
 * - SES SNS: `{ Type, SubscribeURL?, Message }` where Message is JSON with
 *   `content` (raw MIME) or nested `mail`
 * - Resend: `{ type, data: { email_id, to, … } }` with `data.raw` / `data.content`
 *   or top-level `raw` / `email`
 */
export function parseInboundWebhookPayload(
  raw: Buffer,
  contentType: string,
): ParsedInboundWebhook {
  const ct = contentType.toLowerCase();
  const looksJson =
    ct.includes("application/json") ||
    ct.includes("text/json") ||
    raw.slice(0, 1).toString("utf8") === "{";

  if (!looksJson) {
    return {
      mime: raw,
      inboxId: undefined,
      address: undefined,
      snsSubscribeUrl: undefined,
      provider: "raw",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return {
      mime: raw,
      inboxId: undefined,
      address: undefined,
      snsSubscribeUrl: undefined,
      provider: "raw",
    };
  }

  const root = asRecord(parsed);
  if (!root) {
    return {
      mime: null,
      inboxId: undefined,
      address: undefined,
      snsSubscribeUrl: undefined,
      provider: "unknown",
    };
  }

  // --- SNS envelope (SES) ---
  const snsType = stringField(root, "Type", "type");
  if (
    snsType === "SubscriptionConfirmation" ||
    snsType === "UnsubscribeConfirmation"
  ) {
    return {
      mime: null,
      inboxId: undefined,
      address: undefined,
      snsSubscribeUrl: stringField(root, "SubscribeURL", "SubscribeUrl"),
      provider: "ses_sns",
    };
  }

  if (snsType === "Notification") {
    const messageRaw = stringField(root, "Message");
    const messageObj = asRecord(
      (() => {
        if (!messageRaw) return null;
        try {
          return JSON.parse(messageRaw);
        } catch {
          return null;
        }
      })(),
    );

    // Some stacks put MIME directly in Message as a string.
    if (!messageObj && messageRaw && messageRaw.includes("\n")) {
      return {
        mime: messageRaw,
        inboxId: stringField(root, "inboxId"),
        address: stringField(root, "address"),
        snsSubscribeUrl: undefined,
        provider: "ses_sns",
      };
    }

    const content =
      stringField(messageObj, "content", "raw", "eml") ??
      stringField(asRecord(messageObj?.mail as unknown) ?? null, "content");

    const mail = asRecord(messageObj?.mail as unknown);
    const destination = mail?.destination;
    const addressFromSes = Array.isArray(destination)
      ? destination.find((d): d is string => typeof d === "string")
      : stringField(mail, "destination");

    return {
      mime: content ?? null,
      inboxId: stringField(root, "inboxId") ?? stringField(messageObj, "inboxId"),
      address:
        stringField(root, "address") ??
        stringField(messageObj, "address") ??
        addressFromSes,
      snsSubscribeUrl: undefined,
      provider: "ses_sns",
    };
  }

  // --- Resend-style ---
  const resendType = stringField(root, "type");
  const data = asRecord(root.data as unknown);
  if (resendType?.startsWith("email.") || data) {
    const mime =
      stringField(root, "raw", "eml", "email", "content") ??
      stringField(data, "raw", "eml", "email", "content");
    const to = data?.to;
    const address =
      stringField(root, "address") ??
      stringField(data, "address", "to") ??
      (Array.isArray(to)
        ? to.find((t): t is string => typeof t === "string")
        : undefined);
    return {
      mime: mime ?? null,
      inboxId: stringField(root, "inboxId") ?? stringField(data, "inboxId"),
      address,
      snsSubscribeUrl: undefined,
      provider: "resend",
    };
  }

  // --- Envlo JSON ---
  const mime = stringField(root, "raw", "eml", "email", "content");
  return {
    mime: mime ?? null,
    inboxId: stringField(root, "inboxId"),
    address: stringField(root, "address"),
    snsSubscribeUrl: undefined,
    provider: mime ? "json" : "unknown",
  };
}
