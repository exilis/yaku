import { z } from "zod";
import { SegmentSchema, GlossaryEntrySchema } from "./segment.js";
import { TranslationConfigSchema } from "./config.js";

const DocumentSchema = z
  .object({
    id: z.string().optional(),
    segments: z
      .array(SegmentSchema)
      .min(1)
      .refine(
        (segs) => new Set(segs.map((s) => s.id)).size === segs.length,
        { message: "segment ids must be unique" }
      ),
    context: z.string().optional(),
  })
  .strict();

export const TranslationRequestSchema = z
  .object({
    sourceLang: z.string().min(1),
    targetLangs: z.array(z.string().min(1)).min(1),
    document: DocumentSchema,
    glossary: z.array(GlossaryEntrySchema).optional(),
    config: TranslationConfigSchema.partial().optional(),
  })
  .strict();

export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
export type Document = z.infer<typeof DocumentSchema>;
