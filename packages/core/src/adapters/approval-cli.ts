import type { DraftRecord } from "../state/types.js";
import type { ApprovalController } from "./approval-controller.js";
import type { ApprovalChannel } from "./types.js";

export type CliPromptIo = {
  write: (text: string) => void;
  readLine: () => Promise<string>;
};

export type InteractiveCliApprovalChannelOptions = {
  controller: ApprovalController;
  io?: CliPromptIo;
  /**
   * When true (default), `notifyPending` immediately runs the interactive prompt.
   * Set false to only print and let the host call `promptDraftApproval` later.
   */
  promptOnNotify?: boolean;
};

function defaultIo(): CliPromptIo {
  return {
    write: (text) => {
      process.stdout.write(text);
    },
    readLine: async () => {
      const { createInterface } = await import("node:readline");
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      try {
        return await new Promise<string>((resolve) => {
          rl.once("line", (line) => resolve(line));
        });
      } finally {
        rl.close();
      }
    },
  };
}

export function formatDraftApprovalPrompt(draft: DraftRecord): string {
  return [
    "",
    "── Envlo draft approval ──",
    `draft:   ${draft.id}`,
    `thread:  ${draft.threadId}`,
    `to:      ${draft.toAddresses.join(", ") || "(none)"}`,
    `subject: ${draft.subject ?? "(none)"}`,
    "── body ──",
    draft.currentMarkdown,
    "──────────",
    "Choose: [A]pprove  [E]dit & approve  [R]eject with feedback",
    "> ",
  ].join("\n");
}

/**
 * Interactive CLI prompt for a pending draft.
 */
export async function promptDraftApproval(
  controller: ApprovalController,
  draftId: string,
  io: CliPromptIo = defaultIo(),
): Promise<DraftRecord> {
  const draft = await controller.state.getDraft(draftId);
  if (!draft) throw new Error(`draft not found: ${draftId}`);
  if (draft.status !== "PENDING_APPROVAL") {
    throw new Error(`CLI approval requires PENDING_APPROVAL (got ${draft.status})`);
  }

  io.write(formatDraftApprovalPrompt(draft));
  const choice = (await io.readLine()).trim().toLowerCase();

  if (choice === "a" || choice === "approve") {
    return controller.approve(draftId, "cli");
  }

  if (choice === "e" || choice === "edit" || choice.startsWith("e ")) {
    io.write("Enter replacement markdown. End with a line containing only `.`\n");
    const lines: string[] = [];
    for (;;) {
      const line = await io.readLine();
      if (line === ".") break;
      lines.push(line);
    }
    const markdown = lines.join("\n").trim();
    if (!markdown) throw new Error("Edit & Approve requires markdown content");
    return controller.editAndApprove(draftId, { markdown }, "cli");
  }

  if (choice === "r" || choice === "reject" || choice.startsWith("r ")) {
    let feedback = choice.replace(/^(r|reject)\s*/i, "").trim();
    if (!feedback) {
      io.write("Feedback: ");
      feedback = (await io.readLine()).trim();
    }
    if (!feedback) throw new Error("Reject requires feedback");
    return controller.reject(draftId, feedback, "cli");
  }

  throw new Error(`Unrecognized CLI choice: ${choice}`);
}

/**
 * Approval channel that prompts on the terminal when a draft needs review.
 */
export class InteractiveCliApprovalChannel implements ApprovalChannel {
  readonly kind = "cli" as const;
  private readonly controller: ApprovalController;
  private readonly io: CliPromptIo;
  private readonly promptOnNotify: boolean;

  constructor(options: InteractiveCliApprovalChannelOptions) {
    this.controller = options.controller;
    this.io = options.io ?? defaultIo();
    this.promptOnNotify = options.promptOnNotify ?? true;
  }

  async notifyPending(draft: DraftRecord): Promise<void> {
    if (!this.promptOnNotify) {
      this.io.write(
        `[envlo:cli] Draft ${draft.id} is PENDING_APPROVAL — run promptDraftApproval to decide.\n`,
      );
      return;
    }
    await promptDraftApproval(this.controller, draft.id, this.io);
  }
}
