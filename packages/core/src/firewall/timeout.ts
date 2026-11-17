import type { AbortFlag } from "./types.js";

export class SanitizeTimeoutError extends Error {
  constructor(message = "DOM sanitizer timed out") {
    super(message);
    this.name = "SanitizeTimeoutError";
  }
}

/** Cooperative deadline checked during DOM walks (sync work cannot be preempted). */
export class TimeoutGuard {
  private readonly deadline: number;
  private readonly abort: AbortFlag | null;

  private constructor(deadline: number, abort: AbortFlag | null) {
    this.deadline = deadline;
    this.abort = abort;
  }

  static fromMs(timeoutMs: number, abort: AbortFlag | null = null): TimeoutGuard {
    return new TimeoutGuard(Date.now() + Math.max(0, timeoutMs), abort);
  }

  /** Throw when past the deadline or an external abort was signaled. */
  check(): void {
    if (this.abort?.aborted || Date.now() > this.deadline) {
      throw new SanitizeTimeoutError();
    }
  }
}

/** Resolve after `ms`, portable across Node / Bun / Deno / Workers. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
