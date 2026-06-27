import { describe, it, expect } from "vitest";
import { MockProvider } from "@yaku/core";
import { scoreTranslation, aggregateQuality, JudgeSchema } from "./judge.js";

describe("JudgeSchema", () => {
  it("accepts a well-formed verdict", () => {
    const ok = JudgeSchema.safeParse({
      score: 90, dims: { adequacy: 90, fluency: 88, terminology: 92, tone: 90 }, critique: "",
    });
    expect(ok.success).toBe(true);
  });
});

describe("scoreTranslation", () => {
  it("returns the judged score and critique", async () => {
    const provider = new MockProvider({
      reviewer: [{ score: 87, dims: { adequacy: 88, fluency: 86, terminology: 88, tone: 86 }, critique: "slightly stiff" }],
    });
    const out = await scoreTranslation(
      { source: "Welcome", target: "ようこそ", lang: "ja", id: "t" },
      { provider, model: "gpt-4o" }
    );
    expect(out.score).toBe(87);
    expect(out.critique).toBe("slightly stiff");
  });
});

describe("aggregateQuality", () => {
  it("computes mean, min, and collects critiques", () => {
    const agg = aggregateQuality([
      { score: 90, dims: { adequacy: 90, fluency: 90, terminology: 90, tone: 90 }, critique: "" },
      { score: 80, dims: { adequacy: 80, fluency: 80, terminology: 80, tone: 80 }, critique: "awkward" },
    ]);
    expect(agg.quality).toBeCloseTo(85, 5);
    expect(agg.qualityMin).toBe(80);
    expect(agg.critiques).toContain("awkward");
  });
});
