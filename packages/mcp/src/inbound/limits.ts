/** Default max raw MIME size for SMTP DATA + webhook bodies (25 MiB). */
export const DEFAULT_MAX_MIME_BYTES = 25 * 1024 * 1024;

export function readMaxMimeBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.ENVLO_MAX_MIME_BYTES;
  if (!raw) return DEFAULT_MAX_MIME_BYTES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MIME_BYTES;
}

export class MimeTooLargeError extends Error {
  readonly code = "MIME_TOO_LARGE" as const;
  readonly bytes: number;
  readonly limit: number;

  constructor(bytes: number, limit: number) {
    super(`MIME payload too large (${bytes} bytes > ${limit} limit)`);
    this.name = "MimeTooLargeError";
    this.bytes = bytes;
    this.limit = limit;
  }
}

export function assertMimeSize(bytes: number, limit: number): void {
  if (bytes > limit) throw new MimeTooLargeError(bytes, limit);
}
