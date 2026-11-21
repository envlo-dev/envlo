import { describe, expect, it } from "vitest";
import { ConsoleDryRunSender } from "@envlo/core";
import {
  createEnvloMcpContext,
  SmtpCatchAllServer,
} from "../src/index.js";
import { smtpSend } from "./helpers/smtp-send.js";

describe("SmtpCatchAllServer", () => {
  it("ingests MIME sent to 127.0.0.1 ephemeral port", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({
      address: "agent@envlo.local",
    });

    const smtp = new SmtpCatchAllServer({
      context: ctx,
      host: "127.0.0.1",
      port: 0,
      defaultInboxId: inbox.id,
      autoCreateInbox: false,
    });
    await smtp.start();
    expect(smtp.address?.port).toBeGreaterThan(0);

    try {
      const wait = ctx.inboxBus.waitFor(
        (e) => e.type === "message.inbound" && e.inboxId === inbox.id,
        { timeoutMs: 5000 },
      );

      await smtpSend({
        host: "127.0.0.1",
        port: smtp.address!.port,
        from: "user@acme.com",
        to: ["agent@envlo.local"],
        raw: [
          "From: user@acme.com",
          "To: agent@envlo.local",
          "Subject: Local SMTP",
          "Message-ID: <smtp-local@acme.com>",
          "",
          "Hello from catch-all",
        ].join("\n"),
      });

      const event = await wait;
      expect(event.type).toBe("message.inbound");
      expect(smtp.ingestCount).toBe(1);
      const messages = await ctx.state.listMessages(
        (event as { thread: { id: string } }).thread.id,
      );
      expect(messages.some((m) => m.subject === "Local SMTP")).toBe(true);
    } finally {
      await smtp.stop();
      await ctx.close();
    }
  });

  it("auto-creates inbox from RCPT when enabled", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const smtp = new SmtpCatchAllServer({
      context: ctx,
      host: "127.0.0.1",
      port: 0,
      autoCreateInbox: true,
    });
    await smtp.start();

    try {
      await smtpSend({
        host: "127.0.0.1",
        port: smtp.address!.port,
        from: "ci@acme.com",
        to: ["fresh-agent@envlo.local"],
        raw: [
          "From: ci@acme.com",
          "To: fresh-agent@envlo.local",
          "Subject: Auto create",
          "Message-ID: <auto@acme.com>",
          "",
          "body",
        ].join("\n"),
      });
      const inboxes = await ctx.state.listInboxes();
      expect(
        inboxes.some((i) => i.address === "fresh-agent@envlo.local"),
      ).toBe(true);
      expect(smtp.ingestCount).toBe(1);
    } finally {
      await smtp.stop();
      await ctx.close();
    }
  });

  it("rejects when no inbox can be resolved", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const smtp = new SmtpCatchAllServer({
      context: ctx,
      host: "127.0.0.1",
      port: 0,
      autoCreateInbox: false,
      resolveInboxId: async () => null,
    });
    await smtp.start();

    const sendPromise = smtpSend({
      host: "127.0.0.1",
      port: smtp.address!.port,
      from: "x@y.com",
      to: ["unknown@envlo.local"],
      raw: "Subject: nope\n\nbody",
    }).catch((err: unknown) => err);

    let saw = false;
    for (let i = 0; i < 40; i += 1) {
      if (smtp.lastError) {
        saw = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(saw).toBe(true);
    expect(smtp.lastError).toMatch(/No Envlo inbox/i);
    expect(smtp.ingestCount).toBe(0);

    await smtp.stop();
    await sendPromise;
    await ctx.close();
  });
});
