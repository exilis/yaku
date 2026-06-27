import { describe, it, expect } from "vitest";
import { optimize } from "./optimize.js";
import type { Candidate, CandidateResult } from "./types.js";

function res(quality: number, estUsd: number): CandidateResult {
  return { quality, qualityMin: quality, estUsd, gatePassRate: 1, inputTokens: 100, outputTokens: 100, scored: 5, unscoreable: false, critiques: [] };
}

describe("optimize", () => {
  it("keeps a cheaper candidate that clears the floor", async () => {
    const proposals: Candidate[] = [{ config: { maxIterations: 2 }, rationale: "cheaper" }];
    let i = 0;
    const out = await optimize({
      baseline: { config: { maxIterations: 3 } },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 5, budgetUsd: 100, plateauK: 3,
      propose: async () => proposals[i++] ?? null,
      runCandidate: async (c) => (c.config.maxIterations === 3 ? res(90, 0.50) : res(88, 0.20)),
    });
    expect(out.best.config.maxIterations).toBe(2);
    expect(out.bestMetrics.estUsd).toBeCloseTo(0.20, 5);
    expect(out.stopReason).toBe("plateau"); // proposer runs dry after 1 proposal
  });

  it("stops at the iteration cap", async () => {
    const out = await optimize({
      baseline: { config: {} },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 2, budgetUsd: 100, plateauK: 99,
      propose: async () => ({ config: { maxIterations: 2 }, rationale: "x" }),
      runCandidate: async () => res(90, 0.50), // never cheaper -> never accepted
    });
    expect(out.iterations).toBe(2);
    expect(out.stopReason).toBe("max-iter");
  });

  it("stops when the budget would be exceeded", async () => {
    const out = await optimize({
      baseline: { config: {} },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 100, budgetUsd: 0.30, plateauK: 99,
      propose: async () => ({ config: { maxIterations: 2 }, rationale: "x" }),
      runCandidate: async () => res(90, 0.20), // each candidate costs 0.20; baseline already spent 0.20
    });
    expect(out.stopReason).toBe("budget");
  });

  it("keeps baseline as winner when nothing beats it", async () => {
    const out = await optimize({
      baseline: { config: { maxIterations: 3 } },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 3, budgetUsd: 100, plateauK: 2,
      propose: async () => ({ config: { maxIterations: 2 }, rationale: "x" }),
      runCandidate: async (c) => (c.config.maxIterations === 3 ? res(90, 0.20) : res(70, 0.05)),
    });
    expect(out.best.config.maxIterations).toBe(3);
    expect(out.stopReason).toBe("plateau");
  });

  it("throws on a non-finite plateauK to prevent an unbounded run", async () => {
    await expect(
      optimize({
        baseline: { config: {} },
        objective: { floor: 85, epsilon: 0.0001 },
        maxIter: 5, budgetUsd: 100, plateauK: Number.POSITIVE_INFINITY,
        propose: async () => null,
        runCandidate: async () => res(90, 0.1),
      })
    ).rejects.toThrow(/plateauK/);
  });

  it("emits ledger entries: baseline then accept/reject with spendSoFar", async () => {
    const entries: Array<{ iter: number; decision: string; best: boolean }> = [];
    const proposals: Candidate[] = [{ config: { maxIterations: 2 }, rationale: "cheaper" }];
    let i = 0;
    await optimize({
      baseline: { config: { maxIterations: 3 } },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 5, budgetUsd: 100, plateauK: 2,
      propose: async () => proposals[i++] ?? null,
      runCandidate: async (c) => (c.config.maxIterations === 3 ? res(90, 0.50) : res(88, 0.20)),
      onIteration: (e) => entries.push({ iter: e.iter, decision: e.decision, best: e.best }),
    });
    expect(entries[0]).toEqual({ iter: 0, decision: "baseline", best: true });
    expect(entries[1]).toEqual({ iter: 1, decision: "accept", best: true });
  });
});
