import type { Gate, GateViolation } from "./types.js";

// Matches {{double}}, {single}, and printf-style %s %d %1$s.
// The {1,200} bound on the braces body is a guard against pathological input
// (e.g. a long run of unclosed braces) that would otherwise cause quadratic
// backtracking; 200 chars comfortably covers any realistic placeholder name.
const PLACEHOLDER_RE = /\{\{[^}]{1,200}\}\}|\{[^}]{1,200}\}|%(?:\d+\$)?[sdif]/g;

// Note: this gate flags MISSING placeholders only. Extra/hallucinated
// placeholders in the translation are intentionally not flagged (per spec
// "must survive") — only placeholders present in the source must be preserved.

function extract(text: string): string[] {
  return (text.match(PLACEHOLDER_RE) ?? []).sort();
}

export const placeholderGate: Gate = {
  name: "placeholders",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const want = extract(seg.text);
      if (want.length === 0) continue;
      const got = extract(draft.translations[seg.id] ?? "");
      const missing = subtractMultiset(want, got);
      if (missing.length > 0) {
        violations.push({
          gate: "placeholders",
          segmentId: seg.id,
          message: `missing placeholders: ${missing.join(", ")}`,
        });
      }
    }
    return violations;
  },
};

function subtractMultiset(want: string[], got: string[]): string[] {
  const counts = new Map<string, number>();
  for (const g of got) counts.set(g, (counts.get(g) ?? 0) + 1);
  const missing: string[] = [];
  for (const w of want) {
    const c = counts.get(w) ?? 0;
    if (c > 0) counts.set(w, c - 1);
    else missing.push(w);
  }
  return missing;
}
