import { isIP } from "node:net";

/**
 * Block obviously dangerous URL hosts for outbound attachment fetches.
 * Not a full SSRF shield (DNS rebinding still exists) — defense in depth.
 */
export function isBlockedAttachmentHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }

  if (ipVersion === 6) {
    if (host === "::1") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // ULA
    if (host.startsWith("fe80")) return true; // link-local
  }

  return false;
}
