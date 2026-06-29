import type { AssembledGroup } from "../gates/types.js";

/**
 * Customizable prompt strings for the translator, reviewer, and back-translation steps.
 * Any `instruction`/`jsonFormat` string may contain the `{sourceLang}` and `{targetLang}`
 * placeholders, which are substituted with the group's languages at build time.
 */
export interface PromptTemplates {
  translator: {
    instruction: string;
    jsonFormat: string;
    contextLabel: string;
    glossaryHeader: string;
    segmentsHeader: string;
    suggestionsHeader: string;
    gateViolationsHeader: string;
    critiqueHeader: string;
  };
  reviewer: {
    instruction: string;
    judgment: string;
    jsonFormat: string;
    contextLabel: string;
    pairsHeader: string;
  };
  backTranslation: {
    instruction: string;
    jsonFormat: string;
  };
}

export const DEFAULT_TEMPLATES: PromptTemplates = {
  translator: {
    instruction: "Translate the following segments from {sourceLang} to {targetLang}.",
    jsonFormat: 'Return JSON: {"translations": { "<segmentId>": "<translation>", ... }} for EVERY segment id.',
    contextLabel: "Background context (do not translate this, use it for understanding):",
    glossaryHeader: "Glossary rules:",
    segmentsHeader: "Segments:",
    suggestionsHeader: "Prior translations to consider (may be reused or adapted):",
    gateViolationsHeader: "Fix these mechanical problems in your previous attempt:",
    critiqueHeader: "Reviewer critique to address:",
  },
  reviewer: {
    instruction: "You are a professional {sourceLang}->{targetLang} translation reviewer.",
    judgment: "Judge the translations for accuracy, fluency, terminology, and tone, considering all segments together.",
    jsonFormat: 'Return JSON: {"passed": bool, "confidence": {"<id>": 0..1}, "critique": "actionable notes (empty if passed)"}.',
    contextLabel: "Context:",
    pairsHeader: "Source & translation pairs:",
  },
  backTranslation: {
    instruction: "Translate the following from {targetLang} back to {sourceLang}.",
    jsonFormat: 'Return JSON: {"translations": {"<id>": "<back-translation>"}}.',
  },
};

function fill(s: string, group: AssembledGroup): string {
  return s.replace(/\{sourceLang\}/g, group.sourceLang).replace(/\{targetLang\}/g, group.targetLang);
}

function escapeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\\n").replace(/\r/g, "\\n").replace(/\n/g, "\\n");
}

export interface TranslatorPromptExtras {
  critique?: string;
  gateViolations?: string[];
  suggestions?: Record<string, string>; // fuzzy TM hints, segmentId -> suggestion
}

export function buildTranslatorPrompt(
  group: AssembledGroup,
  extras: TranslatorPromptExtras,
  templates: PromptTemplates = DEFAULT_TEMPLATES
): string {
  const t = templates.translator;
  const lines: string[] = [];
  lines.push(fill(t.instruction, group));
  lines.push(fill(t.jsonFormat, group));
  if (group.context) lines.push(`\n${t.contextLabel}\n${group.context}`);
  if (group.glossary.length) {
    lines.push(`\n${t.glossaryHeader}`);
    for (const g of group.glossary) {
      lines.push(g.target ? `- Always translate "${g.source}" as "${g.target}".` : `- Keep "${g.source}" verbatim (do not translate).`);
    }
  }
  lines.push(`\n${t.segmentsHeader}`);
  for (const s of group.segments) {
    const role = s.metadata?.role ? ` (role: ${s.metadata.role})` : "";
    const notes = s.metadata?.notes ? ` [note: ${s.metadata.notes}]` : "";
    lines.push(`- id="${s.id}"${role}${notes}: ${escapeNewlines(s.text)}`);
  }
  if (extras.suggestions && Object.keys(extras.suggestions).length) {
    lines.push(`\n${t.suggestionsHeader}`);
    for (const [id, sug] of Object.entries(extras.suggestions)) lines.push(`- id="${id}": ${escapeNewlines(sug)}`);
  }
  if (extras.gateViolations?.length) {
    lines.push(`\n${t.gateViolationsHeader}`);
    for (const v of extras.gateViolations) lines.push(`- ${v}`);
  }
  if (extras.critique) lines.push(`\n${t.critiqueHeader}\n${extras.critique}`);
  return lines.join("\n");
}

export function buildReviewerPrompt(
  group: AssembledGroup,
  draft: Record<string, string>,
  templates: PromptTemplates = DEFAULT_TEMPLATES
): string {
  const t = templates.reviewer;
  const lines: string[] = [];
  lines.push(fill(t.instruction, group));
  lines.push(t.judgment);
  lines.push(t.jsonFormat);
  if (group.context) lines.push(`\n${t.contextLabel}\n${group.context}`);
  lines.push(`\n${t.pairsHeader}`);
  for (const s of group.segments) {
    lines.push(`- id="${s.id}": SOURCE: ${escapeNewlines(s.text)}  | TARGET: ${escapeNewlines(draft[s.id] ?? "(missing)")}`);
  }
  return lines.join("\n");
}

export function buildBackTranslationPrompt(
  group: AssembledGroup,
  draft: Record<string, string>,
  templates: PromptTemplates = DEFAULT_TEMPLATES
): string {
  const t = templates.backTranslation;
  const lines: string[] = [];
  lines.push(fill(t.instruction, group));
  lines.push(fill(t.jsonFormat, group));
  for (const s of group.segments) lines.push(`- id="${s.id}": ${escapeNewlines(draft[s.id] ?? "")}`);
  return lines.join("\n");
}
