import type { Pricing } from "./types.js";

/** USD per 1M tokens. Extend as needed. */
export const DEFAULT_PRICING: Pricing = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
};

/** Price used when a model id is not in the table (conservative-ish default). */
const FALLBACK = { in: 1.0, out: 4.0 };

export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing = DEFAULT_PRICING
): number {
  const p = pricing[model] ?? FALLBACK;
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}
