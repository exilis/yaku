import { z } from "zod";

const ModelRefSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    temperature: z.number().optional(),
  })
  .strict();

const ModelsSchema = z
  .object({
    translator: ModelRefSchema.optional(),
    reviewer: ModelRefSchema.optional(),
    backTranslator: ModelRefSchema.optional(),
  })
  .strict()
  .default({});

const baseShape = {
  maxIterations: z.number().int().positive().default(3),
  reviewer: z.object({ enabled: z.boolean().default(true) }).strict().default({}),
  backTranslation: z
    .object({
      enabled: z.boolean().default(false),
      driftThreshold: z.number().default(0.15),
    })
    .strict()
    .default({}),
  models: ModelsSchema,
  tm: z
    .object({
      enabled: z.boolean().default(true),
      fuzzy: z.enum(["lexical", "semantic", "both", "off"]).default("both"),
      fuzzyThreshold: z.number().default(0.85),
      namespace: z.string().optional(),
    })
    .strict()
    .default({}),
  budget: z
    .object({
      maxUsd: z.number().optional(),
      maxIterations: z.number().int().positive().optional(),
      onExceed: z.enum(["best-so-far"]).default("best-so-far"),
    })
    .strict()
    .default({}),
  concurrency: z.number().int().positive().default(8),
  trace: z.enum(["none", "summary", "full"]).default("none"),
};

// Per-language overrides reuse the same shape but everything optional.
const PartialConfigSchema = z.object(baseShape).partial().strict();

export const TranslationConfigSchema = z
  .object({
    ...baseShape,
    perLanguage: z.record(z.string(), PartialConfigSchema).optional(),
  })
  .strict();

export type TranslationConfig = z.infer<typeof TranslationConfigSchema>;
export type PartialConfig = z.infer<typeof PartialConfigSchema>;

export const DEFAULT_CONFIG: TranslationConfig = TranslationConfigSchema.parse({});

/**
 * Resolve effective config. Pass a raw/partial request config to merge over
 * defaults. Pass an already-resolved config + a lang to apply that language's
 * perLanguage override.
 */
export function resolveConfig(
  input: Partial<TranslationConfig> = {},
  lang?: string
): TranslationConfig {
  const merged = TranslationConfigSchema.parse({ ...DEFAULT_CONFIG, ...input });
  if (!lang || !merged.perLanguage?.[lang]) return merged;
  const override = merged.perLanguage[lang];
  return TranslationConfigSchema.parse({ ...merged, ...override });
}
