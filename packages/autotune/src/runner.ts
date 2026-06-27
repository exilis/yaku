import { translate } from "@yaku/core";
import type { LLMProvider, TranslationMemory, PromptTemplates } from "@yaku/core";
import type { Candidate, CandidateResult, Pricing } from "./types.js";
import type { GoldRecord } from "./gold.js";
import { scoreTranslation, aggregateQuality, type JudgeVerdict } from "./judge.js";
import { estimateUsd, DEFAULT_PRICING } from "./pricing.js";

export interface RunnerDeps {
  provider: LLMProvider;
  tm: TranslationMemory;
  judgeModel: string;
  /** Model id used to price the run's tokens (the candidate's translator model). */
  translatorModelForPricing: string;
  pricing?: Pricing;
  /** If more than this fraction of judge calls fail, the candidate is unscoreable. */
  maxJudgeFailFraction?: number;
}

/** Build a TranslationConfig from a candidate, forcing TM OFF (anti-gaming). */
function buildConfig(candidate: Candidate): Record<string, unknown> {
  return {
    ...candidate.config,
    tm: { enabled: false },
    trace: "none",
    promptTemplates: candidate.promptTemplates as PromptTemplates | undefined,
  };
}

export async function runCandidate(
  candidate: Candidate,
  records: GoldRecord[],
  deps: RunnerDeps
): Promise<CandidateResult> {
  const pricing = deps.pricing ?? DEFAULT_PRICING;
  const maxFail = deps.maxJudgeFailFraction ?? 0.5;

  let inputTokens = 0;
  let outputTokens = 0;
  let gatePass = 0;
  let gateTotal = 0;
  let judgeAttempts = 0;
  let judgeFailures = 0;
  let firstJudgeError: string | undefined;
  const verdicts: JudgeVerdict[] = [];

  for (const record of records) {
    const req = { ...record, config: buildConfig(candidate) };
    const sourceById = new Map(record.document.segments.map((s) => [s.id, s.text]));
    const res = await translate(req, { provider: deps.provider, tm: deps.tm });

    for (const lr of res.results) {
      inputTokens += lr.summary.cost.inputTokens;
      outputTokens += lr.summary.cost.outputTokens;

      for (const seg of lr.segments) {
        if (seg.status === "skipped") continue;

        if (seg.status === "failed" || !seg.translatedText) {
          // a hard translation failure is a gate failure (not a pass) and a zero-quality verdict
          gateTotal++;
          verdicts.push({ score: 0, dims: { adequacy: 0, fluency: 0, terminology: 0, tone: 0 }, critique: "segment failed to translate" });
          continue;
        }

        gateTotal++;
        if (!seg.warnings || seg.warnings.length === 0) gatePass++;

        judgeAttempts++;
        try {
          const v = await scoreTranslation(
            { source: sourceById.get(seg.id) ?? "", target: seg.translatedText, lang: lr.targetLang, id: seg.id },
            { provider: deps.provider, model: deps.judgeModel }
          );
          verdicts.push(v);
        } catch (err) {
          judgeFailures++;
          firstJudgeError ??= String(err);
        }
      }
    }
  }

  const unscoreable =
    judgeAttempts > 0 && judgeFailures / judgeAttempts > maxFail;

  const agg = aggregateQuality(verdicts);
  const estUsd = estimateUsd(deps.translatorModelForPricing, inputTokens, outputTokens, pricing);

  return {
    quality: unscoreable ? 0 : agg.quality,
    qualityMin: unscoreable ? 0 : agg.qualityMin,
    estUsd,
    gatePassRate: gateTotal === 0 ? 1 : gatePass / gateTotal,
    inputTokens,
    outputTokens,
    scored: verdicts.length,
    unscoreable,
    critiques: agg.critiques,
    firstJudgeError: unscoreable ? firstJudgeError : undefined,
  };
}
