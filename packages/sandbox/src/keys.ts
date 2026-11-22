/**
 * Regional production API keys for Concierge Pro.
 * Format: `envlo_live_{us|eu}_{32 hex chars}`
 */
export type KeyRegion = "us" | "eu";

const KEY_PREFIX = "envlo_live_";
const KEY_BODY_HEX_LEN = 32;

export function isKeyRegion(value: unknown): value is KeyRegion {
  return value === "us" || value === "eu";
}

export function parseKeyRegion(
  value: string | null | undefined,
  fallback: KeyRegion = "us",
): KeyRegion {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (isKeyRegion(normalized)) return normalized;
  // Accept common aliases from Stripe metadata / locale.
  if (normalized === "europe" || normalized.startsWith("eu-")) return "eu";
  if (normalized === "usa" || normalized.startsWith("us-")) return "us";
  return fallback;
}

export function formatLiveApiKey(region: KeyRegion, bodyHex: string): string {
  if (!/^[0-9a-f]+$/i.test(bodyHex) || bodyHex.length !== KEY_BODY_HEX_LEN) {
    throw new Error(
      `API key body must be ${KEY_BODY_HEX_LEN} lowercase hex characters`,
    );
  }
  return `${KEY_PREFIX}${region}_${bodyHex.toLowerCase()}`;
}

export function parseLiveApiKey(
  key: string,
): { region: KeyRegion; bodyHex: string } | null {
  const match = /^envlo_live_(us|eu)_([0-9a-f]{32})$/i.exec(key.trim());
  if (!match) return null;
  const region = match[1]!.toLowerCase() as KeyRegion;
  return { region, bodyHex: match[2]!.toLowerCase() };
}

export async function generateLiveApiKey(
  region: KeyRegion,
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): Promise<string> {
  const bytes = randomBytes(KEY_BODY_HEX_LEN / 2);
  const bodyHex = [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return formatLiveApiKey(region, bodyHex);
}

function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export async function hashApiKey(
  key: string,
  pepper: string = "",
): Promise<string> {
  const data = new TextEncoder().encode(`${pepper}:${key}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Redact for logs: `envlo_live_us_abcd…wxyz` */
export function redactApiKey(key: string): string {
  const parsed = parseLiveApiKey(key);
  if (!parsed) return "envlo_live_***";
  const { bodyHex, region } = parsed;
  return `${KEY_PREFIX}${region}_${bodyHex.slice(0, 4)}…${bodyHex.slice(-4)}`;
}
