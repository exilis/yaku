import type { Pool } from "pg";
import type { TranslationMemory, TMEntry, TMMatch, FuzzyOptions } from "./types.js";
import type { EmbeddingProvider } from "../providers/types.js";
import { trigramSimilarity } from "./fuzzy.js";

const NS = (ns?: string) => ns ?? "__global__";

export interface PostgresTMOptions {
  pool: Pool;
  embeddingProvider?: EmbeddingProvider | null;
  embeddingModel?: string;
}

export class PostgresTranslationMemory implements TranslationMemory {
  constructor(private opts: PostgresTMOptions) {}

  async migrate(): Promise<void> {
    await this.opts.pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS tm (
        namespace TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        embedding vector(1536),
        PRIMARY KEY (namespace, source_lang, target_lang, source_text)
      );
    `);
  }

  async lookupExact(sourceText: string, sourceLang: string, targetLang: string, namespace?: string): Promise<TMEntry | null> {
    const res = await this.opts.pool.query(
      `SELECT * FROM tm WHERE namespace=$1 AND source_lang=$2 AND target_lang=$3 AND source_text=$4`,
      [NS(namespace), sourceLang, targetLang, sourceText]
    );
    return res.rows[0] ? rowToEntry(res.rows[0]) : null;
  }

  async lookupFuzzy(sourceText: string, sourceLang: string, targetLang: string, opts: FuzzyOptions, namespace?: string): Promise<TMMatch[]> {
    if (opts.strategy === "off") return [];

    if ((opts.strategy === "semantic" || opts.strategy === "both") && this.opts.embeddingProvider) {
      const { vectors } = await this.opts.embeddingProvider.embed([sourceText], this.opts.embeddingModel ?? "text-embedding-3-small");
      const vec = `[${vectors[0]!.join(",")}]`;
      const res = await this.opts.pool.query(
        `SELECT *, 1 - (embedding <=> $5::vector) AS score
         FROM tm WHERE namespace=$1 AND source_lang=$2 AND target_lang=$3 AND embedding IS NOT NULL
         AND 1 - (embedding <=> $5::vector) >= $4
         ORDER BY score DESC LIMIT $6`,
        [NS(namespace), sourceLang, targetLang, opts.threshold, vec, opts.limit ?? 5]
      );
      return res.rows.map((r) => ({ entry: rowToEntry(r), score: Number(r.score) }));
    }

    if (opts.strategy === "lexical" || opts.strategy === "both") {
      const res = await this.opts.pool.query(
        `SELECT * FROM tm WHERE namespace=$1 AND source_lang=$2 AND target_lang=$3`,
        [NS(namespace), sourceLang, targetLang]
      );
      const matches = res.rows
        .map((r) => ({ entry: rowToEntry(r), score: trigramSimilarity(sourceText, r.source_text) }))
        .filter((m) => m.score >= opts.threshold)
        .sort((a, b) => b.score - a.score);
      return opts.limit ? matches.slice(0, opts.limit) : matches;
    }

    return [];
  }

  async upsert(entry: TMEntry): Promise<void> {
    let embedding: string | null = null;
    if (this.opts.embeddingProvider) {
      const { vectors } = await this.opts.embeddingProvider.embed([entry.sourceText], this.opts.embeddingModel ?? "text-embedding-3-small");
      embedding = `[${vectors[0]!.join(",")}]`;
    }
    await this.opts.pool.query(
      `INSERT INTO tm (namespace, source_lang, target_lang, source_text, translated_text, source_hash, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (namespace, source_lang, target_lang, source_text)
       DO UPDATE SET translated_text=EXCLUDED.translated_text, source_hash=EXCLUDED.source_hash, embedding=EXCLUDED.embedding`,
      [NS(entry.namespace), entry.sourceLang, entry.targetLang, entry.sourceText, entry.translatedText, entry.sourceHash, embedding]
    );
  }

  async invalidate(filter: { sourceLang?: string; targetLang?: string; namespace?: string }): Promise<void> {
    const clauses: string[] = [];
    const params: string[] = [];
    let i = 1;
    if (filter.namespace !== undefined) { clauses.push(`namespace=$${i++}`); params.push(NS(filter.namespace)); }
    if (filter.sourceLang) { clauses.push(`source_lang=$${i++}`); params.push(filter.sourceLang); }
    if (filter.targetLang) { clauses.push(`target_lang=$${i++}`); params.push(filter.targetLang); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    await this.opts.pool.query(`DELETE FROM tm ${where}`, params);
  }
}

function rowToEntry(row: any): TMEntry {
  return {
    sourceText: row.source_text,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    translatedText: row.translated_text,
    sourceHash: row.source_hash,
    namespace: row.namespace === "__global__" ? undefined : row.namespace,
  };
}
