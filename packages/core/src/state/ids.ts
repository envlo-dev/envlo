/** Filesystem-safe random id (hex). */
export function createStateId(prefix = ""): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return prefix ? `${prefix}_${hex}` : hex;
}

/** Generate an RFC 5322-ish Message-ID for outbound mail. */
export function createOutboundMessageId(domain = "envlo.local"): string {
  const id = createStateId();
  return `<${id}@${domain}>`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
