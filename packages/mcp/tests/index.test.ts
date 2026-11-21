import { describe, expect, it } from "vitest";
import {
  CORE_TOOL_NAMES,
  CURSOR_MCP_CONFIG_SNIPPET,
  clampWaitTimeoutMs,
  createMcpBanner,
  coreToolNameSchema,
  listCoreTools,
  WAIT_FOR_EMAIL_MAX_MS,
} from "../src/index.js";

describe("@envlo/mcp meta", () => {
  it("exposes exactly eight core tools", () => {
    expect(listCoreTools()).toHaveLength(8);
    expect(CORE_TOOL_NAMES).not.toContain("manage_draft_approval");
  });

  it("validates known tool names with zod", () => {
    expect(coreToolNameSchema.parse("wait_for_email")).toBe("wait_for_email");
    expect(() => coreToolNameSchema.parse("manage_draft_approval")).toThrow();
  });

  it("builds a banner that references both packages", () => {
    const banner = createMcpBanner();
    expect(banner).toContain("@envlo/mcp@");
    expect(banner).toContain("@envlo/core@");
  });

  it("caps wait_for_email at 20 seconds via clamp", () => {
    expect(WAIT_FOR_EMAIL_MAX_MS).toBe(20_000);
    expect(clampWaitTimeoutMs(60_000)).toBe(20_000);
  });

  it("exposes a Cursor mcp.json snippet", () => {
    expect(CURSOR_MCP_CONFIG_SNIPPET).toContain("@envlo/mcp");
    expect(CURSOR_MCP_CONFIG_SNIPPET).toContain("mcpServers");
  });
});
