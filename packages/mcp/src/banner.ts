import { createCoreBanner } from "@envlo/core";

export const ENVLO_MCP_VERSION = "0.0.0" as const;

export function createMcpBanner(): string {
  return `@envlo/mcp@${ENVLO_MCP_VERSION} · ${createCoreBanner()}`;
}
