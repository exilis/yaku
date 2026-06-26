import type { Gate, GateViolation } from "./types.js";

export const glossaryGate: Gate = {
  name: "glossary",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const translated = draft.translations[seg.id] ?? "";
      for (const entry of group.glossary) {
        const sourceHasTerm = contains(seg.text, entry.source, entry.caseSensitive);
        if (!sourceHasTerm) continue;
        if (entry.target) {
          if (!translated.includes(entry.target)) {
            violations.push({
              gate: "glossary",
              segmentId: seg.id,
              message: `forced mapping "${entry.source}" -> "${entry.target}" not applied`,
            });
          }
        } else {
          if (!contains(translated, entry.source, entry.caseSensitive)) {
            violations.push({
              gate: "glossary",
              segmentId: seg.id,
              message: `do-not-translate term "${entry.source}" was altered`,
            });
          }
        }
      }
    }
    return violations;
  },
};

// Matching is substring-based (e.g. "cat" would match "category"). This is an
// accepted v1 limitation suited to curated, multi-character terms. Word-boundary
// matching is deferred because it doesn't generalize across CJK targets, where
// there are no word boundaries to anchor on.
function contains(haystack: string, needle: string, caseSensitive?: boolean): boolean {
  if (caseSensitive) return haystack.includes(needle);
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
