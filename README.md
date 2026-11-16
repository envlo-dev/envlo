# Envlo

Open-source agent email firewall and stateful MCP inbox engine.

## Packages

| Package | Description |
| ------- | ----------- |
| [`@envlo/core`](./packages/core) | MIME firewall, DOM sanitizer, and email state engine |
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

## Development

This monorepo uses [pnpm](https://pnpm.io) workspaces (`pnpm@10+`) for local development and CI.

```bash
pnpm install
pnpm build
pnpm test
```

## Licensing

This monorepo — including [`@envlo/core`](./packages/core) and [`@envlo/mcp`](./packages/mcp) — is licensed under the **Apache License 2.0**. See the root [`LICENSE`](./LICENSE).
