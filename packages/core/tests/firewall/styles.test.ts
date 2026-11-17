import { describe, expect, it } from "vitest";
import {
  isOffScreenOffset,
  isZeroOpacity,
  normalizeCssColor,
  parseCssLengthPx,
  parseInlineStyle,
} from "../../src/firewall/index.js";
import { TimeoutGuard, SanitizeTimeoutError } from "../../src/firewall/timeout.js";

describe("style helpers", () => {
  it("parses inline style declarations without nested regexes", () => {
    const styles = parseInlineStyle("Color: #FFF; display:None; font-size:0px");
    expect(styles.get("color")).toBe("#fff");
    expect(styles.get("display")).toBe("none");
    expect(styles.get("font-size")).toBe("0px");
  });

  it("detects zero opacity and off-screen offsets", () => {
    expect(isZeroOpacity("0")).toBe(true);
    expect(isZeroOpacity("0.0")).toBe(true);
    expect(isZeroOpacity("0.1")).toBe(false);
    expect(isOffScreenOffset("-9999px")).toBe(true);
    expect(isOffScreenOffset("-50px")).toBe(false);
    expect(parseCssLengthPx("0em")).toBe(0);
  });

  it("normalizes hex / rgb / named colors", () => {
    expect(normalizeCssColor("#ABC")).toBe("#aabbcc");
    expect(normalizeCssColor("rgb(1,2,3)")).toBe("#010203");
    expect(normalizeCssColor("black")).toBe("#000000");
  });
});

describe("TimeoutGuard", () => {
  it("throws SanitizeTimeoutError after the deadline", () => {
    const guard = TimeoutGuard.fromMs(0);
    // Ensure we are past the deadline.
    const start = Date.now();
    while (Date.now() === start) {
      // spin one ms tick
    }
    expect(() => guard.check()).toThrow(SanitizeTimeoutError);
  });
});
