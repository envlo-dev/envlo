import { redactApiKey, type KeyRegion } from "./keys.js";

export type WelcomeEmailInput = {
  to: string;
  apiKey: string;
  region: KeyRegion;
  from: string;
};

export type ResendSendResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

export function buildWelcomeEmail(input: WelcomeEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "Welcome to Envlo Concierge Pro";
  const redacted = redactApiKey(input.apiKey);
  const text = [
    "Welcome to Envlo Concierge Pro ($19/mo).",
    "",
    `Your regional production API key (${input.region.toUpperCase()}):`,
    input.apiKey,
    "",
    "Keep this key secret. Configure it as ENVLO_API_KEY in your agent runtime.",
    "Docs: https://envlo.dev",
    "",
    `Reference: ${redacted}`,
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5">
      <h1 style="font-size:1.25rem">Welcome to Envlo Concierge Pro</h1>
      <p>Thanks for upgrading ($19/mo). Your regional production API key is ready.</p>
      <p><strong>Region:</strong> ${input.region.toUpperCase()}</p>
      <pre style="background:#0b1020;color:#e8eefc;padding:12px;border-radius:8px;overflow:auto">${escapeHtml(input.apiKey)}</pre>
      <p>Set <code>ENVLO_API_KEY</code> in your agent runtime. Keep the key secret.</p>
      <p><a href="https://envlo.dev">envlo.dev</a></p>
    </div>
  `.trim();

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function sendWelcomeEmailViaResend(
  input: WelcomeEmailInput,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendSendResult> {
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY missing" };
  }
  const body = buildWelcomeEmail(input);
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: body.subject,
      text: body.text,
      html: body.html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `resend ${res.status}: ${errText.slice(0, 200)}` };
  }
  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  return { ok: true, ...(json?.id ? { id: json.id } : {}) };
}
