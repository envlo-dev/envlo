/**
 * @envlo/core — runtime-portable email firewall primitives.
 *
 * Intentionally free of Node-specific native/C++ addons so the same build
 * runs on Node.js, Cloudflare Workers/Pages, Deno, and Bun.
 */

export const ENVLO_CORE_VERSION = "0.0.0" as const;

export type EnvloRuntime = "node" | "cloudflare" | "deno" | "bun" | "unknown";

/** Lightweight runtime probe with no platform-specific imports. */
export function detectRuntime(): EnvloRuntime {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.Deno !== "undefined") return "deno";
  if (typeof g.Bun !== "undefined") return "bun";
  if (typeof g.caches !== "undefined" && typeof g.WebSocketPair !== "undefined") {
    return "cloudflare";
  }
  if (typeof g.process === "object" && g.process !== null) {
    const processLike = g.process as { versions?: { node?: string } };
    if (processLike.versions?.node) return "node";
  }
  return "unknown";
}

export function createCoreBanner(): string {
  return `@envlo/core@${ENVLO_CORE_VERSION} (${detectRuntime()})`;
}
