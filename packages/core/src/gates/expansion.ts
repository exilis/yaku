import type { Gate, GateViolation } from "./types.js";

/**
 * Expansion gate — catches UI labels that ballooned into descriptive phrases or
 * full sentences during translation (e.g. "FAQ"-style label -> "Frequently
 * Asked Questions...", or 購入について -> "Here is some information regarding the
 * purchase.").
 *
 * Why opt-in via `role: "ui-label"`: legitimate script expansion (CJK -> Latin)
 * makes a raw character-ratio heuristic fire on almost every translation. The
 * `ui-label` role is an explicit caller signal that a segment must stay terse,
 * so this gate only judges labels and never penalizes prose. Callers who do not
 * tag labels get no behavior change.
 *
 * Heuristic (Latin-script targets are the common bloat case):
 *  - flag if the translation reads as a full sentence: it ends with sentence
 *    punctuation (. ! ?) AND has more than two words, OR
 *  - flag if the translation exceeds a label word budget (> 6 words).
 *
 * Word-count is whitespace-based, so space-free scripts (zh/ja/ko) stay at ~1
 * "word" and never false-positive. Short labels like "Delete?" or "Next Page"
 * pass. Needs no config — like the leftover gate, it is a pure heuristic.
 */
const LABEL_WORD_BUDGET = 6;
const sentenceEnd = /[.!?]["')\]]?\s*$/;

export const expansionGate: Gate = {
  name: "expansion",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      if (seg.metadata?.role !== "ui-label") continue;
      const tr = (draft.translations[seg.id] ?? "").trim();
      if (tr === "") continue;
      const words = tr.split(/\s+/).filter(Boolean).length;
      const looksLikeSentence = sentenceEnd.test(tr) && words > 2;
      const tooManyWords = words > LABEL_WORD_BUDGET;
      if (looksLikeSentence || tooManyWords) {
        violations.push({
          gate: "expansion",
          segmentId: seg.id,
          message: looksLikeSentence
            ? "ui-label translated as a sentence; keep it a terse label"
            : `ui-label expanded to ${words} words; keep it a terse label`,
        });
      }
    }
    return violations;
  },
};
