import { describe, it, expect } from "vitest";
import { translate, MockProvider, SqliteTranslationMemory, type TranslationRequest } from "./index.js";

const provider = () => new MockProvider({
  translator: [
    { translations: { title: "ようこそ", body: "本文です" } },
    { translations: { title: "환영", body: "본문입니다" } },
  ],
  reviewer: [
    { passed: true, confidence: { title: 0.9, body: 0.9 }, critique: "" },
    { passed: true, confidence: { title: 0.9, body: 0.9 }, critique: "" },
  ],
});

const req: TranslationRequest = {
  sourceLang: "en", targetLangs: ["ja", "ko"],
  document: { segments: [
    { id: "title", text: "Welcome here now", metadata: { group: "g", order: 0 } },
    { id: "body", text: "This is the body text", metadata: { group: "g", order: 1 } },
    { id: "brand", text: "Acme", metadata: { doNotTranslate: true } },
  ] },
  config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } } satisfies TranslationRequest["config"],
};

describe("end-to-end contract", () => {
  it("every input id appears exactly once per language", async () => {
    const res = await translate(req, { provider: provider(), tm: new SqliteTranslationMemory(":memory:") });
    for (const lr of res.results) {
      const ids = lr.segments.map((s) => s.id).sort();
      expect(ids).toEqual(["body", "brand", "title"]);
    }
  });
  it("do-not-translate segments are verbatim and skipped in every language", async () => {
    const res = await translate(req, { provider: provider(), tm: new SqliteTranslationMemory(":memory:") });
    for (const lr of res.results) {
      const brand = lr.segments.find((s) => s.id === "brand")!;
      expect(brand.status).toBe("skipped");
      expect(brand.translatedText).toBe("Acme");
    }
  });
  it("sourceHash is identical across languages for the same segment", async () => {
    const res = await translate(req, { provider: provider(), tm: new SqliteTranslationMemory(":memory:") });
    const ja = res.results.find((r) => r.targetLang === "ja")!.segments.find((s) => s.id === "title")!;
    const ko = res.results.find((r) => r.targetLang === "ko")!.segments.find((s) => s.id === "title")!;
    expect(ja.sourceHash).toBe(ko.sourceHash);
  });
});
