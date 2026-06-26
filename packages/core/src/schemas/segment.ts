import { z } from "zod";

export const SegmentMetadataSchema = z
  .object({
    role: z.string().optional(),
    group: z.string().optional(),
    order: z.number().int().optional(),
    maxChars: z.number().int().positive().optional(),
    doNotTranslate: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const SegmentSchema = z
  .object({
    id: z.string().min(1),
    // Empty string is intentionally allowed: a caller's DB field may
    // legitimately be empty, so do not constrain with .min(1).
    text: z.string(),
    metadata: SegmentMetadataSchema.optional(),
  })
  .strict();

export const GlossaryEntrySchema = z
  .object({
    source: z.string().min(1),
    target: z.string().optional(),
    caseSensitive: z.boolean().optional(),
    lang: z.string().optional(),
  })
  .strict()
  .refine((e) => e.lang === undefined || e.target !== undefined, {
    message: "lang can only be set when target is provided (lang scopes a forced mapping)",
  });

export type Segment = z.infer<typeof SegmentSchema>;
export type SegmentMetadata = z.infer<typeof SegmentMetadataSchema>;
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
