import {
  ApprovalController,
  ConsoleDryRunSender,
  DraftLifecycleBus,
  MemoryStateStore,
  OutboundPolicyEngine,
  openStateStore,
  type ApprovalChannel,
  type EnvloStateStore,
  type InjectionRisk,
  type OutboundPolicyConfig,
  type OutboundSender,
} from "@envlo/core";
import { maxInjectionRisk } from "@envlo/core/firewall";
import { InboxEventBus } from "./bridge/inbox-events.js";
import {
  createApprovalChannelsFromEnv,
  createSenderFromEnv,
} from "./env.js";
import {
  FileThreadMetaStore,
  MemoryThreadMetaStore,
  type ThreadMetaStore,
} from "./thread-meta.js";

export type EnvloMcpContextOptions = {
  /** Defaults to durable SQLite (`~/.envlo/state.db`). Use `memory` for tests. */
  state?: EnvloStateStore;
  stateDriver?: "sqlite" | "memory";
  statePath?: string;
  sender?: OutboundSender;
  /** Default From for outbound when inbox address is used as identity. */
  fromOverride?: string;
  approvalChannels?: ApprovalChannel[];
  /**
   * When true, also attach approval channels from env after construction.
   * Default false (CLI opts in; tests stay isolated from host env).
   */
  bootstrapApprovalChannelsFromEnv?: boolean;
  /**
   * When true (default) and `sender` is omitted, resolve from ENVLO_SENDER.
   * Set false to force ConsoleDryRun without reading env.
   */
  bootstrapSenderFromEnv?: boolean;
  policyConfig?: OutboundPolicyConfig;
  events?: DraftLifecycleBus;
  inboxBus?: InboxEventBus;
  /** Durable thread risk / OTP meta. Defaults to file (or memory with memory state). */
  threadMeta?: ThreadMetaStore;
  threadMetaPath?: string;
};

/**
 * Long-lived process context shared by all MCP tool handlers.
 */
export type EnvloMcpContext = {
  state: EnvloStateStore;
  events: DraftLifecycleBus;
  inboxBus: InboxEventBus;
  policy: OutboundPolicyEngine;
  approval: ApprovalController;
  sender: OutboundSender;
  /** Highest injection risk observed per thread (hydrated from threadMeta). */
  threadRisk: Map<string, InjectionRisk>;
  /** Durable OTP / verificationUrl / risk per thread+message. */
  threadMeta: ThreadMetaStore;
  /** Optional From override (else inbox address). */
  fromOverride: string | undefined;
  close: () => Promise<void>;
};

export async function createEnvloMcpContext(
  options: EnvloMcpContextOptions = {},
): Promise<EnvloMcpContext> {
  const events = options.events ?? new DraftLifecycleBus();
  const inboxBus = options.inboxBus ?? new InboxEventBus();
  const state =
    options.state ??
    (options.stateDriver === "memory"
      ? new MemoryStateStore()
      : await openStateStore({
          ...(options.statePath !== undefined ? { path: options.statePath } : {}),
        }));

  const resolvedSender =
    options.sender ??
    (options.bootstrapSenderFromEnv === false
      ? new ConsoleDryRunSender()
      : createSenderFromEnv());

  const approval = new ApprovalController({
    state,
    events,
    ...(options.approvalChannels
      ? { channels: options.approvalChannels }
      : {}),
  });

  if (options.bootstrapApprovalChannelsFromEnv) {
    for (const channel of createApprovalChannelsFromEnv(
      approval,
      resolvedSender,
    )) {
      approval.addChannel(channel);
    }
  }

  // Bridge draft lifecycle into the inbox bus so wait_for_email can fan-in.
  events.subscribe((event) => {
    inboxBus.emit(event);
  });

  const policy = new OutboundPolicyEngine({
    ...(options.policyConfig !== undefined
      ? { config: options.policyConfig }
      : {}),
    sender: resolvedSender,
    approval,
    events,
  });

  const threadMeta =
    options.threadMeta ??
    (options.stateDriver === "memory" && !options.threadMetaPath
      ? new MemoryThreadMetaStore()
      : new FileThreadMetaStore({
          ...(options.threadMetaPath !== undefined
            ? { path: options.threadMetaPath }
            : process.env.ENVLO_THREAD_META_PATH
              ? { path: process.env.ENVLO_THREAD_META_PATH }
              : {}),
        }));

  const threadRisk = new Map<string, InjectionRisk>();

  return {
    state,
    events,
    inboxBus,
    policy,
    approval,
    sender: resolvedSender,
    threadRisk,
    threadMeta,
    fromOverride: options.fromOverride ?? process.env.ENVLO_FROM ?? undefined,
    close: async () => {
      if ("close" in state && typeof state.close === "function") {
        await state.close();
      }
    },
  };
}

export function rememberThreadRisk(
  ctx: EnvloMcpContext,
  threadId: string,
  risk: InjectionRisk,
): InjectionRisk {
  const prev =
    ctx.threadRisk.get(threadId) ??
    ctx.threadMeta.getThread(threadId)?.injectionRisk ??
    "low";
  const next = maxInjectionRisk(prev, risk);
  ctx.threadRisk.set(threadId, next);
  return next;
}

export function threadRiskOf(
  ctx: EnvloMcpContext,
  threadId: string,
): InjectionRisk {
  return (
    ctx.threadRisk.get(threadId) ??
    ctx.threadMeta.getThread(threadId)?.injectionRisk ??
    "low"
  );
}

export function rememberInboundMeta(
  ctx: EnvloMcpContext,
  input: {
    threadId: string;
    messageId: string;
    injectionRisk: InjectionRisk;
    extractedOtp: string | null;
    verificationUrl: string | null;
  },
): void {
  rememberThreadRisk(ctx, input.threadId, input.injectionRisk);
  ctx.threadMeta.rememberInbound(input);
}
