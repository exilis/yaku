// yaku performance evaluation against the activities dataset.
//
// Translates a subset of activity records into multiple target languages using
// the real OpenAI provider, writes results back to the original JSON structure,
// validates the round-trip, and prints a performance report (latency, tokens,
// cost, iterations, gate/reviewer behaviour, TM reuse).
//
// Usage:
//   OPENAI_API_KEY=$(cat .openai-api-key) node eval/run-eval.mjs \
//     --records 192745,193628,204263 --langs ja,ko --model gpt-4o-mini

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  translate,
  OpenAIProvider,
  SqliteTranslationMemory,
} from "../packages/core/dist/index.js";
import { selectSegments, applyTranslations } from "./select-fields.mjs";

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const DATA_DIR = args.data ?? "/tmp/opencode/activities/activities_split";
const LANGS = (args.langs ?? "ja,ko").split(",");
const MODEL = args.model ?? "gpt-4o-mini";
const OUT_DIR = args.out ?? "eval/out";

let recordIds = args.records
  ? args.records.split(",")
  : readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY not set. Run: OPENAI_API_KEY=$(cat .openai-api-key) node eval/run-eval.mjs");
  process.exit(1);
}

// Shared provider + TM across the whole run so TM reuse can kick in.
const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const tm = new SqliteTranslationMemory(`${OUT_DIR}/eval-tm.sqlite`);

const config = {
  // models per role; reviewer kept distinct-capable but same model here per choice
  models: {
    translator: { provider: "openai", model: MODEL, temperature: 0 },
    reviewer: { provider: "openai", model: MODEL, temperature: 0 },
  },
  maxIterations: 3,
  reviewer: { enabled: true },
  tm: { enabled: true, fuzzy: "lexical", fuzzyThreshold: 0.9, namespace: "activities" },
  concurrency: Number(args.concurrency ?? 8),
  trace: "summary",
};

const runReport = {
  model: MODEL,
  langs: LANGS,
  records: [],
  totals: {
    records: 0,
    languages: 0,
    segments: 0,
    translated: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    wallMs: 0,
  },
};

// Rough gpt-4o-mini pricing (USD per 1M tokens) for a cost estimate.
const PRICE = { in: 0.15, out: 0.6 };

function estimateUsd(inTok, outTok) {
  return (inTok / 1e6) * PRICE.in + (outTok / 1e6) * PRICE.out;
}

const overallStart = performance.now();

for (const id of recordIds) {
  const record = JSON.parse(readFileSync(`${DATA_DIR}/${id}.json`, "utf8"));
  const segments = selectSegments(record);
  if (segments.length === 0) {
    console.warn(`[${id}] no translatable segments, skipping`);
    continue;
  }

  // Build a yaku request. Use the record title as context for coherence; group
  // segments by their role so related fields translate together.
  const request = {
    sourceLang: "en",
    targetLangs: LANGS,
    document: {
      id,
      context: `Travel activity listing: "${record.data.title}". Translate marketing and policy copy naturally for travellers.`,
      segments: segments.map((s) => ({
        id: s.id,
        text: s.text,
        metadata: { role: s.role, group: s.group ?? s.role },
      })),
    },
    config,
  };

  const t0 = performance.now();
  const res = await translate(request, { provider, tm });
  const wallMs = performance.now() - t0;

  // Round-trip validation: every input id present exactly once per language.
  const inputIds = new Set(segments.map((s) => s.id));
  const roundTrip = {};
  for (const lr of res.results) {
    const outIds = lr.segments.map((s) => s.id);
    const outSet = new Set(outIds);
    roundTrip[lr.targetLang] = {
      complete: outSet.size === inputIds.size && [...inputIds].every((i) => outSet.has(i)),
      noDuplicates: outIds.length === outSet.size,
    };
    // write back per language
    const translatedRecord = applyTranslations(record, lr.segments);
    writeFileSync(
      `${OUT_DIR}/${id}.${lr.targetLang}.json`,
      JSON.stringify(translatedRecord, null, 2)
    );
  }

  const rec = {
    id,
    title: record.data.title.slice(0, 60),
    segments: segments.length,
    wallMs: Math.round(wallMs),
    status: res.status,
    roundTrip,
    perLanguage: res.results.map((lr) => ({
      lang: lr.targetLang,
      status: lr.status,
      translated: lr.summary.translated,
      reused: lr.summary.reused,
      skipped: lr.summary.skipped,
      failed: lr.summary.failed,
      iterations: lr.summary.iterationsTotal,
      inputTokens: lr.summary.cost.inputTokens,
      outputTokens: lr.summary.cost.outputTokens,
    })),
  };
  runReport.records.push(rec);

  // accumulate totals
  runReport.totals.records++;
  for (const lr of res.results) {
    runReport.totals.languages++;
    runReport.totals.segments += lr.summary.total;
    runReport.totals.translated += lr.summary.translated;
    runReport.totals.reused += lr.summary.reused;
    runReport.totals.skipped += lr.summary.skipped;
    runReport.totals.failed += lr.summary.failed;
    runReport.totals.iterations += lr.summary.iterationsTotal;
    runReport.totals.inputTokens += lr.summary.cost.inputTokens;
    runReport.totals.outputTokens += lr.summary.cost.outputTokens;
  }

  console.log(
    `[${id}] ${segments.length} segs x ${LANGS.length} langs -> ${res.status} in ${Math.round(wallMs)}ms ` +
      `(${rec.perLanguage.map((p) => `${p.lang}:${p.translated}t/${p.reused}r/${p.failed}f`).join(" ")})`
  );
}

runReport.totals.wallMs = Math.round(performance.now() - overallStart);
runReport.totals.estUsd = Number(
  estimateUsd(runReport.totals.inputTokens, runReport.totals.outputTokens).toFixed(4)
);

writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(runReport, null, 2));

// ---- human-readable summary ----
const t = runReport.totals;
console.log("\n========== yaku eval report ==========");
console.log(`model:        ${MODEL}`);
console.log(`records:      ${t.records}   languages/record: ${LANGS.join(",")}`);
console.log(`segments:     ${t.segments} total (across all record x language results)`);
console.log(`translated:   ${t.translated}`);
console.log(`reused (TM):  ${t.reused}`);
console.log(`skipped:      ${t.skipped}`);
console.log(`failed:       ${t.failed}`);
console.log(`iterations:   ${t.iterations} (avg ${(t.iterations / Math.max(1, t.translated)).toFixed(2)} per translated seg)`);
console.log(`tokens:       ${t.inputTokens} in / ${t.outputTokens} out`);
console.log(`est. cost:    $${t.estUsd} (gpt-4o-mini rates)`);
console.log(`wall time:    ${(t.wallMs / 1000).toFixed(1)}s`);
const allComplete = runReport.records.every((r) =>
  Object.values(r.roundTrip).every((v) => v.complete && v.noDuplicates)
);
console.log(`round-trip:   ${allComplete ? "OK — every id present once per language" : "FAILED — see report.json"}`);
console.log(`outputs:      ${OUT_DIR}/<id>.<lang>.json  +  report.json`);
console.log("======================================");
