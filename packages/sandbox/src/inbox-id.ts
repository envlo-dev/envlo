import { randomToken } from "./crypto-util.js";

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;

export function normalizeLocalPart(local: string): string {
  return local.trim().toLowerCase();
}

export function isValidInboxLocalPart(local: string): boolean {
  const n = normalizeLocalPart(local);
  if (n.length < 1 || n.length > 64) return false;
  if (n.includes("..")) return false;
  return LOCAL_PART_RE.test(n);
}

export function inboxAddress(local: string, domain: string): string {
  return `${normalizeLocalPart(local)}@${domain.toLowerCase()}`;
}

export function parseInboxAddress(
  address: string,
  expectedDomain: string,
): string | null {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (domain !== expectedDomain.toLowerCase()) return null;
  if (!isValidInboxLocalPart(local)) return null;
  return local;
}

/** Generate a unique ephemeral local-part (`a1b2c3d4e5f6`). */
export function generateEphemeralLocalPart(): string {
  return randomToken(8);
}

export function newSessionId(): string {
  return `sess_${randomToken(12)}`;
}
