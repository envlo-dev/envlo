import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { InjectionRisk } from "@envlo/core";

export type MessageMeta = {
  threadId: string;
  extractedOtp: string | null;
  verificationUrl: string | null;
  injectionRisk: InjectionRisk;
  updatedAtMs: number;
};

export type ThreadMeta = {
  injectionRisk: InjectionRisk;
  lastOtp: string | null;
  lastVerificationUrl: string | null;
  updatedAtMs: number;
};

export type ThreadMetaStore = {
  getThread(threadId: string): ThreadMeta | null;
  getMessage(messageId: string): MessageMeta | null;
  rememberInbound(input: {
    threadId: string;
    messageId: string;
    injectionRisk: InjectionRisk;
    extractedOtp: string | null;
    verificationUrl: string | null;
  }): void;
  clear(): void;
};

type FilePayload = {
  threads: Record<string, ThreadMeta>;
  messages: Record<string, MessageMeta>;
};

export function defaultThreadMetaPath(): string {
  return join(homedir(), ".envlo", "thread-meta.json");
}

/**
 * Durable thread/message meta for injection risk + OTP/verification URL.
 * Survives MCP process restarts (in-memory Map alone does not).
 */
export class FileThreadMetaStore implements ThreadMetaStore {
  private readonly path: string;
  private loaded = false;
  private threads = new Map<string, ThreadMeta>();
  private messages = new Map<string, MessageMeta>();

  constructor(options: { path?: string } = {}) {
    this.path = options.path ?? defaultThreadMetaPath();
  }

  getThread(threadId: string): ThreadMeta | null {
    this.ensureLoaded();
    const found = this.threads.get(threadId);
    return found ? { ...found } : null;
  }

  getMessage(messageId: string): MessageMeta | null {
    this.ensureLoaded();
    const found = this.messages.get(messageId);
    return found ? { ...found } : null;
  }

  rememberInbound(input: {
    threadId: string;
    messageId: string;
    injectionRisk: InjectionRisk;
    extractedOtp: string | null;
    verificationUrl: string | null;
  }): void {
    this.ensureLoaded();
    const now = Date.now();
    const prev = this.threads.get(input.threadId);
    const riskRank = { low: 0, medium: 1, high: 2 } as const;
    const nextRisk =
      prev && riskRank[prev.injectionRisk] > riskRank[input.injectionRisk]
        ? prev.injectionRisk
        : input.injectionRisk;

    this.threads.set(input.threadId, {
      injectionRisk: nextRisk,
      lastOtp: input.extractedOtp ?? prev?.lastOtp ?? null,
      lastVerificationUrl:
        input.verificationUrl ?? prev?.lastVerificationUrl ?? null,
      updatedAtMs: now,
    });
    this.messages.set(input.messageId, {
      threadId: input.threadId,
      extractedOtp: input.extractedOtp,
      verificationUrl: input.verificationUrl,
      injectionRisk: input.injectionRisk,
      updatedAtMs: now,
    });
    this.persist();
  }

  clear(): void {
    this.threads.clear();
    this.messages.clear();
    this.persist();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      if (existsSync(this.path)) {
        const raw = readFileSync(this.path, "utf8");
        const parsed = JSON.parse(raw) as FilePayload;
        for (const [id, meta] of Object.entries(parsed.threads ?? {})) {
          this.threads.set(id, meta);
        }
        for (const [id, meta] of Object.entries(parsed.messages ?? {})) {
          this.messages.set(id, meta);
        }
      }
    } catch {
      // corrupt / missing → empty
    }
    this.loaded = true;
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const payload: FilePayload = {
      threads: Object.fromEntries(this.threads),
      messages: Object.fromEntries(this.messages),
    };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
}

/** In-memory store for tests. */
export class MemoryThreadMetaStore implements ThreadMetaStore {
  private readonly threads = new Map<string, ThreadMeta>();
  private readonly messages = new Map<string, MessageMeta>();

  getThread(threadId: string): ThreadMeta | null {
    const found = this.threads.get(threadId);
    return found ? { ...found } : null;
  }

  getMessage(messageId: string): MessageMeta | null {
    const found = this.messages.get(messageId);
    return found ? { ...found } : null;
  }

  rememberInbound(input: {
    threadId: string;
    messageId: string;
    injectionRisk: InjectionRisk;
    extractedOtp: string | null;
    verificationUrl: string | null;
  }): void {
    const now = Date.now();
    const prev = this.threads.get(input.threadId);
    const riskRank = { low: 0, medium: 1, high: 2 } as const;
    const nextRisk =
      prev && riskRank[prev.injectionRisk] > riskRank[input.injectionRisk]
        ? prev.injectionRisk
        : input.injectionRisk;
    this.threads.set(input.threadId, {
      injectionRisk: nextRisk,
      lastOtp: input.extractedOtp ?? prev?.lastOtp ?? null,
      lastVerificationUrl:
        input.verificationUrl ?? prev?.lastVerificationUrl ?? null,
      updatedAtMs: now,
    });
    this.messages.set(input.messageId, {
      threadId: input.threadId,
      extractedOtp: input.extractedOtp,
      verificationUrl: input.verificationUrl,
      injectionRisk: input.injectionRisk,
      updatedAtMs: now,
    });
  }

  clear(): void {
    this.threads.clear();
    this.messages.clear();
  }
}
