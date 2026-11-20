/**
 * Safe attachment extensions / MIME types for agent inboxes.
 * Dangerous executables and scripts are denied.
 */

export const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".csv",
  ".xlsx",
  ".xls",
  ".docx",
  ".doc",
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".tsv",
]);

/** Explicitly dangerous — always reject even if somehow MIME-spoofed. */
export const DENIED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".msi",
  ".dll",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".ps1",
  ".psm1",
  ".sh",
  ".bash",
  ".zsh",
  ".jar",
  ".apk",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".iso",
  ".hta",
  ".lnk",
  ".reg",
  ".cpl",
  ".inf",
  ".pif",
  ".wasm",
]);

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/csv",
  "text/plain",
  "text/markdown",
  "text/tab-separated-values",
  "application/json",
  "application/xml",
  "text/xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".xml": "application/xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

export type AttachmentAllowDecision =
  | { allowed: true; extension: string; mimeType: string }
  | { allowed: false; reason: string; extension: string };

export function extensionOf(filename: string | null | undefined): string {
  if (!filename) return "";
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot).toLowerCase();
}

export function sanitizeFilename(filename: string | null | undefined): string {
  const raw = (filename ?? "attachment").split(/[/\\]/).pop() ?? "attachment";
  const cleaned = raw.replace(/[^\w.\-()+@ ]+/g, "_").replace(/^\.+/, "") || "attachment";
  return cleaned.slice(0, 180);
}

export function mimeForExtension(ext: string): string | null {
  return EXT_TO_MIME[ext.toLowerCase()] ?? null;
}

/**
 * Decide whether an inbound/outbound attachment is allowed by extension + MIME whitelist.
 */
export function evaluateAttachmentAllowlist(
  filename: string | null | undefined,
  mimeType: string | null | undefined,
): AttachmentAllowDecision {
  const ext = extensionOf(filename);
  const mime = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (ext && DENIED_EXTENSIONS.has(ext)) {
    return { allowed: false, reason: `denied-extension:${ext}`, extension: ext };
  }

  // Double extensions like invoice.pdf.exe
  const lowerName = (filename ?? "").toLowerCase();
  for (const denied of DENIED_EXTENSIONS) {
    if (lowerName.endsWith(denied)) {
      return { allowed: false, reason: `denied-extension:${denied}`, extension: denied };
    }
  }

  const extOk = ext !== "" && ALLOWED_EXTENSIONS.has(ext);
  const mimeOk = mime !== "" && ALLOWED_MIME_TYPES.has(mime);

  // Fail closed: a present but non-allowlisted extension is never rescued by MIME spoofing.
  if (ext && !extOk) {
    return {
      allowed: false,
      reason: `extension-not-allowed:${ext}`,
      extension: ext,
    };
  }

  if (!extOk && !mimeOk) {
    return {
      allowed: false,
      reason: mime ? `mime-not-allowed:${mime}` : "missing-extension-and-mime",
      extension: ext,
    };
  }

  // Prefer extension mapping when present; otherwise trust allowlisted MIME.
  const resolvedMime =
    (extOk ? mimeForExtension(ext) : null) ??
    (mimeOk ? mime : null) ??
    "application/octet-stream";

  const resolvedExt =
    extOk
      ? ext
      : Object.entries(EXT_TO_MIME).find(([, m]) => m === resolvedMime)?.[0] ?? "";

  if (resolvedExt && DENIED_EXTENSIONS.has(resolvedExt)) {
    return {
      allowed: false,
      reason: `denied-extension:${resolvedExt}`,
      extension: resolvedExt,
    };
  }

  if (!resolvedExt) {
    return {
      allowed: false,
      reason: "could-not-resolve-safe-extension",
      extension: "",
    };
  }

  return { allowed: true, extension: resolvedExt, mimeType: resolvedMime };
}
