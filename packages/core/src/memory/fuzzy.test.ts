import { describe, it, expect } from "vitest";
import { trigramSimilarity } from "./fuzzy.js";

describe("trigramSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBeCloseTo(1);
  });
  it("is 0 for completely different strings", () => {
    expect(trigramSimilarity("abcdef", "zyxwvu")).toBeLessThan(0.1);
  });
  it("is high for near-identical strings", () => {
    expect(trigramSimilarity("hello world", "hello worlds")).toBeGreaterThan(0.7);
  });
});
