# Envlo

Open-source agent email firewall and stateful MCP inbox engine.

## Packages

| Package | Description |
| ------- | ----------- |
| [`@envlo/core`](./packages/core) | MIME firewall, DOM sanitizer, layout→Markdown flattener, and email state engine |
| [`@envlo/mcp`](./packages/mcp) | MCP server exposing Envlo inbox tools over stdio and Streamable HTTP |
| [`@envlo/sandbox`](./packages/sandbox) | Cloudflare Email Worker ephemeral sandbox (2h DO/KV ring buffer) + Concierge Pro Stripe webhook |

## Install

Published packages can be installed with any Node package manager:

```bash
# Core library (firewall, MIME, state primitives)
npm install @envlo/core

# MCP server (inbox tools over stdio / Streamable HTTP)
npm install @envlo/mcp
```

Equivalents:

```bash
pnpm add @envlo/core @envlo/mcp
yarn add @envlo/core @envlo/mcp
bun add @envlo/core @envlo/mcp
```

Run the MCP server without a local install:

```bash
npx @envlo/mcp
```

## Local inbound (Section 4.1)

Zero-tunnel transports for laptops behind NAT — no ngrok required:

```bash
# SMTP catch-all on 127.0.0.1:1025 + HTTP webhook on :8787
npx @envlo/mcp --local

# Optional IMAP IDLE (Gmail App Password or M365 XOAUTH2)
ENVLO_IMAP_PRESET=gmail \
ENVLO_IMAP_USER=you@gmail.com \
ENVLO_IMAP_PASS='app-password' \
npx @envlo/mcp --local
```

| Transport | How |
| --------- | --- |
| IMAP IDLE | `ENVLO_IMAP_*` — outbound connect through NAT |
| Local SMTP | `127.0.0.1:1025` (`--smtp-port`) for CI / local apps |
| Webhook | `POST /webhooks/inbound` — raw MIME, SES SNS, or Resend JSON |

First IMAP connect defaults to `ENVLO_IMAP_FIRST_RUN=skip` (seed cursor, no mailbox flood).

## Ephemeral sandbox (Section 2)

Zero-login trial inboxes on `@sandbox.envlo.dev` (Cloudflare Email Worker):

```bash
# Local worker
pnpm --filter @envlo/sandbox exec wrangler dev

# Instant inbox (no account)
curl -sX POST http://127.0.0.1:8787/v1/sandbox/inboxes -H 'content-type: application/json' -d '{}'
```

Free limits: **3** inboxes, **2h** TTL, **100** inbound emails/day. Mail is buffered in a Durable Object + KV ring (`expirationTtl: 7200`) and streamed over WebSocket so agents can call `wait_for_email` without races.

Concierge Pro ($19/mo): [`envlo.dev/upgrade`](https://envlo.dev/upgrade) → Stripe Payment Link; webhook mints `envlo_live_us_…` / `envlo_live_eu_…` and emails the founder welcome note via Resend. Verify with `GET /v1/me`. MCP agents can stream the sandbox with `ENVLO_SANDBOX_URL`. See [`packages/sandbox`](./packages/sandbox).

## Development

This monorepo uses [pnpm](https://pnpm.io) workspaces (`pnpm@10+`) for local development and CI.

```bash
pnpm install
pnpm build
pnpm test
```

## Licensing

This monorepo — including [`@envlo/core`](./packages/core), [`@envlo/mcp`](./packages/mcp), and [`@envlo/sandbox`](./packages/sandbox) — is licensed under the **Apache License 2.0**. See the root [`LICENSE`](./LICENSE).
