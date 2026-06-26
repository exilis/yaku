import { z } from "zod";

const ModelRefSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    temperature: z.number().optional(),
  })
  .strict();

// Inner object schemas, defined once so the top-level (defaulting) config and
// the per-language (deeply partial) override config can share field definitions
// without duplicating them.
const ModelsObject = z
  .object({
    translator: ModelRefSchema.optional(),
    reviewer: ModelRefSchema.optional(),
    backTranslator: ModelRefSchema.optional(),
  })
  .strict();

const ReviewerObject = z.object({ enabled: z.boolean().default(true) }).strict();

const BackTranslationObject = z
  .object({
    enabled: z.boolean().default(false),
    driftThreshold: z.number().default(0.15),
  })
  .strict();

const TmObject = z
  .object({
    enabled: z.boolean().default(true),
    fuzzy: z.enum(["lexical", "semantic", "both", "off"]).default("both"),
    fuzzyThreshold: z.number().default(0.85),
    namespace: z.string().optional(),
  })
  .strict();

const BudgetObject = z
  .object({
    maxUsd: z.number().optional(),
    maxIterations: z.number().int().positive().optional(),
    onExceed: z.enum(["best-so-far"]).default("best-so-far"),
  })
  .strict();

const baseShape = {
  maxIterations: z.number().int().positive().default(3),
  reviewer: ReviewerObject.default({}),
  backTranslation: BackTranslationObject.default({}),
  models: ModelsObject.default({}),
  tm: TmObject.default({}),
  budget: BudgetObject.default({}),
  concurrency: z.number().int().positive().default(8),
  trace: z.enum(["none", "summary", "full"]).default("none"),
};

// Per-language overrides are *deeply* partial: every top-level key is optional,
// and the nested object keys use `.partial()` so their inner fields do NOT
// materialize defaults. This is critical — if a per-language override of one
// nested field (e.g. `{ tm: { fuzzy: "off" } }`) carried the full set of nested
// defaults (enabled, fuzzyThreshold, ...), the deep merge in resolveConfig would
// clobber globally-set sibling values. Keeping the override partial means only
// explicitly-set fields participate in the merge.
const PartialConfigSchema = z
  .object({
    maxIterations: baseShape.maxIterations,
    reviewer: ReviewerObject.partial(),
    backTranslation: BackTranslationObject.partial(),
    models: ModelsObject.partial(),
    tm: TmObject.partial(),
    budget: BudgetObject.partial(),
    concurrency: baseShape.concurrency,
    trace: baseShape.trace,
  })
  .partial()
  .strict();

export const TranslationConfigSchema = z
  .object({
    ...baseShape,
    perLanguage: z.record(z.string(), PartialConfigSchema).optional(),
  })
  .strict();

export type TranslationConfig = z.infer<typeof TranslationConfigSchema>;
export type PartialConfig = z.infer<typeof PartialConfigSchema>;

export const DEFAULT_CONFIG: TranslationConfig = TranslationConfigSchema.parse({});

type NestedKey = "tm" | "reviewer" | "backTranslation" | "budget" | "models";
const NESTED_KEYS: NestedKey[] = ["tm", "reviewer", "backTranslation", "budget", "models"];

/**
 * Merge `override` over `base` one level deep for the known nested object keys
 * (tm, reviewer, backTranslation, budget, models): sibling fields of those
 * objects are preserved instead of being clobbered by a shallow replace. Flat
 * keys (maxIterations, concurrency, trace, perLanguage) are plain overrides.
 *
 * `models` sub-objects (translator/reviewer/backTranslator) are themselves
 * nested, so the one-level-deep merge replaces a whole model ref atomically
 * when overridden — which is the intended behavior (a model ref is replaced as
 * a unit, not field-by-field).
 */
function deepMergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base, ...override };
  for (const key of NESTED_KEYS) {
    const b = base[key];
    const o = override[key];
    if (b && o && typeof b === "object" && typeof o === "object") {
      out[key] = { ...(b as object), ...(o as object) };
    }
  }
  return out;
}

/**
 * Resolve effective config. Pass a raw/partial request config to merge over
 * defaults. Pass an already-resolved config + a lang to apply that language's
 * perLanguage override.
 *
 * Nested object keys (tm, reviewer, backTranslation, budget, models) are merged
 * one level deep, so a partial override of one field (e.g. `{ tm: { fuzzy:
 * "off" } }`) preserves the sibling fields rather than clobbering them with
 * schema defaults.
 */
export function resolveConfig(
  input: z.input<typeof TranslationConfigSchema> = {},
  lang?: string
): TranslationConfig {
  const merged = TranslationConfigSchema.parse(
    deepMergeConfig(
      DEFAULT_CONFIG as Record<string, unknown>,
      input as Record<string, unknown>
    )
  );
  if (!lang || !merged.perLanguage?.[lang]) return merged;
  const override = merged.perLanguage[lang];
  return TranslationConfigSchema.parse(
    deepMergeConfig(
      merged as Record<string, unknown>,
      override as Record<string, unknown>
    )
  );
}
