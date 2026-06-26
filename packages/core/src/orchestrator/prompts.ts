import type { AssembledGroup } from "../gates/types.js";

export interface TranslatorPromptExtras {
  critique?: string;
  gateViolations?: string[];
  suggestions?: Record<string, string>; // fuzzy TM hints, segmentId -> suggestion
}

export function buildTranslatorPrompt(group: AssembledGroup, extras: TranslatorPromptExtras): string {
  const lines: string[] = [];
  lines.push(`Translate the following segments from ${group.sourceLang} to ${group.targetLang}.`);
  lines.push(`Return JSON: {"translations": { "<segmentId>": "<translation>", ... }} for EVERY segment id.`);
  if (group.context) lines.push(`\nBackground context (do not translate this, use it for understanding):\n${group.context}`);
  if (group.glossary.length) {
    lines.push(`\nGlossary rules:`);
    for (const g of group.glossary) {
      lines.push(g.target ? `- Always translate "${g.source}" as "${g.target}".` : `- Keep "${g.source}" verbatim (do not translate).`);
    }
  }
  lines.push(`\nSegments:`);
  for (const s of group.segments) {
    const role = s.metadata?.role ? ` (role: ${s.metadata.role})` : "";
    const notes = s.metadata?.notes ? ` [note: ${s.metadata.notes}]` : "";
    lines.push(`- id="${s.id}"${role}${notes}: ${s.text}`);
  }
  if (extras.suggestions && Object.keys(extras.suggestions).length) {
    lines.push(`\nPrior translations to consider (may be reused or adapted):`);
    for (const [id, sug] of Object.entries(extras.suggestions)) lines.push(`- id="${id}": ${sug}`);
  }
  if (extras.gateViolations?.length) {
    lines.push(`\nFix these mechanical problems in your previous attempt:`);
    for (const v of extras.gateViolations) lines.push(`- ${v}`);
  }
  if (extras.critique) lines.push(`\nReviewer critique to address:\n${extras.critique}`);
  return lines.join("\n");
}

export function buildReviewerPrompt(group: AssembledGroup, draft: Record<string, string>): string {
  const lines: string[] = [];
  lines.push(`You are a professional ${group.sourceLang}->${group.targetLang} translation reviewer.`);
  lines.push(`Judge the translations for accuracy, fluency, terminology, and tone, considering all segments together.`);
  lines.push(`Return JSON: {"passed": bool, "confidence": {"<id>": 0..1}, "critique": "actionable notes (empty if passed)"}.`);
  if (group.context) lines.push(`\nContext:\n${group.context}`);
  lines.push(`\nSource & translation pairs:`);
  for (const s of group.segments) {
    lines.push(`- id="${s.id}": SOURCE: ${s.text}  | TARGET: ${draft[s.id] ?? "(missing)"}`);
  }
  return lines.join("\n");
}

export function buildBackTranslationPrompt(group: AssembledGroup, draft: Record<string, string>): string {
  const lines: string[] = [];
  lines.push(`Translate the following from ${group.targetLang} back to ${group.sourceLang}.`);
  lines.push(`Return JSON: {"translations": {"<id>": "<back-translation>"}}.`);
  for (const s of group.segments) lines.push(`- id="${s.id}": ${draft[s.id] ?? ""}`);
  return lines.join("\n");
}
