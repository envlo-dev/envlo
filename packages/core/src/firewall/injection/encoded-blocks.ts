import { findOverridePhraseMatches } from "./dictionary.js";
import { findStructuralOverrideMatches } from "./patterns.js";
import { findTokenMatches } from "./tokens.js";

const BASE64_CANDIDATE_RE =
  /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{24,}={0,2})(?![A-Za-z0-9+/=])/g;
const HEX_CANDIDATE_RE =
  /(?:^|[^0-9A-Fa-f])((?:[0-9A-Fa-f]{2}){12,})(?![0-9A-Fa-f])/g;

const MAX_BLOCKS = 20;
const MAX_DECODE_CHARS = 8_000;

export type EncodedBlockHit = {
  code: string;
  detail: string;
  /** True when decoded payload itself looks like an override / template injection. */
  highSignal: boolean;
};

function decodeBase64(chunk: string): string | null {
  try {
    // Prefer Buffer when present (Node/Bun); fall back to atob for Workers/Deno.
    const g = globalThis as {
      Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } };
      atob?: (s: string) => string;
    };
    if (g.Buffer) {
      return g.Buffer.from(chunk, "base64").toString("utf8");
    }
    if (typeof g.atob === "function") {
      const bin = g.atob(chunk);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

function decodeHex(chunk: string): string | null {
  if (chunk.length % 2 !== 0) return null;
  try {
    const bytes = new Uint8Array(chunk.length / 2);
    for (let i = 0; i < chunk.length; i += 2) {
      bytes[i / 2] = Number.parseInt(chunk.slice(i, i + 2), 16);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function looksMostlyText(decoded: string): boolean {
  if (!decoded || decoded.length < 4) return false;
  let printable = 0;
  for (const ch of decoded) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      printable += 1;
    }
  }
  return printable / decoded.length >= 0.85;
}

function inspectDecoded(decoded: string): boolean {
  const capped =
    decoded.length > MAX_DECODE_CHARS ? decoded.slice(0, MAX_DECODE_CHARS) : decoded;
  if (!looksMostlyText(capped)) return false;
  if (findOverridePhraseMatches(capped).length > 0) return true;
  if (findStructuralOverrideMatches(capped).length > 0) return true;
  if (findTokenMatches(capped).length > 0) return true;
  return false;
}

/**
 * Find suspicious inline Base64/Hex blobs, decode them, and see whether the
 * plaintext carries override / chat-template injection signals.
 */
export function inspectEncodedBlocks(text: string): {
  hits: EncodedBlockHit[];
  inspected: number;
} {
  const hits: EncodedBlockHit[] = [];
  let inspected = 0;

  BASE64_CANDIDATE_RE.lastIndex = 0;
  for (const match of text.matchAll(BASE64_CANDIDATE_RE)) {
    if (inspected >= MAX_BLOCKS) break;
    const chunk = match[1];
    if (!chunk || chunk.length % 4 === 1) continue;
    inspected += 1;
    const decoded = decodeBase64(chunk);
    if (!decoded) continue;
    if (inspectDecoded(decoded)) {
      hits.push({
        code: "encoded.base64_override",
        detail: "Decoded Base64 block contains instruction-override / template tokens",
        highSignal: true,
      });
    } else if (looksMostlyText(decoded) && decoded.length >= 16) {
      hits.push({
        code: "encoded.base64_text",
        detail: "Suspicious inline Base64 decodes to readable text",
        highSignal: false,
      });
    }
  }

  HEX_CANDIDATE_RE.lastIndex = 0;
  for (const match of text.matchAll(HEX_CANDIDATE_RE)) {
    if (inspected >= MAX_BLOCKS) break;
    const chunk = match[1];
    if (!chunk) continue;
    inspected += 1;
    const decoded = decodeHex(chunk);
    if (!decoded) continue;
    if (inspectDecoded(decoded)) {
      hits.push({
        code: "encoded.hex_override",
        detail: "Decoded Hex block contains instruction-override / template tokens",
        highSignal: true,
      });
    } else if (looksMostlyText(decoded) && decoded.length >= 16) {
      hits.push({
        code: "encoded.hex_text",
        detail: "Suspicious inline Hex decodes to readable text",
        highSignal: false,
      });
    }
  }

  return { hits, inspected };
}
