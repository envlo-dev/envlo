/**
 * HMAC-signed session tokens so inbox WS / poll aren't guessable by inbox id.
 * Format: `evlo1.<base64url payload>.<base64url mac>`
 */
import { hmacSha256Hex, timingSafeEqualHex } from "./crypto-util.js";

export type SessionTokenPayload = {
  sid: string;
  /** Optional inbox scope; omit for session-wide access. */
  inboxId?: string;
  exp: number;
};

export function encodeBase64Url(bytes: Uint8Array | string): string {
  const raw =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function"
      ? btoa(bin)
      : Buffer.from(raw).toString("base64");
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeBase64Url(value: string): Uint8Array {
  const b64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const full = b64 + pad;
  if (typeof atob === "function") {
    const bin = atob(full);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(full, "base64"));
}

export async function signSessionToken(
  payload: SessionTokenPayload,
  secret: string,
): Promise<string> {
  if (!secret) {
    throw new Error("SESSION_SIGNING_SECRET required to sign tokens");
  }
  const body = encodeBase64Url(JSON.stringify(payload));
  const macHex = await hmacSha256Hex(secret, `evlo1.${body}`);
  const mac = encodeBase64Url(
    new TextEncoder().encode(
      // Store hex as utf8 then b64url — compact enough for headers.
      macHex,
    ),
  );
  return `evlo1.${body}.${mac}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
  opts: { inboxId?: string; nowMs?: number } = {},
): Promise<SessionTokenPayload | null> {
  if (!secret || !token.startsWith("evlo1.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [, body, mac] = parts;
  if (!body || !mac) return null;

  const expectedHex = await hmacSha256Hex(secret, `evlo1.${body}`);
  const providedHex = new TextDecoder().decode(decodeBase64Url(mac));
  if (!timingSafeEqualHex(expectedHex, providedHex)) return null;

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(body)),
    ) as SessionTokenPayload;
  } catch {
    return null;
  }
  if (!payload.sid || typeof payload.exp !== "number") return null;
  const nowMs = opts.nowMs ?? Date.now();
  if (nowMs >= payload.exp) return null;
  if (opts.inboxId && payload.inboxId && payload.inboxId !== opts.inboxId) {
    return null;
  }
  return payload;
}

export function sessionTokenExpiryMs(
  createdAtMs: number,
  ttlMs: number,
): number {
  return createdAtMs + ttlMs;
}
