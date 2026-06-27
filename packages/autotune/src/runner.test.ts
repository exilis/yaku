import { describe, it, expect } from "vitest";
import { MockProvider } from "@yaku/core";
import type { TranslationMemory } from "@yaku/core";
import { runCandidate } from "./runner.js";
import type { GoldRecord } from "./gold.js";

// A no-op TM so the engine never reuses across the gold set.
// Matches the real @yaku/core TranslationMemory interface exactly:
//   lookupExact -> Promise<TMEntry | null>, lookupFuzzy -> Promise<TMMatch[]>,
//   upsert -> Promise<void>, invalidate(filter) -> Promise<void>.
const noopTm: TranslationMemory = {
  async lookupExact() { return null; },
  async lookupFuzzy() { return []; },
  async upsert() {},
  async invalidate() {},
};

const gold: GoldRecord[] = [
  { sourceLang: "en", targetLangs: ["ja"], document: { id: "d1", segments: [{ id: "t", text: "Welcome" }] } },
];

const baseCandidate = {
  config: {
    models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
  },
};

describe("runCandidate", () => {
  it("translates, judges, and returns a metrics bundle", async () => {
    // translator + reviewer for the engine, then judge call (role reviewer) for autotune
    const provider = new MockProvider({
      translator: [{ translations: { t: "ようこそ" } }],
      reviewer: [
        { passed: true, confidence: { t: 0.9 }, critique: "" },                       // engine reviewer
        { score: 88, dims: { adequacy: 88, fluency: 88, terminology: 88, tone: 88 }, critique: "" }, // judge
      ],
    });
    const result = await runCandidate(baseCandidate, gold, {
      provider, tm: noopTm, judgeModel: "gpt-4o", translatorModelForPricing: "gpt-4o-mini",
    });
    expect(result.quality).toBeCloseTo(88, 5);
    expect(result.scored).toBe(1);
    expect(result.unscoreable).toBe(false);
    expect(result.estUsd).toBeGreaterThanOrEqual(0);
    expect(result.gatePassRate).toBe(1);
  });

  it("marks the candidate unscoreable when judging fails for every segment", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { t: "ようこそ" } }],
      reviewer: [
        { passed: true, confidence: { t: 0.9 }, critique: "" }, // engine reviewer
        // no judge response queued -> judge call throws -> all judges fail
      ],
    });
    const result = await runCandidate(baseCandidate, gold, {
      provider, tm: noopTm, judgeModel: "gpt-4o", translatorModelForPricing: "gpt-4o-mini",
    });
    expect(result.unscoreable).toBe(true);
  });
});
