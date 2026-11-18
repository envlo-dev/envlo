/**
 * Compact pre-translated override phrases across ~25 languages.
 * Matched case-insensitively after NFKC normalization.
 *
 * Families covered:
 * - ignore previous / prior instructions
 * - disregard prior rules
 * - new system prompt
 */

const EN = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "ignore prior instructions",
  "disregard previous instructions",
  "disregard prior rules",
  "disregard all prior rules",
  "new system prompt",
  "override system prompt",
  "forget your instructions",
  "ignore your system prompt",
];

const ES = [
  "ignora las instrucciones anteriores",
  "ignore las instrucciones anteriores",
  "ignorar las instrucciones previas",
  "no tengas en cuenta las reglas anteriores",
  "descarta las reglas previas",
  "nuevo prompt del sistema",
  "nuevo mensaje del sistema",
];

const FR = [
  "ignorez les instructions précédentes",
  "ignorer les instructions précédentes",
  "ne tenez pas compte des règles précédentes",
  "nouveau prompt système",
  "nouveau message système",
];

const DE = [
  "ignoriere vorherige anweisungen",
  "vorherige anweisungen ignorieren",
  "vorherige regeln missachten",
  "neuer systemprompt",
  "neue systemanweisung",
];

const IT = [
  "ignora le istruzioni precedenti",
  "ignora le regole precedenti",
  "non considerare le regole precedenti",
  "nuovo prompt di sistema",
];

const PT = [
  "ignore as instruções anteriores",
  "ignorar as instruções anteriores",
  "desconsidere as regras anteriores",
  "novo prompt do sistema",
];

const NL = [
  "negeer vorige instructies",
  "negeer eerdere instructies",
  "negeer eerdere regels",
  "nieuwe systeemprompt",
];

const PL = [
  "zignoruj poprzednie instrukcje",
  "zignoruj wcześniejsze instrukcje",
  "zignoruj poprzednie reguły",
  "nowy prompt systemowy",
];

const RU = [
  "игнорируй предыдущие инструкции",
  "игнорировать предыдущие инструкции",
  "не учитывай предыдущие правила",
  "новый системный промпт",
];

const UK = [
  "ігноруй попередні інструкції",
  "ігнорувати попередні інструкції",
  "новий системний промпт",
];

const TR = [
  "önceki talimatları yok say",
  "önceki talimatları görmezden gel",
  "önceki kuralları yok say",
  "yeni sistem istemi",
];

const AR = [
  "تجاهل التعليمات السابقة",
  "تجاهل القواعد السابقة",
  "موجه نظام جديد",
];

const HE = ["התעלם מההוראות הקודמות", "התעלם מהכללים הקודמים", "פרומפט מערכת חדש"];

const HI = [
  "पिछले निर्देशों को अनदेखा करें",
  "पूर्व निर्देशों को नजरअंदाज करें",
  "नया सिस्टम प्रॉम्प्ट",
];

const BN = ["আগের নির্দেশাবলী উপেক্ষা করুন", "পূর্ববর্তী নিয়ম উপেক্ষা করুন"];

const ID = [
  "abaikan instruksi sebelumnya",
  "abaikan aturan sebelumnya",
  "prompt sistem baru",
];

const VI = [
  "bỏ qua các hướng dẫn trước",
  "bỏ qua các quy tắc trước",
  "prompt hệ thống mới",
];

const TH = ["เพิกเฉยคำสั่งก่อนหน้า", "ละเว้นกฎก่อนหน้า", "พรอมต์ระบบใหม่"];

const ZH = [
  "忽略之前的指令",
  "忽略以前的指示",
  "无视之前的规则",
  "忽略先前的规则",
  "新的系统提示",
  "新系统提示词",
];

const JA = [
  "以前の指示を無視",
  "前の指示を無視",
  "これまでの指示を無視",
  "以前のルールを無視",
  "前のルールを無視してください",
  "新しいシステムプロンプト",
  "システムプロンプトを上書き",
];

const KO = [
  "이전 지침을 무시",
  "이전 지시사항을 무시",
  "이전 규칙을 무시",
  "새로운 시스템 프롬프트",
];

const SV = [
  "ignorera tidigare instruktioner",
  "bortse från tidigare regler",
  "ny systemprompt",
];

const DA = [
  "ignorer tidligere instruktioner",
  "se bort fra tidligere regler",
  "ny systemprompt",
];

const FI = [
  "ohita aiemmat ohjeet",
  "älä huomioi aiempia sääntöjä",
  "uusi järjestelmäkehote",
];

const NO = [
  "ignorer tidligere instruksjoner",
  "se bort fra tidligere regler",
  "ny systemprompt",
];

const CS = [
  "ignoruj předchozí pokyny",
  "ignoruj předchozí pravidla",
  "nový systémový prompt",
];

const RO = [
  "ignoră instrucțiunile anterioare",
  "ignoră regulile anterioare",
  "noul prompt de sistem",
];

const HU = [
  "hagyd figyelmen kívül a korábbi utasításokat",
  "hagyd figyelmen kívül a korábbi szabályokat",
  "új rendszerprompt",
];

/** All override phrases, lowercased once at module load. */
export const OVERRIDE_PHRASES: readonly string[] = Object.freeze(
  [
    ...EN,
    ...ES,
    ...FR,
    ...DE,
    ...IT,
    ...PT,
    ...NL,
    ...PL,
    ...RU,
    ...UK,
    ...TR,
    ...AR,
    ...HE,
    ...HI,
    ...BN,
    ...ID,
    ...VI,
    ...TH,
    ...ZH,
    ...JA,
    ...KO,
    ...SV,
    ...DA,
    ...FI,
    ...NO,
    ...CS,
    ...RO,
    ...HU,
  ].map((p) => p.toLowerCase()),
);

export function findOverridePhraseMatches(
  normalizedText: string,
): Array<{ code: string; detail: string }> {
  const haystack = normalizedText.toLowerCase();
  const hits: Array<{ code: string; detail: string }> = [];
  for (const phrase of OVERRIDE_PHRASES) {
    if (haystack.includes(phrase)) {
      hits.push({
        code: "phrase.override",
        detail: `Matched instruction-override phrase: "${phrase}"`,
      });
      // One hit is enough to establish the family; keep scanning lightly capped.
      if (hits.length >= 5) break;
    }
  }
  return hits;
}
