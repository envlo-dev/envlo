import type {
  DraftLifecycleEvent,
  IngestedMime,
  MessageRecord,
  ThreadRecord,
} from "@envlo/core";
import { mcpLog } from "../log.js";

/** Hard cap for `wait_for_email` (ticket #12). */
export const WAIT_FOR_EMAIL_MAX_MS = 20_000;

export type InboundMessageEvent = {
  type: "message.inbound";
  inboxId: string;
  thread: ThreadRecord;
  message: MessageRecord;
  mime: IngestedMime | null;
  atMs: number;
};

export type InboxBridgeEvent = InboundMessageEvent | DraftLifecycleEvent;

export type InboxBridgeHandler = (
  event: InboxBridgeEvent,
) => void | Promise<void>;

/**
 * In-process synchronous event bridge for `wait_for_email`.
 * Fans out inbound mail ingest + draft lifecycle events (reject wake).
 *
 * Hosts can also mirror events over WebSocket; the wait primitive is this bus.
 */
export class InboxEventBus {
  private readonly handlers = new Set<InboxBridgeHandler>();
  readonly history: InboxBridgeEvent[] = [];

  subscribe(handler: InboxBridgeHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: InboxBridgeEvent): void {
    this.history.push(event);
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result && typeof (result as Promise<void>).then === "function") {
          void (result as Promise<void>).catch((err) => {
            mcpLog("error", "InboxEventBus handler error", {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        mcpLog("error", "InboxEventBus handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  waitFor(
    predicate: (event: InboxBridgeEvent) => boolean,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<InboxBridgeEvent> {
    const cached = [...this.history].reverse().find(predicate);
    if (cached) return Promise.resolve(cached);

    return new Promise<InboxBridgeEvent>((resolve, reject) => {
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
        finish(() => reject(new Error("InboxEventBus.waitFor aborted")));
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
                `InboxEventBus.waitFor timed out after ${options.timeoutMs}ms`,
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
