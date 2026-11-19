import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ingestRawMime } from "../../src/parser/ingest-raw-mime.js";

const emlDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/eml");

function loadEml(name: string): string {
  return readFileSync(join(emlDir, name), "utf8");
}

type EmlCase = {
  file: string;
  label: string;
  mustInclude: string[];
  mustIncludeUrl?: string;
};

const ESP_EMLS: EmlCase[] = [
  {
    file: "esp-sendgrid-receipt.eml",
    label: "SendGrid receipt .eml",
    mustInclude: ["SG-77821", "$86.40", "View receipt"],
    mustIncludeUrl: "https://orders.northwind.example/SG-77821",
  },
  {
    file: "esp-postmark-shipping.eml",
    label: "Postmark shipping .eml",
    mustInclude: ["PM-55109", "9400111899223344556677", "Track shipment"],
    mustIncludeUrl: "https://app.shop.example/orders/PM-55109",
  },
  {
    file: "esp-hubspot-welcome.eml",
    label: "HubSpot welcome .eml",
    mustInclude: ["WS-90441", "Activate workspace", "Riley"],
    mustIncludeUrl: "https://app.contoso.example/activate/WS-90441",
  },
  {
    file: "esp-ses-notification.eml",
    label: "SES bounce .eml",
    mustInclude: ["ses-0102030405060708090a0b", "Bounce notification", "gone@invalid.example"],
    mustIncludeUrl: "https://console.aws.amazon.com/ses/home?region=us-east-1#/reputation",
  },
];

describe("ESP multipart .eml ingest", () => {
  for (const sample of ESP_EMLS) {
    it(`${sample.label}: flattens, compresses ≥75%, keeps fields/links`, async () => {
      const ingested = await ingestRawMime(loadEml(sample.file));
      expect(ingested.html).toBeTruthy();
      expect(ingested.safeMarkdown).toBeTruthy();
      expect(ingested.layoutTablesFlattened).toBeGreaterThanOrEqual(1);
      expect(ingested.markdownCompressionRatio).not.toBeNull();
      expect(ingested.markdownCompressionRatio!).toBeGreaterThanOrEqual(0.75);
      expect(ingested.safeMarkdown!).not.toMatch(/^\| ---/m);

      for (const needle of sample.mustInclude) {
        expect(ingested.safeMarkdown, `missing “${needle}”`).toContain(needle);
      }
      if (sample.mustIncludeUrl) {
        expect(ingested.safeMarkdown).toContain(sample.mustIncludeUrl);
      }
    });
  }
});
