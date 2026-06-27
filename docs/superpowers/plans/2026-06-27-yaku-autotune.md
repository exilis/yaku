# yaku Autotune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@yaku/autotune`, an autonomous hill-climb optimizer that tunes `@yaku/core` config knobs and prompt templates to maximize translation quality (LLM-judge on a held-out gold set) while minimizing cost, persisting winners as versioned profiles.

**Architecture:** A new workspace package `@yaku/autotune` composed of small, injectable units (gold sampler, judge, candidate runner, proposer, objective/selector, orchestrator, profile store, CLI). Plus one minimal, backward-compatible change to `@yaku/core`: split prompt static text (tunable templates) from dynamic assembly (frozen), and thread an optional `promptTemplates` through `translate()`. Every LLM-calling unit takes its provider as a dependency so the whole loop is testable with `MockProvider` and zero real API calls.

**Tech Stack:** TypeScript (ESM, NodeNext), Zod for schemas/validation, Vitest for tests, pnpm workspaces, commander for the CLI. Mirrors the existing `@yaku/core` / `@yaku/cli` conventions.

**Spec:** `docs/superpowers/specs/2026-06-27-yaku-autotune-design.md`

**Deferred from this plan (YAGNI for v1):** the spec mentions `--resume <runId>`
(replay the append-only ledger to reconstruct `best` and continue a killed run).
The append-only ledger written in Tasks 9–11 already makes runs fully
*reconstructable* (the safety property that matters); the interactive resume
*command* is deferred to a follow-up. Everything else in the spec is implemented
here.

---

## File Structure

**Core change (`packages/core/src/`):**
- Modify `orchestrator/prompts.ts` — add `PromptTemplates` type + `DEFAULT_TEMPLATES`; make the three build functions accept an optional `templates`.
- Modify `orchestrator/group-loop.ts` — pass `config.promptTemplates` into the build functions.
- Modify `schemas/config.ts` — add optional `promptTemplates` to the config schema (passthrough object).
- Modify `index.ts` — export `PromptTemplates`, `DEFAULT_TEMPLATES`.
- Modify `orchestrator/prompts.test.ts` — add coverage for defaults + overrides.

**New package (`packages/autotune/`):**
- `package.json`, `tsconfig.json`
- `src/types.ts` — shared types: `Candidate`, `CandidateResult`, `Pricing`, `Objective`.
- `src/pricing.ts` — token→USD pricing table + `estimateUsd`.
- `src/gold.ts` — load gold records, deterministic seeded sampling.
- `src/judge.ts` — `JudgeSchema`, `buildJudgePrompt`, `scoreTranslation`, `aggregateQuality`.
- `src/objective.ts` — `isBetter`, lexicographic quality-floor → cost.
- `src/proposer.ts` — `ProposalSchema`, `buildProposerPrompt`, `validateCandidate`, `propose`.
- `src/runner.ts` — `runCandidate` (translate + judge + cost + gate-pass).
- `src/profile.ts` — `ProfileSchema`, read/write versioned profiles, ledger append, active pointer.
- `src/optimize.ts` — the hill-climb orchestrator.
- `src/cli.ts` — `run` / `profiles` / `show` commands.
- `src/index.ts` — package exports.
- Tests colocated: `*.test.ts` next to each module.

**Convention notes (discovered from the codebase):**
- All intra-package imports use the `.js` extension (NodeNext), even from `.ts` files. Example: `import { foo } from "./foo.js";`.
- `tsconfig.json` extends `../../tsconfig.base.json`, sets `outDir: ./dist`, `rootDir: ./src`, `include: ["src/**/*"]`, `exclude: ["src/**/*.test.ts"]`.
- Tests use `import { describe, it, expect } from "vitest";`.
- `noUncheckedIndexedAccess` is ON — array/record indexing yields `T | undefined`; handle it.
- The engine's `TokenUsage.usd` is provider-computed and is `0` for `MockProvider`. **Autotune must compute USD itself** from `summary.cost.inputTokens`/`outputTokens` via its own pricing table — do not rely on `summary.cost.usd`.

---

## Task 0: Scaffold the `@yaku/autotune` package

**Files:**
- Create: `packages/autotune/package.json`
- Create: `packages/autotune/tsconfig.json`
- Create: `packages/autotune/src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@yaku/autotune",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "yaku-autotune": "./dist/cli.js" },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@yaku/core": "workspace:*",
    "commander": "^12.1.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create a placeholder `src/index.ts`**

```ts
export const AUTOTUNE_VERSION = "0.1.0";
```

- [ ] **Step 4: Install workspace deps & verify typecheck**

Run: `pnpm install && pnpm -C packages/autotune typecheck`
Expected: install succeeds, typecheck passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/package.json packages/autotune/tsconfig.json packages/autotune/src/index.ts pnpm-lock.yaml
git commit -m "chore: scaffold @yaku/autotune package"
```

---

## Task 1: Core — overridable prompt templates

**Files:**
- Modify: `packages/core/src/orchestrator/prompts.ts`
- Modify: `packages/core/src/orchestrator/prompts.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for defaults + overrides**

Add these tests to the bottom of `packages/core/src/orchestrator/prompts.test.ts`:

```ts
import { buildReviewerPrompt, buildBackTranslationPrompt, DEFAULT_TEMPLATES } from "./prompts.js";

describe("prompt templates", () => {
  it("DEFAULT_TEMPLATES reproduces the original translator wording", () => {
    const p = buildTranslatorPrompt(group, {});
    const pDefault = buildTranslatorPrompt(group, {}, DEFAULT_TEMPLATES);
    expect(p).toBe(pDefault);
  });

  it("applies a translator instruction override with placeholders filled", () => {
    const templates = {
      ...DEFAULT_TEMPLATES,
      translator: { ...DEFAULT_TEMPLATES.translator, instruction: "Render {sourceLang} into {targetLang} now." },
    };
    const p = buildTranslatorPrompt(group, {}, templates);
    expect(p).toContain("Render en into ja now.");
    // dynamic assembly still present
    expect(p).toContain("Welcome to Acme");
  });

  it("applies a reviewer instruction override", () => {
    const draft = { title: "Acme へようこそ" };
    const templates = {
      ...DEFAULT_TEMPLATES,
      reviewer: { ...DEFAULT_TEMPLATES.reviewer, instruction: "Audit {sourceLang}->{targetLang}." },
    };
    const p = buildReviewerPrompt(group, draft, templates);
    expect(p).toContain("Audit en->ja.");
    expect(p).toContain("Acme へようこそ");
  });

  it("back-translation default still mentions both directions", () => {
    const draft = { title: "Acme へようこそ" };
    const p = buildBackTranslationPrompt(group, draft);
    expect(p).toContain("ja");
    expect(p).toContain("en");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/orchestrator/prompts.test.ts`
Expected: FAIL — `DEFAULT_TEMPLATES` is not exported, `buildTranslatorPrompt` takes only 2 args.

- [ ] **Step 3: Rewrite `prompts.ts` with templates**

Replace the entire contents of `packages/core/src/orchestrator/prompts.ts` with:

```ts
import type { AssembledGroup } from "../gates/types.js";

export interface PromptTemplates {
  translator: {
    instruction: string; // "{sourceLang}" / "{targetLang}" placeholders
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
    lines.push(`- id="${s.id}"${role}${notes}: ${s.text}`);
  }
  if (extras.suggestions && Object.keys(extras.suggestions).length) {
    lines.push(`\n${t.suggestionsHeader}`);
    for (const [id, sug] of Object.entries(extras.suggestions)) lines.push(`- id="${id}": ${sug}`);
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
    lines.push(`- id="${s.id}": SOURCE: ${s.text}  | TARGET: ${draft[s.id] ?? "(missing)"}`);
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
  for (const s of group.segments) lines.push(`- id="${s.id}": ${draft[s.id] ?? ""}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Export the new symbols from core `index.ts`**

In `packages/core/src/index.ts`, after the `export { translate ... }` line block, add:

```ts
export { DEFAULT_TEMPLATES } from "./orchestrator/prompts.js";
export type { PromptTemplates } from "./orchestrator/prompts.js";
```

- [ ] **Step 5: Run tests to verify pass (incl. existing prompt tests unchanged)**

Run: `pnpm vitest run packages/core/src/orchestrator/prompts.test.ts`
Expected: PASS — all original + new tests green (the byte-for-byte test proves no behavior change).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/orchestrator/prompts.ts packages/core/src/orchestrator/prompts.test.ts packages/core/src/index.ts
git commit -m "feat(core): overridable prompt templates with byte-identical defaults"
```

---

## Task 2: Core — thread `promptTemplates` through config and group-loop

**Files:**
- Modify: `packages/core/src/schemas/config.ts`
- Modify: `packages/core/src/orchestrator/group-loop.ts`
- Test: `packages/core/src/orchestrator/group-loop.test.ts` (add one test)

- [ ] **Step 1: Add a failing test that an instruction override reaches the translator prompt**

Read the existing `packages/core/src/orchestrator/group-loop.test.ts` to match its setup style (it already constructs an `AssembledGroup`, a `MockProvider` script, and a config). Append this test (adjust the local `group`/`tm` helper names to whatever that file already defines):

```ts
it("passes promptTemplates through to the translator prompt", async () => {
  const provider = new MockProvider({
    translator: [{ translations: { title: "ようこそ" } }],
    reviewer: [{ passed: true, confidence: { title: 0.9 }, critique: "" }],
  });
  const cfg = resolveConfig({
    models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
    promptTemplates: {
      ...DEFAULT_TEMPLATES,
      translator: { ...DEFAULT_TEMPLATES.translator, instruction: "SENTINEL {targetLang}" },
    },
  });
  await runGroupLoop(group, { provider, tm, config: cfg, cost: new CostTracker() });
  const translatorCall = provider.calls.find((c) => c.role === "translator");
  expect(translatorCall?.prompt).toContain("SENTINEL ja");
});
```

Ensure the test file imports `DEFAULT_TEMPLATES` and `resolveConfig`:

```ts
import { DEFAULT_TEMPLATES } from "./prompts.js";
import { resolveConfig } from "../schemas/index.js";
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/orchestrator/group-loop.test.ts`
Expected: FAIL — `promptTemplates` is rejected by the strict config schema (or sentinel not found).

- [ ] **Step 3: Add `promptTemplates` to the config schema**

In `packages/core/src/schemas/config.ts`:

1. At the top, after the `import { z } from "zod";` line, add:

```ts
import type { PromptTemplates } from "../orchestrator/prompts.js";
```

2. Add a schema constant before `baseShape` (a passthrough object — we validate structure loosely here; autotune does the strict validation):

```ts
const PromptTemplatesObject = z.record(z.string(), z.any()).optional();
```

3. In `baseShape`, add the field:

```ts
  promptTemplates: PromptTemplatesObject,
```

4. In `PartialConfigSchema`'s `.object({ ... })`, add:

```ts
    promptTemplates: PromptTemplatesObject,
```

5. After `export type TranslationConfig = ...`, add a typed accessor note: because the schema stores `promptTemplates` as a loose record, expose a typed getter via a cast where consumed. (No code here; the cast happens in group-loop, Step 4.)

- [ ] **Step 4: Use the templates in `group-loop.ts`**

In `packages/core/src/orchestrator/group-loop.ts`:

1. Update the import line to also bring in the type:

```ts
import { buildTranslatorPrompt, buildReviewerPrompt, buildBackTranslationPrompt, type PromptTemplates } from "./prompts.js";
```

2. Near the top of `runGroupLoop`, after `const ns = config.tm.namespace;`, add:

```ts
  const templates = config.promptTemplates as PromptTemplates | undefined;
```

3. Pass `templates` as the trailing arg to every prompt builder call. There are four call sites:

- The main draft prompt:
```ts
    const prompt = buildTranslatorPrompt(llmGroup, {
      critique: iteration > 1 ? critique : undefined,
      gateViolations: iteration > 1 ? gateMsgs : undefined,
      suggestions,
    }, templates);
```
- The reviewer prompt:
```ts
        prompt: buildReviewerPrompt(llmGroup, draft, templates), schema: ReviewSchema,
```
- The back-translation prompt:
```ts
      prompt: buildBackTranslationPrompt(llmGroup, draft, templates),
```
- The back-translation revise prompt:
```ts
      const prompt = buildTranslatorPrompt(llmGroup, { critique, suggestions }, templates);
```

(When `templates` is `undefined`, each builder falls back to `DEFAULT_TEMPLATES` — identical behavior to today.)

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm vitest run packages/core/src/orchestrator/group-loop.test.ts && pnpm -C packages/core typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Run the full core suite to confirm no regressions**

Run: `pnpm vitest run packages/core`
Expected: PASS — all existing core tests still green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schemas/config.ts packages/core/src/orchestrator/group-loop.ts packages/core/src/orchestrator/group-loop.test.ts
git commit -m "feat(core): thread optional promptTemplates through translate config"
```

---

## Task 3: Autotune — shared types & pricing

**Files:**
- Create: `packages/autotune/src/types.ts`
- Create: `packages/autotune/src/pricing.ts`
- Test: `packages/autotune/src/pricing.test.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
import type { PromptTemplates } from "@yaku/core";

/** A point in the search space: config overrides + (optional) prompt templates. */
export interface Candidate {
  /** Partial TranslationConfig (models, maxIterations, reviewer, tm, concurrency). */
  config: Record<string, unknown>;
  promptTemplates?: PromptTemplates;
  /** Human-readable note from the proposer about what this changes and why. */
  rationale?: string;
}

/** Metrics gathered by evaluating a Candidate on a record sample. */
export interface CandidateResult {
  quality: number;        // mean judge score 0..100
  qualityMin: number;     // worst per-segment judge score 0..100
  estUsd: number;         // computed from token counts via Pricing
  gatePassRate: number;   // 0..1 fraction of segments with no gate warnings
  inputTokens: number;
  outputTokens: number;
  scored: number;         // number of segments successfully judged
  unscoreable: boolean;   // true if too many judge failures -> reject
  /** Aggregated judge critiques, fed back to the proposer as the gradient. */
  critiques: string[];
}

/** Per-1M-token USD prices, keyed by model id. */
export type Pricing = Record<string, { in: number; out: number }>;

export interface Objective {
  floor: number;          // minimum acceptable quality (e.g. 85)
  epsilon: number;        // cost delta below this counts as "not better"
}
```

- [ ] **Step 2: Write failing test for pricing**

Create `packages/autotune/src/pricing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { estimateUsd, DEFAULT_PRICING } from "./pricing.js";

describe("estimateUsd", () => {
  it("computes cost from token counts for a known model", () => {
    // gpt-4o-mini: 0.15/1M in, 0.6/1M out
    const usd = estimateUsd("gpt-4o-mini", 1_000_000, 1_000_000, DEFAULT_PRICING);
    expect(usd).toBeCloseTo(0.75, 5);
  });

  it("falls back to a default price for an unknown model", () => {
    const usd = estimateUsd("some-unknown-model", 1_000_000, 0, DEFAULT_PRICING);
    expect(usd).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/pricing.test.ts`
Expected: FAIL — module `./pricing.js` not found.

- [ ] **Step 4: Create `src/pricing.ts`**

```ts
import type { Pricing } from "./types.js";

/** USD per 1M tokens. Extend as needed. */
export const DEFAULT_PRICING: Pricing = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
};

/** Price used when a model id is not in the table (conservative-ish default). */
const FALLBACK = { in: 1.0, out: 4.0 };

export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing = DEFAULT_PRICING
): number {
  const p = pricing[model] ?? FALLBACK;
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/pricing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/autotune/src/types.ts packages/autotune/src/pricing.ts packages/autotune/src/pricing.test.ts
git commit -m "feat(autotune): shared types and token->USD pricing"
```

---

## Task 4: Autotune — objective / selector

**Files:**
- Create: `packages/autotune/src/objective.ts`
- Test: `packages/autotune/src/objective.test.ts`

- [ ] **Step 1: Write failing tests for the lexicographic rule**

Create `packages/autotune/src/objective.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isBetter } from "./objective.js";
import type { CandidateResult, Objective } from "./types.js";

const obj: Objective = { floor: 85, epsilon: 0.0001 };

function r(quality: number, estUsd: number): CandidateResult {
  return {
    quality, qualityMin: quality, estUsd, gatePassRate: 1, inputTokens: 0,
    outputTokens: 0, scored: 10, unscoreable: false, critiques: [],
  };
}

describe("isBetter", () => {
  it("a candidate below the floor never beats the best, even if cheaper", () => {
    expect(isBetter(r(80, 0.10), r(90, 0.50), obj)).toBe(false);
  });

  it("a candidate clearing the floor beats a best that is below the floor", () => {
    expect(isBetter(r(86, 0.50), r(80, 0.10), obj)).toBe(true);
  });

  it("when both clear the floor, the cheaper one wins", () => {
    expect(isBetter(r(90, 0.20), r(88, 0.50), obj)).toBe(true);
    expect(isBetter(r(90, 0.60), r(88, 0.50), obj)).toBe(false);
  });

  it("a cost delta within epsilon does not count as better", () => {
    expect(isBetter(r(90, 0.50000), r(90, 0.50005), obj)).toBe(false);
  });

  it("an unscoreable candidate is never better", () => {
    const bad = { ...r(99, 0.01), unscoreable: true };
    expect(isBetter(bad, r(86, 0.50), obj)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/objective.test.ts`
Expected: FAIL — `./objective.js` not found.

- [ ] **Step 3: Create `src/objective.ts`**

```ts
import type { CandidateResult, Objective } from "./types.js";

/**
 * Lexicographic objective: (1) candidate must clear the quality floor, then
 * (2) be strictly cheaper than `best` by more than epsilon.
 *
 * Rules:
 * - An unscoreable candidate is never better.
 * - If candidate is below floor, it is never better (regardless of cost).
 * - If candidate clears floor and best does NOT, candidate is better.
 * - If both clear floor, cheaper wins (by > epsilon).
 */
export function isBetter(candidate: CandidateResult, best: CandidateResult, obj: Objective): boolean {
  if (candidate.unscoreable) return false;
  const candPasses = candidate.quality >= obj.floor;
  const bestPasses = !best.unscoreable && best.quality >= obj.floor;

  if (!candPasses) return false;
  if (candPasses && !bestPasses) return true;

  // both pass the floor -> minimize cost
  return candidate.estUsd < best.estUsd - obj.epsilon;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/objective.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/src/objective.ts packages/autotune/src/objective.test.ts
git commit -m "feat(autotune): lexicographic quality-floor then cost objective"
```

---

## Task 5: Autotune — gold set loader & deterministic sampler

**Files:**
- Create: `packages/autotune/src/gold.ts`
- Test: `packages/autotune/src/gold.test.ts`

**Note on the gold record shape:** a gold record is a `TranslationRequest`-shaped
object the runner can pass straight to `translate()`. The loader reads
`*.json` files from a directory; each file is one request. The sampler picks a
deterministic subset.

- [ ] **Step 1: Write failing tests**

Create `packages/autotune/src/gold.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sampleRecords, MIN_GOLD } from "./gold.js";

function makeGold(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    sourceLang: "en",
    targetLangs: ["ja"],
    document: { id: `doc${i}`, segments: [{ id: "t", text: `text ${i}` }] },
  }));
}

describe("sampleRecords", () => {
  it("returns the requested number of records", () => {
    const sample = sampleRecords(makeGold(20), 5, 42);
    expect(sample).toHaveLength(5);
  });

  it("is deterministic for the same seed", () => {
    const a = sampleRecords(makeGold(20), 5, 42);
    const b = sampleRecords(makeGold(20), 5, 42);
    expect(a.map((r) => r.document.id)).toEqual(b.map((r) => r.document.id));
  });

  it("different seeds can produce different samples", () => {
    const a = sampleRecords(makeGold(50), 5, 1);
    const b = sampleRecords(makeGold(50), 5, 2);
    // not a hard guarantee, but for 50-choose-5 the chance of identical order is negligible
    expect(a.map((r) => r.document.id)).not.toEqual(b.map((r) => r.document.id));
  });

  it("returns all records when n >= length", () => {
    const sample = sampleRecords(makeGold(3), 10, 42);
    expect(sample).toHaveLength(3);
  });

  it("exposes a minimum gold size constant", () => {
    expect(MIN_GOLD).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/gold.test.ts`
Expected: FAIL — `./gold.js` not found.

- [ ] **Step 3: Create `src/gold.ts`**

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TranslationRequest } from "@yaku/core";

export type GoldRecord = TranslationRequest;

/** Minimum number of gold records required to run an optimization. */
export const MIN_GOLD = 3;

/** Load every *.json gold record from a directory. */
export function loadGold(dir: string): GoldRecord[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GoldRecord);
}

/** Deterministic PRNG (mulberry32) so a seed always yields the same sample. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seeded subset of `records` (seeded Fisher-Yates, take first n). */
export function sampleRecords(records: GoldRecord[], n: number, seed: number): GoldRecord[] {
  if (n >= records.length) return [...records];
  const rng = mulberry32(seed);
  const arr = [...records];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, n);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/gold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/src/gold.ts packages/autotune/src/gold.test.ts
git commit -m "feat(autotune): gold loader and deterministic seeded sampler"
```

---

## Task 6: Autotune — judge

**Files:**
- Create: `packages/autotune/src/judge.ts`
- Test: `packages/autotune/src/judge.test.ts`

**Design:** the judge calls the LLM via the engine's `LLMProvider` interface
(`provider.complete`), using `role: "reviewer"` so the existing `MockProvider`
script format works. It is pinned per run and never tuned.

- [ ] **Step 1: Write failing tests (mock provider)**

Create `packages/autotune/src/judge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MockProvider } from "@yaku/core";
import { scoreTranslation, aggregateQuality, JudgeSchema } from "./judge.js";

describe("JudgeSchema", () => {
  it("accepts a well-formed verdict", () => {
    const ok = JudgeSchema.safeParse({
      score: 90, dims: { adequacy: 90, fluency: 88, terminology: 92, tone: 90 }, critique: "",
    });
    expect(ok.success).toBe(true);
  });
});

describe("scoreTranslation", () => {
  it("returns the judged score and critique", async () => {
    const provider = new MockProvider({
      reviewer: [{ score: 87, dims: { adequacy: 88, fluency: 86, terminology: 88, tone: 86 }, critique: "slightly stiff" }],
    });
    const out = await scoreTranslation(
      { source: "Welcome", target: "ようこそ", lang: "ja", id: "t" },
      { provider, model: "gpt-4o" }
    );
    expect(out.score).toBe(87);
    expect(out.critique).toBe("slightly stiff");
  });
});

describe("aggregateQuality", () => {
  it("computes mean, min, and collects critiques", () => {
    const agg = aggregateQuality([
      { score: 90, dims: { adequacy: 90, fluency: 90, terminology: 90, tone: 90 }, critique: "" },
      { score: 80, dims: { adequacy: 80, fluency: 80, terminology: 80, tone: 80 }, critique: "awkward" },
    ]);
    expect(agg.quality).toBeCloseTo(85, 5);
    expect(agg.qualityMin).toBe(80);
    expect(agg.critiques).toContain("awkward");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/judge.test.ts`
Expected: FAIL — `./judge.js` not found.

- [ ] **Step 3: Create `src/judge.ts`**

```ts
import { z } from "zod";
import type { LLMProvider } from "@yaku/core";

export const JudgeSchema = z
  .object({
    score: z.number().min(0).max(100),
    dims: z.object({
      adequacy: z.number().min(0).max(100),
      fluency: z.number().min(0).max(100),
      terminology: z.number().min(0).max(100),
      tone: z.number().min(0).max(100),
    }),
    critique: z.string(),
  })
  .strict();

export type JudgeVerdict = z.infer<typeof JudgeSchema>;

export interface JudgeInput {
  source: string;
  target: string;
  lang: string;
  id: string;
}

export interface JudgeDeps {
  provider: LLMProvider;
  model: string;
}

export function buildJudgePrompt(input: JudgeInput): string {
  return [
    `You are a strict professional translation quality judge for target language ${input.lang}.`,
    `Rate the TARGET as a translation of the SOURCE on a 0-100 scale for overall quality,`,
    `plus four sub-dimensions: adequacy (meaning preserved), fluency (natural target language),`,
    `terminology (correct domain/brand terms), tone (register matches source).`,
    `Return JSON: {"score": 0..100, "dims": {"adequacy":0..100,"fluency":0..100,"terminology":0..100,"tone":0..100}, "critique": "specific, actionable; empty if excellent"}.`,
    ``,
    `SOURCE: ${input.source}`,
    `TARGET: ${input.target}`,
  ].join("\n");
}

/** Score one source/target pair. The judge model is fixed by the caller. */
export async function scoreTranslation(input: JudgeInput, deps: JudgeDeps): Promise<JudgeVerdict> {
  const res = await deps.provider.complete({
    role: "reviewer",
    system: "You are a strict translation quality judge.",
    prompt: buildJudgePrompt(input),
    schema: JudgeSchema,
    model: deps.model,
    temperature: 0,
  });
  return res.value;
}

export interface QualityAggregate {
  quality: number;     // mean
  qualityMin: number;  // worst
  critiques: string[]; // non-empty critiques only
}

export function aggregateQuality(verdicts: JudgeVerdict[]): QualityAggregate {
  if (verdicts.length === 0) return { quality: 0, qualityMin: 0, critiques: [] };
  const scores = verdicts.map((v) => v.score);
  const sum = scores.reduce((a, b) => a + b, 0);
  return {
    quality: sum / verdicts.length,
    qualityMin: Math.min(...scores),
    critiques: verdicts.map((v) => v.critique).filter((c) => c.trim().length > 0),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/judge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/src/judge.ts packages/autotune/src/judge.test.ts
git commit -m "feat(autotune): pinned LLM-as-judge with per-dimension scoring"
```

---

## Task 7: Autotune — candidate runner

**Files:**
- Create: `packages/autotune/src/runner.ts`
- Test: `packages/autotune/src/runner.test.ts`

**Design:** `runCandidate` builds a `TranslationConfig` from the candidate
(forcing TM OFF so the gold set can't be memorized across candidates), runs
`translate()` for each gold record, judges every translated segment against its
source, sums token cost via the pricing table, computes gate-pass rate from
segment warnings, and returns a `CandidateResult`. If more than
`maxJudgeFailFraction` of judge calls throw, the candidate is `unscoreable`.

- [ ] **Step 1: Write failing tests (mock provider + mock tm)**

Create `packages/autotune/src/runner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MockProvider } from "@yaku/core";
import type { TranslationMemory } from "@yaku/core";
import { runCandidate } from "./runner.js";
import type { GoldRecord } from "./gold.js";

// A no-op TM so the engine never reuses across the gold set.
// Matches the real @yaku/core TranslationMemory interface exactly:
//   lookupExact -> Promise<TMEntry | null>, lookupFuzzy -> Promise<TMMatch[]>,
//   upsert -> Promise<void>, invalidate(filter) -> Promise<void>.
const noopTm: TranslationMemory = {
  async lookupExact() { return null; },
  async lookupFuzzy() { return []; },
  async upsert() {},
  async invalidate() {},
};

const gold: GoldRecord[] = [
  { sourceLang: "en", targetLangs: ["ja"], document: { id: "d1", segments: [{ id: "t", text: "Welcome" }] } },
];

const baseCandidate = {
  config: {
    models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
  },
};

describe("runCandidate", () => {
  it("translates, judges, and returns a metrics bundle", async () => {
    // translator + reviewer for the engine, then judge call (role reviewer) for autotune
    const provider = new MockProvider({
      translator: [{ translations: { t: "ようこそ" } }],
      reviewer: [
        { passed: true, confidence: { t: 0.9 }, critique: "" },                       // engine reviewer
        { score: 88, dims: { adequacy: 88, fluency: 88, terminology: 88, tone: 88 }, critique: "" }, // judge
      ],
    });
    const result = await runCandidate(baseCandidate, gold, {
      provider, tm: noopTm, judgeModel: "gpt-4o", translatorModelForPricing: "gpt-4o-mini",
    });
    expect(result.quality).toBeCloseTo(88, 5);
    expect(result.scored).toBe(1);
    expect(result.unscoreable).toBe(false);
    expect(result.estUsd).toBeGreaterThanOrEqual(0);
    expect(result.gatePassRate).toBe(1);
  });

  it("marks the candidate unscoreable when judging fails for every segment", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { t: "ようこそ" } }],
      reviewer: [
        { passed: true, confidence: { t: 0.9 }, critique: "" }, // engine reviewer
        // no judge response queued -> judge call throws -> all judges fail
      ],
    });
    const result = await runCandidate(baseCandidate, gold, {
      provider, tm: noopTm, judgeModel: "gpt-4o", translatorModelForPricing: "gpt-4o-mini",
    });
    expect(result.unscoreable).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/runner.test.ts`
Expected: FAIL — `./runner.js` not found.

- [ ] **Step 3: Create `src/runner.ts`**

```ts
import { translate } from "@yaku/core";
import type { LLMProvider, TranslationMemory, PromptTemplates } from "@yaku/core";
import type { Candidate, CandidateResult, Pricing } from "./types.js";
import type { GoldRecord } from "./gold.js";
import { scoreTranslation, aggregateQuality, type JudgeVerdict } from "./judge.js";
import { estimateUsd, DEFAULT_PRICING } from "./pricing.js";

export interface RunnerDeps {
  provider: LLMProvider;
  tm: TranslationMemory;
  judgeModel: string;
  /** Model id used to price the run's tokens (the candidate's translator model). */
  translatorModelForPricing: string;
  pricing?: Pricing;
  /** If more than this fraction of judge calls fail, the candidate is unscoreable. */
  maxJudgeFailFraction?: number;
}

/** Build a TranslationConfig from a candidate, forcing TM OFF (anti-gaming). */
function buildConfig(candidate: Candidate): Record<string, unknown> {
  return {
    ...candidate.config,
    tm: { enabled: false },
    trace: "none",
    promptTemplates: candidate.promptTemplates as PromptTemplates | undefined,
  };
}

export async function runCandidate(
  candidate: Candidate,
  records: GoldRecord[],
  deps: RunnerDeps
): Promise<CandidateResult> {
  const pricing = deps.pricing ?? DEFAULT_PRICING;
  const maxFail = deps.maxJudgeFailFraction ?? 0.5;

  let inputTokens = 0;
  let outputTokens = 0;
  let gatePass = 0;
  let gateTotal = 0;
  let judgeAttempts = 0;
  let judgeFailures = 0;
  const verdicts: JudgeVerdict[] = [];

  for (const record of records) {
    const req = { ...record, config: buildConfig(candidate) };
    const res = await translate(req, { provider: deps.provider, tm: deps.tm });

    for (const lr of res.results) {
      inputTokens += lr.summary.cost.inputTokens;
      outputTokens += lr.summary.cost.outputTokens;

      // Map source text by id for judging.
      const sourceById = new Map(record.document.segments.map((s) => [s.id, s.text]));

      for (const seg of lr.segments) {
        if (seg.status === "skipped") continue;
        gateTotal++;
        if (!seg.warnings || seg.warnings.length === 0) gatePass++;

        if (seg.status === "failed" || !seg.translatedText) {
          // a failed segment counts as a zero-quality judged segment
          verdicts.push({ score: 0, dims: { adequacy: 0, fluency: 0, terminology: 0, tone: 0 }, critique: "segment failed to translate" });
          continue;
        }

        judgeAttempts++;
        try {
          const v = await scoreTranslation(
            { source: sourceById.get(seg.id) ?? "", target: seg.translatedText, lang: lr.targetLang, id: seg.id },
            { provider: deps.provider, model: deps.judgeModel }
          );
          verdicts.push(v);
        } catch {
          judgeFailures++;
        }
      }
    }
  }

  const unscoreable =
    judgeAttempts > 0 && judgeFailures / judgeAttempts > maxFail;

  const agg = aggregateQuality(verdicts);
  const estUsd = estimateUsd(deps.translatorModelForPricing, inputTokens, outputTokens, pricing);

  return {
    quality: unscoreable ? 0 : agg.quality,
    qualityMin: unscoreable ? 0 : agg.qualityMin,
    estUsd,
    gatePassRate: gateTotal === 0 ? 1 : gatePass / gateTotal,
    inputTokens,
    outputTokens,
    scored: verdicts.length,
    unscoreable,
    critiques: agg.critiques,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/src/runner.ts packages/autotune/src/runner.test.ts
git commit -m "feat(autotune): candidate runner (translate + judge + cost + gates)"
```

---

## Task 8: Autotune — proposer with validation

**Files:**
- Create: `packages/autotune/src/proposer.ts`
- Test: `packages/autotune/src/proposer.test.ts`

**Design:** `validateCandidate` is the safety gate — it rejects proposals that
touch disallowed config keys, set out-of-range knobs, or break the JSON contract
in a prompt template. `propose` asks an LLM (via `provider.complete`,
`role: "translator"`) for the next candidate, validates it, and on rejection
retries with the reason up to `maxRetries`.

- [ ] **Step 1: Write failing tests**

Create `packages/autotune/src/proposer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MockProvider, DEFAULT_TEMPLATES } from "@yaku/core";
import { validateCandidate, propose, ProposalSchema } from "./proposer.js";

describe("validateCandidate", () => {
  it("accepts an allowed config knob change", () => {
    const v = validateCandidate({ config: { maxIterations: 2, reviewer: { enabled: false } } });
    expect(v.ok).toBe(true);
  });

  it("rejects an unknown/disallowed config key", () => {
    const v = validateCandidate({ config: { secretBackdoor: true } });
    expect(v.ok).toBe(false);
  });

  it("rejects maxIterations out of range", () => {
    const v = validateCandidate({ config: { maxIterations: 99 } });
    expect(v.ok).toBe(false);
  });

  it("rejects a translator template that drops the translations JSON contract", () => {
    const v = validateCandidate({
      config: {},
      promptTemplates: {
        ...DEFAULT_TEMPLATES,
        translator: { ...DEFAULT_TEMPLATES.translator, jsonFormat: "Just answer in prose." },
      },
    });
    expect(v.ok).toBe(false);
  });

  it("rejects a reviewer template that drops the passed JSON contract", () => {
    const v = validateCandidate({
      config: {},
      promptTemplates: {
        ...DEFAULT_TEMPLATES,
        reviewer: { ...DEFAULT_TEMPLATES.reviewer, jsonFormat: "Say yes or no." },
      },
    });
    expect(v.ok).toBe(false);
  });
});

describe("propose", () => {
  it("returns a validated candidate from the LLM", async () => {
    const provider = new MockProvider({
      translator: [{ config: { maxIterations: 2 }, rationale: "fewer iters to cut cost" }],
    });
    const out = await propose(
      { config: { maxIterations: 3 } },
      { quality: 90, qualityMin: 88, estUsd: 0.5, gatePassRate: 1, inputTokens: 0, outputTokens: 0, scored: 5, unscoreable: false, critiques: [] },
      { provider, model: "gpt-4o", maxRetries: 3 }
    );
    expect(out?.config.maxIterations).toBe(2);
    expect(out?.rationale).toContain("cut cost");
  });

  it("retries on an invalid proposal then succeeds", async () => {
    const provider = new MockProvider({
      translator: [
        { config: { maxIterations: 99 }, rationale: "bad" },        // invalid -> rejected
        { config: { maxIterations: 2 }, rationale: "good" },        // valid
      ],
    });
    const out = await propose(
      { config: { maxIterations: 3 } },
      { quality: 90, qualityMin: 88, estUsd: 0.5, gatePassRate: 1, inputTokens: 0, outputTokens: 0, scored: 5, unscoreable: false, critiques: [] },
      { provider, model: "gpt-4o", maxRetries: 3 }
    );
    expect(out?.config.maxIterations).toBe(2);
  });

  it("returns null when all retries are exhausted", async () => {
    const provider = new MockProvider({
      translator: [
        { config: { maxIterations: 99 }, rationale: "bad" },
        { config: { maxIterations: 100 }, rationale: "bad" },
      ],
    });
    const out = await propose(
      { config: {} },
      { quality: 90, qualityMin: 88, estUsd: 0.5, gatePassRate: 1, inputTokens: 0, outputTokens: 0, scored: 5, unscoreable: false, critiques: [] },
      { provider, model: "gpt-4o", maxRetries: 2 }
    );
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/proposer.test.ts`
Expected: FAIL — `./proposer.js` not found.

- [ ] **Step 3: Create `src/proposer.ts`**

```ts
import { z } from "zod";
import type { LLMProvider } from "@yaku/core";
import type { Candidate, CandidateResult } from "./types.js";

/** The structured proposal we ask the LLM for. promptTemplates is opaque here;
 *  validateCandidate enforces the JSON-contract guard. */
export const ProposalSchema = z
  .object({
    config: z.record(z.string(), z.unknown()).default({}),
    promptTemplates: z.any().optional(),
    rationale: z.string().default(""),
  })
  .strict();

export type Proposal = z.infer<typeof ProposalSchema>;

/** Config keys the optimizer is allowed to touch (the bounded search space). */
const ALLOWED_CONFIG_KEYS = new Set(["models", "maxIterations", "reviewer", "tm", "concurrency"]);

const MAX_ITERATIONS_RANGE: [number, number] = [1, 6];
const CONCURRENCY_RANGE: [number, number] = [1, 32];

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateCandidate(candidate: Candidate): ValidationResult {
  // 1. config keys must all be in the allow-list
  for (const key of Object.keys(candidate.config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      return { ok: false, reason: `disallowed config key: "${key}"` };
    }
  }

  // 2. numeric knob ranges
  const maxIter = candidate.config.maxIterations;
  if (maxIter !== undefined) {
    if (typeof maxIter !== "number" || maxIter < MAX_ITERATIONS_RANGE[0] || maxIter > MAX_ITERATIONS_RANGE[1]) {
      return { ok: false, reason: `maxIterations out of range ${MAX_ITERATIONS_RANGE.join("-")}` };
    }
  }
  const concurrency = candidate.config.concurrency;
  if (concurrency !== undefined) {
    if (typeof concurrency !== "number" || concurrency < CONCURRENCY_RANGE[0] || concurrency > CONCURRENCY_RANGE[1]) {
      return { ok: false, reason: `concurrency out of range ${CONCURRENCY_RANGE.join("-")}` };
    }
  }

  // 3. prompt template JSON-contract guard
  const pt = candidate.promptTemplates as
    | { translator?: { jsonFormat?: string }; reviewer?: { jsonFormat?: string } }
    | undefined;
  if (pt) {
    const tj = pt.translator?.jsonFormat;
    if (tj !== undefined && !tj.includes('{"translations"')) {
      return { ok: false, reason: 'translator.jsonFormat must keep the {"translations" contract' };
    }
    const rj = pt.reviewer?.jsonFormat;
    if (rj !== undefined && !rj.includes('{"passed"')) {
      return { ok: false, reason: 'reviewer.jsonFormat must keep the {"passed" contract' };
    }
  }

  return { ok: true };
}

export interface ProposeDeps {
  provider: LLMProvider;
  model: string;
  maxRetries: number;
}

export function buildProposerPrompt(best: Candidate, metrics: CandidateResult, rejection?: string): string {
  const lines: string[] = [];
  lines.push(`You are optimizing a translation pipeline. Propose ONE change to improve quality and/or reduce cost.`);
  lines.push(`Allowed config keys: models, maxIterations (1-6), reviewer {enabled}, tm, concurrency (1-32).`);
  lines.push(`You may also rewrite prompt template instruction text, but you MUST keep the JSON contract lines intact (translator must keep {"translations" and reviewer must keep {"passed").`);
  lines.push(`Return JSON: {"config": {<partial config>}, "promptTemplates": <optional full PromptTemplates>, "rationale": "<one line>"}.`);
  lines.push(``);
  lines.push(`Current best config: ${JSON.stringify(best.config)}`);
  lines.push(`Current metrics: quality=${metrics.quality.toFixed(1)} (min ${metrics.qualityMin.toFixed(1)}), estUsd=${metrics.estUsd.toFixed(4)}, gatePassRate=${metrics.gatePassRate.toFixed(2)}`);
  if (metrics.critiques.length) {
    lines.push(`Judge critiques (use these to guide prompt/quality changes):`);
    for (const c of metrics.critiques.slice(0, 10)) lines.push(`- ${c}`);
  }
  if (rejection) lines.push(`\nYour previous proposal was rejected: ${rejection}. Propose a different, valid change.`);
  return lines.join("\n");
}

/** Ask the LLM for the next candidate; validate; retry on rejection. Returns null if exhausted. */
export async function propose(
  best: Candidate,
  metrics: CandidateResult,
  deps: ProposeDeps
): Promise<Candidate | null> {
  let rejection: string | undefined;
  for (let attempt = 0; attempt < deps.maxRetries; attempt++) {
    const res = await deps.provider.complete({
      role: "translator",
      system: "You are a translation pipeline optimizer.",
      prompt: buildProposerPrompt(best, metrics, rejection),
      schema: ProposalSchema,
      model: deps.model,
      temperature: 0.7,
    });
    const candidate: Candidate = {
      config: res.value.config,
      promptTemplates: res.value.promptTemplates,
      rationale: res.value.rationale,
    };
    const v = validateCandidate(candidate);
    if (v.ok) return candidate;
    rejection = v.reason;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/proposer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/src/proposer.ts packages/autotune/src/proposer.test.ts
git commit -m "feat(autotune): LLM proposer with bounded search-space validation"
```

---

## Task 9: Autotune — profile store & ledger

**Files:**
- Create: `packages/autotune/src/profile.ts`
- Test: `packages/autotune/src/profile.test.ts`

**Design:** profiles are versioned immutable JSON; `active.json` is a pointer;
the ledger is append-only JSONL. All paths are rooted at a passed-in `baseDir`
so tests use a temp dir.

- [ ] **Step 1: Write failing tests (temp dir)**

Create `packages/autotune/src/profile.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProfile, readActiveProfile, setActive, appendLedger, nextVersion } from "./profile.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "autotune-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const sampleProfile = {
  name: "activities",
  version: 1,
  createdAt: "2026-06-27T00:00:00.000Z",
  parentVersion: null,
  config: { maxIterations: 3 },
  promptTemplates: undefined,
  provenance: { runId: "run-1", goldSet: "activities", sample: 6, langs: ["ja"], judgeModel: "gpt-4o", objective: { floor: 85 } },
  metrics: { quality: 89, estUsd: 0.4, gatePassRate: 1 },
};

describe("profile store", () => {
  it("writes a versioned profile file", () => {
    writeProfile(dir, sampleProfile);
    expect(existsSync(join(dir, "profiles", "activities-v1.json"))).toBe(true);
  });

  it("nextVersion increments based on existing files", () => {
    writeProfile(dir, sampleProfile);
    expect(nextVersion(dir, "activities")).toBe(2);
    expect(nextVersion(dir, "missing")).toBe(1);
  });

  it("setActive + readActiveProfile round-trips", () => {
    writeProfile(dir, sampleProfile);
    setActive(dir, "activities", 1);
    const active = readActiveProfile(dir);
    expect(active?.name).toBe("activities");
    expect(active?.version).toBe(1);
  });

  it("readActiveProfile returns null when none set", () => {
    expect(readActiveProfile(dir)).toBeNull();
  });

  it("appendLedger appends one JSON line per call", () => {
    appendLedger(dir, { runId: "r", iter: 0, decision: "baseline" });
    appendLedger(dir, { runId: "r", iter: 1, decision: "accept" });
    const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).decision).toBe("accept");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/profile.test.ts`
Expected: FAIL — `./profile.js` not found.

- [ ] **Step 3: Create `src/profile.ts`**

```ts
import { z } from "zod";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const ProfileSchema = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  parentVersion: z.number().int().positive().nullable(),
  config: z.record(z.string(), z.unknown()),
  promptTemplates: z.any().optional(),
  provenance: z.object({
    runId: z.string(),
    goldSet: z.string(),
    sample: z.number(),
    langs: z.array(z.string()),
    judgeModel: z.string(),
    objective: z.object({ floor: z.number() }),
  }),
  metrics: z.object({
    quality: z.number(),
    estUsd: z.number(),
    gatePassRate: z.number(),
  }),
});

export type Profile = z.infer<typeof ProfileSchema>;

function profilesDir(baseDir: string): string {
  return join(baseDir, "profiles");
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

/** Highest existing version for a profile name + 1 (1 if none). */
export function nextVersion(baseDir: string, name: string): number {
  const dir = profilesDir(baseDir);
  if (!existsSync(dir)) return 1;
  const prefix = `${name}-v`;
  const versions = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => Number(f.slice(prefix.length, -5)))
    .filter((n) => Number.isFinite(n));
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

/** Write an immutable versioned profile file. Refuses to overwrite. */
export function writeProfile(baseDir: string, profile: Profile): string {
  ProfileSchema.parse(profile);
  const dir = profilesDir(baseDir);
  ensureDir(dir);
  const path = join(dir, `${profile.name}-v${profile.version}.json`);
  if (existsSync(path)) throw new Error(`profile already exists (immutable): ${path}`);
  writeFileSync(path, JSON.stringify(profile, null, 2));
  return path;
}

/** Point active.json at a profile name+version. */
export function setActive(baseDir: string, name: string, version: number): void {
  const dir = profilesDir(baseDir);
  ensureDir(dir);
  writeFileSync(join(dir, "active.json"), JSON.stringify({ name, version }, null, 2));
}

/** Read the active profile (or null if none set / missing). */
export function readActiveProfile(baseDir: string): Profile | null {
  const activePath = join(profilesDir(baseDir), "active.json");
  if (!existsSync(activePath)) return null;
  const { name, version } = JSON.parse(readFileSync(activePath, "utf8")) as { name: string; version: number };
  const profilePath = join(profilesDir(baseDir), `${name}-v${version}.json`);
  if (!existsSync(profilePath)) return null;
  return ProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")));
}

/** Append one entry to the append-only ledger. */
export function appendLedger(baseDir: string, entry: Record<string, unknown>): void {
  ensureDir(baseDir);
  appendFileSync(join(baseDir, "ledger.jsonl"), JSON.stringify(entry) + "\n");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/src/profile.ts packages/autotune/src/profile.test.ts
git commit -m "feat(autotune): versioned immutable profiles + append-only ledger"
```

---

## Task 10: Autotune — optimize orchestrator (the hill-climb loop)

**Files:**
- Create: `packages/autotune/src/optimize.ts`
- Test: `packages/autotune/src/optimize.test.ts`

**Design:** `optimize` runs baseline → loop(propose → run → select) with three
stop conditions (iteration cap, budget cap, plateau), appends a ledger entry per
iteration, then returns the winning candidate + its metrics + a stop reason.
Persistence to disk is the CLI's job (Task 11); `optimize` takes injected
`propose`/`runCandidate` functions so the loop is unit-testable with stubs.

- [ ] **Step 1: Write failing tests (stubbed propose + runCandidate)**

Create `packages/autotune/src/optimize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { optimize } from "./optimize.js";
import type { Candidate, CandidateResult } from "./types.js";

function res(quality: number, estUsd: number): CandidateResult {
  return { quality, qualityMin: quality, estUsd, gatePassRate: 1, inputTokens: 100, outputTokens: 100, scored: 5, unscoreable: false, critiques: [] };
}

describe("optimize", () => {
  it("keeps a cheaper candidate that clears the floor", async () => {
    const proposals: Candidate[] = [{ config: { maxIterations: 2 }, rationale: "cheaper" }];
    let i = 0;
    const out = await optimize({
      baseline: { config: { maxIterations: 3 } },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 5, budgetUsd: 100, plateauK: 3,
      propose: async () => proposals[i++] ?? null,
      runCandidate: async (c) => (c.config.maxIterations === 3 ? res(90, 0.50) : res(88, 0.20)),
    });
    expect(out.best.config.maxIterations).toBe(2);
    expect(out.bestMetrics.estUsd).toBeCloseTo(0.20, 5);
    expect(out.stopReason).toBe("plateau"); // proposer runs dry after 1 proposal
  });

  it("stops at the iteration cap", async () => {
    const out = await optimize({
      baseline: { config: {} },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 2, budgetUsd: 100, plateauK: 99,
      propose: async () => ({ config: { maxIterations: 2 }, rationale: "x" }),
      runCandidate: async () => res(90, 0.50), // never cheaper -> never accepted
    });
    expect(out.iterations).toBe(2);
    expect(out.stopReason).toBe("max-iter");
  });

  it("stops when the budget would be exceeded", async () => {
    const out = await optimize({
      baseline: { config: {} },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 100, budgetUsd: 0.30, plateauK: 99,
      propose: async () => ({ config: { maxIterations: 2 }, rationale: "x" }),
      runCandidate: async () => res(90, 0.20), // each candidate costs 0.20; baseline already spent 0.20
    });
    expect(out.stopReason).toBe("budget");
  });

  it("keeps baseline as winner when nothing beats it", async () => {
    const out = await optimize({
      baseline: { config: { maxIterations: 3 } },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 3, budgetUsd: 100, plateauK: 2,
      propose: async () => ({ config: { maxIterations: 2 }, rationale: "x" }),
      runCandidate: async (c) => (c.config.maxIterations === 3 ? res(90, 0.20) : res(70, 0.05)),
    });
    expect(out.best.config.maxIterations).toBe(3);
    expect(out.stopReason).toBe("plateau");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/autotune/src/optimize.test.ts`
Expected: FAIL — `./optimize.js` not found.

- [ ] **Step 3: Create `src/optimize.ts`**

```ts
import type { Candidate, CandidateResult, Objective } from "./types.js";
import { isBetter } from "./objective.js";

export type StopReason = "max-iter" | "budget" | "plateau";

export interface OptimizeArgs {
  baseline: Candidate;
  objective: Objective;
  maxIter: number;
  budgetUsd: number;
  plateauK: number;
  /** Inject the real propose/runCandidate, or stubs in tests. */
  propose: (best: Candidate, metrics: CandidateResult) => Promise<Candidate | null>;
  runCandidate: (candidate: Candidate) => Promise<CandidateResult>;
  /** Optional per-iteration hook for ledger writing (CLI supplies this). */
  onIteration?: (entry: LedgerIteration) => void;
}

export interface LedgerIteration {
  iter: number;
  candidate: Candidate;
  metrics: CandidateResult;
  decision: "baseline" | "accept" | "reject";
  spendSoFar: number;
  best: boolean;
}

export interface OptimizeResult {
  best: Candidate;
  bestMetrics: CandidateResult;
  iterations: number;
  spendUsd: number;
  stopReason: StopReason;
}

export async function optimize(args: OptimizeArgs): Promise<OptimizeResult> {
  // Baseline (iteration 0)
  let best = args.baseline;
  let bestMetrics = await args.runCandidate(best);
  let spend = bestMetrics.estUsd;
  args.onIteration?.({ iter: 0, candidate: best, metrics: bestMetrics, decision: "baseline", spendSoFar: spend, best: true });

  let iterations = 0;
  let plateau = 0;
  let stopReason: StopReason = "plateau";

  while (iterations < args.maxIter) {
    // propose
    const candidate = await args.propose(best, bestMetrics);
    if (candidate === null) {
      // proposer exhausted / dry -> treat as plateau progress
      plateau++;
      if (plateau >= args.plateauK) { stopReason = "plateau"; break; }
      continue;
    }

    // budget guard BEFORE spending: estimate next cost ~= baseline candidate cost
    const estimatedNext = bestMetrics.estUsd;
    if (spend + estimatedNext > args.budgetUsd) { stopReason = "budget"; break; }

    iterations++;
    const metrics = await args.runCandidate(candidate);
    spend += metrics.estUsd;

    const better = isBetter(metrics, bestMetrics, args.objective);
    if (better) {
      best = candidate;
      bestMetrics = metrics;
      plateau = 0;
      args.onIteration?.({ iter: iterations, candidate, metrics, decision: "accept", spendSoFar: spend, best: true });
    } else {
      plateau++;
      args.onIteration?.({ iter: iterations, candidate, metrics, decision: "reject", spendSoFar: spend, best: false });
    }

    if (iterations >= args.maxIter) { stopReason = "max-iter"; break; }
    if (plateau >= args.plateauK) { stopReason = "plateau"; break; }
  }

  return { best, bestMetrics, iterations, spendUsd: spend, stopReason };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/autotune/src/optimize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/autotune/src/optimize.ts packages/autotune/src/optimize.test.ts
git commit -m "feat(autotune): hill-climb orchestrator with cap/budget/plateau stops"
```

---

## Task 11: Autotune — CLI wiring & exports

**Files:**
- Create: `packages/autotune/src/cli.ts`
- Modify: `packages/autotune/src/index.ts`

**Design:** `cli.ts` is the only place that touches the real OpenAI provider,
real TM (a throwaway one), disk gold set, and disk profiles. It wires the
injected functions for `optimize`, runs the loop, validates the winner on the
full gold set, writes the profile + ledger + markdown report. No unit test for
the CLI itself (it's the I/O shell); the logic underneath is fully tested.

- [ ] **Step 1: Replace `src/index.ts` with full exports**

```ts
export const AUTOTUNE_VERSION = "0.1.0";

export * from "./types.js";
export { DEFAULT_PRICING, estimateUsd } from "./pricing.js";
export { loadGold, sampleRecords, MIN_GOLD } from "./gold.js";
export type { GoldRecord } from "./gold.js";
export { JudgeSchema, buildJudgePrompt, scoreTranslation, aggregateQuality } from "./judge.js";
export { isBetter } from "./objective.js";
export { ProposalSchema, validateCandidate, buildProposerPrompt, propose } from "./proposer.js";
export { runCandidate } from "./runner.js";
export type { RunnerDeps } from "./runner.js";
export { ProfileSchema, writeProfile, readActiveProfile, setActive, appendLedger, nextVersion } from "./profile.js";
export type { Profile } from "./profile.js";
export { optimize } from "./optimize.js";
export type { OptimizeResult, StopReason, LedgerIteration } from "./optimize.js";
```

- [ ] **Step 2: Create `src/cli.ts`**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OpenAIProvider, SqliteTranslationMemory } from "@yaku/core";
import { loadGold, sampleRecords, MIN_GOLD, type GoldRecord } from "./gold.js";
import { runCandidate } from "./runner.js";
import { propose } from "./proposer.js";
import { optimize, type LedgerIteration } from "./optimize.js";
import { readActiveProfile, writeProfile, setActive, appendLedger, nextVersion, type Profile } from "./profile.js";
import type { Candidate } from "./types.js";

const program = new Command();
program.name("yaku-autotune").description("Autonomous translation pipeline optimizer");

program
  .command("run")
  .requiredOption("--profile <name>", "profile name to produce")
  .option("--gold <dir>", "gold set directory", "autotune/gold")
  .option("--base <dir>", "autotune base directory (profiles/ledger)", "autotune")
  .option("--floor <n>", "minimum quality 0-100", "85")
  .option("--max-iter <n>", "iteration cap", "12")
  .option("--budget <usd>", "total USD budget", "5")
  .option("--sample <n>", "records per iteration", "6")
  .option("--plateau <k>", "stop after K non-improving iterations", "3")
  .option("--langs <csv>", "target languages override (optional)")
  .option("--judge-model <m>", "judge model (pinned)", "gpt-4o")
  .option("--translator-model <m>", "translator model for pricing/default", "gpt-4o-mini")
  .option("--dry-run", "do not flip active.json", false)
  .action(async (opts) => {
    if (!process.env.OPENAI_API_KEY) {
      console.error("ERROR: OPENAI_API_KEY not set.");
      process.exit(2);
    }
    const goldAll = loadGold(opts.gold);
    if (goldAll.length < MIN_GOLD) {
      console.error(`ERROR: need at least ${MIN_GOLD} gold records, found ${goldAll.length}.`);
      process.exit(2);
    }

    const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
    // throwaway TM, never reused across candidates (runner forces tm.enabled=false anyway)
    const tm = new SqliteTranslationMemory(":memory:");

    const floor = Number(opts.floor);
    const sample = Number(opts.sample);
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const seed = Date.now() & 0x7fffffff;
    const langs: string[] | undefined = opts.langs ? String(opts.langs).split(",") : undefined;

    const applyLangs = (r: GoldRecord): GoldRecord => (langs ? { ...r, targetLangs: langs } : r);
    const iterationSample = sampleRecords(goldAll, sample, seed).map(applyLangs);

    // baseline = active profile's config (or engine defaults = empty config)
    const active = readActiveProfile(opts.base);
    const baseline: Candidate = active
      ? { config: active.config, promptTemplates: active.promptTemplates as Candidate["promptTemplates"] }
      : { config: { models: { translator: { provider: "openai", model: opts.translatorModel }, reviewer: { provider: "openai", model: opts.translatorModel } } } };

    const ledger = (e: LedgerIteration) =>
      appendLedger(opts.base, { runId, ...e, candidate: { config: e.candidate.config, rationale: e.candidate.rationale } });

    const result = await optimize({
      baseline,
      objective: { floor, epsilon: 0.0001 },
      maxIter: Number(opts.maxIter),
      budgetUsd: Number(opts.budget),
      plateauK: Number(opts.plateau),
      propose: (best, metrics) => propose(best, metrics, { provider, model: opts.translatorModel, maxRetries: 3 }),
      runCandidate: (c) => runCandidate(c, iterationSample, { provider, tm, judgeModel: opts.judgeModel, translatorModelForPricing: opts.translatorModel }),
      onIteration: ledger,
    });

    // Validate the winner on the FULL gold set
    const fullSet = goldAll.map(applyLangs);
    const finalMetrics = await runCandidate(result.best, fullSet, {
      provider, tm, judgeModel: opts.judgeModel, translatorModelForPricing: opts.translatorModel,
    });

    const confirmed = finalMetrics.quality >= floor;
    const winnerMetrics = confirmed ? finalMetrics : result.bestMetrics;

    // Persist profile
    const version = nextVersion(opts.base, opts.profile);
    const profile: Profile = {
      name: opts.profile,
      version,
      createdAt: new Date().toISOString(),
      parentVersion: active ? active.version : null,
      config: result.best.config,
      promptTemplates: result.best.promptTemplates,
      provenance: { runId, goldSet: opts.gold, sample, langs: langs ?? [], judgeModel: opts.judgeModel, objective: { floor } },
      metrics: { quality: winnerMetrics.quality, estUsd: winnerMetrics.estUsd, gatePassRate: winnerMetrics.gatePassRate },
    };
    const profilePath = writeProfile(opts.base, profile);
    if (!opts.dryRun) setActive(opts.base, opts.profile, version);

    // Markdown report
    const outDir = join(opts.base, "out");
    mkdirSync(outDir, { recursive: true });
    const report = [
      `# Autotune run ${runId}`,
      ``,
      `| Metric | Baseline | Winner |`,
      `|---|---|---|`,
      `| Quality | ${active ? active.metrics.quality.toFixed(1) : "n/a (engine defaults)"} | ${winnerMetrics.quality.toFixed(1)} |`,
      `| Est. USD | ${active ? "$" + active.metrics.estUsd.toFixed(4) : "n/a"} | $${winnerMetrics.estUsd.toFixed(4)} |`,
      `| Gate pass rate | ${active ? active.metrics.gatePassRate.toFixed(2) : "n/a"} | ${winnerMetrics.gatePassRate.toFixed(2)} |`,
      ``,
      `**Stop reason:** ${result.stopReason}`,
      `**Iterations:** ${result.iterations}`,
      `**Total spend (search):** $${result.spendUsd.toFixed(4)}`,
      `**Winner confirmed on full gold set:** ${confirmed ? "yes" : "NO — kept search-best"}`,
      `**Winning change rationale:** ${result.best.rationale ?? "(baseline unchanged)"}`,
      `**Profile written:** ${profilePath}${opts.dryRun ? " (dry-run, not activated)" : " (active)"}`,
    ].join("\n");
    writeFileSync(join(outDir, `${runId}.md`), report);

    console.log(report);
  });

program
  .command("profiles")
  .option("--base <dir>", "autotune base directory", "autotune")
  .action((opts) => {
    const active = readActiveProfile(opts.base);
    console.log(active ? `active: ${active.name}-v${active.version} (quality ${active.metrics.quality}, $${active.metrics.estUsd})` : "no active profile");
  });

program
  .command("show")
  .argument("<runId>", "run id to show the report for")
  .option("--base <dir>", "autotune base directory", "autotune")
  .action((runId, opts) => {
    const path = join(opts.base, "out", `${runId}.md`);
    if (!existsSync(path)) { console.error(`no report at ${path}`); process.exit(1); }
    console.log(readFileSync(path, "utf8"));
  });

program.parseAsync(process.argv);
```

- [ ] **Step 3: Build the whole workspace and typecheck**

Run: `pnpm build && pnpm typecheck`
Expected: PASS — `@yaku/autotune` compiles, `dist/cli.js` is produced, all packages typecheck.

- [ ] **Step 4: Smoke-test the CLI help (no API call)**

Run: `node packages/autotune/dist/cli.js --help`
Expected: prints the `run` / `profiles` / `show` command help.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all core + autotune tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/autotune/src/cli.ts packages/autotune/src/index.ts
git commit -m "feat(autotune): CLI run/profiles/show wiring full optimization loop"
```

---

## Task 12: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an Autotune section to the README**

Insert after the `## MCP` section in `README.md`:

```markdown
## Autotune (self-improving optimizer)

`@yaku/autotune` runs an autonomous hill-climb that tunes engine config knobs and
prompt templates to maximize translation quality (LLM-as-judge on a held-out gold
set) while minimizing cost. Winners are saved as versioned profiles the engine
can load.

```bash
# place TranslationRequest-shaped gold records under autotune/gold/*.json, then:
OPENAI_API_KEY=$(cat .openai-api-key) \
  node packages/autotune/dist/cli.js run \
  --profile activities --floor 85 --max-iter 12 --budget 5 --sample 6 \
  --langs ja,ko --judge-model gpt-4o --translator-model gpt-4o-mini

node packages/autotune/dist/cli.js profiles          # show the active profile
node packages/autotune/dist/cli.js show <runId>      # print a run report
```

Outputs: `autotune/profiles/<name>-v<N>.json` (winner), `autotune/profiles/active.json`
(pointer), `autotune/ledger.jsonl` (append-only audit trail), `autotune/out/<runId>.md`
(report). Use `--dry-run` to produce the profile + report without activating it.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document @yaku/autotune optimizer in README"
```

---

## Final verification

- [ ] **Run the complete suite, build, lint, typecheck**

Run: `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. The engine's default behavior is unchanged (Task 1 byte-identical test proves it); the autotune loop is fully exercised by unit tests with `MockProvider` and no real API calls.
