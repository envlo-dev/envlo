import type { DraftRecord } from "../state/types.js";
import type { MagicLinkApprovalChannel } from "./approval-magic-link.js";
import type { MagicLinkClickAction } from "./approval-magic-link.js";

export type MagicLinkFormPageOptions = {
  token: string;
  action: MagicLinkClickAction;
  /** Optional draft preview shown on the form. */
  draft?: Pick<
    DraftRecord,
    "id" | "subject" | "toAddresses" | "currentMarkdown"
  > | null;
  /** Form POST target (default: same path). */
  actionUrl?: string;
  title?: string;
};

/**
 * Minimal HTML collector for magic-link reject / edit / approve-with-note.
 * Hosts can return this from GET `?token=&action=reject|edit|approve`.
 */
export function renderMagicLinkFormPage(options: MagicLinkFormPageOptions): string {
  const actionUrl = options.actionUrl ?? "";
  const title =
    options.title ??
    (options.action === "approve"
      ? "Approve draft"
      : options.action === "edit"
        ? "Edit & Approve"
        : "Reject with Feedback");

  const draftBlock = options.draft
    ? `<section style="margin:1rem 0;padding:1rem;background:#f6f8fa;border-radius:8px">
        <p><b>Draft</b> <code>${escapeHtml(options.draft.id)}</code></p>
        <p><b>To</b> ${escapeHtml(options.draft.toAddresses.join(", ") || "(none)")}</p>
        <p><b>Subject</b> ${escapeHtml(options.draft.subject ?? "(none)")}</p>
        <pre style="white-space:pre-wrap">${escapeHtml(options.draft.currentMarkdown)}</pre>
      </section>`
    : "";

  const fields =
    options.action === "approve"
      ? `<label>Optional note<br/><textarea name="note" rows="3" style="width:100%"></textarea></label>`
      : options.action === "reject"
        ? `<label>Feedback (required)<br/><textarea name="feedback" rows="5" style="width:100%" required></textarea></label>`
        : `<label>Subject<br/><input name="subject" style="width:100%" value="${escapeHtml(options.draft?.subject ?? "")}"/></label>
           <label style="display:block;margin-top:.75rem">To (comma-separated)<br/><input name="toAddresses" style="width:100%" value="${escapeHtml(options.draft?.toAddresses.join(", ") ?? "")}"/></label>
           <label style="display:block;margin-top:.75rem">Markdown body (required)<br/><textarea name="markdown" rows="10" style="width:100%" required>${escapeHtml(options.draft?.currentMarkdown ?? "")}</textarea></label>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#111}
    button{margin-top:1rem;padding:.6rem 1rem;font-size:1rem;cursor:pointer}
    label{display:block;margin-top:.5rem}
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${draftBlock}
  <form method="POST" action="${escapeHtml(actionUrl)}">
    <input type="hidden" name="token" value="${escapeHtml(options.token)}"/>
    <input type="hidden" name="action" value="${escapeHtml(options.action)}"/>
    ${fields}
    <button type="submit">${escapeHtml(title)}</button>
  </form>
</body>
</html>`;
}

export type MagicLinkHttpRequest = {
  method: string;
  /** Full URL or path+query. */
  url: string;
  /** Raw body for application/x-www-form-urlencoded or JSON. */
  body?: string | null;
  headers?: Record<string, string | undefined>;
};

export type MagicLinkHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/**
 * Host-friendly HTTP handler for magic-link clicks:
 * - GET `?token=&action=approve|edit|reject` → HTML form (approve may include optional note)
 * - POST form/JSON → applies decision via `channel.handleClick`
 */
export async function handleMagicLinkHttpRequest(
  channel: MagicLinkApprovalChannel,
  request: MagicLinkHttpRequest,
  options: {
    /** Resolve draft preview for GET forms (optional). */
    loadDraft?: (draftId: string) => Promise<DraftRecord | null>;
  } = {},
): Promise<MagicLinkHttpResponse> {
  const url = new URL(request.url, "http://localhost");
  const method = request.method.toUpperCase();

  if (method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    const action = (url.searchParams.get("action") ?? "approve") as MagicLinkClickAction;
    if (!token || !["approve", "edit", "reject"].includes(action)) {
      return htmlResponse(400, "<p>Missing or invalid token/action.</p>");
    }

    let draft: DraftRecord | null = null;
    const peeked = channel.tokens.peek(token);
    if (peeked && options.loadDraft) {
      draft = await options.loadDraft(peeked.draftId);
    }

    // Direct approve without form when `confirm=1` is absent still shows form
    // so supervisors can optionally leave a note.
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: renderMagicLinkFormPage({
        token,
        action,
        draft,
        actionUrl: url.pathname,
      }),
    };
  }

  if (method === "POST") {
    const parsed = parseMagicLinkPostBody(
      request.body ?? "",
      request.headers?.["content-type"] ?? request.headers?.["Content-Type"],
      url,
    );
    if (!parsed.token || !parsed.action) {
      return htmlResponse(400, "<p>Missing token or action.</p>");
    }

    try {
      const draft = await channel.handleClick({
        token: parsed.token,
        action: parsed.action,
        ...(parsed.feedback !== undefined ? { feedback: parsed.feedback } : {}),
        ...(parsed.markdown !== undefined ? { markdown: parsed.markdown } : {}),
        ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
        ...(parsed.toAddresses !== undefined
          ? { toAddresses: parsed.toAddresses }
          : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
      });
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: `<!doctype html><html><body><h1>Done</h1><p>Draft <code>${escapeHtml(draft.id)}</code> is now <b>${escapeHtml(draft.status)}</b>.</p></body></html>`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return htmlResponse(400, `<p>${escapeHtml(message)}</p>`);
    }
  }

  return htmlResponse(405, "<p>Method not allowed.</p>");
}

type ParsedMagicLinkPost = {
  token?: string;
  action?: MagicLinkClickAction;
  feedback?: string;
  markdown?: string;
  subject?: string;
  toAddresses?: string[];
  note?: string;
};

function parseMagicLinkPostBody(
  body: string,
  contentType: string | undefined,
  url: URL,
): ParsedMagicLinkPost {
  const queryToken = url.searchParams.get("token");
  const queryAction = url.searchParams.get("action") as MagicLinkClickAction | null;
  const fromQuery: ParsedMagicLinkPost = {
    ...(queryToken ? { token: queryToken } : {}),
    ...(queryAction ? { action: queryAction } : {}),
  };

  if (contentType?.includes("application/json")) {
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      const token = stringOrUndef(json.token) ?? fromQuery.token;
      const action =
        (stringOrUndef(json.action) as MagicLinkClickAction | undefined) ??
        fromQuery.action;
      const feedback = stringOrUndef(json.feedback);
      const markdown = stringOrUndef(json.markdown);
      const subject = stringOrUndef(json.subject);
      const note = stringOrUndef(json.note);
      return {
        ...(token ? { token } : {}),
        ...(action ? { action } : {}),
        ...(feedback !== undefined ? { feedback } : {}),
        ...(markdown !== undefined ? { markdown } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(typeof json.toAddresses === "string"
          ? {
              toAddresses: json.toAddresses
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : Array.isArray(json.toAddresses)
            ? { toAddresses: json.toAddresses.map(String) }
            : {}),
      };
    } catch {
      return fromQuery;
    }
  }

  const params = new URLSearchParams(body);
  const token = params.get("token") ?? fromQuery.token;
  const action =
    (params.get("action") as MagicLinkClickAction | null) ?? fromQuery.action;
  const feedback = params.get("feedback");
  const markdown = params.get("markdown");
  const subject = params.get("subject");
  const note = params.get("note");
  const toRaw = params.get("toAddresses");
  return {
    ...(token ? { token } : {}),
    ...(action ? { action } : {}),
    ...(feedback != null ? { feedback } : {}),
    ...(markdown != null ? { markdown } : {}),
    ...(subject != null ? { subject } : {}),
    ...(note != null ? { note } : {}),
    ...(toRaw != null
      ? {
          toAddresses: toRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

function stringOrUndef(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function htmlResponse(status: number, body: string): MagicLinkHttpResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: `<!doctype html><html><body>${body}</body></html>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
