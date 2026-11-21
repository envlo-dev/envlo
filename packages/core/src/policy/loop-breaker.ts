import { normalizeAddress, primaryRecipient } from "./recipients.js";
import type { LoopBreakerConfig, LoopBreakerTrip } from "./types.js";
import {
  DEFAULT_LOOP_MAX_OUTBOUND,
  DEFAULT_LOOP_WINDOW_MS,
} from "./types.js";

type TimedEvent = { atMs: number };

type PairState = {
  outbounds: TimedEvent[];
  lastInboundAtMs: number | null;
  /** Durable auto-pause until an inbound reply clears it. */
  paused: boolean;
  pausedAtMs: number | null;
};

function pairKey(inboxId: string, recipient: string): string {
  return `${inboxId.trim().toLowerCase()}::${normalizeAddress(recipient)}`;
}

/**
 * Runaway Agent Loop Circuit-Breaker.
 * Trips when an inbox **sends** ≥N emails to the same recipient within a window
 * without an intervening inbound reply. On trip, the pair is auto-paused until
 * `recordInbound` from that recipient clears it.
 */
export class RunawayLoopBreaker {
  private readonly pairs = new Map<string, PairState>();
  private readonly maxOutbound: number;
  private readonly windowMs: number;

  constructor(config: LoopBreakerConfig = {}) {
    this.maxOutbound = config.maxOutboundWithoutReply ?? DEFAULT_LOOP_MAX_OUTBOUND;
    this.windowMs = config.windowMs ?? DEFAULT_LOOP_WINDOW_MS;
  }

  /**
   * Record a **successful send** (not a draft attempt).
   * Call from `autoSendApprovedDraft` / after `markDraftSent`.
   */
  recordOutbound(
    inboxId: string,
    recipient: string,
    atMs: number = Date.now(),
  ): LoopBreakerTrip {
    const state = this.getOrCreate(inboxId, recipient);
    state.outbounds.push({ atMs });
    this.prune(state, atMs);
    const trip = this.check(inboxId, recipient, atMs);
    if (trip.tripped && !state.paused) {
      state.paused = true;
      state.pausedAtMs = atMs;
    }
    return this.check(inboxId, recipient, atMs);
  }

  /**
   * Record inbound mail from a recipient — clears pause and resets the
   * outbound streak for that inbox↔recipient pair.
   */
  recordInbound(
    inboxId: string,
    fromAddress: string,
    atMs: number = Date.now(),
  ): void {
    const state = this.getOrCreate(inboxId, fromAddress);
    state.lastInboundAtMs = atMs;
    state.paused = false;
    state.pausedAtMs = null;
    state.outbounds = state.outbounds.filter((o) => o.atMs > atMs);
  }

  /** True when this inbox↔recipient pair is auto-paused. */
  isPaused(inboxId: string, recipient: string): boolean {
    return this.getOrCreate(inboxId, recipient).paused;
  }

  /** List paused recipient keys for an inbox (`recipient` lowercased). */
  listPausedRecipients(inboxId: string): string[] {
    const prefix = `${inboxId.trim().toLowerCase()}::`;
    const out: string[] = [];
    for (const [key, state] of this.pairs) {
      if (!state.paused || !key.startsWith(prefix)) continue;
      out.push(key.slice(prefix.length));
    }
    return out;
  }

  check(
    inboxId: string,
    recipient: string,
    atMs: number = Date.now(),
  ): LoopBreakerTrip {
    const state = this.getOrCreate(inboxId, recipient);
    this.prune(state, atMs);
    const relevant = state.outbounds.filter(
      (o) =>
        o.atMs > atMs - this.windowMs &&
        (state.lastInboundAtMs === null || o.atMs > state.lastInboundAtMs),
    );
    const countTripped = relevant.length >= this.maxOutbound;
    if (countTripped && !state.paused) {
      state.paused = true;
      state.pausedAtMs = atMs;
    }
    return {
      tripped: state.paused || countTripped,
      inboxId,
      recipient: normalizeAddress(recipient),
      outboundCount: relevant.length,
      maxOutboundWithoutReply: this.maxOutbound,
      windowMs: this.windowMs,
      lastInboundAtMs: state.lastInboundAtMs,
      oldestCountedOutboundAtMs: relevant[0]?.atMs ?? null,
      paused: state.paused,
      pausedAtMs: state.pausedAtMs,
    };
  }

  checkContext(
    inboxId: string,
    recipients: string[],
    atMs: number = Date.now(),
  ): LoopBreakerTrip {
    const recipient = primaryRecipient(recipients);
    if (!recipient) {
      return {
        tripped: false,
        inboxId,
        recipient: "",
        outboundCount: 0,
        maxOutboundWithoutReply: this.maxOutbound,
        windowMs: this.windowMs,
        lastInboundAtMs: null,
        oldestCountedOutboundAtMs: null,
        paused: false,
        pausedAtMs: null,
      };
    }
    return this.check(inboxId, recipient, atMs);
  }

  clear(): void {
    this.pairs.clear();
  }

  private getOrCreate(inboxId: string, recipient: string): PairState {
    const key = pairKey(inboxId, recipient);
    let state = this.pairs.get(key);
    if (!state) {
      state = {
        outbounds: [],
        lastInboundAtMs: null,
        paused: false,
        pausedAtMs: null,
      };
      this.pairs.set(key, state);
    }
    return state;
  }

  private prune(state: PairState, nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    state.outbounds = state.outbounds.filter((o) => o.atMs > cutoff);
  }
}

export class LoopBreakerTrippedError extends Error {
  readonly trip: LoopBreakerTrip;

  constructor(trip: LoopBreakerTrip) {
    super(
      `Runaway loop breaker tripped: inbox=${trip.inboxId} sent ${trip.outboundCount} emails to ${trip.recipient} within ${trip.windowMs}ms without inbound reply (max ${trip.maxOutboundWithoutReply}). Recipient auto-paused until an inbound reply arrives.`,
    );
    this.name = "LoopBreakerTrippedError";
    this.trip = trip;
  }
}
