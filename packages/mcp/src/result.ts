import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** JSON tool result for MCP clients (text + structuredContent). */
export function toolJson(data: unknown, isError = false): CallToolResult {
  const text = JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent:
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : { value: data },
    ...(isError ? { isError: true } : {}),
  };
}

export function toolError(message: string, details?: unknown): CallToolResult {
  return toolJson(
    {
      error: message,
      ...(details !== undefined ? { details } : {}),
    },
    true,
  );
}
