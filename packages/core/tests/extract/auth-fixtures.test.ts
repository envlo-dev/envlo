import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";
import { extractAuthSignals } from "../../src/extract/index.js";
import { ingestRawMime } from "../../src/parser/ingest-raw-mime.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const authEmlDir = join(fixturesRoot, "eml/auth");
const authHtmlDir = join(fixturesRoot, "html/auth");

type ManifestRow = {
  id: string;
  file: string;
  otp: string | null;
  url: string | null;
};

const manifest = JSON.parse(
  readFileSync(join(authEmlDir, "manifest.json"), "utf8"),
) as ManifestRow[];

describe("auth fixtures (signup/2FA)", () => {
  it("manifest lists every .eml on disk (≥20)", () => {
    const onDisk = readdirSync(authEmlDir)
      .filter((name) => name.endsWith(".eml"))
      .sort();
    const listed = manifest.map((row) => row.file).sort();
    expect(manifest.length).toBeGreaterThanOrEqual(20);
    expect(listed).toEqual(onDisk);
  });

  for (const row of manifest) {
    it(`${row.id}: extractAuthSignals → otp=${row.otp} url=${row.url}`, async () => {
      const raw = readFileSync(join(authEmlDir, row.file), "utf8");
      const email = await PostalMime.parse(raw);
      const result = extractAuthSignals({
        subject: email.subject ?? null,
        text: email.text ?? null,
        html: email.html ?? null,
      });
      expect(result.extractedOtp).toBe(row.otp);
      expect(result.verificationUrl).toBe(row.url);
    });

    it(`${row.id}: ingestRawMime exposes extractedOtp + verificationUrl`, async () => {
      const raw = readFileSync(join(authEmlDir, row.file), "utf8");
      const ingested = await ingestRawMime(raw);
      expect(ingested.extractedOtp).toBe(row.otp);
      expect(ingested.verificationUrl).toBe(row.url);
    });
  }
});

describe("auth HTML fragment fixtures", () => {
  const htmlFiles = readdirSync(authHtmlDir)
    .filter((name) => name.endsWith(".html"))
    .sort();

  it("each html/auth fragment has a matching manifest row", () => {
    for (const file of htmlFiles) {
      const id = file.replace(/\.html$/, "");
      expect(
        manifest.some((row) => row.id === id),
        `missing manifest row for ${file}`,
      ).toBe(true);
    }
  });

  for (const file of htmlFiles) {
    const id = file.replace(/\.html$/, "");
    const row = manifest.find((entry) => entry.id === id);
    if (!row) continue;

    it(`${id}: extractAuthSignals(html) → otp=${row.otp} url=${row.url}`, () => {
      const html = readFileSync(join(authHtmlDir, file), "utf8");
      const result = extractAuthSignals({ html });
      expect(result.extractedOtp).toBe(row.otp);
      expect(result.verificationUrl).toBe(row.url);
    });
  }
});
