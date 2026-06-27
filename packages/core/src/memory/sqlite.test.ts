import { describe, it, expect } from "vitest";
import { SqliteTranslationMemory } from "./sqlite.js";

function tm() {
  return new SqliteTranslationMemory(":memory:");
}

describe("SqliteTranslationMemory", () => {
  it("upserts and finds exact match", async () => {
    const m = tm();
    await m.upsert({ sourceText: "Hello", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    const got = await m.lookupExact("Hello", "en", "ja");
    expect(got?.translatedText).toBe("やあ");
  });
  it("scopes by namespace", async () => {
    const m = tm();
    await m.upsert({ sourceText: "Hello", sourceLang: "en", targetLang: "ja", translatedText: "A", sourceHash: "h", namespace: "p1" });
    expect(await m.lookupExact("Hello", "en", "ja", "p2")).toBeNull();
    expect((await m.lookupExact("Hello", "en", "ja", "p1"))?.translatedText).toBe("A");
  });
  it("returns ranked fuzzy matches above threshold", async () => {
    const m = tm();
    await m.upsert({ sourceText: "hello world", sourceLang: "en", targetLang: "ja", translatedText: "X", sourceHash: "h" });
    const matches = await m.lookupFuzzy("hello worlds", "en", "ja", { threshold: 0.5, strategy: "lexical" });
    expect(matches.length).toBe(1);
    expect(matches[0]!.score).toBeGreaterThan(0.5);
  });
  it("invalidate removes entries by filter", async () => {
    const m = tm();
    await m.upsert({ sourceText: "Hello", sourceLang: "en", targetLang: "ja", translatedText: "A", sourceHash: "h" });
    await m.invalidate({ targetLang: "ja" });
    expect(await m.lookupExact("Hello", "en", "ja")).toBeNull();
  });
  it("upsert overwrites translated_text and source_hash on the same key", async () => {
    const m = tm();
    await m.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "v1", sourceHash: "h1" });
    await m.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "v2", sourceHash: "h2" });
    const got = await m.lookupExact("Hi", "en", "ja");
    expect(got?.translatedText).toBe("v2");
    expect(got?.sourceHash).toBe("h2");
  });
  it("treats an explicit '\\u0000global' namespace distinctly is not needed, but a literal-looking global string is a real namespace", async () => {
    const m = tm();
    // A user namespace that LOOKS like a global marker must stay distinct from the undefined bucket.
    await m.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "scoped", sourceHash: "h", namespace: "__global__" });
    // undefined (real global) must NOT see the "__global__"-named entry
    expect(await m.lookupExact("Hi", "en", "ja")).toBeNull();
    expect((await m.lookupExact("Hi", "en", "ja", "__global__"))?.translatedText).toBe("scoped");
  });
  it("excludes fuzzy matches below threshold and respects limit", async () => {
    const m = tm();
    await m.upsert({ sourceText: "hello world", sourceLang: "en", targetLang: "ja", translatedText: "A", sourceHash: "h" });
    await m.upsert({ sourceText: "completely different text", sourceLang: "en", targetLang: "ja", translatedText: "B", sourceHash: "h" });
    const high = await m.lookupFuzzy("hello world!", "en", "ja", { threshold: 0.5, strategy: "lexical" });
    expect(high.map((x) => x.entry.translatedText)).toEqual(["A"]); // B excluded
    const limited = await m.lookupFuzzy("hello world!", "en", "ja", { threshold: 0, strategy: "lexical", limit: 1 });
    expect(limited).toHaveLength(1);
  });
  it("close() releases the db handle without throwing", () => {
    const tm = new SqliteTranslationMemory(":memory:");
    expect(() => tm.close()).not.toThrow();
  });
});
