export class SanitizeTimeoutError extends Error {
  constructor(message = "DOM sanitizer timed out") {
    super(message);
    this.name = "SanitizeTimeoutError";
  }
}

/** Cooperative deadline checked during DOM walks (sync work cannot be preempted). */
export class TimeoutGuard {
  private readonly deadline: number;

  private constructor(deadline: number) {
    this.deadline = deadline;
  }

  static fromMs(timeoutMs: number): TimeoutGuard {
    return new TimeoutGuard(Date.now() + Math.max(0, timeoutMs));
  }

  /** Throw when past the deadline. */
  check(): void {
    if (Date.now() > this.deadline) {
      throw new SanitizeTimeoutError();
    }
  }
}
