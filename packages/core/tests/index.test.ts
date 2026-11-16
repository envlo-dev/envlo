import { describe, expect, it } from "vitest";
import { ENVLO_CORE_VERSION, createCoreBanner, detectRuntime } from "../src/index.js";

describe("@envlo/core", () => {
  it("exports a semver-shaped version string", () => {
    expect(ENVLO_CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("detects a known runtime in test environments", () => {
    const runtime = detectRuntime();
    expect(["node", "bun", "deno", "cloudflare", "unknown"]).toContain(runtime);
  });

  it("builds a banner that includes the package name", () => {
    expect(createCoreBanner()).toContain("@envlo/core@");
  });
});
