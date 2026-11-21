import type { DraftLifecycleEvent } from "./types.js";

export type DraftLifecycleHandler = (
  event: DraftLifecycleEvent,
) => void | Promise<void>;

/**
 * In-process bus that wakes `wait_for_email` (and other host waiters) when
 * supervisors approve/reject drafts out-of-band.
 *
 * Ticket #11 acceptance: reject (Slack / magic-link reply) must emit
 * `draft.rejected` so MCP hosts can resume waiting agents.
 */
export class DraftLifecycleBus {
  private readonly handlers = new Set<DraftLifecycleHandler>();
  readonly history: DraftLifecycleEvent[] = [];

  subscribe(handler: DraftLifecycleHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Emit synchronously; async handlers are fire-and-forget (errors logged). */
  emit(event: DraftLifecycleEvent): void {
    this.history.push(event);
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result && typeof (result as Promise<void>).then === "function") {
          void (result as Promise<void>).catch((err) => {
            console.error("[envlo:DraftLifecycleBus] handler error", err);
          });
        }
      } catch (err) {
        console.error("[envlo:DraftLifecycleBus] handler error", err);
      }
    }
  }

  /**
   * Resolve when a matching lifecycle event arrives — primary wake primitive
   * for `wait_for_email` hosts.
   */
  waitFor(
    predicate: (event: DraftLifecycleEvent) => boolean,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<DraftLifecycleEvent> {
    const cached = [...this.history].reverse().find(predicate);
    if (cached) return Promise.resolve(cached);

    return new Promise<DraftLifecycleEvent>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const onAbort = () => {
        finish(() => reject(new Error("DraftLifecycleBus.waitFor aborted")));
      };

      const unsubscribe = this.subscribe((event) => {
        if (!predicate(event)) return;
        finish(() => resolve(event));
      });

      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          finish(() =>
            reject(
              new Error(
                `DraftLifecycleBus.waitFor timed out after ${options.timeoutMs}ms`,
              ),
            ),
          );
        }, options.timeoutMs);
      }

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}

/** Shared default bus for hosts that do not inject their own. */
export const defaultDraftLifecycleBus = new DraftLifecycleBus();
