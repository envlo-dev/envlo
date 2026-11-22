import type { KeyRegion } from "./keys.js";
import { parseKeyRegion } from "./keys.js";
import { MAX_BUFFERED_MIME_BYTES } from "./mime.js";

export type SandboxEnv = {
  SANDBOX_KV: KVNamespace;
  INBOX: DurableObjectNamespace;
  SANDBOX_DOMAIN: string;
  UPGRADE_ORIGIN: string;
  STRIPE_PAYMENT_LINK_URL: string;
  DEFAULT_KEY_REGION?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  API_KEY_PEPPER?: string;
  /** HMAC secret for ephemeral session tokens (required in production). */
  SESSION_SIGNING_SECRET?: string;
  /** Hard reject inbound MIME above this size (bytes). */
  MAX_MIME_BYTES?: string;
};

export type ResolvedSandboxConfig = {
  sandboxDomain: string;
  upgradeOrigin: string;
  stripePaymentLinkUrl: string;
  defaultKeyRegion: KeyRegion;
  stripeWebhookSecret: string;
  resendApiKey: string;
  resendFrom: string;
  apiKeyPepper: string;
  sessionSigningSecret: string;
  maxMimeBytes: number;
};

export function resolveSandboxConfig(env: SandboxEnv): ResolvedSandboxConfig {
  const maxMime = Number.parseInt(env.MAX_MIME_BYTES || "", 10);
  return {
    sandboxDomain: env.SANDBOX_DOMAIN || "sandbox.envlo.dev",
    upgradeOrigin: env.UPGRADE_ORIGIN || "https://envlo.dev",
    stripePaymentLinkUrl: env.STRIPE_PAYMENT_LINK_URL || "",
    defaultKeyRegion: parseKeyRegion(env.DEFAULT_KEY_REGION, "us"),
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    resendApiKey: env.RESEND_API_KEY || "",
    resendFrom: env.RESEND_FROM || "Envlo <welcome@envlo.dev>",
    apiKeyPepper: env.API_KEY_PEPPER || "",
    sessionSigningSecret:
      env.SESSION_SIGNING_SECRET || env.API_KEY_PEPPER || "dev-session-secret",
    maxMimeBytes:
      Number.isFinite(maxMime) && maxMime > 0
        ? maxMime
        : Math.max(MAX_BUFFERED_MIME_BYTES, 1024 * 1024),
  };
}
