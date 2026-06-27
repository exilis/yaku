import { describe, it, expect } from "vitest";
import { isBetter } from "./objective.js";
import type { CandidateResult, Objective } from "./types.js";

const obj: Objective = { floor: 85, epsilon: 0.0001 };

function r(quality: number, estUsd: number): CandidateResult {
  return {
    quality, qualityMin: quality, estUsd, gatePassRate: 1, inputTokens: 0,
    outputTokens: 0, scored: 10, unscoreable: false, critiques: [],
  };
}

describe("isBetter", () => {
  it("a candidate below the floor never beats the best, even if cheaper", () => {
    expect(isBetter(r(80, 0.10), r(90, 0.50), obj)).toBe(false);
  });

  it("a candidate clearing the floor beats a best that is below the floor", () => {
    expect(isBetter(r(86, 0.50), r(80, 0.10), obj)).toBe(true);
  });

  it("when both clear the floor, the cheaper one wins", () => {
    expect(isBetter(r(90, 0.20), r(88, 0.50), obj)).toBe(true);
    expect(isBetter(r(90, 0.60), r(88, 0.50), obj)).toBe(false);
  });

  it("a cost delta within epsilon does not count as better", () => {
    expect(isBetter(r(90, 0.50000), r(90, 0.50005), obj)).toBe(false);
  });

  it("an unscoreable candidate is never better", () => {
    const bad = { ...r(99, 0.01), unscoreable: true };
    expect(isBetter(bad, r(86, 0.50), obj)).toBe(false);
  });
});
