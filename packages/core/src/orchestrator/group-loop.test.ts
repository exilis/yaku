import { describe, it, expect } from "vitest";
import { runGroupLoop } from "./group-loop.js";
import { MockProvider } from "../providers/mock.js";
import { SqliteTranslationMemory } from "../memory/sqlite.js";
import { CostTracker } from "../cost/budget.js";
import { resolveConfig } from "../schemas/index.js";
import type { AssembledGroup } from "../gates/types.js";

function group(text = "Hello world friend"): AssembledGroup {
  return { groupKey: "g", sourceLang: "en", targetLang: "ja", glossary: [], segments: [{ id: "s1", text }] };
}

const cfg = resolveConfig({
  models: {
    translator: { provider: "mock", model: "m" },
    reviewer: { provider: "mock", model: "m" },
  },
});

describe("runGroupLoop", () => {
  it("accepts when gates pass and reviewer passes on first draft", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { s1: "こんにちは世界の友よ" } }],
      reviewer: [{ passed: true, confidence: { s1: 0.95 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r = await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    expect(r.results[0]!.status).toBe("translated");
    expect(r.results[0]!.translatedText).toBe("こんにちは世界の友よ");
    expect(r.iterations).toBe(1);
  });

  it("revises when reviewer fails, then accepts", async () => {
    const provider = new MockProvider({
      translator: [
        { translations: { s1: "悪い訳" } },
        { translations: { s1: "良い訳です" } },
      ],
      reviewer: [
        { passed: false, confidence: { s1: 0.4 }, critique: "too literal" },
        { passed: true, confidence: { s1: 0.9 }, critique: "" },
      ],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r = await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    expect(r.iterations).toBe(2);
    expect(r.results[0]!.translatedText).toBe("良い訳です");
  });

  it("returns exact TM match without any LLM call", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hello world friend", sourceLang: "en", targetLang: "ja", translatedText: "再利用訳", sourceHash: "h" });
    const provider = new MockProvider({}); // no scripted responses → would throw if called
    const r = await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    expect(r.results[0]!.status).toBe("reused");
    expect(r.results[0]!.translatedText).toBe("再利用訳");
    expect(provider.calls).toHaveLength(0);
  });

  it("stops at maxIterations with best-so-far when reviewer never passes", async () => {
    const provider = new MockProvider({
      translator: [
        { translations: { s1: "v1" } }, { translations: { s1: "v2" } }, { translations: { s1: "v3" } },
      ],
      reviewer: [
        { passed: false, confidence: { s1: 0.5 }, critique: "x" },
        { passed: false, confidence: { s1: 0.5 }, critique: "x" },
        { passed: false, confidence: { s1: 0.5 }, critique: "x" },
      ],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r = await runGroupLoop(group(), { provider, tm, config: resolveConfig({ ...cfg, maxIterations: 3 }), cost: new CostTracker() });
    expect(r.iterations).toBe(3);
    expect(r.stopReason).toBe("max-iterations");
    expect(r.results[0]!.translatedText).toBe("v3");
  });

  it("commits accepted translations to TM", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { s1: "確定訳" } }],
      reviewer: [{ passed: true, confidence: { s1: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    const stored = await tm.lookupExact("Hello world friend", "en", "ja");
    expect(stored?.translatedText).toBe("確定訳");
  });
});
