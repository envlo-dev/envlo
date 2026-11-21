import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ENVLO_MCP_VERSION } from "./banner.js";
import type { EnvloMcpContext } from "./context.js";
import { registerCoreTools } from "./tools.js";

export type CreateEnvloMcpServerOptions = {
  context: EnvloMcpContext;
  /** Override server name (default `@envlo/mcp`). */
  name?: string;
  version?: string;
};

/**
 * Build an MCP server with the 8 Envlo core tools registered.
 */
export function createEnvloMcpServer(
  options: CreateEnvloMcpServerOptions,
): McpServer {
  const server = new McpServer({
    name: options.name ?? "@envlo/mcp",
    version: options.version ?? ENVLO_MCP_VERSION,
  });
  registerCoreTools(server, options.context);
  return server;
}
