/** Structured stderr logging — never write to stdout (stdio JSON-RPC). */
export function mcpLog(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  });
  process.stderr.write(`${line}\n`);
}
