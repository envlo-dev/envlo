/**
 * Envlo Day-1 Ephemeral Sandbox Gateway
 * Domain: @sandbox.envlo.dev (or a separate trial domain)
 *
 * - Cloudflare Email Worker → Durable Object + KV (expirationTtl: 7200) ring buffer
 * - WebSocket bridge for wait_for_email / brief disconnect catch-up
 * - Free limits: 3 inboxes, 2h TTL, 100 inbound/day
 * - Concierge Pro ($19/mo) Stripe Payment Link webhook → envlo_live_{us|eu}_… + Resend
 */
import type { SandboxEnv } from "./env.js";
import { handleEmailMessage, handleHttpRequest } from "./http.js";

export { InboxDurableObject } from "./inbox-do.js";
export {
  FREE_EPHEMERAL_LIMITS,
  SANDBOX_TTL_SECONDS,
  SANDBOX_TTL_MS,
} from "./limits.js";
export {
  formatLiveApiKey,
  generateLiveApiKey,
  hashApiKey,
  parseLiveApiKey,
  parseKeyRegion,
  redactApiKey,
} from "./keys.js";
export {
  appendToRing,
  messagesAfter,
  ringPutOptions,
  RING_BUFFER_TTL_SECONDS,
} from "./ring-buffer.js";
export {
  verifyStripeSignature,
  fulfillConciergeCheckout,
  parseStripeEvent,
  revokeConciergeKeysForEmail,
  isRevokeEvent,
} from "./stripe.js";
export { buildWelcomeEmail, sendWelcomeEmailViaResend } from "./welcome-email.js";
export { handleHttpRequest, handleEmailMessage } from "./http.js";
export { provisionEphemeralInbox, getInboxMeta } from "./sandbox-store.js";
export {
  loadMessagesFromKv,
  trimRecent,
  RING_RECENT_CAP,
} from "./ring-buffer.js";
export { signSessionToken, verifySessionToken } from "./session-token.js";
export { authenticateRequest } from "./auth.js";

export type { SandboxEnv } from "./env.js";
export type { BufferedEmail, InboxMeta } from "./ring-buffer.js";
export type { KeyRegion } from "./keys.js";
export type { ProvisionedApiKey, ApiKeyRecord } from "./stripe.js";

const worker: ExportedHandler<SandboxEnv> = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,stripe-signature",
        },
      });
    }
    return handleHttpRequest(request, env, ctx);
  },

  async email(message, env, _ctx) {
    await handleEmailMessage(message, env);
  },
};

export default worker;
