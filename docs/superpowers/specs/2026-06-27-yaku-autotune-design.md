# yaku Autotune — Autonomous Self-Improving Optimizer

**Date:** 2026-06-27
**Status:** Design approved, ready for implementation planning
**Scope:** A new `@yaku/autotune` package plus a minimal, backward-compatible
change to `@yaku/core` that makes prompt templates overridable. Autotune runs an
autonomous hill-climb loop that optimizes translation **quality** and **cost** by
tuning engine config knobs and prompt template text, evaluating candidates
against a held-out gold set with an LLM-as-judge, and persisting the winner as a
versioned profile.

> **Note on speed:** latency is intentionally NOT an optimization objective.
> Throughput is fundamentally an infrastructure/parallelization concern
> (`concurrency`, batching, queues) rather than a property of the config + prompt
> choices Autotune searches over. Optimizing for it would mostly duplicate the
> cost signal (e.g. "disable the reviewer"). The objective is therefore a clean
> two-dimensional tradeoff: **quality vs cost.**

---

## 1. Overview

Production translation needs more than a fixed pipeline — the best
model/reviewer/prompt combination for a given corpus, language set, and budget
is an empirical question. yaku already has a working agentic engine
(`@yaku/core`) and an eval harness (`eval/`) that measures cost (tokens)
deterministically and surfaces quality via a human-facing viewer. **Autotune
closes the loop:** it automatically proposes changes, measures whether they help,
and keeps what is better.

The mechanism:

> evaluate current best → LLM proposes a candidate → evaluate candidate on a
> cheap sample → keep it if it clears the quality floor and lowers cost →
> repeat until capped/converged → validate the winner on the full gold set →
> write a versioned profile + ledger entry.

**Nothing in the hot translation path changes by default.** The engine gains the
ability to load an optional *profile* (config overrides + prompt template
overrides). With no active profile, behavior is byte-for-byte identical to today.

### What it tunes (bounded search space)

1. **Config knobs** — `models.{translator,reviewer,backTranslator}` (provider +
   model + temperature), `maxIterations`, `reviewer.enabled`, `tm.fuzzy`,
   `tm.fuzzyThreshold`, `concurrency`.
2. **Prompt templates** — the *static instruction text* of the translator /
   reviewer / back-translation prompts.
3. The *combination* of the above.

### Explicitly out of scope

- Editing engine source code (gates, orchestrator, assembly). Config + prompts
  only — bounded, no code-review risk.
- Editing the judge model or judge prompt (frozen, see §2.2).
- Changing the I/O contract or segment-injection logic.

### Reused as-is

The existing translation + metrics-collection logic from `eval/`, the
deterministic gates, and the cost accounting already in `@yaku/core`.

---

## 2. Components

The package decomposes into small, independently-testable units. Every unit that
calls an LLM takes its provider as an injected dependency, so the whole system is
testable with `MockProvider` and no real API calls — matching how `@yaku/core`
is already built.

### 2.1 Gold set & sampler (`gold.ts`)
- Loads a held-out reference set of source records, stored under `autotune/gold/`.
- `sampleRecords(goldSet, n, seed)` → deterministic cheap subset for
  per-iteration eval; the full set is used for final winner validation.
- The gold set is **frozen**: the optimizer never trains the TM on it during
  search (TM disabled, or a throwaway namespace per candidate run) so quality
  cannot be gamed by memorization.
- Refuses to run on an empty / sub-minimum gold set (not enough signal).

### 2.2 Judge (`judge.ts`)
- `scoreTranslation(source, target, lang, judgeModel)` →
  `{ score: 0..100, dims: { adequacy, fluency, terminology, tone }, critique }`.
- **Fixed and independent**: the judge model and judge prompt are pinned per run
  and are NOT part of the search space. The optimizer cannot edit them. This is
  what keeps the metric honest and ungameable.
- Aggregates per-candidate quality (mean score), and also reports the **min**
  segment score so a single catastrophic translation is visible, not averaged
  away.

### 2.3 Candidate runner (`runner.ts`)
- Given a candidate (config + prompt-template overrides) and a record sample:
  runs `translate()` under that profile and collects:
  - **quality** (via the judge),
  - **cost** (tokens → USD),
  - **structural gate pass-rate**.
- Returns a `CandidateResult` metrics bundle. This is the one unit that spends
  money.

### 2.4 Proposer (`proposer.ts`)
- An LLM that reads the current best candidate, its metrics, and the judge
  critiques + gate failures, then emits the **next candidate** as a
  structured, Zod-validated diff — either a knob change or a prompt-template
  rewrite — with a one-line rationale.
- Validates each proposal against the allowed search space **before** spending:
  rejects anything that touches the judge, the gold set, breaks the JSON
  contract, or sets an out-of-bounds knob. On rejection the proposer gets the
  reason and retries up to `maxProposalRetries` (default 3).

### 2.5 Objective & selector (`objective.ts`)
- Implements the lexicographic rule:
  1. `quality >= floor` (hard gate), then
  2. minimize `cost` (USD).
- `isBetter(candidate, best)` → boolean. `floor` is configurable. Cost deltas
  below an epsilon are treated as "not better" to avoid churning on
  floating-point noise.

### 2.6 Orchestrator (`optimize.ts`)
- The hill-climb loop. Enforces the iteration cap, budget cap, and plateau
  early-stop. Calls proposer → runner → selector, and appends a ledger entry
  every iteration.

### 2.7 Profile store (`profile.ts`)
- Reads/writes versioned profiles
  (`autotune/profiles/<name>-v<N>.json`), maintains the `active.json` pointer,
  and appends to the run ledger (`autotune/ledger.jsonl`). Profiles are
  immutable once written.

### 2.8 CLI entry (`cli.ts`)
- `yaku-autotune run …`, `yaku-autotune profiles`, `yaku-autotune show <run>`.

---

## 3. Data flow (one optimization run)

```
yaku-autotune run --profile activities --floor 85 --max-iter 12 --budget 5.00 \
                  --sample 6 --langs ja,ko --judge-model gpt-4o

1. INIT
   - load gold set (autotune/gold/*.json)
   - baseline candidate = active profile (or engine defaults if none)
   - evaluate baseline on the seeded sample -> CandidateResult
   - best := baseline ; ledger.append(iteration 0)

2. LOOP  (until iteration cap OR budget spent OR plateau)
   a. proposer reads (best candidate + best metrics + judge critiques + gate fails)
      -> proposes ONE candidate (config diff or prompt rewrite) + rationale
   b. validate proposal against the allowed search space (illegal -> retry/skip)
   c. runner evaluates the candidate on the SAME seeded sample (fair compare)
      -> CandidateResult
   d. selector.isBetter(candidate, best)?
        - quality >= floor AND cost < best's -> ACCEPT:
          best := candidate, reset plateau counter
        - else -> REJECT, plateau counter++
   e. ledger.append(iteration n: candidate, metrics, decision, rationale, spend)
   f. if plateau counter >= K -> break

3. VALIDATE WINNER
   - re-evaluate `best` on the FULL gold set (not just the sample)
   - if it still clears the floor -> confirmed; else fall back to last confirmed

4. PERSIST
   - write profiles/<name>-v<N+1>.json (winning config + prompt templates)
   - mark active (unless --dry-run)
   - final ledger summary + human-readable report (autotune/out/<run>.md)
```

### Invariants
- **Fair comparison:** every candidate in a run is scored on the identical
  seeded sample, so deltas are real signal, not sampling noise.
- **Budget checked before spending:** the loop never starts a runner call it
  cannot afford; it stops cleanly rather than overshooting the cap.
- **Baseline is always candidate 0:** the report always reads "improved X% over
  the starting point" or honestly "no improvement found, keeping baseline."
- **Cheap search / expensive confirm:** sample during the loop; the full gold
  set is evaluated only once, on the single winner.
- **One candidate per iteration:** simplest correct hill-climb.

---

## 4. Core change: overridable prompt templates

The only change to `@yaku/core`. Minimal and backward-compatible.

**Today:** `prompts.ts` has three functions
(`buildTranslatorPrompt` / `buildReviewerPrompt` / `buildBackTranslationPrompt`)
that hard-code their instruction text interleaved with dynamic assembly
(segments, glossary, critique). They are called from `group-loop.ts`.

**Change:** split each prompt into a **static template** (tunable) and **dynamic
assembly** (frozen in code). Introduce a `PromptTemplates` object:

```ts
interface PromptTemplates {
  translator: {
    instruction: string;   // e.g. "Translate the following segments from {sourceLang} to {targetLang}."
    jsonFormat: string;    // the "Return JSON: ..." contract line
    // section labels for context / glossary / segments / critique
  };
  reviewer: { instruction: string; jsonFormat: string; /* ... */ };
  backTranslation: { instruction: string; jsonFormat: string };
}
```

- The three build functions gain an **optional** `templates?` parameter that
  defaults to `DEFAULT_TEMPLATES` — which reproduces today's wording exactly.
  Templates use simple `{sourceLang}` / `{targetLang}` placeholders filled by
  code.
- All dynamic logic (looping segments, injecting glossary rules, appending gate
  violations and critique) stays in the function body, unchanged. The optimizer
  only ever rewrites the static instruction strings — it cannot break the
  segment-injection logic.
- `translate()` / config gains an optional `promptTemplates?: PromptTemplates`,
  threaded down to `group-loop.ts`. A profile carries `promptTemplates` and the
  engine merges it the same way it merges config.

### Why this shape
- **Safety:** the optimizer rewrites prose, not control flow. The
  `{"translations": {...}}` JSON contract the parser depends on is preserved
  structurally; even a candidate with a bad `jsonFormat` string simply scores
  terribly and is rejected by the selector — self-correcting.
- **Backward compatible:** every existing call works untouched;
  `DEFAULT_TEMPLATES` reproduces current output byte-for-byte, so existing
  `prompts.test.ts` still passes.
- **Profile-loadable:** the same merge path used for config carries the
  templates.

A cheap guard in the proposer's validation step ensures a rewritten `jsonFormat`
still contains the required `{"translations"` / `{"passed"` tokens — caught
before any money is spent.

---

## 5. Persisted artifacts

### Profile — what the engine consumes
`autotune/profiles/<name>-v<N>.json`:
```jsonc
{
  "name": "activities",
  "version": 3,
  "createdAt": "2026-06-27T...",
  "parentVersion": 2,                 // lineage
  "config": { /* partial TranslationConfig: models, maxIterations, reviewer, tm, ... */ },
  "promptTemplates": { /* translator / reviewer / backTranslation static text */ },
  "provenance": {
    "runId": "run-2026-06-27-...",
    "goldSet": "activities", "sample": 6, "langs": ["ja", "ko"],
    "judgeModel": "gpt-4o",           // pinned, for honest cross-version comparison
    "objective": { "floor": 85 }
  },
  "metrics": { "quality": 89.2, "estUsd": 0.41, "gatePassRate": 1.0 }
}
```
`autotune/profiles/active.json` is a tiny pointer recording the live profile
name+version. The engine loads it (or nothing) at startup.

### Ledger — append-only audit trail
`autotune/ledger.jsonl`, one line per iteration across all runs:
```jsonc
{"runId":"...","iter":4,"candidate":{"diff":"reviewer.enabled=false"},
 "rationale":"judge floor cleared at iter2 without reviewer; cutting cost",
 "metrics":{"quality":86.1,"estUsd":0.22},
 "decision":"accept","spendSoFar":1.84,"best":true}
```
Never rewritten — a full forensic record of every candidate, the proposer's
reasoning, and each accept/reject decision.

### Report — human-facing output
`autotune/out/<runId>.md`:
- Baseline vs winner table (quality / cost / gate-pass, with % deltas).
- The accepted change-set with rationales (what actually moved the needle).
- Rejected-but-interesting candidates (what was tried and didn't help).
- Convergence note (hit cap / hit budget / plateaued) and total spend.
- The winning prompt-template diffs, inline.

### Revert story
Profiles are versioned and immutable, so rollback is just repointing
`active.json` to an earlier version — no source changes to undo.

---

## 6. Error handling, edge cases & testing

### Failure handling during a run
- **Invalid/illegal candidate** (touches judge, breaks JSON contract,
  out-of-bounds knob): rejected at validation *before* spending; proposer retries
  with the reason up to `maxProposalRetries` (default 3), then the iteration is
  skipped (counts toward plateau).
- **Candidate run errors mid-eval** (provider 5xx, timeout, partial doc): the
  candidate scores as failed (quality 0), is rejected, the run continues. One
  bad candidate never aborts the loop.
- **Judge fails on a segment:** that segment's score is excluded with a logged
  warning; if more than X% of judging fails, the candidate is marked
  unscoreable and rejected (a partial quality number can't be trusted).
- **Budget exhausted mid-iteration:** never starts an unaffordable runner call;
  stops cleanly, persists best-so-far, report notes "stopped: budget."
- **No candidate beats baseline:** winner = baseline; no spurious new version is
  written; the report says so honestly. The loop never invents an improvement.
- **Crash / interrupt mid-run:** the ledger is append-only and flushed per
  iteration, so a killed run is reconstructable; `--resume <runId>` restores
  best from the ledger and continues.

### Edge cases
- Empty / tiny gold set → refuse to run.
- `--dry-run` → does everything, writes report + would-be profile, but does NOT
  flip `active.json`.
- Float noise → quality deltas below an epsilon count as "not better."

### Testing strategy (unit tests with `MockProvider`, mirroring core)
- `objective.test.ts` — lexicographic `isBetter`: floor-not-cleared loses
  regardless of cheapness; both clear floor → cheaper wins; epsilon handling.
- `proposer.test.ts` — validation rejects illegal proposals (judge edit, broken
  `jsonFormat`, out-of-range knob); valid diff parses.
- `profile.test.ts` — version increment, lineage, active-pointer, immutability;
  ledger append-only.
- `runner.test.ts` — with mock provider: assembles the metrics bundle; a forced
  run error → quality 0.
- `gold.test.ts` — deterministic seeded sampling; same seed → same subset.
- `optimize.test.ts` — full loop with a scripted mock proposer + mock provider:
  verifies cap / budget / plateau stops, accept/reject decisions, and the
  baseline-wins path. No real API calls.
- Addition to core `prompts.test.ts` — `DEFAULT_TEMPLATES` reproduces current
  output; overrides apply.

The full loop is end-to-end testable with mocks because every spending unit
takes its provider as an injected dependency.

---

## Appendix: relationship to existing `eval/`

The current `eval/run-eval.mjs` harness collects cost/speed/round-trip metrics
over the activities dataset and feeds the self-contained viewer. Autotune reuses
the same translation-and-measure pattern but adds: (1) the frozen LLM judge for a
quality *score*, (2) the proposer/selector hill-climb, and (3) versioned
profiles + ledger. The eval harness remains useful as a standalone reporting
tool; autotune is the closed-loop optimizer built on the same foundations.
