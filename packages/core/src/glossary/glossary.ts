import type { GlossaryEntry } from "../schemas/index.js";

/** Resolve the glossary entries that apply to a target language:
 *  all global entries (no lang) plus entries scoped to this lang. */
export function resolveGlossary(
  glossary: GlossaryEntry[] | undefined,
  targetLang: string
): GlossaryEntry[] {
  if (!glossary) return [];
  return glossary.filter((e) => e.lang === undefined || e.lang === targetLang);
}
