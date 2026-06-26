# yaku — Agentic Translation Engine — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan

## 1. Summary

**yaku** is a production-quality translation engine built around an *agentic
refine loop* rather than one-shot LLM translation. A draft is produced, then
iteratively reviewed and refined against deterministic quality gates and an
independent LLM-as-judge, with optional back-translation verification, until it
passes or a budget is hit.

One core engine is exposed through three thin front doors — **CLI**, **HTTP
API**, and **MCP server** — all sharing a single, Zod-validated structured I/O
contract.

The engine is **storage-agnostic**: input and output are structured documents of
*segments* keyed by stable ids. This directly serves the motivating use case —
web-page content stored across separate DB fields must be assembled together for
full context before translation, then written back to the original separate
fields. The caller owns DB read/write and maps segment ids ↔ DB fields; the
engine never touches the database.

Native **multi-target** translation: a single source document is translated into
many target languages at once, with the source treated as a single anchor for
everything shared (detection, context assembly, hashing, glossary) to maximize
cross-language consistency.

## 2. Goals & Non-Goals

### Goals
- Agentic review/refine loop producing production-quality output.
- Structured input/output suitable for round-tripping into separate DB fields.
- Full context assembly across fragmented fields, with per-id write-back.
- Native multi-language (one source → many targets) with strong consistency.
- Three execution surfaces (CLI, API, MCP) over one shared contract.
- Pluggable LLM providers (per-role model selection).
- Translation memory (TM) with exact + fuzzy matching, pluggable backends.
- Glossary / terminology control enforced deterministically.
- Bounded-parallel batch processing with graceful partial failure.
- Observability: per-document run traces, token/cost accounting, budget caps.

### Non-Goals (v1)
- The engine owning DB schema / read-write adapters (caller owns persistence).
- Durable job queue / async worker model for the API (documented future ext).
- Runtime plugin discovery for surfaces (interfaces are compile-time).
- A translation UI / web frontend.

## 3. Architecture & Package Layout

TypeScript pnpm monorepo. One engine, three thin surfaces. Surfaces contain **no
translation logic** — they parse transport input into a `TranslationRequest`,
call `core.translate()`, and serialize the `TranslationResponse` back.

```
yaku/  (pnpm monorepo, TypeScript strict)
├── packages/
│   ├── core/        @yaku/core  — the engine (all domain logic)
│   ├── cli/         @yaku/cli   — `yaku` command, thin wrapper
│   ├── api/         @yaku/api   — HTTP server (createServer), thin wrapper
│   └── mcp/         @yaku/mcp   — MCP server (stdio), thin wrapper
├── docs/superpowers/specs/      — design docs
├── pnpm-workspace.yaml
├── turbo.json                   — build orchestration (or tsc project refs)
└── package.json
```

### core internal modules (each a focused, independently testable unit)
- `schemas/` — Zod schemas for Request/Response/Segment/Config. Types via
  `z.infer`. **Single source of truth** for the I/O contract across all surfaces.
- `orchestrator/` — the agentic refine loop (§6).
- `providers/` — `LLMProvider` interface + adapters; rate-limit/backoff/retry.
- `memory/` — `TranslationMemory` interface + SQLite & Postgres adapters; both
  fuzzy strategies; optional `EmbeddingProvider`.
- `gates/` — deterministic validators (placeholders, markup, glossary, length,
  leftover-source).
- `glossary/` — glossary model + enforcement.
- `assembly/` — segment → context-block assembly and de-assembly.
- `batch/` — bounded-parallelism document runner with per-doc isolation.
- `trace/` + `cost/` — run traces, token/cost accounting, budget enforcement.

### Rationale
Chosen over (a) a single multi-entrypoint package — which bundles API/MCP/CLI
deps together and enforces boundaries only by convention — and (b) a
plugin-registry architecture — over-engineered for v1 (YAGNI). The monorepo
expresses the mental model directly (one engine, three front doors), keeps
surfaces trivially thin, and the shared Zod schemas guarantee the structured I/O
contract never drifts between CLI, API, and MCP.

## 4. Structured I/O Contract

All schemas are Zod (in `@yaku/core/schemas`); TypeScript types are derived via
`z.infer`. This contract is shared verbatim by CLI, API, and MCP.

### TranslationRequest
```
TranslationRequest {
  sourceLang: string | "auto"        // e.g. "en", or auto-detect
  targetLangs: string[]              // one or many; a single language is a list of one
  document: {
    id?: string                      // optional doc id (for traces / TM scoping)
    segments: Segment[]              // the translatable units
    context?: string                 // OPTIONAL caller-assembled background, read-only
  }
  glossary?: GlossaryEntry[]         // global by default; per-language via lang?
  config?: TranslationConfig         // overrides engine defaults (§8)
}

Segment {
  id: string                         // STABLE round-trip key ↔ caller's DB field
  text: string                       // source text for this field
  metadata?: {
    role?: string                    // "title" | "body" | "cta" | free-form — aids assembly
    group?: string                   // segments sharing a group are assembled together
    order?: number                   // ordering hint within a group
    maxChars?: number                // length budget → length gate
    doNotTranslate?: boolean         // returned verbatim, status "skipped"
    notes?: string                   // freeform hint passed to the LLM ("formal tone")
  }
}

GlossaryEntry {
  source: string
  target?: string                    // present = forced mapping; absent = do-not-translate term
  caseSensitive?: boolean
  lang?: string                      // scopes a forced mapping to one target language
}
```

### TranslationResponse
```
TranslationResponse {
  status: "ok" | "partial" | "failed"   // worst across all languages
  sourceLang: string                    // resolved once (after auto-detect)
  results: LanguageResult[]             // one per target language
  summary: {                            // aggregated across all languages
    total, translated, reused, unchanged, failed, skipped: number
    iterationsTotal: number
    cost: { inputTokens, outputTokens, usd? }
    budgetHit?: boolean
  }
  trace?: DocumentTrace                 // opt-in (config.trace)
}

LanguageResult {
  targetLang: string
  status: "ok" | "partial" | "failed"
  segments: SegmentResult[]             // every input id appears exactly once
  summary: { total, translated, reused, unchanged, failed, skipped,
             iterationsTotal, cost }
}

SegmentResult {
  id: string
  translatedText: string
  status: "translated" | "reused" | "unchanged" | "skipped" | "failed"
  sourceHash: string                    // for incremental re-runs / change-detection
  tmMatch?: { type: "exact" | "fuzzy", score: number }
  confidence?: number                   // 0..1 from reviewer
  warnings?: string[]                   // e.g. ["length exceeds maxChars"]
  error?: string                        // present iff status === "failed"
}
```

### Guarantees (enforced in core)
1. Every input segment id appears exactly once in every `LanguageResult.segments`.
2. `doNotTranslate` segments returned verbatim, status `skipped`.
3. Placeholders/variables (`{name}`, `%s`, `{{x}}`, `<b>…</b>`) preserved —
   enforced by deterministic gates.
4. `sourceHash` (stable across languages) lets a re-run skip unchanged segments
   (reused from TM, or marked `unchanged`).
5. A `failed` segment never aborts the document; the language/document status
   becomes `partial`.

## 5. Multi-Language Consistency Model

Multi-target is native (`targetLangs[]`). The **source is the single anchor** for
everything shared; only genuinely language-specific details vary.

### Shared once across all languages (consistency anchors)
- Source auto-detection — resolved one time.
- Context assembly — segments arranged into the context block exactly once;
  every language translates from the same assembled understanding.
- `sourceHash` per segment — computed once, identical across languages; keeps
  incremental re-runs and change-detection aligned across all locales.
- Glossary do-not-translate terms — global by default.
- Segment structure & ids — identical id set guaranteed in every `LanguageResult`.

### Allowed to vary per language (only where correctness requires)
- Forced glossary *mappings* (e.g. "Sign in" → "ログイン" ja vs "로그인" ko),
  scoped via `GlossaryEntry.lang`.
- Config such as tone/formality, via optional `config.perLanguage[lang]` override.
- Per-language status (one locale can be `partial` without affecting others).

### Rule: global-by-default, override opt-in
Glossary and config default to **global**. If the caller does nothing, every
language uses the same glossary and config — consistency is the default. Per-
language variation is introduced only deliberately, exactly where divergence is
correct. This avoids accidental drift while supporting genuine locale needs.

## 6. The Agentic Refine Loop

The `orchestrator` runs this loop **per (segment-group × target language)** — a
group is the unit translated together for context.

```
1. TM LOOKUP (before any LLM call)
   - For each segment: lookup (sourceText, sourceLang, targetLang, namespace).
   - exact hit  → mark "reused", skip LLM entirely.
   - fuzzy hit  → keep as a SUGGESTION fed into the translator prompt
                  (never auto-accepted).
   - miss       → normal path.
   - If every segment in the group is an exact hit → group done, zero LLM cost.

2. DRAFT (translator model)
   - Assemble the group (+ optional caller context, + fuzzy TM suggestions,
     + glossary, + per-segment role/notes) into one prompt.
   - Produce structured draft { segmentId → translation } via the provider's
     Zod-validated structured-output parsing.

3. DETERMINISTIC GATES (no LLM, cheap, run cheap-first):
   - placeholder/variable preservation ({name}, %s, {{x}})
   - HTML/markup tag integrity
   - glossary enforcement (do-not-translate verbatim; forced mappings applied)
   - length bounds (maxChars)
   - leftover-source detection (untranslated spans in target)
   Any failure → collect machine-readable gate violations.

4. REVIEWER / LLM-AS-JUDGE (model independent of the translator)
   - Critique the WHOLE GROUP TOGETHER for cross-segment coherence
     (accuracy, fluency, terminology, tone vs source).
   - Returns: pass/fail + per-segment confidence + actionable critique notes.

5. DECISION
   - gates pass AND reviewer passes → ACCEPT.
   - else → REVISE: feed gate violations + reviewer critique back to the
     translator (stage 2) for a targeted fix; increment iteration.
   - Stop conditions: maxIterations reached, OR cost/iteration budget hit
     → return best-so-far; flag budgetHit / lower confidence.

6. OPTIONAL BACK-TRANSLATION (config-gated; high-stakes content)
   - Back-translate accepted result to source with a third model.
   - Compare semantic drift; if over driftThreshold, one more bounded revise pass.

7. COMMIT TO TM
   - Accepted translations upserted into TranslationMemory
     (keyed by sourceText + sourceLang + targetLang + namespace).
```

### Key properties
- Cheap deterministic gates run before the expensive reviewer.
- Reviewer defaults to a *different* model than the translator (unbiased judging).
- Reviewer judges the whole group together (coherence) but emits per-segment
  confidence.
- Fuzzy TM is a hint, never auto-accepted — preserves quality while saving effort.
- Stubborn segments degrade gracefully (best-so-far + flag) rather than looping
  forever or failing the whole document.

### Defaults
- `maxIterations` = 3 (draft + up to 2 revisions).
- Reviewer enabled; back-translation disabled (opt-in).

### Trace
Each iteration records: draft, gate results, reviewer verdict, TM hit type,
tokens/cost, and the final **stop reason** (`accepted` / `max-iterations` /
`budget-hit` / `back-translation-ok`). This is the opt-in `DocumentTrace`
(`config.trace` = `none` | `summary` | `full`).

## 7. Core Interfaces

### LLMProvider (core/providers)
Narrow, engine-owned abstraction with per-role model selection.
```
interface LLMProvider {
  name: string
  complete<T>(args: {
    role: "translator" | "reviewer" | "backTranslator"
    system: string
    prompt: string
    schema: ZodSchema<T>        // engine demands typed, validated output
    model: string
    temperature?: number
  }): Promise<{ value: T; usage: TokenUsage }>
}
```
- Adapters: OpenAI, Anthropic, Google (extensible). May be backed by a
  multi-provider SDK to avoid hand-writing every adapter.
- **Rate-limit / exponential backoff / retry live here** — all surfaces benefit.
- Structured-output parse failure → bounded retry with a repair prompt.
- `TokenUsage` flows into cost/budget accounting.

### TranslationMemory (core/memory)
Pluggable; both fuzzy strategies; namespace-scoped.
```
interface TranslationMemory {
  lookupExact(sourceText, sourceLang, targetLang, namespace?): Promise<TMEntry | null>
  lookupFuzzy(sourceText, sourceLang, targetLang, opts, namespace?): Promise<TMMatch[]>
  upsert(entry: { sourceText, sourceLang, targetLang, translatedText,
                  sourceHash, namespace? }): Promise<void>
  invalidate(filter): Promise<void>
}
```
- **SQLite adapter** (default; CLI/local): exact via index; fuzzy via
  trigram/edit-distance; optional embedding column for semantic.
- **Postgres adapter** (API/MCP shared): exact via index; fuzzy via `pgvector`
  semantic + trigram.
- **Fuzzy strategy** (config): `lexical` (cheap, no embedding calls),
  `semantic` (embedding-based), or `both` (lexical pre-filter → semantic rerank).
  Embedding calls go through an optional `EmbeddingProvider` (same retry layer).
- **Namespace** (project/tenant) scopes all operations so a shared Postgres TM
  never mixes unrelated products. Defaults to a global namespace.
- Keyed by (sourceText, sourceLang, targetLang, namespace).

### Gate (core/gates)
Uniform validator shape; list is extensible.
```
interface Gate {
  name: string
  check(group: AssembledGroup, draft: DraftResult, ctx): GateViolation[]
}
```
Built-ins: placeholders, markup, glossary, length, leftover-source. Run in
cheap-first order; violations are machine-readable and fed into the revise prompt.

## 8. Configuration

`TranslationConfig` (Zod; all optional with sensible defaults). Global with
per-language overrides per the consistency rule.
```
TranslationConfig {
  maxIterations: 3
  reviewer: { enabled: true }
  backTranslation: { enabled: false, driftThreshold: 0.15 }
  models: {
    translator:     { provider, model, temperature }
    reviewer:       { provider, model, temperature }   // defaults to a different model
    backTranslator: { provider, model, temperature }
  }
  tm: { enabled: true, fuzzy: "both", fuzzyThreshold: 0.85, namespace? }
  budget: { maxUsd?, maxIterations?, onExceed: "best-so-far" }
  concurrency: 8                         // bounded parallelism
  trace: "none" | "summary" | "full"
  perLanguage?: { [lang]: PartialConfig }   // opt-in overrides; inherits global
}
```
**Resolution order:** built-in defaults → engine config file
(`yaku.config.{ts,json}`) → request `config` → per-language override.
**Secrets** (API keys) come from environment only — never from request bodies.

## 9. The Three Surfaces

All thin wrappers over `core.translate(request)`. Same Zod validation everywhere;
no logic duplication.

### CLI — @yaku/cli (`yaku` command)
- `yaku translate --in request.json --out response.json` — structured file I/O.
- stdin/stdout piping; `--source en --target ja,ko,fr` shorthand;
  `--config yaku.config.json`; `--trace full`.
- `yaku tm export | import | invalidate` — manage translation memory.
- Exit codes reflect status: `ok`=0, `partial`=1, `failed`=2 (scripting-friendly).

### API — @yaku/api (`createServer()`)
- `POST /translate` — body = `TranslationRequest`, returns `TranslationResponse`.
  Zod-validated; structured 400 on bad input.
- `GET /health`. Optional API-key auth middleware. Can point at shared Postgres TM.
- **Synchronous** (bounded-parallel) in v1; durable queue is a future extension.

### MCP — @yaku/mcp (stdio, official SDK)
- Tool `translate` — input schema = the same Zod `TranslationRequest` (as JSON
  Schema); output = `TranslationResponse`. Lets an AI agent call yaku as a
  structured tool.
- Tools `tm_lookup` / `tm_invalidate` for memory ops.
- Shares core schemas, so the tool contract cannot drift from CLI/API.

## 10. Error Handling & Resilience
- **Per-segment isolation:** failing segment → `status: "failed"` + `error`;
  language/document becomes `partial`; never aborts siblings.
- **Per-document isolation:** in a batch, one document failing doesn't kill the
  batch; the runner collects per-doc results.
- **Per-language isolation:** one target language can be `partial`/`failed` while
  others are `ok`.
- **Provider failures:** transient (rate-limit/5xx/timeout) → retried with
  exponential backoff in the provider layer; exhausted → segment fails gracefully
  with a clear error.
- **Structured-output parse failures:** retried with a bounded repair prompt;
  still failing → segment fails.
- **Budget exceeded:** loop returns best-so-far, `summary.budgetHit = true`,
  affected segments flagged lower-confidence — never throws.
- **Validation:** all inbound requests Zod-validated at the surface boundary;
  invalid → structured error (CLI exit 2 / HTTP 400 / MCP error) before any LLM
  call.

## 11. Testing Strategy
- **Unit tests** per core unit: gates (table-driven: placeholders, markup,
  glossary, length, leftovers), assembly/de-assembly (id round-trip), sourceHash
  stability, config resolution/merge, TM adapters (in-memory SQLite).
- **Orchestrator tests with a mock `LLMProvider`** — scripted deterministic
  responses exercising: gate-fail→revise, reviewer-fail→revise, exact/fuzzy TM
  paths, budget cutoff, back-translation drift. No real API calls in CI.
- **Contract/invariant tests:** every input id appears exactly once per language;
  do-not-translate verbatim; placeholders preserved.
- **Surface integration tests:** CLI (file in→file out), API (`POST /translate`),
  MCP (tool round-trip) — all hitting core with the mock provider.
- **Optional live smoke test** gated by env var (not in CI) against a real provider.
- TDD: tests first for gates, schemas, and the loop's decision logic.

## 12. Project Conventions
- TypeScript strict; Zod as single source of truth for types (`z.infer`).
- pnpm workspaces + Turbo (or tsc project references) for build orchestration.
- Vitest for tests; ESLint + Prettier.
- Each core module is an independently testable unit with a clear public surface.
- Secrets via environment only.

## 13. Future Extensions (out of scope for v1)
- Durable job queue / async workers for very large API batches.
- Additional LLM provider adapters.
- Runtime plugin discovery for surfaces/providers.
- Template/slots context model layered on top of segments (Q4/C variant).
