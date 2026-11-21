import type { ApprovalAction } from "./types.js";

export type ParsedApprovalReply = {
  action: ApprovalAction;
  rawBody: string;
};

/**
 * Parse a supervisor reply to a magic-link approval email.
 *
 * Supported forms (case-insensitive first line / subject cue):
 * - `APPROVE` / `APPROVED` / `LGTM`
 * - `REJECT <feedback…>` / `REJECTED: …`
 * - `EDIT` followed by the replacement markdown body
 * - bare feedback without keyword → treat as reject feedback (phone-friendly)
 */
export function parseApprovalReply(input: {
  subject?: string | null;
  text?: string | null;
}): ParsedApprovalReply {
  const subject = (input.subject ?? "").trim();
  const text = (input.text ?? "").replace(/\r\n/g, "\n").trim();
  const combinedHead = `${subject}\n${text}`.trim();
  const rawBody = text || subject;

  const subjectCue = subject.match(/^\s*(approve|approved|lgtm|reject(?:ed)?|edit)\b/i);
  const bodyLines = text.split("\n");
  const first = (bodyLines[0] ?? "").trim();

  const head = subjectCue?.[1] ?? first.match(/^(approve|approved|lgtm|reject(?:ed)?|edit)\b/i)?.[1];

  if (head && /^(approve|approved|lgtm)$/i.test(head)) {
    return { action: { type: "approve" }, rawBody };
  }

  if (head && /^edit$/i.test(head)) {
    const restFromBody = subjectCue
      ? text
      : bodyLines.slice(1).join("\n").trim();
    const markdown = restFromBody || text.replace(/^edit\b[:\s-]*/i, "").trim();
    if (!markdown) {
      throw new Error("EDIT reply requires a replacement markdown body");
    }
    return {
      action: { type: "edit_and_approve", edits: { markdown } },
      rawBody,
    };
  }

  if (head && /^reject(?:ed)?$/i.test(head)) {
    const feedback = extractRejectFeedback(subject, text, Boolean(subjectCue));
    if (!feedback) {
      throw new Error("REJECT reply requires feedback text");
    }
    return { action: { type: "reject", feedback }, rawBody };
  }

  // Phone-friendly: any non-empty reply without a keyword is rejection feedback.
  if (combinedHead.length > 0) {
    return { action: { type: "reject", feedback: rawBody }, rawBody };
  }

  throw new Error("Empty approval reply");
}

function extractRejectFeedback(
  subject: string,
  text: string,
  subjectHadCue: boolean,
): string {
  if (subjectHadCue) {
    const fromSubject = subject.replace(/^\s*reject(?:ed)?\b[:\s-]*/i, "").trim();
    if (fromSubject) return fromSubject;
    return text.replace(/^\s*reject(?:ed)?\b[:\s-]*/i, "").trim() || text.trim();
  }
  const lines = text.split("\n");
  const first = (lines[0] ?? "").replace(/^\s*reject(?:ed)?\b[:\s-]*/i, "").trim();
  const rest = lines.slice(1).join("\n").trim();
  return [first, rest].filter(Boolean).join("\n").trim();
}
