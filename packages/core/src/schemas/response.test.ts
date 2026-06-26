import { describe, it, expect } from "vitest";
import { TranslationResponseSchema, SegmentResultSchema } from "./response.js";

describe("response schemas", () => {
  it("accepts a valid segment result", () => {
    const r = SegmentResultSchema.safeParse({
      id: "t",
      translatedText: "やあ",
      status: "translated",
      sourceHash: "abc123",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a full multi-language response", () => {
    const r = TranslationResponseSchema.safeParse({
      status: "ok",
      sourceLang: "en",
      results: [
        {
          targetLang: "ja",
          status: "ok",
          segments: [{ id: "t", translatedText: "やあ", status: "translated", sourceHash: "h" }],
          summary: { total: 1, translated: 1, reused: 0, unchanged: 0, failed: 0, skipped: 0, iterationsTotal: 1, cost: { inputTokens: 10, outputTokens: 5 } },
        },
      ],
      summary: { total: 1, translated: 1, reused: 0, unchanged: 0, failed: 0, skipped: 0, iterationsTotal: 1, cost: { inputTokens: 10, outputTokens: 5 } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const r = SegmentResultSchema.safeParse({ id: "t", translatedText: "x", status: "bogus", sourceHash: "h" });
    expect(r.success).toBe(false);
  });
});
