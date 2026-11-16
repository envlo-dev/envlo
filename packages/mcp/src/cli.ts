#!/usr/bin/env node
import { createMcpBanner, listCoreTools } from "./index.js";

function main(): void {
  const tools = listCoreTools().join(", ");
  process.stdout.write(`${createMcpBanner()}\n`);
  process.stdout.write(`tools: ${tools}\n`);
  process.stdout.write("MCP server bootstrap — full tool handlers land in Phase 1 ticket 12.\n");
}

main();
