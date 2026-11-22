import { describe, expect, it } from "vitest";
import {
  formatLiveApiKey,
  generateLiveApiKey,
  hashApiKey,
  parseKeyRegion,
  parseLiveApiKey,
  redactApiKey,
} from "../src/keys.js";

describe("regional API keys", () => {
  it("formats and parses envlo_live_us_/eu_", () => {
    const us = formatLiveApiKey("us", "a".repeat(32));
    expect(us).toBe(`envlo_live_us_${"a".repeat(32)}`);
    expect(parseLiveApiKey(us)).toEqual({
      region: "us",
      bodyHex: "a".repeat(32),
    });

    const eu = formatLiveApiKey("eu", "b".repeat(32));
    expect(eu.startsWith("envlo_live_eu_")).toBe(true);
    expect(parseLiveApiKey(eu)?.region).toBe("eu");
  });

  it("generates cryptographically random keys", async () => {
    const a = await generateLiveApiKey("us");
    const b = await generateLiveApiKey("eu");
    expect(parseLiveApiKey(a)?.region).toBe("us");
    expect(parseLiveApiKey(b)?.region).toBe("eu");
    expect(a).not.toBe(b);
  });

  it("hashes with pepper and redacts", async () => {
    const key = formatLiveApiKey("us", "c".repeat(32));
    const h1 = await hashApiKey(key, "pepper");
    const h2 = await hashApiKey(key, "pepper");
    const h3 = await hashApiKey(key, "other");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(redactApiKey(key)).toContain("envlo_live_us_cccc");
    expect(redactApiKey(key)).toContain("…");
  });

  it("parses region aliases", () => {
    expect(parseKeyRegion("EU")).toBe("eu");
    expect(parseKeyRegion("europe")).toBe("eu");
    expect(parseKeyRegion("us-east-1")).toBe("us");
    expect(parseKeyRegion("nope", "eu")).toBe("eu");
  });
});
