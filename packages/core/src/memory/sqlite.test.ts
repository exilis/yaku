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
});
