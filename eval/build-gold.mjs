// Build a yaku-autotune gold set from the activities dataset.
//
// Reads activity records, extracts the translatable fields (via the shared
// select-fields helper), and writes one TranslationRequest-shaped JSON per
// record into the gold directory. These files are what `yaku-autotune run`
// loads from `--gold <dir>` and samples for each candidate evaluation.
//
// The gold files deliberately carry NO `config` block — autotune injects the
// candidate's config (and forces TM off) at evaluation time, so a fixed config
// here would just be ignored. We keep `sourceLang`, `targetLangs`, and the
// assembled `document` (id + context + segments).
//
// Usage:
//   node eval/build-gold.mjs                        # all records -> autotune/gold/
//   node eval/build-gold.mjs --records 192745,193628
//   node eval/build-gold.mjs --langs ja,ko,de --limit 8 --out autotune/gold
//
// Pick a HELD-OUT subset (records you are happy to optimize against) so the
// optimizer can't overfit to the same data you later translate in production.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { selectSegments } from "./select-fields.mjs";

// ---- args (same lightweight parser as run-eval.mjs) ----
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const DATA_DIR = args.data ?? "/tmp/opencode/activities/activities_split";
const LANGS = (args.langs ?? "ja,ko").split(",");
const OUT_DIR = args.out ?? "autotune/gold";
const LIMIT = args.limit ? Number(args.limit) : undefined;

let recordIds = args.records
  ? args.records.split(",")
  : readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));

if (LIMIT !== undefined) recordIds = recordIds.slice(0, LIMIT);

mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
let skipped = 0;

for (const id of recordIds) {
  let record;
  try {
    record = JSON.parse(readFileSync(join(DATA_DIR, `${id}.json`), "utf8"));
  } catch (err) {
    console.warn(`[${id}] could not read record (${String(err)}), skipping`);
    skipped++;
    continue;
  }

  const segments = selectSegments(record);
  if (segments.length === 0) {
    console.warn(`[${id}] no translatable segments, skipping`);
    skipped++;
    continue;
  }

  const title = record?.data?.title ?? id;
  const request = {
    sourceLang: "en",
    targetLangs: LANGS,
    document: {
      id,
      context: `Travel activity listing: "${title}". Translate marketing and policy copy naturally for travellers.`,
      segments: segments.map((s) => ({
        id: s.id,
        text: s.text,
        metadata: { role: s.role, group: s.group ?? s.role },
      })),
    },
  };

  writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(request, null, 2));
  written++;
  console.log(`[${id}] ${segments.length} segments -> ${OUT_DIR}/${id}.json`);
}

console.log(
  `\nGold set: ${written} record(s) written to ${OUT_DIR}/ (${skipped} skipped), langs=${LANGS.join(",")}.`
);
if (written < 3) {
  console.warn(
    `WARNING: autotune requires at least 3 gold records (MIN_GOLD). Add more before running 'yaku-autotune run'.`
  );
}
