/** Extract domain from an email address (lowercased). */
export function domainOfAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * True when any recipient domain is outside the inbox domain + internalDomains.
 * Addresses without a domain are treated as external (fail closed).
 */
export function hasExternalRecipient(
  recipients: string[],
  inboxAddress: string | null | undefined,
  internalDomains: string[] = [],
): boolean {
  const inboxDomain = domainOfAddress(inboxAddress);
  const allowed = new Set(
    [inboxDomain, ...internalDomains]
      .filter((d): d is string => Boolean(d))
      .map((d) => d.toLowerCase()),
  );

  if (recipients.length === 0) return false;

  for (const raw of recipients) {
    const domain = domainOfAddress(raw);
    if (!domain) return true;
    if (!allowed.has(domain)) return true;
  }
  return false;
}

/** Primary recipient key for loop-breaker bucketing (first To, lowercased). */
export function primaryRecipient(recipients: string[]): string | null {
  const first = recipients.map(normalizeAddress).find((a) => a.length > 0);
  return first ?? null;
}
