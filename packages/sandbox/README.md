# `@envlo/sandbox`

Day-1 **Ephemeral Sandbox Gateway** for Envlo (Section 2 / Diagram 2, ticket #14).

Deployed as a Cloudflare Worker with Email Routing, Durable Objects, and KV:

| Surface | Role |
| ------- | ---- |
| Email Worker | Ingest `*@sandbox.envlo.dev` → per-inbox Durable Object |
| Durable Object + KV | 2-hour ring buffer (`expirationTtl: 7200`) + WebSocket bridge (KV replay after hibernation) |
| HTTP API | Zero-login provision + signed session tokens, poll, WS stream |
| `/v1/me` | Concierge Pro API key introspection (`Authorization: Bearer envlo_live_…`) |
| `/upgrade` | Redirect to Stripe Payment Link ($19/mo Concierge Pro) |
| `/webhooks/stripe` | Mint key + Resend welcome; revoke on cancel/refund |

## Free Ephemeral Sandbox limits

- **3** ephemeral inboxes per session
- **2 hour** TTL (`SANDBOX_TTL_SECONDS = 7200`)
- **100** inbound emails / day / session

## Quick start (local)

```bash
pnpm --filter @envlo/sandbox install
cp packages/sandbox/.dev.vars.example packages/sandbox/.dev.vars
pnpm --filter @envlo/sandbox exec wrangler dev
```

Provision an inbox:

```bash
curl -sX POST http://127.0.0.1:8787/v1/sandbox/inboxes \
  -H 'content-type: application/json' -d '{}'
```

## Concierge Pro

1. Create a Stripe Payment Link for $19/mo and set `STRIPE_PAYMENT_LINK_URL`.
2. Point Stripe webhooks at `https://envlo.dev/webhooks/stripe` (`checkout.session.completed`, `customer.subscription.deleted`, `charge.refunded`).
3. Set secrets: `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `API_KEY_PEPPER`, `SESSION_SIGNING_SECRET`.
4. Successful test checkout emails a working `envlo_live_us_…` / `envlo_live_eu_…` key — verify with `GET /v1/me`.

Region selection: Stripe `metadata.region`, else currency/locale heuristics, else `DEFAULT_KEY_REGION`.

## MCP bridge

```bash
ENVLO_SANDBOX_URL=https://sandbox.envlo.dev npx @envlo/mcp
```

Provisions an ephemeral inbox (or reuses `ENVLO_SANDBOX_INBOX_ID` + `ENVLO_SANDBOX_SESSION_TOKEN`) and streams WebSocket mail into `wait_for_email`.

## Scripts

```bash
pnpm --filter @envlo/sandbox test
pnpm --filter @envlo/sandbox typecheck
pnpm --filter @envlo/sandbox exec wrangler deploy
```
