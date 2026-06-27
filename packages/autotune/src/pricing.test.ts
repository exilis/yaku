import { describe, it, expect } from "vitest";
import { estimateUsd, DEFAULT_PRICING } from "./pricing.js";

describe("estimateUsd", () => {
  it("computes cost from token counts for a known model", () => {
    // gpt-4o-mini: 0.15/1M in, 0.6/1M out
    const usd = estimateUsd("gpt-4o-mini", 1_000_000, 1_000_000, DEFAULT_PRICING);
    expect(usd).toBeCloseTo(0.75, 5);
  });

  it("falls back to a default price for an unknown model", () => {
    const usd = estimateUsd("some-unknown-model", 1_000_000, 0, DEFAULT_PRICING);
    expect(usd).toBeGreaterThan(0);
  });
});
