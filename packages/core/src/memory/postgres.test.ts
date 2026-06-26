import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresTranslationMemory } from "./postgres.js";

// Build a minimal fake `pg` Pool around a vitest mock `query` fn. The mock is
// returned alongside so tests can assert on the calls it received; the pool is
// cast to `Pool` (via `unknown`) because we only implement the one method the
// memory uses.
function fakePool(rows: Record<string, unknown>[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { query, pool: { query } as unknown as Pool };
}

describe("PostgresTranslationMemory", () => {
  it("lookupExact returns a parsed entry", async () => {
    const { pool } = fakePool([
      { source_text: "Hello", source_lang: "en", target_lang: "ja", translated_text: "やあ", source_hash: "h", namespace: "__global__" },
    ]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    const got = await m.lookupExact("Hello", "en", "ja");
    expect(got?.translatedText).toBe("やあ");
  });
  it("lookupFuzzy returns empty without embedding provider when strategy=semantic", async () => {
    const { pool } = fakePool([]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    const matches = await m.lookupFuzzy("Hello", "en", "ja", { threshold: 0.5, strategy: "semantic" });
    expect(matches).toEqual([]);
  });
  it("upsert issues an INSERT ... ON CONFLICT query", async () => {
    const { pool, query } = fakePool([]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    await m.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls.at(-1)![0] as string;
    expect(sql).toMatch(/INSERT INTO tm/i);
    expect(sql).toMatch(/ON CONFLICT/i);
  });
  it("runs the pgvector semantic query when an embedding provider is present", async () => {
    const { pool, query } = fakePool([
      { source_text: "Hello", source_lang: "en", target_lang: "ja", translated_text: "やあ", source_hash: "h", namespace: "\u0000global", score: 0.92 },
    ]);
    const embeddingProvider = {
      name: "mock-embed",
      embed: vi.fn().mockResolvedValue({ vectors: [[0.1, 0.2, 0.3]], usage: { inputTokens: 1, outputTokens: 0 } }),
    };
    const m = new PostgresTranslationMemory({ pool, embeddingProvider });
    const matches = await m.lookupFuzzy("Hello", "en", "ja", { threshold: 0.5, strategy: "semantic" });
    expect(embeddingProvider.embed).toHaveBeenCalled();
    const sql = query.mock.calls.at(-1)![0] as string;
    expect(sql).toMatch(/embedding <=>/);
    expect(matches[0]!.score).toBeCloseTo(0.92);
    expect(matches[0]!.entry.translatedText).toBe("やあ");
  });
  it("upsert with embedding provider stores an embedding param", async () => {
    const { pool, query } = fakePool([]);
    const embeddingProvider = { name: "mock-embed", embed: vi.fn().mockResolvedValue({ vectors: [[0.1, 0.2]], usage: { inputTokens: 1, outputTokens: 0 } }) };
    const m = new PostgresTranslationMemory({ pool, embeddingProvider });
    await m.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    const params = query.mock.calls.at(-1)![1] as unknown[];
    expect(params[params.length - 1]).toMatch(/^\[/); // embedding vector literal "[...]"
  });
});
