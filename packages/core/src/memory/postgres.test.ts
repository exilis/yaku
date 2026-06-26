import { describe, it, expect, vi } from "vitest";
import { PostgresTranslationMemory } from "./postgres.js";

function fakePool(rows: any[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

describe("PostgresTranslationMemory", () => {
  it("lookupExact returns a parsed entry", async () => {
    const pool = fakePool([
      { source_text: "Hello", source_lang: "en", target_lang: "ja", translated_text: "やあ", source_hash: "h", namespace: "__global__" },
    ]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    const got = await m.lookupExact("Hello", "en", "ja");
    expect(got?.translatedText).toBe("やあ");
  });
  it("lookupFuzzy returns empty without embedding provider when strategy=semantic", async () => {
    const pool = fakePool([]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    const matches = await m.lookupFuzzy("Hello", "en", "ja", { threshold: 0.5, strategy: "semantic" });
    expect(matches).toEqual([]);
  });
  it("upsert issues an INSERT ... ON CONFLICT query", async () => {
    const pool = fakePool([]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    await m.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    expect(pool.query).toHaveBeenCalled();
    const sql = pool.query.mock.calls.at(-1)![0] as string;
    expect(sql).toMatch(/INSERT INTO tm/i);
    expect(sql).toMatch(/ON CONFLICT/i);
  });
});
