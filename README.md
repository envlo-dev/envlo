# Envlo

Open-source agent email firewall and stateful MCP inbox engine.

## Packages

| Package | Description |
| ------- | ----------- |
| [`@envlo/core`](./packages/core) | MIME firewall, DOM sanitizer, layout→Markdown flattener, and email state engine |
| [`@envlo/mcp`](./packages/mcp) | MCP server exposing Envlo inbox tools over stdio and Streamable HTTP |

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

## Development

This monorepo uses [pnpm](https://pnpm.io) workspaces (`pnpm@10+`) for local development and CI.

```bash
pnpm install
pnpm build
pnpm test
```

## Licensing

This monorepo — including [`@envlo/core`](./packages/core) and [`@envlo/mcp`](./packages/mcp) — is licensed under the **Apache License 2.0**. See the root [`LICENSE`](./LICENSE).
