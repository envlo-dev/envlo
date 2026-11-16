import { createCoreBanner } from "@envlo/core";
import { z } from "zod";

export const ENVLO_MCP_VERSION = "0.0.0" as const;

/** Canonical Phase-1 MCP tool names (manage_draft_approval intentionally omitted). */
export const CORE_TOOL_NAMES = [
  "create_inbox",
  "wait_for_email",
  "list_messages",
  "read_thread",
  "reply_to_thread",
  "list_inboxes",
  "send_email",
  "forward_thread",
] as const;

export type CoreToolName = (typeof CORE_TOOL_NAMES)[number];

export const coreToolNameSchema = z.enum(CORE_TOOL_NAMES);

export function createMcpBanner(): string {
  return `@envlo/mcp@${ENVLO_MCP_VERSION} · ${createCoreBanner()}`;
}

export function listCoreTools(): readonly CoreToolName[] {
  return CORE_TOOL_NAMES;
}
