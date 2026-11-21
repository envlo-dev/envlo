import type { DraftRecord, DraftStatus } from "./types.js";

export class DraftTransitionError extends Error {
  readonly draftId: string;
  readonly from: DraftStatus;
  readonly to: DraftStatus;

  constructor(draftId: string, from: DraftStatus, to: DraftStatus, detail?: string) {
    super(
      `Invalid draft transition ${from} → ${to} for ${draftId}${detail ? `: ${detail}` : ""}`,
    );
    this.name = "DraftTransitionError";
    this.draftId = draftId;
    this.from = from;
    this.to = to;
  }
}

/**
 * Allowed transitions:
 *   DRAFT → PENDING_APPROVAL
 *   REJECTED_WITH_FEEDBACK → PENDING_APPROVAL  (resubmit after edits)
 *   PENDING_APPROVAL → APPROVED
 *   PENDING_APPROVAL → REJECTED_WITH_FEEDBACK
 *   APPROVED → SENT
 *
 * Edits (`currentMarkdown`) are allowed in DRAFT and REJECTED_WITH_FEEDBACK.
 */
export function assertDraftTransition(
  draft: DraftRecord,
  to: DraftStatus,
): void {
  const from = draft.status;
  const allowed =
    (from === "DRAFT" && to === "PENDING_APPROVAL") ||
    (from === "REJECTED_WITH_FEEDBACK" && to === "PENDING_APPROVAL") ||
    (from === "PENDING_APPROVAL" && to === "APPROVED") ||
    (from === "PENDING_APPROVAL" && to === "REJECTED_WITH_FEEDBACK") ||
    (from === "APPROVED" && to === "SENT");

  if (!allowed) {
    throw new DraftTransitionError(draft.id, from, to);
  }
}

export function assertDraftEditable(draft: DraftRecord): void {
  if (draft.status !== "DRAFT" && draft.status !== "REJECTED_WITH_FEEDBACK") {
    throw new DraftTransitionError(
      draft.id,
      draft.status,
      draft.status,
      "draft is not editable in this status",
    );
  }
}

export function isActiveDraftStatus(status: DraftStatus): boolean {
  return status !== "SENT";
}
