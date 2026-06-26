import type { TokenUsage } from "../providers/types.js";
import type { Cost } from "../schemas/index.js";

export interface BudgetOptions {
  maxUsd?: number;
}

export class CostTracker {
  total: Cost = { inputTokens: 0, outputTokens: 0, usd: 0 };
  constructor(private budget: BudgetOptions = {}) {}

  add(usage: TokenUsage): void {
    this.total.inputTokens += usage.inputTokens;
    this.total.outputTokens += usage.outputTokens;
    this.total.usd = (this.total.usd ?? 0) + (usage.usd ?? 0);
  }

  budgetExceeded(): boolean {
    if (this.budget.maxUsd === undefined) return false;
    return (this.total.usd ?? 0) >= this.budget.maxUsd;
  }
}

export function addCost(a: Cost, b: Cost): Cost {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    usd: (a.usd ?? 0) + (b.usd ?? 0),
  };
}
