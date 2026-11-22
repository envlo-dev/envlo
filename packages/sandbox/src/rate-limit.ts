import { ringPutOptions } from "./ring-buffer.js";

export const DEFAULT_PROVISION_RATE_LIMIT = {
  windowSeconds: 60,
  maxRequests: 30,
} as const;

export function kvProvisionRateKey(scope: string, windowId: number): string {
  return `rate:provision:${scope}:${windowId}`;
}

export async function consumeProvisionRateLimit(
  kv: KVNamespace,
  scope: string,
  opts: {
    nowMs?: number;
    windowSeconds?: number;
    maxRequests?: number;
  } = {},
): Promise<{ ok: true; count: number } | { ok: false; count: number; retryAfterSec: number }> {
  const windowSeconds = opts.windowSeconds ?? DEFAULT_PROVISION_RATE_LIMIT.windowSeconds;
  const maxRequests = opts.maxRequests ?? DEFAULT_PROVISION_RATE_LIMIT.maxRequests;
  const nowMs = opts.nowMs ?? Date.now();
  const windowId = Math.floor(nowMs / (windowSeconds * 1000));
  const key = kvProvisionRateKey(scope || "anon", windowId);
  const raw = await kv.get(key);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (current >= maxRequests) {
    const retryAfterSec =
      windowSeconds - Math.floor((nowMs / 1000) % windowSeconds);
    return { ok: false, count: current, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  const next = current + 1;
  await kv.put(key, String(next), ringPutOptions(windowSeconds * 2));
  return { ok: true, count: next };
}

export function clientIpFromRequest(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "anon"
  );
}
