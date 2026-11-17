import { describe, expect, it } from "vitest";
import { evaluateSenderAuth } from "../../src/parser/index.js";

describe("evaluateSenderAuth", () => {
  it("returns pass when dmarc=pass and nothing fails, with per-method fields", () => {
    const details = evaluateSenderAuth([
      {
        key: "authentication-results",
        originalKey: "Authentication-Results",
        value: "mx.example; spf=neutral; dkim=pass; dmarc=pass header.from=example.com",
      },
    ]);
    expect(details.status).toBe("pass");
    expect(details.spf).toBe("neutral");
    expect(details.dkim).toBe("pass");
    expect(details.dmarc).toBe("pass");
  });

  it("returns pass when spf and dkim both pass without dmarc", () => {
    const details = evaluateSenderAuth([
      {
        key: "authentication-results",
        originalKey: "Authentication-Results",
        value: "mx.example; spf=pass smtp.mailfrom=a@b.com; dkim=pass header.d=b.com",
      },
    ]);
    expect(details.status).toBe("pass");
    expect(details.dmarc).toBeNull();
  });

  it("returns pass from Received-SPF pass plus DKIM pass", () => {
    const details = evaluateSenderAuth([
      {
        key: "received-spf",
        originalKey: "Received-SPF",
        value: "pass (domain designates 1.2.3.4 as permitted sender)",
      },
      {
        key: "authentication-results",
        originalKey: "Authentication-Results",
        value: "mx.example; dkim=pass header.d=example.com",
      },
    ]);
    expect(details.status).toBe("pass");
    expect(details.spf).toBe("pass");
    expect(details.dkim).toBe("pass");
  });

  it("returns fail when any of spf/dkim/dmarc is fail and keeps method detail", () => {
    const details = evaluateSenderAuth([
      {
        key: "authentication-results",
        originalKey: "Authentication-Results",
        value: "mx.example; spf=fail; dkim=pass; dmarc=pass",
      },
    ]);
    expect(details.status).toBe("fail");
    expect(details.spf).toBe("fail");
    expect(details.dkim).toBe("pass");
    expect(details.dmarc).toBe("pass");
  });

  it("returns unverified for softfail / neutral / missing", () => {
    const soft = evaluateSenderAuth([
      {
        key: "authentication-results",
        originalKey: "Authentication-Results",
        value: "mx.example; spf=softfail; dkim=neutral",
      },
    ]);
    expect(soft.status).toBe("unverified");
    expect(soft.spf).toBe("softfail");
    expect(soft.dkim).toBe("neutral");
    expect(soft.dmarc).toBeNull();

    expect(evaluateSenderAuth([])).toMatchObject({
      status: "unverified",
      spf: null,
      dkim: null,
      dmarc: null,
    });
  });
});
