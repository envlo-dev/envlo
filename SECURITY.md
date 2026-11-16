# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | ✅        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately via **GitHub Security Advisories** — use [Report a vulnerability](https://github.com/envlo-dev/envlo/security/advisories/new) on this repository.

Include:

- Affected package (`@envlo/core`, `@envlo/mcp`, or hosted/cloud components)
- Version / commit SHA
- Reproduction steps or proof-of-concept
- Impact assessment (e.g. prompt-injection bypass, privilege escalation, supply-chain)

## Supply-Chain Controls

This repository enforces:

- `pnpm install --frozen-lockfile --ignore-scripts` in CI to block postinstall malware
- `pnpm audit --audit-level high` gate
- Google OSV Scanner
- GitHub Dependency Review on pull requests
- Socket.dev dependency analysis
- Dependabot / Renovate for grouped weekly minor/patch updates

## Safe Harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, destruction of data, and interruption of service
- Report findings promptly through the channels above
- Do not exploit the issue beyond what is necessary to demonstrate it
