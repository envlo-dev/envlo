import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConsoleDryRunSender, OutboundIdempotencyGuard } from "@envlo/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  WAIT_FOR_EMAIL_MAX_MS,
  clampWaitTimeoutMs,
  createEnvloMcpContext,
  createEnvloMcpServer,
  createSenderFromEnv,
  FileThreadMetaStore,
  ingestInboundMime,
  waitForEmail,
  waitForEmailArgs,
} from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>)
    .map((c) => c.text ?? "")
    .join("");
  const parsed = text ? JSON.parse(text) : result.structuredContent;
  return { result, parsed };
}

describe("MCP gap fixes", () => {
  it("clamps timeoutMs above 20s instead of rejecting at zod", () => {
    expect(clampWaitTimeoutMs(60_000)).toBe(WAIT_FOR_EMAIL_MAX_MS);
    expect(clampWaitTimeoutMs(5_000)).toBe(5_000);
    expect(clampWaitTimeoutMs(undefined)).toBe(WAIT_FOR_EMAIL_MAX_MS);
    // Schema allows >20s; clamp happens at runtime.
    expect(() => waitForEmailArgs.parse({ inboxId: "i", timeoutMs: 60_000 })).not.toThrow();
  });

  it("honors client idempotencyKey for outbound policy cache", async () => {
    const sender = new ConsoleDryRunSender({ log: () => {} });
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender,
      bootstrapSenderFromEnv: false,
      policyConfig: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
        allowAutoSend: true,
        internalDomains: ["acme.com"],
      },
    });
    const server = createEnvloMcpServer({ context: ctx });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "idemp", version: "0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const inbox = await callTool(client, "create_inbox", {
      address: "agent@envlo.dev",
    });
    const first = await callTool(client, "send_email", {
      inboxId: inbox.parsed.inbox.id,
      to: ["user@acme.com"],
      subject: "Hello",
      markdown: "One",
      idempotencyKey: "client-key-1",
    });
    expect(first.parsed.disposition).toBe("AUTO_SEND");

    const second = await callTool(client, "send_email", {
      inboxId: inbox.parsed.inbox.id,
      to: ["user@acme.com"],
      subject: "Different subject",
      markdown: "Different body",
      idempotencyKey: "client-key-1",
    });
    expect(second.parsed.disposition).toBe("IDEMPOTENT_REPLAY");
    expect(second.parsed.idempotentReplay).toBe(true);
    expect(OutboundIdempotencyGuard.keyFor({
      inboxId: inbox.parsed.inbox.id,
      to: ["user@acme.com"],
      subject: "x",
      markdownBody: "y",
      tool: "send_email",
      idempotencyKey: "client-key-1",
    })).toBe("client-key-1");
  });

  it("persists threadRisk + OTP across context rebuild via FileThreadMetaStore", async () => {
    const dir = mkdtempSync(join(tmpdir(), "envlo-meta-"));
    tempDirs.push(dir);
    const metaPath = join(dir, "thread-meta.json");

    const first = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
      threadMeta: new FileThreadMetaStore({ path: metaPath }),
      policyConfig: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
      },
    });
    const inbox = await first.state.createInbox({ address: "agent@envlo.dev" });
    const inbound = await ingestInboundMime(
      first,
      inbox.id,
      [
        "From: auth@acme.com",
        "To: agent@envlo.dev",
        "Subject: Your code is 482913",
        "Message-ID: <otp@acme.com>",
        "",
        "Your verification code is 482913. https://acme.com/verify?token=abc",
      ].join("\r\n"),
    );

    expect(first.threadMeta.getMessage(inbound.message.messageId)?.extractedOtp).toBeTruthy();
    first.threadRisk.set(inbound.thread.id, "high");
    first.threadMeta.rememberInbound({
      threadId: inbound.thread.id,
      messageId: inbound.message.messageId,
      injectionRisk: "high",
      extractedOtp: first.threadMeta.getMessage(inbound.message.messageId)?.extractedOtp ?? null,
      verificationUrl:
        first.threadMeta.getMessage(inbound.message.messageId)?.verificationUrl ?? null,
    });

    const second = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
      threadMeta: new FileThreadMetaStore({ path: metaPath }),
    });
    expect(second.threadMeta.getThread(inbound.thread.id)?.injectionRisk).toBe("high");
    expect(second.threadMeta.getMessage(inbound.message.messageId)?.extractedOtp).toBeTruthy();
  });

  it("wait_for_email clamps oversized timeout and respects AbortSignal", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });
    const controller = new AbortController();
    const waiting = waitForEmail(
      ctx.inboxBus,
      { inboxId: inbox.id, timeoutMs: 60_000 },
      { signal: controller.signal },
    );
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const result = await waiting;
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("aborted");
    expect(result.timeoutMs).toBe(WAIT_FOR_EMAIL_MAX_MS);
  });

  it("createSenderFromEnv defaults to console", () => {
    const sender = createSenderFromEnv({ ENVLO_SENDER: "console" });
    expect(sender.kind).toBe("console");
  });

  it("threadRiskOf hydrates from durable meta after Map is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "envlo-meta-"));
    tempDirs.push(dir);
    const metaPath = join(dir, "thread-meta.json");
    const meta = new FileThreadMetaStore({ path: metaPath });
    meta.rememberInbound({
      threadId: "thread-hydrate",
      messageId: "<m@x>",
      injectionRisk: "high",
      extractedOtp: null,
      verificationUrl: null,
    });

    const { threadRiskOf } = await import("../src/index.js");
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
      threadMeta: new FileThreadMetaStore({ path: metaPath }),
    });
    expect(ctx.threadRisk.size).toBe(0);
    expect(threadRiskOf(ctx, "thread-hydrate")).toBe("high");
  });

  it("buildForwardMarkdown includes preface and forwarded header", async () => {
    const { buildForwardMarkdown } = await import("../src/index.js");
    const md = buildForwardMarkdown({
      preface: "FYI",
      fromAddress: "a@b.com",
      subject: "Hello",
      date: "2026-01-01",
      body: "Body",
    });
    expect(md).toContain("FYI");
    expect(md).toContain("Forwarded message");
    expect(md).toContain("From: a@b.com");
    expect(md).toContain("Body");
  });

  it("persisted high risk forces REQUIRE_APPROVAL without in-memory Map seed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "envlo-meta-"));
    tempDirs.push(dir);
    const metaPath = join(dir, "risk.json");

    const first = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
      threadMeta: new FileThreadMetaStore({ path: metaPath }),
      policyConfig: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
      },
    });
    const inbox = await first.state.createInbox({ address: "agent@envlo.dev" });
    const inbound = await ingestInboundMime(
      first,
      inbox.id,
      [
        "From: user@acme.com",
        "To: agent@envlo.dev",
        "Subject: hi",
        "Message-ID: <persist-risk@acme.com>",
        "",
        "hello",
      ].join("\r\n"),
    );
    first.threadMeta.rememberInbound({
      threadId: inbound.thread.id,
      messageId: inbound.message.messageId,
      injectionRisk: "high",
      extractedOtp: null,
      verificationUrl: null,
    });

    // Simulate restart: new context, empty threadRisk Map, same durable meta + state.
    const restarted = await createEnvloMcpContext({
      state: first.state,
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
      threadMeta: new FileThreadMetaStore({ path: metaPath }),
      policyConfig: {
        requireApprovalIf: ["high_injection_risk_thread"],
        escalateOnInjectionRisk: "high",
        allowAutoSend: true,
        internalDomains: ["acme.com"],
      },
    });
    expect(restarted.threadRisk.size).toBe(0);

    const server = createEnvloMcpServer({ context: restarted });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "hydrate", version: "0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const reply = await callTool(client, "reply_to_thread", {
      threadId: inbound.thread.id,
      markdown: "ok",
      to: ["user@acme.com"],
    });
    expect(reply.parsed.disposition).toBe("REQUIRE_APPROVAL");
  });
});
