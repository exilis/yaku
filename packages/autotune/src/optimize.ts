import type { Candidate, CandidateResult, Objective } from "./types.js";
import { isBetter } from "./objective.js";

export type StopReason = "max-iter" | "budget" | "plateau";

export interface OptimizeArgs {
  baseline: Candidate;
  objective: Objective;
  maxIter: number;
  budgetUsd: number;
  plateauK: number;
  /** Inject the real propose/runCandidate, or stubs in tests. */
  propose: (best: Candidate, metrics: CandidateResult) => Promise<Candidate | null>;
  runCandidate: (candidate: Candidate) => Promise<CandidateResult>;
  /** Optional per-iteration hook for ledger writing (CLI supplies this). */
  onIteration?: (entry: LedgerIteration) => void;
}

export interface LedgerIteration {
  iter: number;
  candidate: Candidate;
  metrics: CandidateResult;
  decision: "baseline" | "accept" | "reject";
  spendSoFar: number;
  best: boolean;
}

export interface OptimizeResult {
  best: Candidate;
  bestMetrics: CandidateResult;
  iterations: number;
  spendUsd: number;
  stopReason: StopReason;
}

export async function optimize(args: OptimizeArgs): Promise<OptimizeResult> {
  // Baseline (iteration 0)
  let best = args.baseline;
  let bestMetrics = await args.runCandidate(best);
  let spend = bestMetrics.estUsd;
  args.onIteration?.({ iter: 0, candidate: best, metrics: bestMetrics, decision: "baseline", spendSoFar: spend, best: true });

  let iterations = 0;
  let plateau = 0;
  let stopReason: StopReason = "plateau";

  while (iterations < args.maxIter) {
    // propose
    const candidate = await args.propose(best, bestMetrics);
    if (candidate === null) {
      // proposer exhausted / dry -> treat as plateau progress
      plateau++;
      if (plateau >= args.plateauK) { stopReason = "plateau"; break; }
      continue;
    }

    // budget guard BEFORE spending: estimate next cost ~= baseline candidate cost
    const estimatedNext = bestMetrics.estUsd;
    if (spend + estimatedNext > args.budgetUsd) { stopReason = "budget"; break; }

    iterations++;
    const metrics = await args.runCandidate(candidate);
    spend += metrics.estUsd;

    const better = isBetter(metrics, bestMetrics, args.objective);
    if (better) {
      best = candidate;
      bestMetrics = metrics;
      plateau = 0;
      args.onIteration?.({ iter: iterations, candidate, metrics, decision: "accept", spendSoFar: spend, best: true });
    } else {
      plateau++;
      args.onIteration?.({ iter: iterations, candidate, metrics, decision: "reject", spendSoFar: spend, best: false });
    }

    if (iterations >= args.maxIter) { stopReason = "max-iter"; break; }
    if (plateau >= args.plateauK) { stopReason = "plateau"; break; }
  }

  return { best, bestMetrics, iterations, spendUsd: spend, stopReason };
}
