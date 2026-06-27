export interface TMEntry {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  translatedText: string;
  sourceHash: string;
  namespace?: string;
}

export interface TMMatch {
  entry: TMEntry;
  score: number; // 0..1
}

export interface FuzzyOptions {
  threshold: number; // 0..1
  limit?: number;
  strategy: "lexical" | "semantic" | "both" | "off";
}

export interface TranslationMemory {
  lookupExact(sourceText: string, sourceLang: string, targetLang: string, namespace?: string): Promise<TMEntry | null>;
  lookupFuzzy(sourceText: string, sourceLang: string, targetLang: string, opts: FuzzyOptions, namespace?: string): Promise<TMMatch[]>;
  upsert(entry: TMEntry): Promise<void>;
  invalidate(filter: { sourceLang?: string; targetLang?: string; namespace?: string }): Promise<void>;
  /** Release any underlying resources (e.g. close the DB handle). Optional. */
  close?(): void;
}
