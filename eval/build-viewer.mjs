// Build a self-contained interactive HTML viewer for the yaku eval results.
//
// Combines:
//   - eval/out/report.json (performance metrics)
//   - the original source records (for source text per field)
//   - eval/out/<id>.<lang>.json (translated records)
// into one embedded dataset, and writes eval/out/viewer.html — a single static
// file (no server, no network) with a metrics dashboard + field-by-field
// source/translation comparison.

import { readFileSync, writeFileSync } from "node:fs";
import { selectSegments } from "./select-fields.mjs";

const OUT_DIR = "eval/out";
const SRC_DIR = process.argv[2] ?? "/tmp/opencode/activities/activities_split";

const report = JSON.parse(readFileSync(`${OUT_DIR}/report.json`, "utf8"));
const langs = report.langs;

// Read a value at a dotted path (numeric parts = array indices).
function getByPath(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[/^\d+$/.test(p) ? Number(p) : p];
  }
  return cur;
}

// Build the per-field comparison rows for each record.
const records = [];
for (const rec of report.records) {
  const id = rec.id;
  const source = JSON.parse(readFileSync(`${SRC_DIR}/${id}.json`, "utf8"));
  const segs = selectSegments(source);
  const translated = {};
  for (const lang of langs) {
    translated[lang] = JSON.parse(readFileSync(`${OUT_DIR}/${id}.${lang}.json`, "utf8"));
  }
  const fields = segs.map((s) => {
    const row = { id: s.id, role: s.role, source: s.text, translations: {} };
    for (const lang of langs) {
      row.translations[lang] = getByPath(translated[lang], s.id) ?? "";
    }
    return row;
  });
  records.push({
    id,
    title: source.data.title,
    metrics: rec,
    fields,
  });
}

const dataset = {
  generatedAt: new Date().toISOString(),
  model: report.model,
  langs,
  totals: report.totals,
  records,
};

const json = JSON.stringify(dataset);

const html = renderHtml(json);
writeFileSync(`${OUT_DIR}/viewer.html`, html);
console.log(
  `wrote ${OUT_DIR}/viewer.html (${(html.length / 1024).toFixed(1)} KB, ${records.length} records, ${langs.join("+")})`
);

function renderHtml(dataJson) {
  // Note: the embedded data is assigned via JSON.parse of a string literal to
  // avoid any chance of </script> in the content breaking parsing — we escape
  // the closing-tag sequence defensively.
  const safe = dataJson.replace(/<\/script>/gi, "<\\/script>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>yaku — Translation Eval Viewer</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --panel2: #1e222b; --border: #2a2f3a;
    --fg: #e6e9ef; --muted: #9aa3b2; --accent: #6ea8fe; --good: #5bd6a0;
    --warn: #f0c674; --bad: #f06d6d; --chip: #232834;
    --src: #c9d1e0; --tgt: #e6e9ef;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans); font-size: 14px; line-height: 1.5; }
  header { padding: 20px 24px; border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 10; }
  header h1 { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -0.01em; }
  header .sub { color: var(--muted); font-size: 12.5px; margin-top: 4px; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  section { margin-bottom: 32px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; margin: 0 0 12px; }

  /* dashboard cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .card .k { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  .card .v { font-size: 22px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .card .v small { font-size: 13px; color: var(--muted); font-weight: 500; }
  .v.good { color: var(--good); } .v.bad { color: var(--bad); }

  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  th { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; background: var(--panel2); }
  tr:last-child td { border-bottom: none; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
  .pill.ok { background: rgba(91,214,160,.15); color: var(--good); }
  .pill.partial { background: rgba(240,198,116,.15); color: var(--warn); }
  .pill.failed { background: rgba(240,109,109,.15); color: var(--bad); }

  /* controls */
  .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
  .controls input[type=search], .controls select { background: var(--panel2); border: 1px solid var(--border); color: var(--fg); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: var(--sans); }
  .controls input[type=search] { min-width: 240px; flex: 1; }
  .controls label { color: var(--muted); font-size: 12.5px; display: inline-flex; gap: 6px; align-items: center; }
  .count { color: var(--muted); font-size: 12.5px; margin-left: auto; }

  /* comparison */
  .cmp { display: grid; gap: 10px; }
  .field { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .field .fhead { display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: var(--panel2); border-bottom: 1px solid var(--border); }
  .field .role { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent); }
  .field .path { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .field .recid { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .cols { display: grid; grid-template-columns: repeat(var(--ncols, 1), minmax(0, 1fr)); }
  .cols .cell { border-top: none; border-left: 1px solid var(--border); }
  .cols .cell:first-child { border-left: none; }
  @media (max-width: 900px) { .cols { grid-template-columns: 1fr !important; } .cols .cell { border-left: none; border-top: 1px solid var(--border); } }
  .cell .lang { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 3px; }
  .cell.source .lang { color: var(--muted); }
  .cell .txt { white-space: pre-wrap; word-break: break-word; }
  .cell.source .txt { color: var(--src); }
  .cell .txt mark { background: rgba(110,168,254,.28); color: inherit; border-radius: 2px; }
  .empty { color: var(--bad); font-style: italic; }
  footer { color: var(--muted); font-size: 12px; text-align: center; padding: 24px; border-top: 1px solid var(--border); }
  a { color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>yaku — Translation Evaluation</h1>
  <div class="sub" id="subline"></div>
</header>
<main>
  <section id="dash">
    <h2>Performance</h2>
    <div class="cards" id="cards"></div>
  </section>

  <section>
    <h2>Per-record / per-language</h2>
    <table id="recTable"><thead></thead><tbody></tbody></table>
  </section>

  <section>
    <h2>Field-by-field comparison</h2>
    <div class="controls">
      <input type="search" id="q" placeholder="Search source or translation text…">
      <label>Record
        <select id="fRecord"><option value="">all</option></select>
      </label>
      <label>Field role
        <select id="fRole"><option value="">all</option></select>
      </label>
      <span class="count" id="cmpCount"></span>
    </div>
    <div class="cmp" id="cmp"></div>
  </section>
</main>
<footer id="foot"></footer>

<script id="data" type="application/json">${safe}</script>
<script>
(function () {
  const DATA = JSON.parse(document.getElementById("data").textContent);
  const { totals: T, langs, model, records, generatedAt } = DATA;

  document.getElementById("subline").textContent =
    \`model: \${model}  ·  \${T.records} records × [\${langs.join(", ")}]  ·  generated \${new Date(generatedAt).toLocaleString()}\`;
  document.getElementById("foot").textContent =
    "yaku eval viewer · self-contained · " + records.reduce((n, r) => n + r.fields.length, 0) + " source fields";

  // ---- dashboard cards ----
  const allComplete = records.every(r =>
    Object.values(r.metrics.roundTrip).every(v => v.complete && v.noDuplicates));
  const cards = [
    ["Segment-translations", T.segments],
    ["Translated", T.translated],
    ["Reused (TM)", T.reused],
    ["Failed", T.failed, T.failed === 0 ? "good" : "bad"],
    ["Round-trip", allComplete ? "100%" : "FAIL", allComplete ? "good" : "bad"],
    ["Refine iterations", T.iterations],
    ["Tokens in/out", \`\${fmt(T.inputTokens)}<small> / \${fmt(T.outputTokens)}</small>\`],
    ["Est. cost (USD)", "$" + (T.estUsd ?? 0)],
    ["Wall time", (T.wallMs/1000).toFixed(1) + "<small>s</small>"],
  ];
  document.getElementById("cards").innerHTML = cards.map(([k, v, cls]) =>
    \`<div class="card"><div class="k">\${k}</div><div class="v \${cls||""}">\${v}</div></div>\`).join("");

  // ---- per-record table ----
  const thead = "<tr><th>Record</th><th>Title</th><th>Segments</th>" +
    langs.map(l => \`<th>\${l} (t/r/f)</th><th>\${l} iters</th>\`).join("") +
    "<th>ms</th><th>round-trip</th><th>status</th></tr>";
  const rows = records.map(r => {
    const m = r.metrics;
    const byLang = Object.fromEntries(m.perLanguage.map(p => [p.lang, p]));
    const langCells = langs.map(l => {
      const p = byLang[l] || {};
      return \`<td>\${p.translated||0}/\${p.reused||0}/\${p.failed||0}</td><td>\${p.iterations||0}</td>\`;
    }).join("");
    const rt = Object.entries(m.roundTrip).every(([_,v]) => v.complete && v.noDuplicates);
    return \`<tr>
      <td><code>\${r.id}</code></td>
      <td>\${esc(r.title).slice(0,46)}\${r.title.length>46?"…":""}</td>
      <td>\${m.segments}</td>
      \${langCells}
      <td>\${m.wallMs}</td>
      <td><span class="pill \${rt?"ok":"failed"}">\${rt?"OK":"BAD"}</span></td>
      <td><span class="pill \${m.status}">\${m.status}</span></td>
    </tr>\`;
  }).join("");
  const rt = document.getElementById("recTable");
  rt.querySelector("thead").innerHTML = thead;
  rt.querySelector("tbody").innerHTML = rows;

  // ---- comparison ----
  const allFields = [];
  for (const r of records) for (const f of r.fields) allFields.push({ ...f, recId: r.id });

  const roles = [...new Set(allFields.map(f => f.role))].sort();
  const recSel = document.getElementById("fRecord");
  records.forEach(r => recSel.add(new Option(r.id, r.id)));
  const roleSel = document.getElementById("fRole");
  roles.forEach(role => roleSel.add(new Option(role, role)));

  const q = document.getElementById("q");
  const cmp = document.getElementById("cmp");
  const cmpCount = document.getElementById("cmpCount");
  const ncols = langs.length + 1; // source + each language

  function render() {
    const term = q.value.trim().toLowerCase();
    const fr = recSel.value, ro = roleSel.value;
    const shown = allFields.filter(f => {
      if (fr && f.recId !== fr) return false;
      if (ro && f.role !== ro) return false;
      if (term) {
        const hay = (f.source + " " + langs.map(l => f.translations[l]||"").join(" ")).toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    cmpCount.textContent = shown.length + " / " + allFields.length + " fields";
    cmp.innerHTML = shown.map(f => {
      const cells = [\`<div class="cell source"><div class="lang">source · en</div><div class="txt">\${hl(f.source, term)}</div></div>\`]
        .concat(langs.map(l => {
          const t = f.translations[l];
          return \`<div class="cell"><div class="lang">\${l}</div><div class="txt">\${t ? hl(t, term) : '<span class="empty">— missing —</span>'}</div></div>\`;
        })).join("");
      return \`<div class="field">
        <div class="fhead">
          <span class="role">\${esc(f.role)}</span>
          <span class="path">\${esc(f.id)}</span>
          <span class="recid">\${f.recId}</span>
        </div>
        <div class="cols" style="--ncols:\${ncols}">\${cells}</div>
      </div>\`;
    }).join("") || '<div class="card">No fields match.</div>';
  }
  q.addEventListener("input", render);
  recSel.addEventListener("change", render);
  roleSel.addEventListener("change", render);
  render();

  // helpers
  function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function hl(s, term){ const e = esc(s); if(!term) return e; const i = e.toLowerCase().indexOf(esc(term).toLowerCase()); if(i<0) return e; const len = esc(term).length; return e.slice(0,i)+"<mark>"+e.slice(i,i+len)+"</mark>"+e.slice(i+len); }
  function fmt(n){ return n.toLocaleString(); }
})();
</script>
</body>
</html>`;
}
