import type { MimeAddress } from "../parser/types.js";

const ANGLE_EMAIL_RE = /^(.*)<\s*([^<>@\s]+@[^<>@\s]+)\s*>\s*$/;
const BARE_EMAIL_RE = /^([^<>@\s]+@[^<>@\s]+)$/;
const EMAIL_IN_TEXT_RE = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

/** Parse `Name <user@domain>` / bare email header-style values. */
export function parseAddressString(raw: string | undefined | null): MimeAddress | null {
  if (!raw) return null;
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) return null;

  const angled = ANGLE_EMAIL_RE.exec(value);
  if (angled) {
    const name = (angled[1] ?? "").replace(/^["']|["']$/g, "").trim();
    const address = (angled[2] ?? "").trim().toLowerCase();
    if (!address) return null;
    return { name, address };
  }

  const bare = BARE_EMAIL_RE.exec(value);
  if (bare?.[1]) {
    return { name: "", address: bare[1].toLowerCase() };
  }

  const embedded = EMAIL_IN_TEXT_RE.exec(value);
  if (embedded?.[1]) {
    const address = embedded[1].toLowerCase();
    const name = value.replace(embedded[0], "").replace(/[<>]/g, "").trim();
    return { name, address };
  }

  return null;
}

/** Collect email-looking tokens from a header that may list multiple addresses. */
export function extractEmailsFromHeader(value: string | undefined | null): string[] {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}
