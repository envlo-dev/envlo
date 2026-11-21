import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { EnvloMcpContext } from "../context.js";
import { createEnvloMcpServer } from "../server.js";

/**
 * Run the MCP server over stdio (Cursor / Claude Code default).
 * Diagnostics must go to stderr — stdout is the JSON-RPC channel.
 */
export async function runStdioServer(ctx: EnvloMcpContext): Promise<void> {
  const server = createEnvloMcpServer({ context: ctx });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
