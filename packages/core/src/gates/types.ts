import type { Segment, GlossaryEntry } from "../schemas/index.js";

/** A group of segments translated together for context. */
export interface AssembledGroup {
  groupKey: string;
  segments: Segment[];          // ordered
  targetLang: string;
  sourceLang: string;
  glossary: GlossaryEntry[];    // resolved for this target lang
  context?: string;             // caller-provided background
}

/** Draft (or revision) output: segmentId -> translated text. */
export interface DraftResult {
  translations: Record<string, string>;
}

export interface GateViolation {
  gate: string;
  segmentId: string;
  message: string;
}

export interface Gate {
  name: string;
  check(group: AssembledGroup, draft: DraftResult): GateViolation[];
}
