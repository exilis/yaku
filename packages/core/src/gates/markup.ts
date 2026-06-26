import type { Gate, GateViolation } from "./types.js";

const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

function tagNames(text: string): string[] {
  return (text.match(TAG_RE) ?? [])
    .map((t) => t.replace(/<\/?\s*([a-zA-Z0-9]+)[\s\S]*?>/, "$1").toLowerCase())
    .sort();
}

export const markupGate: Gate = {
  name: "markup",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const want = tagNames(seg.text);
      if (want.length === 0) continue;
      const got = tagNames(draft.translations[seg.id] ?? "");
      if (want.join("|") !== got.join("|")) {
        violations.push({
          gate: "markup",
          segmentId: seg.id,
          message: `markup tags mismatch (expected [${want.join(",")}], got [${got.join(",")}])`,
        });
      }
    }
    return violations;
  },
};
