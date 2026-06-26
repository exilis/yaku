import { trigramSimilarity } from "../memory/fuzzy.js";

/** Lexical drift proxy (0 = identical, 1 = completely different).
 *  For v1 we use trigram similarity; semantic embeddings can replace this later. */
export function semanticDrift(source: string, backTranslated: string): number {
  return 1 - trigramSimilarity(source, backTranslated);
}
