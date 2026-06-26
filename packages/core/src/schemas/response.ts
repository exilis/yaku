import { z } from "zod";

export const CostSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    usd: z.number().nonnegative().optional(),
  })
  .strict();

export const SegmentResultSchema = z
  .object({
    id: z.string(),
    translatedText: z.string(),
    status: z.enum(["translated", "reused", "unchanged", "skipped", "failed"]),
    sourceHash: z.string(),
    tmMatch: z
      .object({ type: z.enum(["exact", "fuzzy"]), score: z.number().min(0).max(1) })
      .strict()
      .optional(),
    confidence: z.number().min(0).max(1).optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  })
  .strict();

const SummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    translated: z.number().int().nonnegative(),
    reused: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    iterationsTotal: z.number().int().nonnegative(),
    cost: CostSchema,
    budgetHit: z.boolean().optional(),
  })
  .strict();

export const LanguageResultSchema = z
  .object({
    targetLang: z.string(),
    status: z.enum(["ok", "partial", "failed"]),
    segments: z.array(SegmentResultSchema),
    summary: SummarySchema,
  })
  .strict();

export const TranslationResponseSchema = z
  .object({
    status: z.enum(["ok", "partial", "failed"]),
    sourceLang: z.string(),
    results: z.array(LanguageResultSchema),
    summary: SummarySchema,
    // TODO(trace): replace z.unknown() with DocumentTraceSchema once the trace module lands
    trace: z.unknown().optional(),
  })
  .strict();

export type Cost = z.infer<typeof CostSchema>;
export type SegmentResult = z.infer<typeof SegmentResultSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type LanguageResult = z.infer<typeof LanguageResultSchema>;
export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;
