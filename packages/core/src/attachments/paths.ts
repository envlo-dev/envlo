import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, normalize, resolve, sep } from "node:path";

export const DEFAULT_ATTACHMENTS_DIR_NAME = ".envlo/attachments";

/** Default sandboxed cache root: `~/.envlo/attachments`. */
export function defaultAttachmentsRoot(): string {
  return resolve(homedir(), DEFAULT_ATTACHMENTS_DIR_NAME);
}

async function realpathIfExists(absolute: string): Promise<string> {
  try {
    return normalize(await realpath(absolute));
  } catch {
    return normalize(absolute);
  }
}

function isInsideRoot(candidate: string, root: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(prefix);
}

/**
 * Resolve `candidate` (following symlinks) and ensure it stays under one of
 * `allowedRoots` (blocks path traversal / symlink escape).
 */
export async function resolveUnderAllowedRoots(
  candidate: string,
  allowedRoots: string[],
): Promise<string> {
  if (!candidate || !candidate.trim()) {
    throw new Error("filePath is empty");
  }
  const absolute = normalize(isAbsolute(candidate) ? candidate : resolve(candidate));
  const realCandidate = await realpathIfExists(absolute);

  for (const root of allowedRoots) {
    const resolvedRoot = normalize(resolve(root));
    const realRoot = await realpathIfExists(resolvedRoot);
    if (isInsideRoot(realCandidate, realRoot)) {
      return realCandidate;
    }
  }

  throw new Error(
    `filePath escapes allowed attachment roots: ${realCandidate} (allowed: ${allowedRoots
      .map((r) => normalize(resolve(r)))
      .join(", ")})`,
  );
}
