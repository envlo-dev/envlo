import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  plainTextToAgentMarkdown,
  stripQuotedReply,
} from "../../src/markdown/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/text");

function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

type ReplyCase = {
  file: string;
  label: string;
  keep: string;
  drop: string[];
};

const REPLIES: ReplyCase[] = [
  {
    file: "reply-outlook-original-message.txt",
    label: "Outlook -----Original Message-----",
    keep: "fixes the invoice amount",
    drop: ["confirm the invoice amount", "-----Original Message-----"],
  },
  {
    file: "reply-gmail-on-wrote.txt",
    label: "Gmail On … wrote:",
    keep: "Sounds good — ship it",
    drop: ["ship-by date", "Order G-2201", "Alex Buyer"],
  },
  {
    file: "reply-apple-mail.txt",
    label: "Apple Mail On … wrote + iPhone sig",
    keep: "Approved on my end",
    drop: ["Please approve PO-441", "Sent from my iPhone"],
  },
  {
    file: "reply-de-am-schrieb.txt",
    label: "German Am … schrieb:",
    keep: "Alles klar, danke",
    drop: ["Rechnungsbetrag", "Mia Kunde"],
  },
  {
    file: "reply-fr-a-ecrit.txt",
    label: "French a écrit :",
    keep: "Parfait, merci",
    drop: ["montant de la facture", "Camille Client"],
  },
  {
    file: "reply-es-escribio.txt",
    label: "Spanish escribió:",
    keep: "De acuerdo, gracias",
    drop: ["importe de la factura", "Luis Cliente"],
  },
  {
    file: "reply-ja-date-attribution.txt",
    label: "Japanese 年月日 attribution",
    keep: "了解しました",
    drop: ["請求額", "JA-100", "山田太郎", "2026年11月10日"],
  },
  {
    file: "reply-ko-date-attribution.txt",
    label: "Korean 년월일 attribution",
    keep: "확인했습니다",
    drop: ["청구 금액", "김민수", "2026년 11월 10일"],
  },
  {
    file: "reply-pt-escreveu.txt",
    label: "Portuguese escreveu:",
    keep: "Ok, obrigado",
    drop: ["valor da fatura", "Ana Cliente"],
  },
  {
    file: "reply-it-ha-scritto.txt",
    label: "Italian ha scritto:",
    keep: "Va bene, grazie",
    drop: ["importo della fattura", "Luca Cliente"],
  },
  {
    file: "reply-nl-schreef.txt",
    label: "Dutch schreef:",
    keep: "Ok, bedankt",
    drop: ["bedrag bevestigen", "Jan Klant"],
  },
];


describe("stripQuotedReply locales / clients", () => {
  for (const sample of REPLIES) {
    it(`${sample.label}: strips quote + signature by default`, () => {
      const text = load(sample.file);
      const result = stripQuotedReply(text);

      expect(result.text).toContain(sample.keep);
      for (const needle of sample.drop) {
        expect(result.text, `still contains “${needle}”`).not.toContain(needle);
      }
      expect(result.quotesStripped || result.signatureStripped).toBe(true);
    });

    it(`${sample.label}: can retain history when opted in`, () => {
      const text = load(sample.file);
      const result = stripQuotedReply(text, {
        includeQuotedHistory: true,
        includeSignatures: true,
      });
      expect(result.text).toContain(sample.keep);
      // At least one dropped phrase should reappear when keeping history.
      expect(sample.drop.some((needle) => result.text.includes(needle))).toBe(true);
    });
  }

  it("plainTextToAgentMarkdown compresses threaded replies", () => {
    const text = load("reply-gmail-on-wrote.txt");
    const result = plainTextToAgentMarkdown(text);
    expect(result.markdown).toContain("Sounds good");
    expect(result.compressionRatio).toBeGreaterThan(0.2);
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore);
  });
});
