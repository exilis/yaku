import { describe, it, expect } from "vitest";
import { translate } from "./translate.js";
import { MockProvider } from "../providers/mock.js";
import { SqliteTranslationMemory } from "../memory/sqlite.js";
import type { TranslationRequest } from "../schemas/index.js";

const req: TranslationRequest = {
  sourceLang: "en",
  targetLangs: ["ja", "ko"],
  document: { id: "doc1", segments: [{ id: "title", text: "Welcome aboard now" }] },
  config: {
    tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 },
    models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
  } satisfies TranslationRequest["config"],
};

describe("translate", () => {
  it("returns one LanguageResult per target language, each with every id", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { title: "ようこそ" } }, { translations: { title: "환영합니다" } }],
      reviewer: [{ passed: true, confidence: { title: 0.9 }, critique: "" }, { passed: true, confidence: { title: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const res = await translate(req, { provider, tm });
    expect(res.results.map((r) => r.targetLang).sort()).toEqual(["ja", "ko"]);
    for (const lr of res.results) {
      expect(lr.segments.map((s) => s.id)).toEqual(["title"]);
    }
    expect(res.status).toBe("ok");
  });

  it("returns verbatim skipped for doNotTranslate segments", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { body: "本文" } }],
      reviewer: [{ passed: true, confidence: { body: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r2: TranslationRequest = {
      sourceLang: "en", targetLangs: ["ja"],
      document: { segments: [
        { id: "brand", text: "Acme", metadata: { doNotTranslate: true } },
        { id: "body", text: "Hello there now", metadata: { group: "g" } },
      ] },
      config: req.config,
    };
    const res = await translate(r2, { provider, tm });
    const brand = res.results[0]!.segments.find((s) => s.id === "brand")!;
    expect(brand.status).toBe("skipped");
    expect(brand.translatedText).toBe("Acme");
  });

  it("marks document partial when a segment fails", async () => {
    const provider = new MockProvider({
      translator: [{ translations: {} }],
      reviewer: [{ passed: false, confidence: {}, critique: "x" }, { passed: false, confidence: {}, critique: "x" }, { passed: false, confidence: {}, critique: "x" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r3: TranslationRequest = {
      sourceLang: "en", targetLangs: ["ja"],
      document: { segments: [{ id: "x", text: "Hello there now" }] },
      config: { ...req.config, maxIterations: 1 } satisfies TranslationRequest["config"],
    };
    const res = await translate(r3, { provider, tm });
    expect(res.status).toBe("partial");
    expect(res.results[0]!.segments[0]!.status).toBe("failed");
  });

  it("flags budgetHit in summary when maxUsd budget is exceeded", async () => {
    // MockProvider reports usd:0 per call, so a maxUsd of 0 means budgetExceeded() is true
    // as soon as any cost is recorded (>= comparison). The summary should reflect budgetHit.
    const provider = new MockProvider({
      translator: [{ translations: { x: "訳" } }],
      reviewer: [{ passed: true, confidence: { x: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r4: TranslationRequest = {
      sourceLang: "en", targetLangs: ["ja"],
      document: { segments: [{ id: "x", text: "Hello there now" }] },
      config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } }, budget: { maxUsd: 0 } } satisfies TranslationRequest["config"],
    };
    const res = await translate(r4, { provider, tm });
    expect(res.results[0]!.summary.budgetHit).toBe(true);
  });
});
