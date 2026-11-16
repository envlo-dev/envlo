import { describe, expect, it } from "vitest";
import {
  CORE_TOOL_NAMES,
  createMcpBanner,
  coreToolNameSchema,
  listCoreTools,
} from "../src/index.js";

describe("@envlo/mcp", () => {
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
});
