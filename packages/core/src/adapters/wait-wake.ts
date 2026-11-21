import type { DraftLifecycleBus } from "./events.js";
import type { DraftLifecycleEvent } from "./types.js";

/**
 * Wake helper for MCP `wait_for_email` hosts: resolves when a draft on the
 * given thread is rejected (or optionally approved) out-of-band.
 *
 * Acceptance (#11): Slack Reject / magic-link reply → REJECTED_WITH_FEEDBACK
 * and this waiter resumes.
 */
export function waitForDraftDecision(
  bus: DraftLifecycleBus,
  options: {
    threadId?: string;
    draftId?: string;
    /**
     * Default: approve **or** reject (fan-in wake for `wait_for_email`).
     * Pass `["draft.rejected"]` to wake only on rejection.
     */
    events?: Array<"draft.rejected" | "draft.approved">;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<DraftLifecycleEvent> {
  const wanted = new Set(
    options.events ?? ["draft.rejected", "draft.approved"],
  );
  return bus.waitFor((event) => {
    if (event.type !== "draft.rejected" && event.type !== "draft.approved") {
      return false;
    }
    if (!wanted.has(event.type)) return false;
    if (options.draftId && event.draft.id !== options.draftId) return false;
    if (options.threadId && event.draft.threadId !== options.threadId) {
      return false;
    }
    return true;
  }, {
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
