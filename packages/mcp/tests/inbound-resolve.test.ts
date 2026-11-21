import { describe, expect, it } from "vitest";
import { ConsoleDryRunSender } from "@envlo/core";
import {
  createEnvloMcpContext,
  normalizeMailboxAddress,
  parseArgs,
  readLocalInboundConfig,
  resolveInboxId,
  IMAP_PRESETS,
} from "../src/index.js";

describe("inbound helpers", () => {
  it("normalizeMailboxAddress strips angles and prefixes", () => {
    expect(normalizeMailboxAddress("Alice <a@B.com>")).toBe("a@b.com");
    expect(normalizeMailboxAddress("smtp:Agent@Envlo.dev")).toBe(
      "agent@envlo.dev",
    );
  });

  it("resolveInboxId matches address, falls back, and auto-creates", async () => {
    const ctx = await createEnvloMcpContext({
      stateDriver: "memory",
      sender: new ConsoleDryRunSender({ log: () => {} }),
      bootstrapSenderFromEnv: false,
    });
    const inbox = await ctx.state.createInbox({ address: "agent@envlo.dev" });

    expect(
      await resolveInboxId(ctx, ["Agent <agent@envlo.dev>"]),
    ).toBe(inbox.id);

    expect(
      await resolveInboxId(ctx, ["missing@x.com"], {
        defaultInboxId: inbox.id,
      }),
    ).toBe(inbox.id);

    const createdId = await resolveInboxId(ctx, ["new@envlo.dev"], {
      autoCreate: true,
    });
    expect(createdId).toBeTruthy();
    const created = await ctx.state.getInbox(createdId!);
    expect(created?.address).toBe("new@envlo.dev");
  });

  it("parseArgs handles --local --smtp-port --http --no-smtp --no-http", () => {
    expect(parseArgs(["--local", "--smtp-port", "2525", "--http", "9000"])).toEqual({
      help: false,
      http: true,
      local: true,
      httpPort: 9000,
      smtpPort: 2525,
      disableSmtp: false,
      disableHttp: false,
    });
    expect(parseArgs(["--local", "--no-smtp"]).disableSmtp).toBe(true);
    expect(parseArgs(["--local", "--no-http"]).disableHttp).toBe(true);
    expect(() => parseArgs(["--smtp-port"])).toThrow(/requires/);
  });

  it("readLocalInboundConfig enables http by default and maps XOAUTH2 + first-run", () => {
    const cfg = readLocalInboundConfig({
      ENVLO_IMAP_PRESET: "outlook",
      ENVLO_IMAP_USER: "me@contoso.com",
      ENVLO_IMAP_ACCESS_TOKEN: "tok",
      ENVLO_IMAP_FIRST_RUN: "unseen",
    });
    expect(cfg.http).toBe(true);
    expect(cfg.imap?.accessToken).toBe("tok");
    expect(cfg.imap?.pass).toBeUndefined();
    expect(cfg.imap?.firstRunMode).toBe("unseen");
    expect(cfg.imap?.host).toBe(IMAP_PRESETS.outlook.host);
  });

  it("readLocalInboundConfig maps presets and credentials", () => {
    const cfg = readLocalInboundConfig({
      ENVLO_IMAP_PRESET: "gmail",
      ENVLO_IMAP_USER: "me@gmail.com",
      ENVLO_IMAP_PASS: "app-pass",
      ENVLO_SMTP_PORT: "2525",
    });
    expect(cfg.imap?.host).toBe(IMAP_PRESETS.gmail.host);
    expect(cfg.imap?.user).toBe("me@gmail.com");
    expect(cfg.smtpPort).toBe(2525);
    expect(cfg.smtp).toBe(true);

    const skipped = readLocalInboundConfig(
      { ENVLO_IMAP_HOST: "imap.x" },
      { disableSmtp: true },
    );
    expect(skipped.imap).toBeNull();
    expect(skipped.smtp).toBe(false);
  });
});
