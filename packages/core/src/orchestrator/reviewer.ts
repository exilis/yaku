import { z } from "zod";

export const ReviewSchema = z
  .object({
    passed: z.boolean(),
    confidence: z.record(z.string(), z.number().min(0).max(1)),
    critique: z.string(),
  })
  .strict();

export type Review = z.infer<typeof ReviewSchema>;

export const TranslationDraftSchema = z
  .object({ translations: z.record(z.string(), z.string()) })
  .strict();
export type TranslationDraft = z.infer<typeof TranslationDraftSchema>;
