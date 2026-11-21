import { describe, expect, it } from "vitest";
import { ConsoleDryRunSender } from "@envlo/core";
import {
  WAIT_FOR_EMAIL_MAX_MS,
  createEnvloMcpContext,
  ingestInboundMime,
  waitForEmail,
} from "../src/index.js";

describe("waitForEmail filters + bus", () => {
  async function setup() {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });
    return { ctx, inbox };
  }

  it("matches fromContains and subjectContains", async () => {
    const { ctx, inbox } = await setup();
    const waiting = waitForEmail(ctx.inboxBus, {
      inboxId: inbox.id,
      fromContains: "billing@",
      subjectContains: "Invoice",
      timeoutMs: 2000,
    });

    await ingestInboundMime(
      ctx,
      inbox.id,
      [
        "From: noise@acme.com",
        "To: agent@envlo.dev",
        "Subject: Hello",
        "Message-ID: <n1@acme.com>",
        "",
        "noise",
      ].join("\r\n"),
    );

    await ingestInboundMime(
      ctx,
      inbox.id,
      [
        "From: billing@acme.com",
        "To: agent@envlo.dev",
        "Subject: Invoice #42",
        "Message-ID: <inv@acme.com>",
        "",
        "Please pay",
      ].join("\r\n"),
    );

    const result = await waiting;
    expect(result.matched).toBe(true);
    expect(result.subject).toContain("Invoice");
    expect(result.fromAddress).toContain("billing@");
  });

  it("wakes from bus history when inbound already arrived", async () => {
    const { ctx, inbox } = await setup();
    await ingestInboundMime(
      ctx,
      inbox.id,
      [
        "From: user@acme.com",
        "To: agent@envlo.dev",
        "Subject: Already here",
        "Message-ID: <hist@acme.com>",
        "",
        "hi",
      ].join("\r\n"),
    );

    const result = await waitForEmail(ctx.inboxBus, {
      inboxId: inbox.id,
      timeoutMs: 50,
    });
    expect(result.matched).toBe(true);
    expect(result.reason).toBe("inbound");
    expect(result.subject).toBe("Already here");
  });

  it("returns aborted immediately when signal already aborted", async () => {
    const { ctx, inbox } = await setup();
    const controller = new AbortController();
    controller.abort();
    const result = await waitForEmail(
      ctx.inboxBus,
      { inboxId: inbox.id, timeoutMs: 5000 },
      { signal: controller.signal },
    );
    expect(result.reason).toBe("aborted");
    expect(result.matched).toBe(false);
  });

  it("times out quickly when no match and reports effective timeoutMs", async () => {
    const { ctx, inbox } = await setup();
    const result = await waitForEmail(ctx.inboxBus, {
      inboxId: inbox.id,
      fromContains: "never@match",
      timeoutMs: 40,
    });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("timeout");
    expect(result.timeoutMs).toBe(40);
    expect(result.timeoutMs).toBeLessThanOrEqual(WAIT_FOR_EMAIL_MAX_MS);
  });
});
