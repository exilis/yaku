import { describe, it, expect } from "vitest";
import { runGroupLoop } from "./group-loop.js";
import { MockProvider } from "../providers/mock.js";
import { SqliteTranslationMemory } from "../memory/sqlite.js";
import { CostTracker } from "../cost/budget.js";
import { resolveConfig } from "../schemas/index.js";
import type { AssembledGroup } from "../gates/types.js";
import { DEFAULT_TEMPLATES } from "./prompts.js";

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

  it("runs back-translation and revises on high drift", async () => {
    const provider = new MockProvider({
      translator: [
        { translations: { s1: "初稿" } },
        { translations: { s1: "改訂稿" } }, // revision after drift
      ],
      reviewer: [{ passed: true, confidence: { s1: 0.9 }, critique: "" }],
      backTranslator: [{ translations: { s1: "totally unrelated text here" } }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const cfg2 = resolveConfig({
      models: {
        translator: { provider: "mock", model: "m" },
        reviewer: { provider: "mock", model: "m" },
        backTranslator: { provider: "mock", model: "m" },
      },
      backTranslation: { enabled: true, driftThreshold: 0.2 },
    });
    const g = { groupKey: "g", sourceLang: "en", targetLang: "ja", glossary: [], segments: [{ id: "s1", text: "Hello world friend" }] } satisfies AssembledGroup;
    const r = await runGroupLoop(g, { provider, tm, config: cfg2, cost: new CostTracker() });
    expect(r.stopReason).toBe("back-translation-ok");
    expect(r.results[0]!.translatedText).toBe("改訂稿");
  });

  it("handles a mix of reused (exact TM) and freshly translated segments, every id once", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Reused source here", sourceLang: "en", targetLang: "ja", translatedText: "再利用", sourceHash: "h" });
    const provider = new MockProvider({
      translator: [{ translations: { fresh: "新規訳" } }],
      reviewer: [{ passed: true, confidence: { fresh: 0.9 }, critique: "" }],
    });
    const g = { groupKey: "g", sourceLang: "en", targetLang: "ja", glossary: [], segments: [
      { id: "old", text: "Reused source here" },
      { id: "fresh", text: "A fresh new line" },
    ] } satisfies AssembledGroup;
    const r = await runGroupLoop(g, { provider, tm, config: cfg, cost: new CostTracker() });
    const byId = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(byId.old!.status).toBe("reused");
    expect(byId.old!.translatedText).toBe("再利用");
    expect(byId.fresh!.status).toBe("translated");
    expect(byId.fresh!.translatedText).toBe("新規訳");
    expect(r.results).toHaveLength(2);
  });

  it("marks a segment failed when the translator omits its id", async () => {
    const provider = new MockProvider({
      translator: [{ translations: {} }], // omits s1
      reviewer: [{ passed: false, confidence: {}, critique: "x" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r = await runGroupLoop(group(), { provider, tm, config: resolveConfig({ ...cfg, maxIterations: 1 }), cost: new CostTracker() });
    expect(r.results[0]!.status).toBe("failed");
    expect(r.results[0]!.error).toBeDefined();
  });

  it("skips the reviewer when reviewer.enabled is false (accepts on gates alone)", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { s1: "訳" } }],
      // no reviewer scripted — must not be called
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const cfgNoReviewer = resolveConfig({
      models: { translator: { provider: "mock", model: "m" } },
      reviewer: { enabled: false },
    });
    const r = await runGroupLoop(group("short"), { provider, tm, config: cfgNoReviewer, cost: new CostTracker() });
    expect(r.results[0]!.status).toBe("translated");
    expect(provider.calls.filter((c) => c.role === "reviewer")).toHaveLength(0);
  });

  it("feeds a fuzzy TM suggestion into the translator prompt", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hello world friends", sourceLang: "en", targetLang: "ja", translatedText: "やあ世界の友", sourceHash: "h" });
    const provider = new MockProvider({
      translator: [{ translations: { s1: "やあ世界の友よ" } }],
      reviewer: [{ passed: true, confidence: { s1: 0.9 }, critique: "" }],
    });
    // query text "Hello world friend" is fuzzy-near the stored "Hello world friends"
    const r = await runGroupLoop(group("Hello world friend"), { provider, tm, config: cfg, cost: new CostTracker() });
    // the translator prompt for the first (and only) call should contain the fuzzy suggestion
    const translatorCall = provider.calls.find((c) => c.role === "translator")!;
    expect(translatorCall.prompt).toContain("やあ世界の友");
    expect(r.results[0]!.status).toBe("translated");
  });

  it("back-translation with low drift accepts without an extra revise pass", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { s1: "こんにちは世界の友よ" } }], // proper ja translation (passes leftover gate)
      reviewer: [{ passed: true, confidence: { s1: 0.9 }, critique: "" }],
      backTranslator: [{ translations: { s1: "Hello world friend" } }], // near-identical to source -> low drift
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const cfgBt = resolveConfig({
      models: {
        translator: { provider: "mock", model: "m" },
        reviewer: { provider: "mock", model: "m" },
        backTranslator: { provider: "mock", model: "m" },
      },
      backTranslation: { enabled: true, driftThreshold: 0.2 },
    });
    const r = await runGroupLoop(group("Hello world friend"), { provider, tm, config: cfgBt, cost: new CostTracker() });
    expect(r.stopReason).toBe("back-translation-ok");
    expect(r.results[0]!.translatedText).toBe("こんにちは世界の友よ");
    // only ONE translator call (no extra revise pass)
    expect(provider.calls.filter((c) => c.role === "translator")).toHaveLength(1);
  });

  it("passes promptTemplates through to the translator prompt", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { s1: "ようこそ" } }],
      reviewer: [{ passed: true, confidence: { s1: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const cfg = resolveConfig({
      models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
      promptTemplates: {
        ...DEFAULT_TEMPLATES,
        translator: { ...DEFAULT_TEMPLATES.translator, instruction: "SENTINEL {targetLang}" },
      },
    });
    await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    const translatorCall = provider.calls.find((c) => c.role === "translator");
    expect(translatorCall?.prompt).toContain("SENTINEL ja");
  });
});
