import { describe, expect, it, vi } from "vitest";
import {
  ConsoleDryRunSender,
  ResendSender,
  SesSender,
  SmtpSender,
  deliverApprovedDraft,
  draftToOutboundMail,
} from "../../src/adapters/index.js";
import { MemoryStateStore } from "../../src/state/index.js";

async function approvedDraft() {
  const state = new MemoryStateStore();
  const inbox = await state.createInbox({ address: "agent@envlo.dev" });
  const { thread } = await state.ingestMessage(inbox.id, {
    messageId: "<in@acme.com>",
    fromAddress: "user@acme.com",
    subject: "Help",
    bodyMarkdown: "Need help",
  });
  let draft = await state.createDraft({
    threadId: thread.id,
    markdown: "Working on it.",
    toAddresses: ["user@acme.com"],
    subject: "Re: Help",
  });
  draft = await state.submitDraftForApproval(draft.id);
  draft = await state.approveDraft(draft.id);
  return { state, inbox, thread, draft };
}

describe("BYO outbound senders", () => {
  it("ConsoleDryRunSender logs and returns a dry-run Message-ID", async () => {
    const lines: string[] = [];
    const sender = new ConsoleDryRunSender({
      log: (line) => lines.push(line),
    });
    const result = await sender.send({
      from: "agent@envlo.dev",
      to: ["user@acme.com"],
      subject: "Hi",
      text: "Hello",
    });
    expect(result.dryRun).toBe(true);
    expect(result.messageId).toMatch(/^<.+@envlo\.local>$/);
    expect(sender.sent).toHaveLength(1);
    expect(lines[0]).toContain("[envlo:console-dry-run]");
  });

  it("ResendSender POSTs JSON with injected fetch", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "re_123" }),
      json: async () => ({ id: "re_123" }),
    }));
    const sender = new ResendSender({
      apiKey: "re_test",
      fetch: fetchMock,
    });
    const result = await sender.send({
      from: "agent@envlo.dev",
      to: ["user@acme.com"],
      subject: "Hi",
      text: "Hello",
      inReplyTo: "<in@acme.com>",
    });
    expect(result.providerId).toBe("re_123");
    expect(result.messageId).toContain("re_123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers?.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init!.body!)).toMatchObject({
      from: "agent@envlo.dev",
      to: ["user@acme.com"],
      subject: "Hi",
    });
  });

  it("SesSender and SmtpSender delegate to injected clients", async () => {
    const ses = new SesSender({
      client: {
        sendEmail: async () => ({ messageId: "ses-abc" }),
      },
    });
    const sesResult = await ses.send({
      from: "a@envlo.dev",
      to: ["b@x.com"],
      subject: "S",
      text: "T",
    });
    expect(sesResult.providerId).toBe("ses-abc");
    expect(sesResult.messageId).toContain("ses-abc");

    const smtp = new SmtpSender({
      transport: {
        sendMail: async () => ({ messageId: "<smtp@local>" }),
      },
    });
    const smtpResult = await smtp.send({
      from: "a@envlo.dev",
      to: ["b@x.com"],
      subject: "S",
      text: "T",
    });
    expect(smtpResult.messageId).toBe("<smtp@local>");
  });

  it("deliverApprovedDraft sends then marks SENT", async () => {
    const { state, draft } = await approvedDraft();
    const sender = new ConsoleDryRunSender({ log: () => {} });
    const delivered = await deliverApprovedDraft({
      state,
      sender,
      draftId: draft.id,
      from: "agent@envlo.dev",
    });
    expect(delivered.draft.status).toBe("SENT");
    expect(delivered.message?.direction).toBe("outbound");
    expect(delivered.send.dryRun).toBe(true);
    expect(sender.sent[0]?.to).toEqual(["user@acme.com"]);
  });

  it("draftToOutboundMail maps stitch headers", async () => {
    const { draft } = await approvedDraft();
    const mail = draftToOutboundMail(draft, { from: "agent@envlo.dev" });
    expect(mail.subject).toBe("Re: Help");
    expect(mail.inReplyTo).toBe("<in@acme.com>");
    expect(mail.references).toEqual(["<in@acme.com>"]);
  });
});
