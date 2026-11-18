/**
 * Structural override patterns — catch paraphrases the exact dictionary misses.
 * Each hit contributes weight toward the numeric injection score.
 */
export type StructuralHit = {
  code: string;
  detail: string;
  weight: number;
};

const STRUCTURAL_OVERRIDE_PATTERNS: ReadonlyArray<{
  code: string;
  re: RegExp;
  weight: number;
  detail: string;
}> = [
  {
    code: "struct.ignore_instructions",
    re: /\b(ignore|disregard|forget|override|bypass)\b[\s\S]{0,48}\b(previous|prior|above|earlier|all)\b[\s\S]{0,24}\b(instruction|instructions|rule|rules|prompt|policy|policies)\b/i,
    weight: 8,
    detail: "Structural ignore/disregard + instructions/rules pattern",
  },
  {
    code: "struct.new_system_prompt",
    re: /\b(new|updated|replacement)\b[\s\S]{0,24}\b(system\s+prompt|system\s+message|developer\s+message)\b/i,
    weight: 8,
    detail: "Structural new/updated system prompt pattern",
  },
  {
    code: "struct.you_are_now",
    re: /\b(you\s+are\s+now|from\s+now\s+on\s+you|act\s+as|pretend\s+to\s+be)\b[\s\S]{0,40}\b(admin|root|unrestricted|jailbreak|dan)\b/i,
    weight: 6,
    detail: "Structural role-hijack / jailbreak pattern",
  },
  {
    code: "struct.es_ignore",
    re: /\b(ignora|ignore|ignorad|descarta|desconsidere?)\b[\s\S]{0,48}\b(instrucciones?|reglas?|indicaciones?)\b[\s\S]{0,24}\b(anteriores?|previas?)\b/i,
    weight: 8,
    detail: "Spanish structural override pattern",
  },
  {
    code: "struct.fr_ignore",
    re: /\b(ignorez|ignorer)\b[\s\S]{0,48}\b(instructions?|r[eè]gles?)\b[\s\S]{0,24}\b(pr[eé]c[eé]dentes?)\b/i,
    weight: 8,
    detail: "French structural override pattern",
  },
  {
    code: "struct.de_ignore",
    re: /\b(ignoriere?|missachte)\b[\s\S]{0,48}\b(vorherige[n]?|fr[uü]here[n]?)\b[\s\S]{0,24}\b(anweisungen?|regeln?|prompts?)\b/i,
    weight: 8,
    detail: "German structural override pattern",
  },
  {
    code: "struct.ja_ignore",
    re: /(以前|前|これまでの).{0,12}(指示|ルール|命令).{0,12}(無視|忘れ)/u,
    weight: 8,
    detail: "Japanese structural override pattern",
  },
  {
    code: "struct.ja_system",
    re: /(新しい|新規).{0,8}システム(プロンプト|メッセージ)/u,
    weight: 8,
    detail: "Japanese new system prompt pattern",
  },
  {
    code: "struct.zh_ignore",
    re: /(忽略|无视|無視).{0,12}(之前|以前|先前).{0,8}(指令|指示|规则|規則)/u,
    weight: 8,
    detail: "Chinese structural override pattern",
  },
];

export function findStructuralOverrideMatches(text: string): StructuralHit[] {
  const hits: StructuralHit[] = [];
  for (const pattern of STRUCTURAL_OVERRIDE_PATTERNS) {
    pattern.re.lastIndex = 0;
    if (pattern.re.test(text)) {
      hits.push({
        code: pattern.code,
        detail: pattern.detail,
        weight: pattern.weight,
      });
    }
  }
  return hits;
}

/**
 * Bonus when a chat-template marker appears near override language
 * (classic visible injection shape).
 */
export function findProximityBonus(
  text: string,
): StructuralHit | null {
  const template = /(?:SYSTEM\s*:|ADMIN\s+OVERRIDE\s*:|\[INST\]|<\|im_start\|>|Developer\s+Mode)/i.exec(
    text,
  );
  const override =
    /\b(ignore|disregard|forget|override|instrucciones|指示|忽略)\b/i.exec(text);
  if (!template || !override) return null;

  const distance = Math.abs((template.index ?? 0) - (override.index ?? 0));
  if (distance > 240) return null;

  return {
    code: "struct.proximity",
    detail: "Chat-template marker near override language",
    weight: 3,
  };
}
