import type { CandidateResult, Objective } from "./types.js";

/**
 * Lexicographic objective: (1) candidate must clear the quality floor, then
 * (2) be strictly cheaper than `best` by more than epsilon.
 *
 * Rules:
 * - An unscoreable candidate is never better.
 * - If candidate is below floor, it is never better (regardless of cost).
 * - If candidate clears floor and best does NOT, candidate is better.
 * - If both clear floor, cheaper wins (by > epsilon).
 */
export function isBetter(candidate: CandidateResult, best: CandidateResult, obj: Objective): boolean {
  if (candidate.unscoreable) return false;
  const candPasses = candidate.quality >= obj.floor;
  const bestPasses = !best.unscoreable && best.quality >= obj.floor;

  if (!candPasses) return false;
  if (candPasses && !bestPasses) return true;

  // both pass the floor -> minimize cost
  return candidate.estUsd < best.estUsd - obj.epsilon;
}
