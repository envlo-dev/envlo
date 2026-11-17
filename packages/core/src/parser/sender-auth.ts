import type { Header } from "postal-mime";
import type {
  AuthMethodOutcome,
  AuthMethodResult,
  SenderAuthDetails,
  SenderAuthStatus,
} from "./types.js";

const AUTH_METHOD_RE =
  /\b(spf|dkim|dmarc)\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror|policy)\b/gi;

const RECEIVED_SPF_RE =
  /^\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i;

function pushUnique(results: AuthMethodResult[], next: AuthMethodResult): void {
  const exists = results.some((r) => r.method === next.method && r.result === next.result);
  if (!exists) results.push(next);
}

function parseAuthenticationResults(value: string, results: AuthMethodResult[]): void {
  AUTH_METHOD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AUTH_METHOD_RE.exec(value)) !== null) {
    const method = match[1]?.toLowerCase() as AuthMethodResult["method"] | undefined;
    const result = match[2]?.toLowerCase();
    if (!method || !result) continue;
    pushUnique(results, { method, result });
  }
}

function parseReceivedSpf(value: string, results: AuthMethodResult[]): void {
  const match = RECEIVED_SPF_RE.exec(value);
  const result = match?.[1]?.toLowerCase();
  if (!result) return;
  pushUnique(results, { method: "spf", result });
}

function pickLatest(
  results: AuthMethodResult[],
  method: AuthMethodResult["method"],
): AuthMethodOutcome | null {
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const row = results[i];
    if (row?.method === method) return row.result;
  }
  return null;
}

function deriveStatus(
  spf: AuthMethodOutcome | null,
  dkim: AuthMethodOutcome | null,
  dmarc: AuthMethodOutcome | null,
): SenderAuthStatus {
  if (spf === "fail" || dkim === "fail" || dmarc === "fail") {
    return "fail";
  }
  if (dmarc === "pass" || (spf === "pass" && dkim === "pass")) {
    return "pass";
  }
  return "unverified";
}

/**
 * Derive a coarse spoofing verdict plus per-method SPF/DKIM/DMARC tokens
 * from Authentication-Results / Received-SPF.
 *
 * Policy for `status`:
 * - `fail` if SPF, DKIM, or DMARC reports `fail`
 * - `pass` if DMARC is `pass`, or both SPF and DKIM are `pass`
 * - `unverified` otherwise (missing headers, softfail, neutral, partial signals)
 */
export function evaluateSenderAuth(headers: Header[]): SenderAuthDetails {
  const results: AuthMethodResult[] = [];

  for (const header of headers) {
    const key = header.key.toLowerCase();
    if (key === "authentication-results") {
      parseAuthenticationResults(header.value, results);
    } else if (key === "received-spf") {
      parseReceivedSpf(header.value, results);
    }
  }

  const spf = pickLatest(results, "spf");
  const dkim = pickLatest(results, "dkim");
  const dmarc = pickLatest(results, "dmarc");

  return {
    status: deriveStatus(spf, dkim, dmarc),
    spf,
    dkim,
    dmarc,
    results,
  };
}

export function evaluateSenderAuthStatus(headers: Header[]): SenderAuthStatus {
  return evaluateSenderAuth(headers).status;
}
