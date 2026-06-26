import type { Gate, GateViolation } from "./types.js";

// Matches {{double}}, {single}, and printf-style %s %d %1$s
const PLACEHOLDER_RE = /\{\{[^}]+\}\}|\{[^}]+\}|%(?:\d+\$)?[sdif]/g;

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
