import { describe, it, expect } from "vitest";
import { CostTracker } from "./budget.js";

describe("CostTracker", () => {
  it("accumulates token usage", () => {
    const t = new CostTracker();
    t.add({ inputTokens: 10, outputTokens: 5 });
    t.add({ inputTokens: 3, outputTokens: 2, usd: 0.01 });
    expect(t.total.inputTokens).toBe(13);
    expect(t.total.outputTokens).toBe(7);
    expect(t.total.usd).toBeCloseTo(0.01);
  });
  it("reports budget not exceeded when under cap", () => {
    const t = new CostTracker({ maxUsd: 1 });
    t.add({ inputTokens: 1, outputTokens: 1, usd: 0.1 });
    expect(t.budgetExceeded()).toBe(false);
  });
  it("reports budget exceeded when over usd cap", () => {
    const t = new CostTracker({ maxUsd: 0.05 });
    t.add({ inputTokens: 1, outputTokens: 1, usd: 0.1 });
    expect(t.budgetExceeded()).toBe(true);
  });
});
