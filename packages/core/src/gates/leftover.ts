import type { Gate, GateViolation } from "./types.js";

export const leftoverGate: Gate = {
  name: "leftover",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const src = seg.text.trim();
      const tr = (draft.translations[seg.id] ?? "").trim();
      // Heuristic: only flag identical when source is "wordy" (>= 3 words, > 10 chars).
      const wordy = src.split(/\s+/).length >= 3 && src.length > 10;
      if (wordy && tr === src) {
        violations.push({
          gate: "leftover",
          segmentId: seg.id,
          message: "target identical to source (likely untranslated)",
        });
      }
    }
    return violations;
  },
};
