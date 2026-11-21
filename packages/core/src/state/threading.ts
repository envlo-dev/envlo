import { normalizeMessageId, parseReferencesHeader } from "../parser/references.js";
import type { MessageRecord, StitchedReplyHeaders } from "./types.js";

/**
 * Normalize Message-ID tokens to a single identity form: `<id@domain>`.
 * Bare `id@domain` and `<id@domain>` both become `<id@domain>` so correlation
 * and stitching never miss on bracket variance.
 */
export function canonicalizeMessageId(value: string | null | undefined): string | null {
  const normalized = normalizeMessageId(value);
  if (!normalized) return null;
  if (normalized.startsWith("<") && normalized.endsWith(">")) {
    return normalized;
  }
  return `<${normalized}>`;
}

export function canonicalizeReferences(
  values: string[] | string | null | undefined,
): string[] {
  if (!values) return [];
  if (typeof values === "string") {
    return parseReferencesHeader(values)
      .map((id) => canonicalizeMessageId(id))
      .filter((id): id is string => Boolean(id));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const id = canonicalizeMessageId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Build RFC 5322 reply headers from a parent message.
 * `References` = parent's References + parent Message-ID (if not already present).
 * `In-Reply-To` = parent Message-ID.
 */
export function stitchReplyHeadersFromParent(parent: {
  messageId: string;
  references: string[];
}): StitchedReplyHeaders {
  const parentId = canonicalizeMessageId(parent.messageId);
  if (!parentId) {
    throw new Error("parent messageId is required to stitch reply headers");
  }
  const refs = canonicalizeReferences(parent.references);
  if (!refs.includes(parentId)) {
    refs.push(parentId);
  }
  return { inReplyTo: parentId, references: refs };
}

/**
 * Pick the best parent message for an outbound reply:
 * explicit Message-ID → else latest message in chronological order.
 */
export function selectParentMessage(
  messages: MessageRecord[],
  parentMessageId?: string | null,
): MessageRecord | null {
  if (messages.length === 0) return null;
  const wanted = canonicalizeMessageId(parentMessageId);
  if (wanted) {
    const found = messages.find((m) => m.messageId === wanted);
    if (!found) {
      throw new Error(`parent messageId not found in thread: ${wanted}`);
    }
    return found;
  }
  return messages[messages.length - 1] ?? null;
}

/**
 * Correlation candidates for attaching an inbound message to an existing thread:
 * In-Reply-To first, then References (newest → oldest).
 */
export function correlationMessageIds(input: {
  inReplyTo?: string | null;
  references?: string[];
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const id = canonicalizeMessageId(raw);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  push(input.inReplyTo ?? null);
  const refs = canonicalizeReferences(input.references);
  // Prefer later references (closer to tip of thread).
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    push(refs[i]);
  }
  return ids;
}

export function sortMessagesChronologically(messages: MessageRecord[]): MessageRecord[] {
  return [...messages].sort((a, b) => {
    const aKey = a.date ?? a.createdAt;
    const bKey = b.date ?? b.createdAt;
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}
