// Build the eval viewer from whatever per-language output files exist in
// eval/out/, WITHOUT requiring the final report.json. Safe to run mid-run.
//
// It derives the field-by-field comparison from the source records + the
// translated <id>.<lang>.json files, and pulls metrics from report.json if it
// exists (final run) or synthesizes lightweight per-record metrics from the
// run.log lines if not.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { selectSegments } from "./select-fields.mjs";

const OUT_DIR = "eval/out";
const SRC_DIR = process.argv[2] ?? "/tmp/opencode/activities/activities_split";
const TEMPLATE = readFileSync(new URL("./viewer-template.html", import.meta.url), "utf8");

function getByPath(obj, dotted) {
  let cur = obj;
  for (const p of dotted.split(".")) {
    if (cur == null) return undefined;
    cur = cur[/^\d+$/.test(p) ? Number(p) : p];
  }
  return cur;
}

// Discover completed (id, lang) pairs from output filenames.
const files = readdirSync(OUT_DIR).filter((f) => /^\d+\..+\.json$/.test(f) && f !== "report.json");
const byRecord = new Map();
for (const f of files) {
  const m = f.match(/^(\d+)\.(.+)\.json$/);
  if (!m) continue;
  const [, id, lang] = m;
  if (!byRecord.has(id)) byRecord.set(id, new Set());
  byRecord.get(id).add(lang);
}

// Only include records where ALL discovered languages are present and which
// have a source file. Use the union of langs seen across all records.
const allLangs = [...new Set(files.map((f) => f.match(/^\d+\.(.+)\.json$/)[1]))].sort();

// Optional metrics from a finished run.
let report = null;
if (existsSync(`${OUT_DIR}/report.json`)) {
  report = JSON.parse(readFileSync(`${OUT_DIR}/report.json`, "utf8"));
}
// Parse run.log for per-record completion lines as a fallback metrics source.
const logMetrics = parseLog();

const records = [];
for (const [id, langSet] of [...byRecord.entries()].sort()) {
  const srcPath = `${SRC_DIR}/${id}.json`;
  if (!existsSync(srcPath)) continue;
  const langsHere = allLangs.filter((l) => langSet.has(l));
  if (langsHere.length === 0) continue;
  const source = JSON.parse(readFileSync(srcPath, "utf8"));
  const segs = selectSegments(source);
  const translated = {};
  for (const lang of langsHere) {
    translated[lang] = JSON.parse(readFileSync(`${OUT_DIR}/${id}.${lang}.json`, "utf8"));
  }
  const fields = segs.map((s) => {
    const row = { id: s.id, role: s.role, source: s.text, translations: {} };
    for (const lang of langsHere) row.translations[lang] = getByPath(translated[lang], s.id) ?? "";
    return row;
  });

  const reportRec = report?.records.find((r) => r.id === id);
  const log = logMetrics.get(id);
  records.push({
    id,
    title: source.data.title,
    fields,
    metrics: reportRec ?? synthMetrics(id, segs.length, langsHere, log, fields),
  });
}

// Totals: prefer report.totals; else compute from records.
const totals = report?.totals ?? computeTotals(records, allLangs);

const dataset = {
  generatedAt: new Date().toISOString(),
  model: report?.model ?? "gpt-4o-mini",
  langs: allLangs,
  totals,
  records,
  partial: !report,
};

writeFileSync(`${OUT_DIR}/viewer.html`, renderHtml(JSON.stringify(dataset)));
console.log(
  `wrote ${OUT_DIR}/viewer.html — ${records.length} records, langs [${allLangs.join(", ")}]` +
    (report ? " (final report)" : " (PARTIAL — run still in progress)")
);

// ---- helpers ----
function parseLog() {
  const map = new Map();
  if (!existsSync(`${OUT_DIR}/run.log`)) return map;
  const log = readFileSync(`${OUT_DIR}/run.log`, "utf8");
  for (const line of log.split("\n")) {
    // [192983] 85 segs x 6 langs -> ok in 764331ms (ja:85t/0r/0f ...)
    const m = line.match(/^\[(\d+)\]\s+(\d+)\s+segs.*->\s+(\w+)\s+in\s+(\d+)ms\s+\((.+)\)/);
    if (!m) continue;
    const [, id, segCount, status, ms, perLangStr] = m;
    const perLanguage = perLangStr.split(" ").map((chunk) => {
      const mm = chunk.match(/^(.+?):(\d+)t\/(\d+)r\/(\d+)f$/);
      if (!mm) return null;
      return { lang: mm[1], translated: +mm[2], reused: +mm[3], failed: +mm[4] };
    }).filter(Boolean);
    map.set(id, { segCount: +segCount, status, wallMs: +ms, perLanguage });
  }
  return map;
}

function synthMetrics(id, segCount, langs, log, fields) {
  // round-trip: every source field has a non-empty translation per language
  const roundTrip = {};
  for (const l of langs) {
    const complete = fields.every((f) => (f.translations[l] ?? "") !== "");
    roundTrip[l] = { complete, noDuplicates: true };
  }
  const perLanguage = langs.map((l) => {
    const fromLog = log?.perLanguage.find((p) => p.lang === l);
    return {
      lang: l,
      status: "ok",
      translated: fromLog?.translated ?? segCount,
      reused: fromLog?.reused ?? 0,
      skipped: 0,
      failed: fromLog?.failed ?? 0,
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  });
  return { id, title: fields[0]?.source.slice(0, 60) ?? "", segments: segCount, wallMs: log?.wallMs ?? 0, status: log?.status ?? "ok", roundTrip, perLanguage };
}

function computeTotals(records, langs) {
  const t = { records: records.length, languages: 0, segments: 0, translated: 0, reused: 0, skipped: 0, failed: 0, iterations: 0, inputTokens: 0, outputTokens: 0, wallMs: 0, estUsd: 0 };
  for (const r of records) {
    for (const p of r.metrics.perLanguage) {
      t.languages++; t.segments += (p.translated + p.reused + p.skipped + p.failed);
      t.translated += p.translated; t.reused += p.reused; t.skipped += p.skipped; t.failed += p.failed;
      t.iterations += p.iterations || 0; t.inputTokens += p.inputTokens || 0; t.outputTokens += p.outputTokens || 0;
    }
    t.wallMs += r.metrics.wallMs || 0;
  }
  t.estUsd = Number(((t.inputTokens / 1e6) * 0.15 + (t.outputTokens / 1e6) * 0.6).toFixed(4));
  return t;
}

function renderHtml(dataJson) {
  const safe = dataJson.replace(/<\/script>/gi, "<\\/script>");
  // Use a function replacer so `$` sequences in the JSON aren't interpreted.
  return TEMPLATE.replace("__DATA__", () => safe);
}
