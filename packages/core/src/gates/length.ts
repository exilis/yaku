import type { Gate, GateViolation } from "./types.js";

export const lengthGate: Gate = {
  name: "length",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const max = seg.metadata?.maxChars;
      if (max === undefined) continue;
      const len = [...(draft.translations[seg.id] ?? "")].length;
      if (len > max) {
        violations.push({
          gate: "length",
          segmentId: seg.id,
          message: `length ${len} exceeds maxChars ${max}`,
        });
      }
    }
    return violations;
  },
};
