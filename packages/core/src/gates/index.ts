import type { Gate, GateViolation, AssembledGroup, DraftResult } from "./types.js";
import { placeholderGate } from "./placeholders.js";
import { markupGate } from "./markup.js";
import { glossaryGate } from "./glossary-gate.js";
import { lengthGate } from "./length.js";
import { leftoverGate } from "./leftover.js";

// Cheap-first order.
export const GATES: Gate[] = [placeholderGate, markupGate, glossaryGate, lengthGate, leftoverGate];

export function runGates(group: AssembledGroup, draft: DraftResult): GateViolation[] {
  return GATES.flatMap((gate) => gate.check(group, draft));
}

export type { Gate, GateViolation, AssembledGroup, DraftResult } from "./types.js";
