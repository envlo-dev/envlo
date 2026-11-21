import { describe, expect, it } from "vitest";
import { ConsoleDryRunSender } from "@envlo/core";
import {
  createEnvloMcpContext,
  startLocalInbound,
} from "../src/index.js";
import { smtpSend } from "./helpers/smtp-send.js";

describe("startLocalInbound", () => {
  it("starts SMTP catch-all under local config and stops cleanly", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });

    const runtime = await startLocalInbound(ctx, {
      smtp: true,
      smtpHost: "127.0.0.1",
      smtpPort: 0,
      smtpAutoCreateInbox: true,
      maxMimeBytes: 25 * 1024 * 1024,
      defaultInboxId: undefined,
      http: false,
      httpPort: 8787,
      imap: null,
    });

    expect(runtime.smtp?.address?.port).toBeGreaterThan(0);
    expect(runtime.imap).toBeNull();
    expect(runtime.handles.map((h) => h.kind)).toEqual(["smtp"]);

    await smtpSend({
      host: "127.0.0.1",
      port: runtime.smtp!.address!.port,
      from: "dev@acme.com",
      to: ["local-runtime@envlo.local"],
      raw: [
        "From: dev@acme.com",
        "To: local-runtime@envlo.local",
        "Subject: Runtime",
        "Message-ID: <runtime@acme.com>",
        "",
        "via local runtime",
      ].join("\n"),
    });

    expect(runtime.smtp!.ingestCount).toBe(1);
    await runtime.stop();
    await ctx.close();
  });
});
