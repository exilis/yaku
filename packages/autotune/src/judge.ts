import { z } from "zod";
import type { LLMProvider } from "@yaku/core";

export const JudgeSchema = z
  .object({
    score: z.number().min(0).max(100),
    dims: z.object({
      adequacy: z.number().min(0).max(100),
      fluency: z.number().min(0).max(100),
      terminology: z.number().min(0).max(100),
      tone: z.number().min(0).max(100),
    }),
    critique: z.string(),
  })
  .strict();

export type JudgeVerdict = z.infer<typeof JudgeSchema>;

export interface JudgeInput {
  source: string;
  target: string;
  lang: string;
  id: string;
}

export interface JudgeDeps {
  provider: LLMProvider;
  model: string;
}

export function buildJudgePrompt(input: JudgeInput): string {
  return [
    `You are a strict professional translation quality judge for target language ${input.lang}.`,
    `Rate the TARGET as a translation of the SOURCE on a 0-100 scale for overall quality,`,
    `plus four sub-dimensions: adequacy (meaning preserved), fluency (natural target language),`,
    `terminology (correct domain/brand terms), tone (register matches source).`,
    `Return JSON: {"score": 0..100, "dims": {"adequacy":0..100,"fluency":0..100,"terminology":0..100,"tone":0..100}, "critique": "specific, actionable; empty if excellent"}.`,
    ``,
    `SOURCE: ${input.source}`,
    `TARGET: ${input.target}`,
  ].join("\n");
}

/** Score one source/target pair. The judge model is fixed by the caller. */
export async function scoreTranslation(input: JudgeInput, deps: JudgeDeps): Promise<JudgeVerdict> {
  const res = await deps.provider.complete({
    role: "reviewer",
    system: "You are a strict translation quality judge.",
    prompt: buildJudgePrompt(input),
    schema: JudgeSchema,
    model: deps.model,
    temperature: 0,
  });
  return res.value;
}

export interface QualityAggregate {
  quality: number;     // mean
  qualityMin: number;  // worst
  critiques: string[]; // non-empty critiques only
}

export function aggregateQuality(verdicts: JudgeVerdict[]): QualityAggregate {
  if (verdicts.length === 0) return { quality: 0, qualityMin: 0, critiques: [] };
  const scores = verdicts.map((v) => v.score);
  const sum = scores.reduce((a, b) => a + b, 0);
  return {
    quality: sum / verdicts.length,
    qualityMin: Math.min(...scores),
    critiques: verdicts.map((v) => v.critique).filter((c) => c.trim().length > 0),
  };
}
