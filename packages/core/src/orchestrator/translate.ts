import type { LLMProvider } from "../providers/types.js";
import type { TranslationMemory } from "../memory/types.js";
import type {
  TranslationRequest, TranslationResponse, LanguageResult, SegmentResult, Summary,
} from "../schemas/index.js";
import { resolveConfig } from "../schemas/index.js";
import { resolveGlossary } from "../glossary/glossary.js";
import { groupSegments } from "../assembly/assemble.js";
import { runGroupLoop } from "./group-loop.js";
import { CostTracker } from "../cost/budget.js";
import { sourceHash } from "../util/hash.js";
import type { AssembledGroup } from "../gates/types.js";
import type { GroupTraceJSON } from "../trace/trace.js";

export interface TranslateDeps {
  provider: LLMProvider;
  tm: TranslationMemory;
}

export async function translate(req: TranslationRequest, deps: TranslateDeps): Promise<TranslationResponse> {
  const baseConfig = resolveConfig(req.config ?? {});
  const groups = groupSegments(req.document.segments);
  const documentTraces: unknown[] = [];

  const results: LanguageResult[] = [];

  for (const targetLang of req.targetLangs) {
    const config = resolveConfig(baseConfig, targetLang);
    const cost = new CostTracker({ maxUsd: config.budget.maxUsd });
    const glossary = resolveGlossary(req.glossary, targetLang);
    const segResults: SegmentResult[] = [];
    let iterationsTotal = 0;

    const tasks: Array<() => Promise<void>> = [];
    for (const g of groups) {
      const dnt = g.segments.filter((s) => s.metadata?.doNotTranslate);
      const translatable = g.segments.filter((s) => !s.metadata?.doNotTranslate);
      for (const s of dnt) {
        segResults.push({ id: s.id, translatedText: s.text, status: "skipped", sourceHash: sourceHash(s.text) });
      }
      if (translatable.length === 0) continue;

      const assembled: AssembledGroup = {
        groupKey: g.groupKey, segments: translatable, sourceLang: req.sourceLang,
        targetLang, glossary, context: req.document.context,
      };
      tasks.push(async () => {
        try {
          const r = await runGroupLoop(assembled, { provider: deps.provider, tm: deps.tm, config, cost });
          segResults.push(...r.results);
          iterationsTotal += r.iterations;
          if (config.trace === "summary") {
            // Summary trace: keep the shape but drop per-iteration drafts —
            // surface only the stop reason and an iteration count per group.
            const t = r.trace as GroupTraceJSON;
            documentTraces.push({
              groupKey: t.groupKey,
              targetLang: t.targetLang,
              stopReason: t.stopReason,
              iterations: t.iterations.length,
            });
          } else if (config.trace !== "none") {
            documentTraces.push(r.trace);
          }
        } catch (err) {
          for (const s of translatable) {
            segResults.push({ id: s.id, translatedText: "", status: "failed", sourceHash: sourceHash(s.text), error: String(err) });
          }
        }
      });
    }

    await runBounded(tasks, config.concurrency);

    const orderIndex = new Map(req.document.segments.map((s, i) => [s.id, i]));
    segResults.sort((a, b) => (orderIndex.get(a.id)! - orderIndex.get(b.id)!));

    const summary = summarize(segResults, iterationsTotal, cost);
    const status = statusFor(segResults);
    results.push({ targetLang, status, segments: segResults, summary });
  }

  const docSummary = aggregate(results.map((r) => r.summary));
  const overall = worstStatus(results.map((r) => r.status));
  const response: TranslationResponse = {
    status: overall, sourceLang: req.sourceLang, results, summary: docSummary,
  };
  if (baseConfig.trace !== "none") {
    (response as { trace?: unknown }).trace = { documentId: req.document.id, groups: documentTraces };
  }
  return response;
}

async function runBounded(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      await tasks[idx]!();
    }
  });
  await Promise.all(workers);
}

function summarize(segs: SegmentResult[], iterationsTotal: number, cost: CostTracker): Summary {
  const count = (st: SegmentResult["status"]) => segs.filter((s) => s.status === st).length;
  return {
    total: segs.length,
    translated: count("translated"),
    reused: count("reused"),
    unchanged: count("unchanged"),
    failed: count("failed"),
    skipped: count("skipped"),
    iterationsTotal,
    cost: cost.total,
    budgetHit: cost.budgetExceeded() || undefined,
  };
}

function statusFor(segs: SegmentResult[]): "ok" | "partial" | "failed" {
  // Spec guarantee #5: a `failed` segment never aborts the document — it degrades
  // the language status to `partial`, never `failed`. A `failed` language status
  // is reserved for harder failures (not per-segment isolation), so any segment
  // failure here maps to `partial`.
  const failed = segs.filter((s) => s.status === "failed").length;
  return failed === 0 ? "ok" : "partial";
}

function worstStatus(statuses: Array<"ok" | "partial" | "failed">): "ok" | "partial" | "failed" {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("partial")) return "partial";
  return "ok";
}

function aggregate(summaries: Summary[]): Summary {
  const base: Summary = { total: 0, translated: 0, reused: 0, unchanged: 0, failed: 0, skipped: 0, iterationsTotal: 0, cost: { inputTokens: 0, outputTokens: 0, usd: 0 } };
  for (const s of summaries) {
    base.total += s.total; base.translated += s.translated; base.reused += s.reused;
    base.unchanged += s.unchanged; base.failed += s.failed; base.skipped += s.skipped;
    base.iterationsTotal += s.iterationsTotal;
    base.cost.inputTokens += s.cost.inputTokens; base.cost.outputTokens += s.cost.outputTokens;
    base.cost.usd = (base.cost.usd ?? 0) + (s.cost.usd ?? 0);
    if (s.budgetHit) base.budgetHit = true;
  }
  return base;
}
