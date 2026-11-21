import { describe, expect, it } from "vitest";
import {
  ApprovalController,
  ConsoleDryRunSender,
  MemoryStateStore,
  ResendSender,
} from "@envlo/core";
import {
  createApprovalChannelsFromEnv,
  createEnvloMcpContext,
  createSenderFromEnv,
  readEnvloRuntimeConfig,
} from "../src/index.js";

describe("env bootstrap", () => {
  it("readEnvloRuntimeConfig maps state/sender/from/meta paths", () => {
    const cfg = readEnvloRuntimeConfig({
      ENVLO_STATE: "memory",
      ENVLO_STATE_PATH: "/tmp/state.db",
      ENVLO_HTTP_HOST: "0.0.0.0",
      ENVLO_SENDER: "Resend",
      ENVLO_FROM: "agent@envlo.dev",
      ENVLO_THREAD_META_PATH: "/tmp/meta.json",
    });
    expect(cfg).toEqual({
      stateDriver: "memory",
      statePath: "/tmp/state.db",
      httpHost: "0.0.0.0",
      senderKind: "resend",
      fromOverride: "agent@envlo.dev",
      threadMetaPath: "/tmp/meta.json",
    });
  });

  it("defaults runtime config when env is empty", () => {
    const cfg = readEnvloRuntimeConfig({});
    expect(cfg.stateDriver).toBe("sqlite");
    expect(cfg.httpHost).toBe("127.0.0.1");
    expect(cfg.senderKind).toBe("console");
    expect(cfg.statePath).toBeUndefined();
    expect(cfg.fromOverride).toBeUndefined();
  });

  it("createSenderFromEnv covers console aliases, resend, and fallbacks", () => {
    expect(createSenderFromEnv({ ENVLO_SENDER: "console" }).kind).toBe("console");
    expect(createSenderFromEnv({ ENVLO_SENDER: "dry-run" }).kind).toBe("console");
    expect(createSenderFromEnv({ ENVLO_SENDER: "dryrun" }).kind).toBe("console");
    expect(createSenderFromEnv({ ENVLO_SENDER: "ses" }).kind).toBe("console");
    expect(createSenderFromEnv({ ENVLO_SENDER: "smtp" }).kind).toBe("console");
    expect(createSenderFromEnv({ ENVLO_SENDER: "nope" }).kind).toBe("console");
    expect(createSenderFromEnv({ ENVLO_SENDER: "resend" }).kind).toBe("console");

    const resend = createSenderFromEnv({
      ENVLO_SENDER: "resend",
      RESEND_API_KEY: "re_test",
    });
    expect(resend).toBeInstanceOf(ResendSender);
    expect(resend.kind).toBe("resend");

    const alt = createSenderFromEnv({
      ENVLO_SENDER: "resend",
      ENVLO_RESEND_API_KEY: "re_alt",
    });
    expect(alt.kind).toBe("resend");
  });

  it("createApprovalChannelsFromEnv wires webhook + slack + magic-link", () => {
    const state = new MemoryStateStore();
    const controller = new ApprovalController({ state });
    const sender = new ConsoleDryRunSender({ log: () => {} });

    const channels = createApprovalChannelsFromEnv(controller, sender, {
      ENVLO_WEBHOOK_URL: "https://hooks.example/pending",
      ENVLO_WEBHOOK_AUTH_HEADER: "Bearer secret",
      ENVLO_SLACK_WEBHOOK: "https://hooks.slack.com/services/x",
      ENVLO_SLACK_CHANNEL: "#approvals",
      ENVLO_APPROVAL_SUPERVISOR: "boss@acme.com",
      ENVLO_APPROVAL_BASE_URL: "https://app.envlo.dev/approvals",
    });

    expect(channels.map((c) => c.kind).sort()).toEqual([
      "magic_link",
      "slack",
      "webhook",
    ]);
  });

  it("skips local magic-link without ENVLO_FROM and builds it when present", () => {
    const state = new MemoryStateStore();
    const controller = new ApprovalController({ state });
    const sender = new ConsoleDryRunSender({ log: () => {} });

    const skipped = createApprovalChannelsFromEnv(controller, sender, {
      ENVLO_APPROVAL_SUPERVISOR: "boss@acme.com",
      ENVLO_APPROVAL_BASE_URL: "http://localhost:8787/approvals",
      ENVLO_APPROVAL_MODE: "local",
    });
    expect(skipped).toEqual([]);

    const local = createApprovalChannelsFromEnv(controller, sender, {
      ENVLO_APPROVAL_SUPERVISOR: "boss@acme.com",
      ENVLO_APPROVAL_BASE_URL: "http://localhost:8787/approvals",
      ENVLO_APPROVAL_MODE: "local",
      ENVLO_FROM: "agent@envlo.dev",
    });
    expect(local).toHaveLength(1);
    expect(local[0]?.kind).toBe("magic_link");
  });

  it("createEnvloMcpContext can bootstrap approval channels from env", async () => {
    const prev = process.env.ENVLO_WEBHOOK_URL;
    process.env.ENVLO_WEBHOOK_URL = "https://hooks.example/from-env";
    try {
      const ctx = await createEnvloMcpContext({
        stateDriver: "memory",
        sender: new ConsoleDryRunSender({ log: () => {} }),
        bootstrapSenderFromEnv: false,
        bootstrapApprovalChannelsFromEnv: true,
      });
      // notifyPending with zero pending is enough to prove channels attached:
      // WebhookApprovalChannel is present when ENVLO_WEBHOOK_URL is set.
      const draft = await ctx.state.createInbox({ address: "a@envlo.dev" }).then(
        async (inbox) => {
          const seeded = await ctx.state.ingestMessage(inbox.id, {
            messageId: "<x@envlo.dev>",
            subject: "s",
            bodyMarkdown: "b",
          });
          return ctx.state.createDraft({
            threadId: seeded.thread.id,
            markdown: "need approve",
            toAddresses: ["user@acme.com"],
          });
        },
      );
      const pending = await ctx.state.submitDraftForApproval(draft.id);
      // Channel will fail network call — use allSettled path via notifyPending.
      // With one failing channel, ApprovalController throws AggregateError.
      await expect(ctx.approval.notifyPending(pending.id)).rejects.toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.ENVLO_WEBHOOK_URL;
      else process.env.ENVLO_WEBHOOK_URL = prev;
    }
  });
});
