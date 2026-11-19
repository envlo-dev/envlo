import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { htmlToAgentMarkdown } from "../../src/markdown/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/html");

function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

type ProviderCase = {
  file: string;
  label: string;
  mustInclude: string[];
  mustIncludeUrl?: string;
  minLayoutTables?: number;
};

const PROVIDERS: ProviderCase[] = [
  {
    file: "esp-sendgrid-receipt.html",
    label: "SendGrid-style receipt",
    mustInclude: ["SG-77821", "$86.40", "Canvas Tote", "View receipt", "Jordan Lee"],
    mustIncludeUrl: "https://orders.northwind.example/SG-77821",
    minLayoutTables: 3,
  },
  {
    file: "esp-postmark-shipping.html",
    label: "Postmark-style shipping",
    mustInclude: ["PM-55109", "9400111899223344556677", "Desk Lamp", "Track shipment"],
    mustIncludeUrl: "https://app.shop.example/orders/PM-55109",
    minLayoutTables: 2,
  },
  {
    file: "esp-hubspot-welcome.html",
    label: "HubSpot-style welcome",
    mustInclude: ["WS-90441", "Welcome aboard, Riley", "Activate workspace", "Growth"],
    mustIncludeUrl: "https://app.contoso.example/activate/WS-90441",
    minLayoutTables: 2,
  },
  {
    file: "esp-ses-notification.html",
    label: "SES-style bounce notification",
    mustInclude: [
      "ses-0102030405060708090a0b",
      "gone@invalid.example",
      "Bounce notification",
      "alerts@ops.envlo.example",
    ],
    mustIncludeUrl: "https://console.aws.amazon.com/ses/home?region=us-east-1#/reputation",
    minLayoutTables: 2,
  },
  {
    file: "transactional-layout-heavy.html",
    label: "generic ESP layout",
    mustInclude: ["A-10422", "1Z999AA10123456784", "Trail Bottle", "View order"],
    mustIncludeUrl: "https://shop.example.com/orders/A-10422",
    minLayoutTables: 3,
  },
];

describe("ESP provider HTML → agent Markdown", () => {
  for (const provider of PROVIDERS) {
    it(`${provider.label}: compresses ≥75% and keeps key fields/links`, () => {
      const html = load(provider.file);
      const result = htmlToAgentMarkdown(html);

      expect(result.sanitizeTimedOut).toBe(false);
      expect(result.markdown.length).toBeGreaterThan(40);
      expect(result.compressionRatio).toBeGreaterThanOrEqual(0.75);
      expect(result.layoutTablesFlattened).toBeGreaterThanOrEqual(provider.minLayoutTables ?? 1);
      expect(result.markdown).not.toMatch(/^\| ---/m);

      for (const needle of provider.mustInclude) {
        expect(result.markdown, `missing “${needle}”`).toContain(needle);
      }
      if (provider.mustIncludeUrl) {
        expect(result.markdown).toContain(provider.mustIncludeUrl);
      }

      // Flattened agent Markdown should beat naive GFM pipe dumps.
      expect(result.markdown.length).toBeLessThan(result.naiveMarkdown.length);
    });
  }
});
