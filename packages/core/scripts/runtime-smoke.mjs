/**
 * Runtime smoke for @envlo/core (Node + Bun).
 *
 * Usage:
 *   node packages/core/scripts/runtime-smoke.mjs --expect node
 *   bun packages/core/scripts/runtime-smoke.mjs --expect bun
 *
 * Requires a prior `pnpm --filter @envlo/core build` (imports ../dist/index.js).
 */

function readExpect(argv) {
  const idx = argv.indexOf("--expect");
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1] ?? null;
}

function fail(message) {
  console.error(`runtime-smoke FAIL: ${message}`);
  process.exit(1);
}

const expected = readExpect(process.argv.slice(2));
const { createCoreBanner, detectRuntime } = await import("../dist/index.js");

const runtime = detectRuntime();
const banner = createCoreBanner();

if (!banner.includes("@envlo/core@")) {
  fail(`banner missing package marker: ${banner}`);
}

if (expected && runtime !== expected) {
  fail(`expected runtime "${expected}", got "${runtime}" (banner: ${banner})`);
}

if (runtime !== "node" && runtime !== "bun") {
  fail(`unexpected runtime "${runtime}" (banner: ${banner})`);
}

console.log(`runtime-smoke OK: ${banner}`);
