import type { LLMProvider } from "../providers/types.js";
import type { TranslationMemory } from "../memory/types.js";
import type { TranslationConfig, SegmentResult } from "../schemas/index.js";
import type { AssembledGroup } from "../gates/types.js";
import { CostTracker } from "../cost/budget.js";
import { runGates } from "../gates/index.js";
import { sourceHash } from "../util/hash.js";
import { TranslationDraftSchema, ReviewSchema } from "./reviewer.js";
import { buildTranslatorPrompt, buildReviewerPrompt, buildBackTranslationPrompt, type PromptTemplates } from "./prompts.js";
import { semanticDrift } from "./back-translation.js";
import { GroupTrace, type StopReason } from "../trace/trace.js";

export interface GroupLoopDeps {
  provider: LLMProvider;
  tm: TranslationMemory;
  config: TranslationConfig;
  cost: CostTracker;
}

export interface GroupLoopResult {
  results: SegmentResult[];
  iterations: number;
  stopReason: StopReason;
  trace: ReturnType<GroupTrace["toJSON"]>;
}

export async function runGroupLoop(group: AssembledGroup, deps: GroupLoopDeps): Promise<GroupLoopResult> {
  const { provider, tm, config, cost } = deps;

  if (!config.models.translator) {
    throw new Error("runGroupLoop: config.models.translator is required");
  }
  if (config.reviewer.enabled && !config.models.reviewer) {
    throw new Error("runGroupLoop: config.models.reviewer is required when reviewer is enabled");
  }
  if (config.backTranslation.enabled && !config.models.backTranslator) {
    throw new Error("runGroupLoop: config.models.backTranslator is required when backTranslation is enabled");
  }

  const trace = new GroupTrace(group.groupKey, group.targetLang);
  const ns = config.tm.namespace;
  const templates = config.promptTemplates as PromptTemplates | undefined;

  // 1. TM LOOKUP
  const reused = new Map<string, { text: string; score: number }>();
  const suggestions: Record<string, string> = {};

  if (config.tm.enabled) {
    for (const seg of group.segments) {
      const exact = await tm.lookupExact(seg.text, group.sourceLang, group.targetLang, ns);
      if (exact) {
        reused.set(seg.id, { text: exact.translatedText, score: 1 });
        continue;
      }
      if (config.tm.fuzzy !== "off") {
        const fuzzy = await tm.lookupFuzzy(seg.text, group.sourceLang, group.targetLang, { threshold: config.tm.fuzzyThreshold, strategy: config.tm.fuzzy, limit: 1 }, ns);
        if (fuzzy[0]) suggestions[seg.id] = fuzzy[0].entry.translatedText;
      }
    }
  }

  const needLLM = group.segments.filter((s) => !reused.has(s.id));

  // All exact hits → done.
  if (needLLM.length === 0) {
    trace.finish("accepted");
    return finalize(group, reused, {}, {}, 1, "accepted", trace);
  }

  // 2-5. DRAFT → GATES → REVIEW → REVISE
  const llmGroup: AssembledGroup = { ...group, segments: needLLM };
  let draft: Record<string, string> = {};
  let confidence: Record<string, number> = {};
  let critique = "";
  let gateMsgs: string[] = [];
  let iteration = 0;
  let stopReason: StopReason = "max-iterations";

  while (iteration < config.maxIterations) {
    iteration++;

    const prompt = buildTranslatorPrompt(llmGroup, {
      critique: iteration > 1 ? critique : undefined,
      gateViolations: iteration > 1 ? gateMsgs : undefined,
      suggestions,
    }, templates);
    const draftRes = await provider.complete({
      role: "translator", system: "You are a professional translator.",
      prompt, schema: TranslationDraftSchema,
      model: config.models.translator!.model, temperature: config.models.translator!.temperature,
    });
    cost.add(draftRes.usage);
    draft = draftRes.value.translations;

    const violations = runGates(llmGroup, { translations: draft });
    gateMsgs = violations.map((v) => `[${v.gate}/${v.segmentId}] ${v.message}`);

    let reviewerPassed = false;
    if (config.reviewer.enabled) {
      const reviewRes = await provider.complete({
        role: "reviewer", system: "You are a translation reviewer.",
        prompt: buildReviewerPrompt(llmGroup, draft, templates), schema: ReviewSchema,
        model: config.models.reviewer!.model, temperature: config.models.reviewer!.temperature,
      });
      cost.add(reviewRes.usage);
      reviewerPassed = reviewRes.value.passed;
      confidence = reviewRes.value.confidence;
      critique = reviewRes.value.critique;
    } else {
      reviewerPassed = true;
    }

    trace.iteration({ draft: { ...draft }, gateViolations: gateMsgs, reviewerPassed, cost: cost.total });

    const gatesPass = violations.length === 0;
    if (gatesPass && reviewerPassed) { stopReason = "accepted"; break; }
    if (cost.budgetExceeded()) { stopReason = "budget-hit"; break; }
  }

  trace.finish(stopReason);

  // 6. OPTIONAL BACK-TRANSLATION (config-gated)
  if (config.backTranslation.enabled && stopReason === "accepted" && config.models.backTranslator) {
    const btRes = await provider.complete({
      role: "backTranslator", system: "You are a back-translation checker.",
      prompt: buildBackTranslationPrompt(llmGroup, draft, templates),
      schema: TranslationDraftSchema,
      model: config.models.backTranslator.model, temperature: config.models.backTranslator.temperature,
    });
    cost.add(btRes.usage);
    const back = btRes.value.translations;
    const drifted = needLLM.filter((s) => semanticDrift(s.text, back[s.id] ?? "") > config.backTranslation.driftThreshold);
    if (drifted.length > 0 && iteration < config.maxIterations) {
      // One bounded extra revise pass focused on drifted segments.
      iteration++;
      critique = `Back-translation drift detected on: ${drifted.map((s) => s.id).join(", ")}. Improve fidelity.`;
      const prompt = buildTranslatorPrompt(llmGroup, { critique, suggestions }, templates);
      const revRes = await provider.complete({
        role: "translator", system: "You are a professional translator.",
        prompt, schema: TranslationDraftSchema,
        model: config.models.translator!.model, temperature: config.models.translator!.temperature,
      });
      cost.add(revRes.usage);
      draft = revRes.value.translations;
      confidence = {}; // revised draft was not reviewed; prior confidence no longer applies
      // Re-gate the revised draft — the back-translation fix must not silently
      // reintroduce mechanical violations into committed output.
      const revViolations = runGates(llmGroup, { translations: draft });
      const revGateMsgs = revViolations.map((v) => `[${v.gate}/${v.segmentId}] ${v.message}`);
      trace.iteration({ draft: { ...draft }, gateViolations: revGateMsgs, reviewerPassed: false, cost: cost.total });
      // Only treat as a clean success if the revised draft still passes gates.
      stopReason = revViolations.length === 0 ? "back-translation-ok" : "max-iterations";
    } else {
      stopReason = "back-translation-ok";
    }
    trace.finish(stopReason);
  }

  // 7. COMMIT accepted translations to TM
  if (config.tm.enabled && (stopReason === "accepted" || stopReason === "back-translation-ok")) {
    for (const seg of needLLM) {
      const text = draft[seg.id];
      if (text !== undefined) {
        await tm.upsert({ sourceText: seg.text, sourceLang: group.sourceLang, targetLang: group.targetLang, translatedText: text, sourceHash: sourceHash(seg.text), namespace: ns });
      }
    }
  }

  return finalize(group, reused, draft, confidence, iteration, stopReason, trace);
}

function finalize(
  group: AssembledGroup,
  reused: Map<string, { text: string; score: number }>,
  draft: Record<string, string>,
  confidence: Record<string, number>,
  iterations: number,
  stopReason: StopReason,
  trace: GroupTrace
): GroupLoopResult {
  const results: SegmentResult[] = group.segments.map((seg) => {
    const hash = sourceHash(seg.text);
    const r = reused.get(seg.id);
    if (r) {
      return { id: seg.id, translatedText: r.text, status: "reused", sourceHash: hash, tmMatch: { type: "exact", score: 1 } };
    }
    const text = draft[seg.id];
    if (text === undefined) {
      return { id: seg.id, translatedText: "", status: "failed", sourceHash: hash, error: "no translation produced" };
    }
    return {
      id: seg.id, translatedText: text, status: "translated", sourceHash: hash,
      confidence: confidence[seg.id],
      warnings: stopReason !== "accepted" && stopReason !== "back-translation-ok" ? [`stopped: ${stopReason}`] : undefined,
    };
  });
  return { results, iterations, stopReason, trace: trace.toJSON() };
}
