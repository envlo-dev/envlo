import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { defaultAttachmentsRoot, resolveUnderAllowedRoots } from "./paths.js";
import { resolveMaxBytes } from "./policy.js";
import { isBlockedAttachmentHost } from "./ssrf.js";
import {
  evaluateAttachmentAllowlist,
  extensionOf,
  sanitizeFilename,
} from "./whitelist.js";
import type {
  OutboundAttachmentBytes,
  OutboundAttachmentRef,
  OutboundRedirectMode,
  ResolveOutboundOptions,
} from "./types.js";

function guessFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split("/").filter(Boolean).pop();
    return sanitizeFilename(base ?? "download");
  } catch {
    return "download";
  }
}

function assertUrlAllowed(
  url: URL,
  options: {
    httpsOnly: boolean;
    blockPrivateHosts: boolean;
  },
): void {
  if (options.httpsOnly) {
    if (url.protocol !== "https:") {
      throw new Error(`Attachment URL must be https (got ${url.protocol})`);
    }
  } else if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported attachment URL protocol: ${url.protocol}`);
  }

  if (options.blockPrivateHosts && isBlockedAttachmentHost(url.hostname)) {
    throw new Error(`Attachment URL host is blocked: ${url.hostname}`);
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readLocalFile(
  filePath: string,
  options: ResolveOutboundOptions & Pick<OutboundAttachmentRef, "filename" | "mimeType">,
): Promise<OutboundAttachmentBytes> {
  const roots = options.allowedRoots ?? [defaultAttachmentsRoot()];
  const absolute = await resolveUnderAllowedRoots(filePath, roots);
  const content = new Uint8Array(await readFile(absolute));
  const filename = sanitizeFilename(options.filename ?? basename(absolute));
  const allow = evaluateAttachmentAllowlist(filename, options.mimeType ?? null);
  if (!allow.allowed) {
    throw new Error(`Outbound attachment blocked (${allow.reason}): ${filename}`);
  }
  const maxBytes = resolveMaxBytes(options.tier ?? "pro", options.maxBytes);
  if (content.byteLength > maxBytes) {
    throw new Error(
      `Outbound attachment over size cap (${content.byteLength}>${maxBytes}): ${filename}`,
    );
  }
  return {
    filename,
    mimeType: allow.mimeType,
    content,
    sizeBytes: content.byteLength,
    source: "filePath",
  };
}

async function fetchWithRedirectPolicy(
  startUrl: URL,
  options: {
    fetch: typeof fetch;
    httpsOnly: boolean;
    blockPrivateHosts: boolean;
    redirect: OutboundRedirectMode;
    maxRedirects: number;
  },
): Promise<Response> {
  assertUrlAllowed(startUrl, options);

  if (options.redirect === "follow") {
    const response = await options.fetch(startUrl, {
      redirect: "follow",
      headers: { Accept: "*/*" },
    });
    return response;
  }

  if (options.redirect === "error") {
    const response = await options.fetch(startUrl, {
      redirect: "error",
      headers: { Accept: "*/*" },
    });
    return response;
  }

  // safe: manual hops with host/protocol re-check
  let current = startUrl;
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    assertUrlAllowed(current, options);
    const response = await options.fetch(current, {
      redirect: "manual",
      headers: { Accept: "*/*" },
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Attachment URL redirect missing Location (${response.status})`);
    }
    if (hop === options.maxRedirects) {
      throw new Error(`Attachment URL exceeded max redirects (${options.maxRedirects})`);
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new Error(`Attachment URL redirect has invalid Location: ${location}`);
    }
    current = next;
  }

  throw new Error(`Attachment URL exceeded max redirects (${options.maxRedirects})`);
}

async function fetchUrl(
  urlString: string,
  options: ResolveOutboundOptions & OutboundAttachmentRef,
): Promise<OutboundAttachmentBytes> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`Invalid attachment URL: ${urlString}`);
  }

  const httpsOnly = options.httpsOnly ?? true;
  const blockPrivateHosts = options.blockPrivateHosts ?? true;
  const redirect = options.redirect ?? "safe";
  const maxRedirects = options.maxRedirects ?? 5;

  const maxBytes = resolveMaxBytes(
    options.tier ?? "pro",
    options.maxDownloadBytes ?? options.maxBytes,
  );
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error("fetch is not available in this runtime");
  }

  const response = await fetchWithRedirectPolicy(url, {
    fetch: fetchFn,
    httpsOnly,
    blockPrivateHosts,
    redirect,
    maxRedirects,
  });

  if (!response.ok) {
    throw new Error(`Attachment URL fetch failed (${response.status}): ${urlString}`);
  }

  const headerLen = Number(response.headers.get("content-length") ?? "0");
  if (headerLen > maxBytes) {
    throw new Error(
      `Attachment URL Content-Length over size cap (${headerLen}>${maxBytes})`,
    );
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `Attachment URL body over size cap (${buffer.byteLength}>${maxBytes})`,
    );
  }

  const filename = sanitizeFilename(
    options.filename ?? guessFilenameFromUrl(urlString),
  );
  const headerMime = response.headers.get("content-type");
  const mimeType = options.mimeType ?? headerMime ?? null;
  const allow = evaluateAttachmentAllowlist(filename, mimeType);
  if (!allow.allowed) {
    throw new Error(`Outbound URL attachment blocked (${allow.reason}): ${filename}`);
  }

  const finalName =
    extensionOf(filename) === ""
      ? `${filename}${allow.extension}`
      : filename;

  return {
    filename: finalName,
    mimeType: allow.mimeType,
    content: buffer,
    sizeBytes: buffer.byteLength,
    source: "url",
  };
}

/**
 * Resolve an outbound attachment for `reply_to_thread` / `send_email` /
 * `forward_thread` from a local sandboxed path, HTTPS URL, or raw bytes.
 */
export async function resolveOutboundAttachment(
  ref: OutboundAttachmentRef,
  options: ResolveOutboundOptions = {},
): Promise<OutboundAttachmentBytes> {
  const sources = [ref.filePath, ref.url, ref.content].filter((v) => v !== undefined);
  if (sources.length !== 1) {
    throw new Error(
      "Outbound attachment requires exactly one of filePath, url, or content",
    );
  }

  if (ref.content) {
    const filename = sanitizeFilename(ref.filename ?? "attachment.bin");
    const allow = evaluateAttachmentAllowlist(filename, ref.mimeType ?? null);
    if (!allow.allowed) {
      throw new Error(`Outbound attachment blocked (${allow.reason}): ${filename}`);
    }
    const maxBytes = resolveMaxBytes(options.tier ?? "pro", options.maxBytes);
    if (ref.content.byteLength > maxBytes) {
      throw new Error(
        `Outbound attachment over size cap (${ref.content.byteLength}>${maxBytes})`,
      );
    }
    return {
      filename: extensionOf(filename) ? filename : `${filename}${allow.extension}`,
      mimeType: allow.mimeType,
      content: ref.content,
      sizeBytes: ref.content.byteLength,
      source: "bytes",
    };
  }

  if (ref.filePath) {
    return readLocalFile(ref.filePath, { ...options, ...ref });
  }

  if (ref.url) {
    return fetchUrl(ref.url, { ...options, ...ref });
  }

  throw new Error("Outbound attachment ref is empty");
}

/**
 * Resolve many outbound refs (shared by reply / send / forward tool handlers).
 */
export async function resolveOutboundAttachments(
  refs: OutboundAttachmentRef[],
  options: ResolveOutboundOptions = {},
): Promise<OutboundAttachmentBytes[]> {
  const out: OutboundAttachmentBytes[] = [];
  for (const ref of refs) {
    out.push(await resolveOutboundAttachment(ref, options));
  }
  return out;
}
