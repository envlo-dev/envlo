/**
 * Language-agnostic chat-template / tool-call markers often used in visible
 * prompt-injection payloads.
 */
export const CHAT_TEMPLATE_PATTERNS: ReadonlyArray<{ code: string; re: RegExp }> = [
  { code: "token.system_colon", re: /\bSYSTEM\s*:/i },
  { code: "token.admin_override", re: /\bADMIN\s+OVERRIDE\s*:/i },
  { code: "token.inst", re: /\[INST\]/i },
  { code: "token.im_start", re: /<\|im_start\|>/i },
  { code: "token.im_end", re: /<\|im_end\|>/i },
  { code: "token.developer_mode", re: /\bDeveloper\s+Mode\b/i },
  // Require a directive shape — bare "system prompt" is common in benign mail.
  { code: "token.sys_prompt", re: /\b(SYSTEM\s+PROMPT\s*:|your\s+system\s+prompt\s+is)\b/i },
  { code: "token.assistant_colon", re: /\bASSISTANT\s*:/i },
  { code: "token.llama_header", re: /<<SYS>>|<<\/SYS>>/i },
];

export const TOOL_CALL_PATTERNS: ReadonlyArray<{ code: string; re: RegExp }> = [
  { code: "tool.reply_to_thread", re: /\breply_to_thread\s*\(/i },
  { code: "tool.send_email", re: /\bsend_email\s*\(/i },
  { code: "tool.manage_draft", re: /\bmanage_draft_approval\s*\(/i },
];

export function findTokenMatches(
  text: string,
): Array<{ code: string; detail: string }> {
  const hits: Array<{ code: string; detail: string }> = [];
  for (const { code, re } of [...CHAT_TEMPLATE_PATTERNS, ...TOOL_CALL_PATTERNS]) {
    re.lastIndex = 0;
    if (re.test(text)) {
      hits.push({ code, detail: `Matched injectable marker (${code})` });
    }
  }
  return hits;
}
