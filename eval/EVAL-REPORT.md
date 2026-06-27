# yaku Performance Evaluation — activities dataset

**Date:** 2026-06-26
**Dataset:** `tmp/activities_split.zip` — 15 real travel-activity records (English
source), deeply nested JSON with translatable copy scattered across `title`,
`description`, `highlights[]`, `options[].title`, nested
`inclusions/requirements/additional_infos/restrictions[].text`,
`itineraries[].summaries[].title/description`, location `name/address`, and
policy `display_text` fields.
**Engine:** `@yaku/core` agentic refine loop, real OpenAI provider.
**Model:** `gpt-4o-mini` for both translator and reviewer.
**Scope:** full corpus — all 15 records × 6 languages
(ja, ko, zh-Hans 簡体字, zh-Hant 繁体字, de, es).

## Headline results (full 15 × 6 run)

| Metric | Value |
|---|---|
| Records × languages | 15 × 6 = 90 document translations |
| Total segment-translations | 20,544 |
| Translated | 20,474 |
| Reused from TM | 70 |
| Skipped | 0 |
| Failed | **0** |
| Round-trip integrity | **100% — every input id present exactly once in all 90 results** |
| Refine iterations | 898 (avg **0.04** extra revisions per translated segment) |
| Tokens | 3,195,779 in / 1,369,487 out |
| Estimated cost | **~$1.30** (gpt-4o-mini rates) |
| Wall time | 10,072 s (~2h 48m, concurrency 8) |

### Per-language totals (across all 15 records)

| Lang | Translated | Reused | Failed | Iterations | Tokens (in / out) |
|---|---|---|---|---|---|
| ja | 3,410 | 14 | 0 | 132 | 477,945 / 198,638 |
| ko | 3,408 | 16 | 0 | 131 | 480,321 / 197,562 |
| zh-Hans | 3,415 | 9 | 0 | 159 | 541,002 / 233,901 |
| zh-Hant | 3,418 | 6 | 0 | 156 | 503,831 / 205,722 |
| de | 3,413 | 11 | 0 | 167 | 622,502 / 284,020 |
| es | 3,410 | 14 | 0 | 153 | 570,178 / 249,644 |

Zero failures and full round-trip integrity held across every language and every
record, including the three largest (535, 567, and 668 translatable fields).
Six scripts/locales handled correctly, including the Simplified vs Traditional
Chinese distinction (e.g. 小世界东京 vs 小小世界東京).

---

## Pilot results (3 records × 2 languages — earlier smoke run)

| Metric | Value |
|---|---|
| Records × languages | 3 × 2 = 6 document translations |
| Total segment-translations | 228 |
| Translated / Reused / Failed | 225 / 3 / 0 |
| Round-trip integrity | 100% |
| Estimated cost | ~$0.027 |
| Wall time | 379 s |

## Per-record breakdown

| Record | Segments | ja (t/r/f, iters) | ko (t/r/f, iters) | Status |
|---|---|---|---|---|
| 192745 | 15 | 15/0/0, 9 | 15/0/0, 8 | ok |
| 193628 | 65 | 65/0/0, 7 | 64/1/0, 5 | ok |
| 204263 | 34 | 33/1/0, 13 | 33/1/0, 11 | ok |

## What worked well

- **Structured round-trip is flawless.** The motivating use case — translatable
  fields scattered across a nested record, assembled for context, written back
  to their exact origin paths — works end to end. Every non-text field
  (currencies `JPY`/`USD`, image URLs, geo coordinates, prices, region codes,
  enum values, dates) was left byte-for-byte untouched; only human copy changed.

- **Translation quality is genuinely good.** Natural, fluent ja/ko output.
  Brand names handled correctly (e.g. "SMALL WORLDS Tokyo" preserved verbatim
  inside translated titles). Marketing tone preserved; policy text rendered
  precisely.

- **Zero failures, zero gate violations surfaced.** All 228 segment-translations
  reached `translated`/`reused` status; no segment failed, no document degraded
  to `partial`.

- **Translation memory reuse engaged.** 3 segments were served from exact TM
  hits (recurring source strings across records/languages) with no model call —
  the cross-run consistency + cost-saving mechanism works in practice.

- **Refine loop is efficient.** Average 0.24 extra revision iterations per
  segment means most drafts passed the deterministic gates + independent
  reviewer on the first attempt; the loop only spent extra cycles where the
  reviewer demanded improvement.

## Observations / limitations

- **Latency is the main cost.** ~63 s per document, dominated by the larger
  record (204263 took ~227 s for both languages). The engine translates per
  (segment-group × language) with the full draft→gate→review loop; with
  `concurrency: 4` and gpt-4o-mini, throughput is fine for batch/offline use but
  would benefit from higher concurrency or batched group prompts for
  interactive use.

- **The reviewer roughly doubles token cost.** Each accepted group incurs a
  translator call plus a reviewer call. This is the deliberate quality tradeoff;
  disabling the reviewer (`reviewer.enabled: false`) or using a cheaper reviewer
  would cut cost where speed/budget matter more than the extra quality gate.

- **TM reuse was modest (3/228)** because the 3 records are largely distinct
  content; reuse would climb sharply on re-runs or on a corpus with shared
  boilerplate (common policies, standard inclusions).

- **Field selection is dataset-specific.** The eval's `select-fields.mjs` encodes
  which JSON paths are translatable for this schema. A production integration
  would own this mapping (the engine itself stays storage/schema-agnostic — it
  only sees segments keyed by id).

## Reproduce

```bash
# extract dataset to /tmp/opencode/activities/ first (unzip tmp/activities_split.zip)
# full corpus, six languages:
OPENAI_API_KEY=$(cat .openai-api-key) \
  node eval/run-eval.mjs --langs ja,ko,zh-Hans,zh-Hant,de,es --concurrency 8 --model gpt-4o-mini
# outputs: eval/out/<id>.<lang>.json + eval/out/report.json + eval/out/run.log

# build the interactive viewer (works mid-run too):
node eval/build-viewer-partial.mjs        # -> eval/out/viewer.html (self-contained)
```

## Verdict

At full-corpus scale — **90 document translations, 20,544 segment-translations,
6 languages/scripts, zero failures, 100% round-trip integrity** — yaku performs
its core job reliably on real, messy, deeply-nested data. It selects and
assembles translatable copy, produces high-quality multi-language translations
through the agentic refine loop, and writes results back to the original
structure intact, for **~$1.30** total. The very low average revision rate
(0.04 iterations/segment) shows most drafts pass the deterministic gates +
independent reviewer on the first attempt.

The engine is functionally production-shaped. The one practical scaling lever is
**throughput**: ~2h48m wall time at concurrency 8 is fine for offline/batch
localization but would benefit from higher concurrency, batched group prompts,
or a durable queue for very large or latency-sensitive workloads. The reviewer
roughly doubles token cost — a deliberate quality gate that can be relaxed where
budget/speed dominate.

Explore the results interactively in `eval/out/viewer.html` (self-contained):
a performance dashboard, per-record/per-language table, and a searchable
field-by-field source↔6-language comparison.
