import type { PromptTemplates } from "@yaku/core";

/** A point in the search space: config overrides + (optional) prompt templates. */
export interface Candidate {
  /** Partial TranslationConfig (models, maxIterations, reviewer, tm, concurrency). */
  config: Record<string, unknown>;
  promptTemplates?: PromptTemplates;
  /** Human-readable note from the proposer about what this changes and why. */
  rationale?: string;
}

/** Metrics gathered by evaluating a Candidate on a record sample. */
export interface CandidateResult {
  quality: number;        // mean judge score 0..100
  qualityMin: number;     // worst per-segment judge score 0..100
  estUsd: number;         // computed from token counts via Pricing
  gatePassRate: number;   // 0..1 fraction of segments with no gate warnings
  inputTokens: number;
  outputTokens: number;
  scored: number;         // number of segments contributing a quality verdict (includes zero-score failed segments)
  unscoreable: boolean;   // true if too many judge failures -> reject
  /** Aggregated judge critiques, fed back to the proposer as the gradient. */
  critiques: string[];
  /** First judge-call error message, surfaced only when unscoreable. */
  firstJudgeError?: string;
}

/** Per-1M-token USD prices, keyed by model id. */
export type Pricing = Record<string, { in: number; out: number }>;

export interface Objective {
  floor: number;          // minimum acceptable quality (e.g. 85)
  epsilon: number;        // cost delta below this counts as "not better"
}
