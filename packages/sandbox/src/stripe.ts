/**
 * Stripe Payment Link webhook verification + Concierge Pro fulfillment.
 */
import { hmacSha256Hex, timingSafeEqualHex } from "./crypto-util.js";
import {
  generateLiveApiKey,
  hashApiKey,
  parseKeyRegion,
  type KeyRegion,
} from "./keys.js";
import {
  kvApiKeyHashKey,
  kvStripeEventKey,
  ringPutOptions,
} from "./ring-buffer.js";

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeCheckoutSession = {
  id: string;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
  currency?: string | null;
  locale?: string | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: StripeCheckoutSession & Record<string, unknown> };
};

export type VerifiedStripeEvent = StripeEvent;

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").map((p) => p.trim());
  let timestamp: number | null = null;
  const v1Sigs: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t" && v) timestamp = Number.parseInt(v, 10);
    if (k === "v1" && v) v1Sigs.push(v);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || v1Sigs.length === 0) {
    return false;
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const signed = `${timestamp}.${rawBody}`;
  const expected = await hmacSha256Hex(secret, signed);
  return v1Sigs.some((sig) => timingSafeEqualHex(sig, expected));
}

export function parseStripeEvent(rawBody: string): StripeEvent {
  const parsed = JSON.parse(rawBody) as StripeEvent;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid stripe event");
  }
  if (typeof parsed.id !== "string" || typeof parsed.type !== "string") {
    throw new Error("invalid stripe event shape");
  }
  return parsed;
}

export function resolveCustomerEmail(session: StripeCheckoutSession): string | null {
  const fromDetails = session.customer_details?.email?.trim();
  if (fromDetails) return fromDetails;
  const fromSession = session.customer_email?.trim();
  if (fromSession) return fromSession;
  return null;
}

export function resolveRegionFromSession(
  session: StripeCheckoutSession,
  fallback: KeyRegion = "us",
): KeyRegion {
  const metaRegion = session.metadata?.["region"] ?? session.metadata?.["Region"];
  if (metaRegion) return parseKeyRegion(metaRegion, fallback);
  if (session.locale) {
    const locale = session.locale.toLowerCase();
    if (locale.startsWith("en-gb") || locale.startsWith("de") || locale.startsWith("fr")) {
      return "eu";
    }
  }
  if (session.currency === "eur" || session.currency === "gbp") return "eu";
  return fallback;
}

export type ProvisionedApiKey = {
  /** Present only on first fulfillment — never persisted for replay. */
  apiKey?: string;
  keyHash: string;
  region: KeyRegion;
  email: string;
  stripeEventId: string;
  checkoutSessionId: string;
  /** False when this Stripe event was already fulfilled (idempotent replay). */
  fresh: boolean;
};

export type ApiKeyRecord = {
  email: string;
  region: KeyRegion;
  plan: "concierge_pro";
  stripeEventId: string;
  checkoutSessionId: string;
  createdAt: string;
  redactedKey: string;
  status: "active" | "revoked";
  revokedAt?: string;
  revokeReason?: string;
};

export type StripeEventDedupe = {
  keyHash: string;
  region: KeyRegion;
  email: string;
  stripeEventId: string;
  checkoutSessionId: string;
};

export type FulfillDeps = {
  kv: KVNamespace;
  pepper: string;
  defaultRegion: KeyRegion;
  nowIso?: string;
  generateKey?: (region: KeyRegion) => Promise<string>;
};

/**
 * Idempotent Concierge Pro fulfillment for `checkout.session.completed`.
 * Returns null when the event is not a checkout completion or has no email.
 */
export async function fulfillConciergeCheckout(
  event: StripeEvent,
  deps: FulfillDeps,
): Promise<ProvisionedApiKey | null> {
  if (event.type !== "checkout.session.completed") {
    return null;
  }

  const dedupeKey = kvStripeEventKey(event.id);
  const already = await deps.kv.get(dedupeKey);
  if (already) {
    const prior = JSON.parse(already) as StripeEventDedupe;
    return {
      keyHash: prior.keyHash,
      region: prior.region,
      email: prior.email,
      stripeEventId: prior.stripeEventId,
      checkoutSessionId: prior.checkoutSessionId,
      fresh: false,
    };
  }

  const session = event.data.object;
  const email = resolveCustomerEmail(session);
  if (!email) {
    throw new Error("checkout.session.completed missing customer email");
  }

  const region = resolveRegionFromSession(session, deps.defaultRegion);
  const apiKey = deps.generateKey
    ? await deps.generateKey(region)
    : await generateLiveApiKey(region);
  const keyHash = await hashApiKey(apiKey, deps.pepper);
  const createdAt = deps.nowIso ?? new Date().toISOString();

  const record: ApiKeyRecord = {
    email,
    region,
    plan: "concierge_pro",
    stripeEventId: event.id,
    checkoutSessionId: session.id,
    createdAt,
    redactedKey: `${apiKey.slice(0, 18)}…`,
    status: "active",
  };

  const dedupe: StripeEventDedupe = {
    keyHash,
    region,
    email,
    stripeEventId: event.id,
    checkoutSessionId: session.id,
  };

  await deps.kv.put(kvApiKeyHashKey(keyHash), JSON.stringify(record));
  // Index by email for subscription cancel / refund revoke.
  await deps.kv.put(
    kvEmailKeysKey(email),
    JSON.stringify(
      await appendEmailKeyIndex(deps.kv, email, keyHash),
    ),
  );
  // Dedupe stores hashes only — never plaintext API keys.
  await deps.kv.put(dedupeKey, JSON.stringify(dedupe), ringPutOptions(86400 * 7));

  return {
    apiKey,
    keyHash,
    region,
    email,
    stripeEventId: event.id,
    checkoutSessionId: session.id,
    fresh: true,
  };
}

export function kvEmailKeysKey(email: string): string {
  return `email:${email.trim().toLowerCase()}:keys`;
}

async function appendEmailKeyIndex(
  kv: KVNamespace,
  email: string,
  keyHash: string,
): Promise<string[]> {
  const raw = await kv.get(kvEmailKeysKey(email));
  let list: string[] = [];
  if (raw) {
    try {
      list = JSON.parse(raw) as string[];
    } catch {
      list = [];
    }
  }
  if (!list.includes(keyHash)) list.push(keyHash);
  return list;
}

export type RevokeResult = {
  revoked: number;
  keyHashes: string[];
};

/**
 * Revoke Concierge Pro keys for subscription cancel / refund events.
 */
export async function revokeConciergeKeysForEmail(
  kv: KVNamespace,
  email: string,
  reason: string,
  nowIso: string = new Date().toISOString(),
): Promise<RevokeResult> {
  const normalized = email.trim().toLowerCase();
  const raw = await kv.get(kvEmailKeysKey(normalized));
  if (!raw) return { revoked: 0, keyHashes: [] };
  let hashes: string[] = [];
  try {
    hashes = JSON.parse(raw) as string[];
  } catch {
    return { revoked: 0, keyHashes: [] };
  }

  const revoked: string[] = [];
  for (const hash of hashes) {
    const recRaw = await kv.get(kvApiKeyHashKey(hash));
    if (!recRaw) continue;
    const record = JSON.parse(recRaw) as ApiKeyRecord;
    if (record.status === "revoked") continue;
    const next: ApiKeyRecord = {
      ...record,
      status: "revoked",
      revokedAt: nowIso,
      revokeReason: reason,
    };
    await kv.put(kvApiKeyHashKey(hash), JSON.stringify(next));
    revoked.push(hash);
  }
  return { revoked: revoked.length, keyHashes: revoked };
}

export function extractRevokeEmail(event: StripeEvent): string | null {
  if (
    event.type === "customer.subscription.deleted" ||
    event.type === "charge.refunded"
  ) {
    const obj = event.data.object as StripeCheckoutSession & {
      receipt_email?: string | null;
      billing_details?: { email?: string | null } | null;
      customer_email?: string | null;
    };
    return (
      resolveCustomerEmail(obj) ||
      obj.receipt_email?.trim() ||
      obj.billing_details?.email?.trim() ||
      null
    );
  }
  return null;
}

export function isRevokeEvent(type: string): boolean {
  return (
    type === "customer.subscription.deleted" || type === "charge.refunded"
  );
}
