import {
  authenticateRequest,
  isAuthSuccess,
  sessionOwnsInbox,
} from "./auth.js";
import { resolveSandboxConfig, type SandboxEnv } from "./env.js";
import { SANDBOX_TTL_MS } from "./limits.js";
import { parseInboxAddress } from "./inbox-id.js";
import {
  clientIpFromRequest,
  consumeProvisionRateLimit,
} from "./rate-limit.js";
import {
  getInboxMeta,
  provisionEphemeralInbox,
} from "./sandbox-store.js";
import {
  sessionTokenExpiryMs,
  signSessionToken,
} from "./session-token.js";
import {
  extractRevokeEmail,
  fulfillConciergeCheckout,
  isRevokeEvent,
  parseStripeEvent,
  revokeConciergeKeysForEmail,
  verifyStripeSignature,
} from "./stripe.js";
import { sendWelcomeEmailViaResend } from "./welcome-email.js";

export async function handleHttpRequest(
  request: Request,
  env: SandboxEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const config = resolveSandboxConfig(env);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json({
      ok: true,
      service: "envlo-sandbox",
      domain: config.sandboxDomain,
      upgrade: `${config.upgradeOrigin}/upgrade`,
    });
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/upgrade" || url.pathname === "/upgrade/")
  ) {
    if (!config.stripePaymentLinkUrl) {
      return json({ ok: false, error: "payment_link_not_configured" }, 503);
    }
    return Response.redirect(config.stripePaymentLinkUrl, 302);
  }

  if (url.pathname === "/webhooks/stripe" && request.method === "POST") {
    return handleStripeWebhook(request, env, ctx);
  }

  // Pro key introspection — proves envlo_live_… is usable end-to-end.
  if (url.pathname === "/v1/me" && request.method === "GET") {
    const auth = await authenticateRequest(request, {
      kv: env.SANDBOX_KV,
      sessionSecret: config.sessionSigningSecret,
      apiKeyPepper: config.apiKeyPepper,
    });
    if (!isAuthSuccess(auth)) {
      return json({ ok: false, error: auth.error }, auth.status);
    }
    if (auth.kind !== "api_key") {
      return json({ ok: false, error: "api_key_required" }, 401);
    }
    return json({
      ok: true,
      plan: auth.record.plan,
      region: auth.record.region,
      email: auth.record.email,
      status: auth.record.status,
      redactedKey: auth.record.redactedKey,
    });
  }

  if (url.pathname === "/v1/sandbox/inboxes" && request.method === "POST") {
    return handleProvision(request, env);
  }

  const inboxMatch =
    /^\/v1\/sandbox\/inboxes\/([^/]+)(?:\/(messages|ws|meta))?$/.exec(
      url.pathname,
    );
  if (inboxMatch) {
    const inboxId = decodeURIComponent(inboxMatch[1]!).toLowerCase();
    const action = inboxMatch[2] ?? "meta";
    return handleInboxRoute(request, env, inboxId, action, url);
  }

  return json({ ok: false, error: "not_found" }, 404);
}

async function handleProvision(
  request: Request,
  env: SandboxEnv,
): Promise<Response> {
  const config = resolveSandboxConfig(env);
  const ip = clientIpFromRequest(request);
  const rate = await consumeProvisionRateLimit(env.SANDBOX_KV, ip);
  if (!rate.ok) {
    return json(
      {
        ok: false,
        error: "rate_limited",
        message: "Too many inbox provisions; retry shortly",
        retryAfterSec: rate.retryAfterSec,
      },
      429,
      { "retry-after": String(rate.retryAfterSec) },
    );
  }

  let body: { sessionId?: string; localPart?: string } = {};
  if (request.headers.get("content-type")?.includes("application/json")) {
    body = (await request.json().catch(() => ({}))) as typeof body;
  }

  const result = await provisionEphemeralInbox(env.SANDBOX_KV, {
    ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
    ...(body.localPart !== undefined ? { preferredLocal: body.localPart } : {}),
    domain: config.sandboxDomain,
  });

  if (!result.ok) {
    return json(
      { ok: false, error: result.error.code, message: result.error.message },
      result.status,
    );
  }

  const stub = env.INBOX.get(env.INBOX.idFromName(result.meta.inboxId));
  await stub.fetch("https://inbox/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result.meta),
  });

  const createdAtMs = Date.parse(result.meta.createdAt);
  const sessionToken = await signSessionToken(
    {
      sid: result.sessionId,
      inboxId: result.meta.inboxId,
      exp: sessionTokenExpiryMs(createdAtMs, SANDBOX_TTL_MS),
    },
    config.sessionSigningSecret,
  );

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "set-cookie": `envlo_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SANDBOX_TTL_MS / 1000)}`,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      sessionId: result.sessionId,
      sessionToken,
      inbox: {
        id: result.meta.inboxId,
        address: result.meta.address,
        createdAt: result.meta.createdAt,
        expiresAt: result.meta.expiresAt,
        websocketPath: `/v1/sandbox/inboxes/${result.meta.inboxId}/ws`,
        messagesPath: `/v1/sandbox/inboxes/${result.meta.inboxId}/messages`,
      },
      limits: result.limits,
    }),
    { status: 201, headers },
  );
}

async function handleInboxRoute(
  request: Request,
  env: SandboxEnv,
  inboxId: string,
  action: string,
  url: URL,
): Promise<Response> {
  const config = resolveSandboxConfig(env);
  const looked = await getInboxMeta(env.SANDBOX_KV, inboxId);
  if ("error" in looked) {
    return json(
      { ok: false, error: looked.error.code, message: looked.error.message },
      looked.status,
    );
  }

  const auth = await authenticateRequest(request, {
    kv: env.SANDBOX_KV,
    sessionSecret: config.sessionSigningSecret,
    apiKeyPepper: config.apiKeyPepper,
    inboxId,
  });
  if (!isAuthSuccess(auth)) {
    return json({ ok: false, error: auth.error }, auth.status);
  }
  if (!sessionOwnsInbox(auth, looked.meta)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const stub = env.INBOX.get(env.INBOX.idFromName(inboxId));

  if (action === "ws") {
    const afterSeq = url.searchParams.get("afterSeq") || "0";
    const headers = new Headers(request.headers);
    return stub.fetch(
      `https://inbox/ws?afterSeq=${encodeURIComponent(afterSeq)}&inboxId=${encodeURIComponent(inboxId)}`,
      new Request(request, { headers }),
    );
  }

  if (action === "messages") {
    const afterSeq = url.searchParams.get("afterSeq") || "0";
    return stub.fetch(
      `https://inbox/messages?afterSeq=${encodeURIComponent(afterSeq)}&inboxId=${encodeURIComponent(inboxId)}`,
      { method: "GET" },
    );
  }

  const doMeta = await stub.fetch("https://inbox/meta");
  const doJson = (await doMeta.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return json({
    ok: true,
    inbox: looked.meta,
    durable: doJson,
  });
}

async function handleStripeWebhook(
  request: Request,
  env: SandboxEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = resolveSandboxConfig(env);
  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  const valid = await verifyStripeSignature(
    rawBody,
    signature,
    config.stripeWebhookSecret,
  );
  if (!valid) {
    return json({ ok: false, error: "invalid_signature" }, 400);
  }

  let event;
  try {
    event = parseStripeEvent(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  try {
    if (isRevokeEvent(event.type)) {
      const email = extractRevokeEmail(event);
      if (email) {
        const result = await revokeConciergeKeysForEmail(
          env.SANDBOX_KV,
          email,
          event.type,
        );
        return json({
          ok: true,
          received: true,
          type: event.type,
          revoked: result.revoked,
        });
      }
      return json({ ok: true, received: true, type: event.type, revoked: 0 });
    }

    const provisioned = await fulfillConciergeCheckout(event, {
      kv: env.SANDBOX_KV,
      pepper: config.apiKeyPepper,
      defaultRegion: config.defaultKeyRegion,
    });

    if (provisioned?.fresh && provisioned.apiKey) {
      const apiKey = provisioned.apiKey;
      ctx.waitUntil(
        sendWelcomeEmailViaResend(
          {
            to: provisioned.email,
            apiKey,
            region: provisioned.region,
            from: config.resendFrom,
          },
          config.resendApiKey,
        ).then((r) => {
          if (!r.ok) {
            console.error("welcome email failed", r.error);
          }
        }),
      );
    }

    return json({ ok: true, received: true, type: event.type });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("stripe fulfill error", message);
    return json({ ok: false, error: "fulfillment_failed", message }, 500);
  }
}

export async function handleEmailMessage(
  message: ForwardableEmailMessage,
  env: SandboxEnv,
): Promise<void> {
  const config = resolveSandboxConfig(env);
  const local = parseInboxAddress(message.to, config.sandboxDomain);
  if (!local) {
    message.setReject("Unknown sandbox recipient");
    return;
  }

  if (message.rawSize > config.maxMimeBytes) {
    message.setReject(
      `Message too large (max ${config.maxMimeBytes} bytes for ephemeral sandbox)`,
    );
    return;
  }

  const looked = await getInboxMeta(env.SANDBOX_KV, local);
  if ("error" in looked) {
    const rejectReason =
      looked.error.code === "expired"
        ? "Sandbox inbox expired"
        : "Unknown sandbox inbox";
    message.setReject(rejectReason);
    return;
  }

  const { consumeDailyInboundQuota } = await import("./sandbox-store.js");
  const quota = await consumeDailyInboundQuota(
    env.SANDBOX_KV,
    looked.meta.sessionId,
  );
  if (!quota.ok) {
    message.setReject("Daily inbound limit reached (100/day)");
    return;
  }

  const {
    readStreamLimited,
    bytesToUtf8,
    headerValue,
    MAX_BUFFERED_MIME_BYTES,
  } = await import("./mime.js");
  const { bytes, truncated, rawSize } = await readStreamLimited(
    message.raw,
    MAX_BUFFERED_MIME_BYTES,
  );
  const rawMime = bytesToUtf8(bytes);
  const subject =
    message.headers.get("subject") || headerValue(rawMime, "subject") || "";
  const messageId =
    message.headers.get("message-id") || headerValue(rawMime, "message-id");

  const stub = env.INBOX.get(env.INBOX.idFromName(local));
  const res = await stub.fetch("https://inbox/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject,
      messageId,
      rawMime,
      rawSize: message.rawSize || rawSize,
      truncated,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("inbox ingest failed", res.status, text);
    message.setReject("Temporary sandbox ingest failure");
  }
}

function json(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}
