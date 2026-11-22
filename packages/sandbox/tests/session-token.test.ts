import { describe, expect, it } from "vitest";
import {
  signSessionToken,
  verifySessionToken,
} from "../src/session-token.js";

describe("session tokens", () => {
  it("signs and verifies scoped tokens", async () => {
    const secret = "test-secret";
    const token = await signSessionToken(
      {
        sid: "sess_1",
        inboxId: "box1",
        exp: Date.now() + 60_000,
      },
      secret,
    );
    expect(token.startsWith("evlo1.")).toBe(true);
    const payload = await verifySessionToken(token, secret, {
      inboxId: "box1",
    });
    expect(payload?.sid).toBe("sess_1");
    expect(
      await verifySessionToken(token, secret, { inboxId: "other" }),
    ).toBeNull();
  });

  it("rejects expired and tampered tokens", async () => {
    const secret = "test-secret";
    const token = await signSessionToken(
      { sid: "sess_1", exp: Date.now() - 1000 },
      secret,
    );
    expect(await verifySessionToken(token, secret)).toBeNull();
    const good = await signSessionToken(
      { sid: "sess_1", exp: Date.now() + 60_000 },
      secret,
    );
    expect(await verifySessionToken(good + "x", secret)).toBeNull();
  });
});
