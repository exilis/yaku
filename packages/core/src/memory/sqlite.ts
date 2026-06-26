import Database from "better-sqlite3";
import type { TranslationMemory, TMEntry, TMMatch, FuzzyOptions } from "./types.js";
import { trigramSimilarity } from "./fuzzy.js";

// Sentinel for the "no namespace" bucket. Uses a NUL prefix so it can never
// collide with a user-supplied namespace string.
const GLOBAL_NS = "\u0000global";
const NS = (ns?: string) => ns ?? GLOBAL_NS;

export class SqliteTranslationMemory implements TranslationMemory {
  private db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tm (
        namespace TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        PRIMARY KEY (namespace, source_lang, target_lang, source_text)
      );
    `);
  }

  async lookupExact(sourceText: string, sourceLang: string, targetLang: string, namespace?: string): Promise<TMEntry | null> {
    const row = this.db
      .prepare(`SELECT * FROM tm WHERE namespace=? AND source_lang=? AND target_lang=? AND source_text=?`)
      .get(NS(namespace), sourceLang, targetLang, sourceText) as any;
    return row ? rowToEntry(row) : null;
  }

  async lookupFuzzy(sourceText: string, sourceLang: string, targetLang: string, opts: FuzzyOptions, namespace?: string): Promise<TMMatch[]> {
    if (opts.strategy === "off" || opts.strategy === "semantic") return [];
    // v1: loads candidate rows for (namespace, langs) and ranks in JS. O(rows) per query; acceptable for moderate TM sizes, revisit with an index/ANN for scale.
    const rows = this.db
      .prepare(`SELECT * FROM tm WHERE namespace=? AND source_lang=? AND target_lang=?`)
      .all(NS(namespace), sourceLang, targetLang) as any[];
    const matches: TMMatch[] = [];
    for (const row of rows) {
      const score = trigramSimilarity(sourceText, row.source_text);
      if (score >= opts.threshold) matches.push({ entry: rowToEntry(row), score });
    }
    matches.sort((a, b) => b.score - a.score);
    return opts.limit ? matches.slice(0, opts.limit) : matches;
  }

  async upsert(entry: TMEntry): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO tm (namespace, source_lang, target_lang, source_text, translated_text, source_hash)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(namespace, source_lang, target_lang, source_text)
        DO UPDATE SET translated_text=excluded.translated_text, source_hash=excluded.source_hash
      `)
      .run(NS(entry.namespace), entry.sourceLang, entry.targetLang, entry.sourceText, entry.translatedText, entry.sourceHash);
  }

  async invalidate(filter: { sourceLang?: string; targetLang?: string; namespace?: string }): Promise<void> {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.namespace !== undefined) { clauses.push("namespace=?"); params.push(NS(filter.namespace)); }
    if (filter.sourceLang) { clauses.push("source_lang=?"); params.push(filter.sourceLang); }
    if (filter.targetLang) { clauses.push("target_lang=?"); params.push(filter.targetLang); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    this.db.prepare(`DELETE FROM tm ${where}`).run(...params);
  }

  async exportAll(): Promise<TMEntry[]> {
    const rows = this.db.prepare(`SELECT * FROM tm`).all() as any[];
    return rows.map((r) => rowToEntry(r));
  }
}

function rowToEntry(row: any): TMEntry {
  return {
    sourceText: row.source_text,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    translatedText: row.translated_text,
    sourceHash: row.source_hash,
    namespace: row.namespace === GLOBAL_NS ? undefined : row.namespace,
  };
}
