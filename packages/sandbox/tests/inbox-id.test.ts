import { describe, expect, it } from "vitest";
import {
  generateEphemeralLocalPart,
  inboxAddress,
  isValidInboxLocalPart,
  parseInboxAddress,
} from "../src/inbox-id.js";

describe("inbox addressing", () => {
  it("parses sandbox recipients", () => {
    expect(parseInboxAddress("Agent@Sandbox.envlo.dev", "sandbox.envlo.dev")).toBe(
      "agent",
    );
    expect(parseInboxAddress("x@other.dev", "sandbox.envlo.dev")).toBeNull();
    expect(isValidInboxLocalPart("ok-name_1")).toBe(true);
    expect(isValidInboxLocalPart("bad..dots")).toBe(false);
  });

  it("builds addresses and random locals", () => {
    expect(inboxAddress("Abc", "Sandbox.envlo.dev")).toBe(
      "abc@sandbox.envlo.dev",
    );
    const a = generateEphemeralLocalPart();
    const b = generateEphemeralLocalPart();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});
