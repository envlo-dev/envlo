/**
 * Auth for sandbox HTTP: ephemeral session tokens + Concierge Pro API keys.
 */
import { hashApiKey, parseLiveApiKey } from "./keys.js";
import { kvApiKeyHashKey } from "./ring-buffer.js";
import {
  verifySessionToken,
  type SessionTokenPayload,
} from "./session-token.js";
import type { ApiKeyRecord } from "./stripe.js";

export type AuthSuccess =
  | { ok: true; kind: "session"; payload: SessionTokenPayload }
  | { ok: true; kind: "api_key"; record: ApiKeyRecord; keyHash: string };

export type AuthFailure = { ok: false; status: number; error: string };

export type AuthResult = AuthSuccess | AuthFailure;

export function isAuthSuccess(result: AuthResult): result is AuthSuccess {
  return result.ok === true;
}

export async function authenticateRequest(
  request: Request,
  deps: {
    kv: KVNamespace;
    sessionSecret: string;
    apiKeyPepper: string;
    inboxId?: string;
  },
): Promise<AuthResult> {
  const urlToken = (() => {
    try {
      return new URL(request.url).searchParams.get("token");
    } catch {
      return null;
    }
  })();

  const sessionHeader =
    request.headers.get("X-Envlo-Session") ||
    bearerToken(request, "session") ||
    cookieValue(request, "envlo_session") ||
    urlToken;

  if (sessionHeader && deps.sessionSecret) {
    const payload = await verifySessionToken(sessionHeader, deps.sessionSecret, {
      ...(deps.inboxId !== undefined ? { inboxId: deps.inboxId } : {}),
    });
    if (payload) {
      return { ok: true, kind: "session", payload };
    }
  }

  const apiKey =
    bearerToken(request, "api") || request.headers.get("X-Envlo-Api-Key");
  if (apiKey && parseLiveApiKey(apiKey)) {
    const keyHash = await hashApiKey(apiKey, deps.apiKeyPepper);
    const raw = await deps.kv.get(kvApiKeyHashKey(keyHash));
    if (!raw) {
      return { ok: false, status: 401, error: "invalid_api_key" };
    }
    const record = JSON.parse(raw) as ApiKeyRecord;
    if (record.status === "revoked") {
      return { ok: false, status: 403, error: "api_key_revoked" };
    }
    return { ok: true, kind: "api_key", record, keyHash };
  }

  return { ok: false, status: 401, error: "unauthorized" };
}

function bearerToken(
  request: Request,
  _mode: "session" | "api",
): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim() || null;
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Session owns inbox when token is session-scoped or inbox-scoped match. */
export function sessionOwnsInbox(
  auth: AuthSuccess,
  meta: { sessionId: string; inboxId: string },
): boolean {
  if (auth.kind === "api_key") return true; // Pro keys can read any sandbox inbox they know
  if (auth.payload.sid !== meta.sessionId) return false;
  if (auth.payload.inboxId && auth.payload.inboxId !== meta.inboxId) return false;
  return true;
}
