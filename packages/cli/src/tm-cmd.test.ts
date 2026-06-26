import { describe, it, expect } from "vitest";
import { tmInvalidate, tmExport, tmImport } from "./tm-cmd.js";
import { SqliteTranslationMemory } from "@yaku/core";

describe("tm commands", () => {
  it("invalidate removes matching entries", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    await tmInvalidate(tm, { targetLang: "ja" });
    expect(await tm.lookupExact("Hi", "en", "ja")).toBeNull();
  });
  it("export returns entries", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    const out = await tmExport(tm);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]!.translatedText).toBe("やあ");
  });
  it("import then export round-trips entries", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tmImport(tm, [{ sourceText: "X", sourceLang: "en", targetLang: "ko", translatedText: "엑스", sourceHash: "h" }]);
    const out = await tmExport(tm);
    expect(out[0]!.translatedText).toBe("엑스");
  });
});
