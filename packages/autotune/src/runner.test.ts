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

  it("counts a failed segment as a gate failure and a zero-score verdict", async () => {
    const provider = new MockProvider({
      // translator omits "t" -> segment fails; maxIterations default lets it retry then fail
      translator: [{ translations: {} }, { translations: {} }, { translations: {} }],
    });
    const failCandidate = {
      config: {
        models: { translator: { provider: "mock", model: "m" } },
        reviewer: { enabled: false },
      },
    };
    const result = await runCandidate(failCandidate, gold, {
      provider, tm: noopTm, judgeModel: "gpt-4o", translatorModelForPricing: "gpt-4o-mini",
    });
    expect(result.gatePassRate).toBe(0);     // the only segment failed -> 0 passes / 1 total
    expect(result.quality).toBe(0);          // zero-score verdict
    expect(result.scored).toBe(1);           // one (zero-score) verdict recorded
    expect(result.unscoreable).toBe(false);  // no judge call was attempted (judgeAttempts=0)
  });
});
