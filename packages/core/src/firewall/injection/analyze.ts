import { buildAgentPromptParts, type AgentPromptParts } from "./prompt.js";
import { scoreInjectionRisk } from "./score.js";
import { spotlightUntrustedEmail } from "./spotlight.js";
import type {
  InjectionScore,
  ScoreInjectionOptions,
  SpotlightMeta,
} from "./types.js";

export type AnalyzeAndSpotlightResult = {
  score: InjectionScore;
  spotlighted: string;
  prompt: AgentPromptParts;
};

/**
 * Score visible text for prompt injection, wrap it in a nonced XML spotlight,
 * and return isolated system/untrusted prompt channels for the agent.
 */
export async function analyzeAndSpotlight(
  body: string,
  meta: Omit<SpotlightMeta, "injectionRisk"> & {
    injectionRisk?: SpotlightMeta["injectionRisk"];
  },
  options: ScoreInjectionOptions = {},
): Promise<AnalyzeAndSpotlightResult> {
  const score = await scoreInjectionRisk(body, options);
  const spotlightMeta: SpotlightMeta = {
    sender: meta.sender ?? null,
    spfDkim: meta.spfDkim ?? null,
    ...(meta.securityHeader !== undefined ? { securityHeader: meta.securityHeader } : {}),
    ...(meta.nonce !== undefined ? { nonce: meta.nonce } : {}),
    injectionRisk: meta.injectionRisk ?? score.risk,
  };
  const spotlighted = spotlightUntrustedEmail(body, spotlightMeta);
  const prompt = buildAgentPromptParts(body, spotlightMeta);
  return { score, spotlighted, prompt };
}
