import { describe, expect, it } from "vitest";
import { ConsoleDryRunSender } from "@envlo/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CORE_TOOL_NAMES,
  createEnvloMcpContext,
  startHttpServer,
} from "../src/index.js";

describe("@envlo/mcp http transport", () => {
  it("serves /health and inbound webhook that wakes the bus", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
      policyConfig: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
      },
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });
    const http = await startHttpServer({
      context: ctx,
      port: 0,
      host: "127.0.0.1",
    });

    try {
      const health = await fetch(
        `http://${http.host}:${http.port}/health`,
      );
      expect(health.status).toBe(200);
      const body = (await health.json()) as { ok: boolean; name: string };
      expect(body.ok).toBe(true);
      expect(body.name).toBe("@envlo/mcp");

      const waitPromise = ctx.inboxBus.waitFor(
        (e) => e.type === "message.inbound" && e.inboxId === inbox.id,
        { timeoutMs: 5000 },
      );

      const webhook = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?inboxId=${inbox.id}`,
        {
          method: "POST",
          headers: { "content-type": "message/rfc822" },
          body: [
            "From: user@acme.com",
            "To: agent@envlo.dev",
            "Subject: Via webhook",
            "Message-ID: <hook@acme.com>",
            "",
            "Webhook body",
          ].join("\r\n"),
        },
      );
      expect(webhook.status).toBe(200);
      const ingested = (await webhook.json()) as { ok: boolean; threadId: string };
      expect(ingested.ok).toBe(true);

      const event = await waitPromise;
      expect(event.type).toBe("message.inbound");
    } finally {
      await http.close();
      await ctx.close();
    }
  });

  it("exposes tools over Streamable HTTP MCP client", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
      policyConfig: {
        requireApprovalIf: [],
        escalateOnInjectionRisk: "off",
        allowAutoSend: true,
        internalDomains: ["acme.com"],
      },
    });
    const http = await startHttpServer({
      context: ctx,
      port: 0,
      host: "127.0.0.1",
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${http.host}:${http.port}/mcp`),
    );
    const client = new Client({ name: "http-e2e", version: "0.0.0" });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      expect(names).toEqual([...CORE_TOOL_NAMES].sort());

      const created = await client.callTool({
        name: "create_inbox",
        arguments: { address: "http-agent@envlo.dev" },
      });
      const createdText = (created.content as Array<{ text?: string }>)
        .map((c) => c.text ?? "")
        .join("");
      const createdParsed = JSON.parse(createdText) as {
        inbox: { id: string; address: string };
      };
      expect(createdParsed.inbox.address).toBe("http-agent@envlo.dev");

      const sent = await client.callTool({
        name: "send_email",
        arguments: {
          inboxId: createdParsed.inbox.id,
          to: ["user@acme.com"],
          subject: "HTTP send",
          markdown: "via streamable http",
        },
      });
      const sentText = (sent.content as Array<{ text?: string }>)
        .map((c) => c.text ?? "")
        .join("");
      const sentParsed = JSON.parse(sentText) as { disposition: string };
      expect(sentParsed.disposition).toBe("AUTO_SEND");
    } finally {
      await client.close().catch(() => undefined);
      await http.close();
      await ctx.close();
    }
  });

  it("unwraps SES SNS Notification and confirms subscriptions", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "ses@envlo.dev" });
    const http = await startHttpServer({
      context: ctx,
      port: 0,
      host: "127.0.0.1",
    });

    try {
      const notify = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?inboxId=${inbox.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            Type: "Notification",
            Message: JSON.stringify({
              content: [
                "From: a@b.com",
                "To: ses@envlo.dev",
                "Subject: SES",
                "Message-ID: <ses@b.com>",
                "",
                "via sns",
              ].join("\r\n"),
            }),
          }),
        },
      );
      expect(notify.status).toBe(200);
      const body = (await notify.json()) as {
        ok: boolean;
        provider: string;
      };
      expect(body.ok).toBe(true);
      expect(body.provider).toBe("ses_sns");

      const confirm = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            Type: "SubscriptionConfirmation",
            SubscribeURL: `http://${http.host}:${http.port}/health`,
          }),
        },
      );
      expect(confirm.status).toBe(200);
      const confBody = (await confirm.json()) as {
        sns: string;
        confirmed: boolean;
      };
      expect(confBody.sns).toBe("subscription_confirmation");
      expect(confBody.confirmed).toBe(true);
    } finally {
      await http.close();
      await ctx.close();
    }
  });

  it("rejects oversized webhook bodies with 413", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "big@envlo.dev" });
    const http = await startHttpServer({
      context: ctx,
      port: 0,
      host: "127.0.0.1",
      maxMimeBytes: 64,
    });
    try {
      const res = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?inboxId=${inbox.id}`,
        {
          method: "POST",
          headers: { "content-type": "message/rfc822" },
          body: "x".repeat(200),
        },
      );
      expect(res.status).toBe(413);
    } finally {
      await http.close();
      await ctx.close();
    }
  });

  it("inbound webhook requires secret when configured and resolves by address", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "hook@envlo.dev" });
    const http = await startHttpServer({
      context: ctx,
      port: 0,
      host: "127.0.0.1",
      webhookSecret: "s3cret",
    });

    try {
      const unauthorized = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?address=hook@envlo.dev`,
        {
          method: "POST",
          headers: { "content-type": "message/rfc822" },
          body: "Subject: x\n\nbody",
        },
      );
      expect(unauthorized.status).toBe(401);

      const ok = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?address=hook@envlo.dev`,
        {
          method: "POST",
          headers: {
            "content-type": "message/rfc822",
            "x-envlo-webhook-secret": "s3cret",
          },
          body: [
            "From: a@b.com",
            "To: hook@envlo.dev",
            "Subject: Secured",
            "Message-ID: <sec@b.com>",
            "",
            "ok",
          ].join("\r\n"),
        },
      );
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { inboxId: string };
      expect(body.inboxId).toBe(inbox.id);
    } finally {
      await http.close();
      await ctx.close();
    }
  });

  it("inbound webhook validates inboxId and accepts JSON body", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });
    const http = await startHttpServer({
      context: ctx,
      port: 0,
      host: "127.0.0.1",
    });

    try {
      const missing = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound`,
        { method: "POST", body: "x" },
      );
      expect(missing.status).toBe(400);

      const unknown = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?inboxId=missing`,
        { method: "POST", body: "x" },
      );
      expect(unknown.status).toBe(404);

      const notFound = await fetch(`http://${http.host}:${http.port}/nope`);
      expect(notFound.status).toBe(404);

      const jsonBody = await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?inboxId=${inbox.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            raw: [
              "From: user@acme.com",
              "To: agent@envlo.dev",
              "Subject: JSON webhook",
              "Message-ID: <json-hook@acme.com>",
              "",
              "Your code is 112233",
            ].join("\r\n"),
          }),
        },
      );
      expect(jsonBody.status).toBe(200);
      const payload = (await jsonBody.json()) as {
        ok: boolean;
        messageId: string;
      };
      expect(payload.ok).toBe(true);
      expect(
        ctx.threadMeta.getMessage(payload.messageId)?.extractedOtp,
      ).toBeTruthy();
    } finally {
      await http.close();
      await ctx.close();
    }
  });

  it("mirrors inbox events over SSE /events", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });
    const http = await startHttpServer({
      context: ctx,
      port: 0,
      host: "127.0.0.1",
    });

    try {
      const response = await fetch(
        `http://${http.host}:${http.port}/events`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const readUntilInbound = (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.includes("event: message.inbound")) return buffer;
        }
        return buffer;
      })();

      await fetch(
        `http://${http.host}:${http.port}/webhooks/inbound?inboxId=${inbox.id}`,
        {
          method: "POST",
          headers: { "content-type": "message/rfc822" },
          body: [
            "From: user@acme.com",
            "To: agent@envlo.dev",
            "Subject: SSE",
            "Message-ID: <sse@acme.com>",
            "",
            "hi",
          ].join("\r\n"),
        },
      );

      const streamed = await Promise.race([
        readUntilInbound,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("SSE timeout")), 5000),
        ),
      ]);
      expect(streamed).toContain("event: message.inbound");
      await reader.cancel().catch(() => undefined);
    } finally {
      await http.close();
      await ctx.close();
    }
  });
});
