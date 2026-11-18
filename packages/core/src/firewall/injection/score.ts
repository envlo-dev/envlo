import { findOverridePhraseMatches } from "./dictionary.js";
import { inspectEncodedBlocks } from "./encoded-blocks.js";
import { hasMixedScriptConfusables } from "./confusables.js";
import { findProximityBonus, findStructuralOverrideMatches } from "./patterns.js";
import { preprocessForInjectionScan } from "./preprocess.js";
import { findTokenMatches, TOOL_CALL_PATTERNS } from "./tokens.js";
import type {
  InjectionRisk,
  InjectionScore,
  InjectionScoreReason,
  ScoreInjectionOptions,
} from "./types.js";
import {
  DEFAULT_SCORE_MAX_INPUT_CHARS,
  SCORE_THRESHOLD_HIGH,
  SCORE_THRESHOLD_MEDIUM,
  WEIGHTS,
} from "./types.js";

const RISK_RANK: Record<InjectionRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function maxInjectionRisk(a: InjectionRisk, b: InjectionRisk): InjectionRisk {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

export function riskFromPoints(points: number): InjectionRisk {
  if (points >= SCORE_THRESHOLD_HIGH) return "high";
  if (points >= SCORE_THRESHOLD_MEDIUM) return "medium";
  return "low";
}

function isToolCallCode(code: string): boolean {
  return TOOL_CALL_PATTERNS.some((p) => p.code === code);
}

function addUniqueReason(reasons: InjectionScoreReason[], reason: InjectionScoreReason): void {
  if (reasons.some((r) => r.code === reason.code && r.detail === reason.detail)) return;
  reasons.push(reason);
}

function scanTextSignals(
  text: string,
  reasons: InjectionScoreReason[],
  codePrefix = "",
): number {
  let points = 0;

  for (const hit of findOverridePhraseMatches(text)) {
    const code = codePrefix ? `${codePrefix}${hit.code}` : hit.code;
    addUniqueReason(reasons, { code, detail: hit.detail, weight: WEIGHTS.exactPhrase });
    points += WEIGHTS.exactPhrase;
  }

  for (const hit of findStructuralOverrideMatches(text)) {
    const code = codePrefix ? `${codePrefix}${hit.code}` : hit.code;
    addUniqueReason(reasons, { code, detail: hit.detail, weight: hit.weight });
    points += hit.weight;
  }

  for (const hit of findTokenMatches(text)) {
    const weight = isToolCallCode(hit.code) ? WEIGHTS.toolCall : WEIGHTS.chatToken;
    const code = codePrefix ? `${codePrefix}${hit.code}` : hit.code;
    addUniqueReason(reasons, { code, detail: hit.detail, weight });
    points += weight;
  }

  const proximity = findProximityBonus(text);
  if (proximity) {
    const code = codePrefix ? `${codePrefix}${proximity.code}` : proximity.code;
    addUniqueReason(reasons, {
      code,
      detail: proximity.detail,
      weight: proximity.weight,
    });
    points += proximity.weight;
  }

  return points;
}

function heuristicScore(
  rawNormalized: string,
  folded: string,
  options: ScoreInjectionOptions,
): InjectionScore {
  const reasons: InjectionScoreReason[] = [];
  let points = 0;

  points += scanTextSignals(rawNormalized, reasons);

  const homoglyphSuspected =
    hasMixedScriptConfusables(rawNormalized) || folded !== rawNormalized;
  if (hasMixedScriptConfusables(rawNormalized)) {
    addUniqueReason(reasons, {
      code: "homoglyph.mixed_script",
      detail: "Mixed Latin / lookalike-script characters detected",
      weight: WEIGHTS.homoglyph,
    });
    points += WEIGHTS.homoglyph;
  }

  // Second pass on confusable-folded text (catches spoofed phrases).
  if (folded !== rawNormalized) {
    points += scanTextSignals(folded, reasons, "folded.");
  }

  const { hits: encodedHits, inspected } = inspectEncodedBlocks(rawNormalized);
  for (const hit of encodedHits) {
    const weight = hit.highSignal ? WEIGHTS.encodedHigh : WEIGHTS.encodedMedium;
    addUniqueReason(reasons, { code: hit.code, detail: hit.detail, weight });
    points += weight;
  }

  if (options.senderAuthStatus === "fail") {
    addUniqueReason(reasons, {
      code: "auth.fail",
      detail: "Sender authentication failed — raised injection floor",
      weight: WEIGHTS.authFail,
    });
    points += WEIGHTS.authFail;
  } else if (options.senderAuthStatus === "unverified") {
    addUniqueReason(reasons, {
      code: "auth.unverified",
      detail: "Sender authentication unverified — slight injection floor raise",
      weight: WEIGHTS.authUnverified,
    });
    points += WEIGHTS.authUnverified;
  }

  return {
    risk: riskFromPoints(points),
    points,
    reasons,
    normalizedText: rawNormalized,
    foldedText: folded,
    homoglyphSuspected,
    decodedBlocksInspected: inspected,
  };
}

/**
 * Deterministic multilingual visible prompt-injection scorer with weighted
 * signals (exact phrases, structural paraphrases, tokens, encodings, confusables).
 * Optional `customClassifier` may only raise risk (never lower it).
 */
export async function scoreInjectionRisk(
  text: string,
  options: ScoreInjectionOptions = {},
): Promise<InjectionScore> {
  const maxInputChars = options.maxInputChars ?? DEFAULT_SCORE_MAX_INPUT_CHARS;
  const capped = text.length > maxInputChars ? text.slice(0, maxInputChars) : text;
  const { text: normalizedText, folded } = preprocessForInjectionScan(capped);
  const heuristic = heuristicScore(normalizedText, folded, options);

  if (!options.customClassifier) return heuristic;

  const custom = await options.customClassifier(normalizedText, heuristic);
  if (!custom) return heuristic;

  const risk = maxInjectionRisk(heuristic.risk, custom);
  if (risk === heuristic.risk) return heuristic;

  return {
    ...heuristic,
    risk,
    reasons: [
      ...heuristic.reasons,
      {
        code: "custom.classifier",
        detail: `customClassifier raised risk to ${custom}`,
      },
    ],
  };
}

/** Sync heuristic-only path (no custom classifier). */
export function scoreInjectionRiskSync(
  text: string,
  options: ScoreInjectionOptions = {},
): InjectionScore {
  const maxInputChars = options.maxInputChars ?? DEFAULT_SCORE_MAX_INPUT_CHARS;
  const capped = text.length > maxInputChars ? text.slice(0, maxInputChars) : text;
  const { text: normalizedText, folded } = preprocessForInjectionScan(capped);
  return heuristicScore(normalizedText, folded, options);
}
