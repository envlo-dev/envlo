/** Lightweight header peek for Email Worker buffering (no full MIME parse). */

/** Soft cap stored in the ring buffer (larger messages are truncated). */
export const MAX_BUFFERED_MIME_BYTES = 256 * 1024; // 256 KiB

/** Hard reject at the Email Worker when rawSize exceeds this (1 MiB default). */
export const DEFAULT_MAX_MIME_BYTES = 1024 * 1024;

export async function readStreamLimited(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean; rawSize: number }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (truncated) continue;
    const remaining = maxBytes - chunks.reduce((n, c) => n + c.byteLength, 0);
    if (remaining <= 0) {
      truncated = true;
      continue;
    }
    if (value.byteLength <= remaining) {
      chunks.push(value);
    } else {
      chunks.push(value.slice(0, remaining));
      truncated = true;
    }
  }

  const bytes = concatBytes(chunks);
  return { bytes, truncated: truncated || total > maxBytes, rawSize: total };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export function headerValue(rawMime: string, name: string): string | null {
  const lines = rawMime.split(/\r?\n/);
  const lower = name.toLowerCase();
  const unfolded: string[] = [];
  for (const line of lines) {
    if (line === "") break;
    if (/^\s/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += " " + line.trim();
      continue;
    }
    unfolded.push(line);
  }
  for (const line of unfolded) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx).trim().toLowerCase() === lower) {
      return line.slice(idx + 1).trim();
    }
  }
  return null;
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
