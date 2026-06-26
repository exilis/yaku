import type { Cost } from "../schemas/index.js";

export type StopReason = "accepted" | "max-iterations" | "budget-hit" | "back-translation-ok";

export interface IterationTrace {
  draft: Record<string, string>;
  gateViolations: string[];
  reviewerPassed: boolean;
  tmHit?: "exact" | "fuzzy" | "none";
  cost: Cost;
}

export interface GroupTraceJSON {
  groupKey: string;
  targetLang: string;
  iterations: IterationTrace[];
  stopReason: StopReason;
}

export class GroupTrace {
  private iterations: IterationTrace[] = [];
  private stopReason: StopReason = "accepted";
  constructor(private groupKey: string, private targetLang: string) {}

  iteration(it: IterationTrace): void {
    this.iterations.push(it);
  }
  finish(reason: StopReason): void {
    this.stopReason = reason;
  }
  toJSON(): GroupTraceJSON {
    return {
      groupKey: this.groupKey,
      targetLang: this.targetLang,
      iterations: this.iterations,
      stopReason: this.stopReason,
    };
  }
}

export interface DocumentTrace {
  documentId?: string;
  groups: GroupTraceJSON[];
}
