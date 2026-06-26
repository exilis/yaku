# yaku Translation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agentic translation engine with a review/refine loop, native multi-language output, storage-agnostic structured I/O, translation memory, and three thin surfaces (CLI, HTTP API, MCP).

**Architecture:** A pnpm TypeScript monorepo. `@yaku/core` holds all domain logic (Zod schemas, orchestrator refine loop, pluggable LLM providers, pluggable SQLite/Postgres translation memory, deterministic gates, glossary, assembly, batch runner, trace/cost). Three thin packages — `@yaku/cli`, `@yaku/api`, `@yaku/mcp` — each parse transport input into a `TranslationRequest`, call `core.translate()`, and serialize the `TranslationResponse`. Shared Zod schemas guarantee the I/O contract never drifts.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vitest, Zod, `better-sqlite3` (TM SQLite adapter), `pg` + `pgvector` (TM Postgres adapter), official `@modelcontextprotocol/sdk` (MCP), a minimal HTTP framework (`hono`), `commander` (CLI). LLM providers behind a narrow in-house interface.

**Spec:** `docs/superpowers/specs/2026-06-26-yaku-translation-engine-design.md`

---

## File Structure

```
yaku/
├── package.json                      # root: workspace scripts, devDeps (vitest, typescript, eslint, prettier)
├── pnpm-workspace.yaml
├── tsconfig.base.json                # shared strict TS config
├── vitest.config.ts                  # root vitest (workspace) config
├── packages/
│   ├── core/
│   │   ├── package.json              # @yaku/core
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # public API: translate(), types, factory exports
│   │       ├── schemas/
│   │       │   ├── segment.ts        # Segment, GlossaryEntry Zod schemas
│   │       │   ├── request.ts        # TranslationRequest schema
│   │       │   ├── response.ts       # SegmentResult, LanguageResult, TranslationResponse
│   │       │   ├── config.ts         # TranslationConfig schema + defaults + resolution
│   │       │   └── index.ts          # re-exports + inferred types
│   │       ├── util/
│   │       │   └── hash.ts           # sourceHash (stable, language-independent)
│   │       ├── assembly/
│   │       │   └── assemble.ts       # group segments -> AssembledGroup; de-assemble back to ids
│   │       ├── glossary/
│   │       │   └── glossary.ts       # resolve glossary for a target lang (global + lang overrides)
│   │       ├── gates/
│   │       │   ├── types.ts          # Gate, GateViolation, AssembledGroup, DraftResult
│   │       │   ├── placeholders.ts
│   │       │   ├── markup.ts
│   │       │   ├── glossary-gate.ts
│   │       │   ├── length.ts
│   │       │   ├── leftover.ts
│   │       │   └── index.ts          # ordered gate list + runGates()
│   │       ├── providers/
│   │       │   ├── types.ts          # LLMProvider, TokenUsage, CompleteArgs, EmbeddingProvider
│   │       │   ├── retry.ts          # exponential backoff wrapper
│   │       │   ├── mock.ts           # MockProvider for tests (scripted responses)
│   │       │   └── openai.ts         # OpenAI adapter (one concrete provider for v1)
│   │       ├── memory/
│   │       │   ├── types.ts          # TranslationMemory, TMEntry, TMMatch interfaces
│   │       │   ├── fuzzy.ts          # lexical similarity (trigram / edit distance)
│   │       │   ├── sqlite.ts         # SQLite adapter (default)
│   │       │   └── postgres.ts       # Postgres + pgvector adapter
│   │       ├── cost/
│   │       │   └── budget.ts         # cost accounting + budget enforcement
│   │       ├── trace/
│   │       │   └── trace.ts          # DocumentTrace builder
│   │       ├── orchestrator/
│   │       │   ├── prompts.ts        # translator/reviewer/back-translator prompt builders
│   │       │   ├── reviewer.ts       # reviewer schema + invocation
│   │       │   ├── group-loop.ts     # refine loop for one (group x language)
│   │       │   └── translate.ts      # top-level translate(): fan out languages/groups
│   │       └── batch/
│   │           └── runner.ts         # bounded-parallelism document batch runner
│   ├── cli/
│   │   ├── package.json              # @yaku/cli, bin: yaku
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # commander setup
│   │       ├── translate-cmd.ts
│   │       └── tm-cmd.ts
│   ├── api/
│   │   ├── package.json              # @yaku/api
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # createServer()
│   │       └── routes.ts
│   └── mcp/
│       ├── package.json              # @yaku/mcp, bin: yaku-mcp
│       ├── tsconfig.json
│       └── src/
│           └── index.ts              # MCP server, translate/tm tools
```

**Build order (dependency-respecting):** schemas → util/hash → assembly → glossary → gates → providers (types/retry/mock) → cost → trace → memory → orchestrator → batch → core index → CLI → API → MCP.

---

## Milestone 0: Monorepo Scaffolding

### Task 1: Root workspace setup

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "yaku",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint ."
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.3.0"
  },
  "packageManager": "pnpm@10.29.2"
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
*.log
.env
*.sqlite
*.sqlite-journal
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: completes without error; `node_modules/` created.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold yaku monorepo workspace"
```

### Task 2: Core package skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@yaku/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create placeholder `packages/core/src/index.ts`**

```typescript
export const VERSION = "0.1.0";
```

- [ ] **Step 4: Install zod into the workspace**

Run: `pnpm install`
Expected: zod resolved under `@yaku/core`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @yaku/core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "chore(core): scaffold @yaku/core package"
```

---

## Milestone 1: Schemas (the shared I/O contract)

### Task 3: Segment & glossary schemas

**Files:**
- Create: `packages/core/src/schemas/segment.ts`
- Test: `packages/core/src/schemas/segment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { SegmentSchema, GlossaryEntrySchema } from "./segment.js";

describe("SegmentSchema", () => {
  it("accepts a minimal segment", () => {
    const r = SegmentSchema.safeParse({ id: "title", text: "Hello" });
    expect(r.success).toBe(true);
  });

  it("accepts full metadata", () => {
    const r = SegmentSchema.safeParse({
      id: "body",
      text: "Welcome",
      metadata: { role: "body", group: "g1", order: 1, maxChars: 100, doNotTranslate: false, notes: "formal" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a segment without id", () => {
    const r = SegmentSchema.safeParse({ text: "Hello" });
    expect(r.success).toBe(false);
  });
});

describe("GlossaryEntrySchema", () => {
  it("accepts a do-not-translate term (no target)", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "Acme" }).success).toBe(true);
  });
  it("accepts a forced mapping scoped to a language", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "Sign in", target: "ログイン", lang: "ja" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/schemas/segment.test.ts`
Expected: FAIL — cannot find module `./segment.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { z } from "zod";

export const SegmentMetadataSchema = z
  .object({
    role: z.string().optional(),
    group: z.string().optional(),
    order: z.number().optional(),
    maxChars: z.number().int().positive().optional(),
    doNotTranslate: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const SegmentSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    metadata: SegmentMetadataSchema.optional(),
  })
  .strict();

export const GlossaryEntrySchema = z
  .object({
    source: z.string().min(1),
    target: z.string().optional(),
    caseSensitive: z.boolean().optional(),
    lang: z.string().optional(),
  })
  .strict();

export type Segment = z.infer<typeof SegmentSchema>;
export type SegmentMetadata = z.infer<typeof SegmentMetadataSchema>;
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/schemas/segment.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/segment.ts packages/core/src/schemas/segment.test.ts
git commit -m "feat(core): segment and glossary schemas"
```

### Task 4: Config schema, defaults, and resolution

**Files:**
- Create: `packages/core/src/schemas/config.ts`
- Test: `packages/core/src/schemas/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { TranslationConfigSchema, DEFAULT_CONFIG, resolveConfig } from "./config.js";

describe("config", () => {
  it("parses an empty config and applies defaults", () => {
    const c = TranslationConfigSchema.parse({});
    expect(c.maxIterations).toBe(3);
    expect(c.reviewer.enabled).toBe(true);
    expect(c.backTranslation.enabled).toBe(false);
    expect(c.tm.enabled).toBe(true);
    expect(c.tm.fuzzy).toBe("both");
    expect(c.concurrency).toBe(8);
    expect(c.trace).toBe("none");
  });

  it("DEFAULT_CONFIG is a valid parsed config", () => {
    expect(DEFAULT_CONFIG.maxIterations).toBe(3);
  });

  it("resolveConfig merges request over defaults", () => {
    const c = resolveConfig({ maxIterations: 5 });
    expect(c.maxIterations).toBe(5);
    expect(c.concurrency).toBe(8);
  });

  it("resolveConfig applies a per-language override", () => {
    const c = resolveConfig({ perLanguage: { ja: { maxIterations: 2 } } });
    const ja = resolveConfig(c, "ja");
    expect(ja.maxIterations).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/schemas/config.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { z } from "zod";

const ModelRefSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    temperature: z.number().optional(),
  })
  .strict();

const ModelsSchema = z
  .object({
    translator: ModelRefSchema.optional(),
    reviewer: ModelRefSchema.optional(),
    backTranslator: ModelRefSchema.optional(),
  })
  .strict()
  .default({});

const baseShape = {
  maxIterations: z.number().int().positive().default(3),
  reviewer: z.object({ enabled: z.boolean().default(true) }).strict().default({}),
  backTranslation: z
    .object({
      enabled: z.boolean().default(false),
      driftThreshold: z.number().default(0.15),
    })
    .strict()
    .default({}),
  models: ModelsSchema,
  tm: z
    .object({
      enabled: z.boolean().default(true),
      fuzzy: z.enum(["lexical", "semantic", "both", "off"]).default("both"),
      fuzzyThreshold: z.number().default(0.85),
      namespace: z.string().optional(),
    })
    .strict()
    .default({}),
  budget: z
    .object({
      maxUsd: z.number().optional(),
      maxIterations: z.number().int().positive().optional(),
      onExceed: z.enum(["best-so-far"]).default("best-so-far"),
    })
    .strict()
    .default({}),
  concurrency: z.number().int().positive().default(8),
  trace: z.enum(["none", "summary", "full"]).default("none"),
};

// Per-language overrides reuse the same shape but everything optional.
const PartialConfigSchema = z.object(baseShape).partial().strict();

export const TranslationConfigSchema = z
  .object({
    ...baseShape,
    perLanguage: z.record(z.string(), PartialConfigSchema).optional(),
  })
  .strict();

export type TranslationConfig = z.infer<typeof TranslationConfigSchema>;
export type PartialConfig = z.infer<typeof PartialConfigSchema>;

export const DEFAULT_CONFIG: TranslationConfig = TranslationConfigSchema.parse({});

/**
 * Resolve effective config. Pass a raw/partial request config to merge over
 * defaults. Pass an already-resolved config + a lang to apply that language's
 * perLanguage override.
 */
export function resolveConfig(
  input: Partial<TranslationConfig> = {},
  lang?: string
): TranslationConfig {
  const merged = TranslationConfigSchema.parse({ ...DEFAULT_CONFIG, ...input });
  if (!lang || !merged.perLanguage?.[lang]) return merged;
  const override = merged.perLanguage[lang];
  return TranslationConfigSchema.parse({ ...merged, ...override });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/schemas/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/config.ts packages/core/src/schemas/config.test.ts
git commit -m "feat(core): config schema, defaults, resolution"
```

### Task 5: Request schema

**Files:**
- Create: `packages/core/src/schemas/request.ts`
- Test: `packages/core/src/schemas/request.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { TranslationRequestSchema } from "./request.js";

describe("TranslationRequestSchema", () => {
  it("accepts a single-language request", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "en",
      targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "Hi" }] },
    });
    expect(r.success).toBe(true);
  });

  it("accepts multi-language with context and glossary", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "auto",
      targetLangs: ["ja", "ko", "fr"],
      document: { id: "page1", segments: [{ id: "t", text: "Hi" }], context: "A landing page" },
      glossary: [{ source: "Acme" }],
      config: { maxIterations: 2 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty targetLangs", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "en",
      targetLangs: [],
      document: { segments: [{ id: "t", text: "Hi" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate segment ids", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "en",
      targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "a" }, { id: "t", text: "b" }] },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/schemas/request.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { z } from "zod";
import { SegmentSchema, GlossaryEntrySchema } from "./segment.js";
import { TranslationConfigSchema } from "./config.js";

const DocumentSchema = z
  .object({
    id: z.string().optional(),
    segments: z
      .array(SegmentSchema)
      .min(1)
      .refine(
        (segs) => new Set(segs.map((s) => s.id)).size === segs.length,
        { message: "segment ids must be unique" }
      ),
    context: z.string().optional(),
  })
  .strict();

export const TranslationRequestSchema = z
  .object({
    sourceLang: z.string().min(1),
    targetLangs: z.array(z.string().min(1)).min(1),
    document: DocumentSchema,
    glossary: z.array(GlossaryEntrySchema).optional(),
    config: TranslationConfigSchema.partial().optional(),
  })
  .strict();

export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
export type Document = z.infer<typeof DocumentSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/schemas/request.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/request.ts packages/core/src/schemas/request.test.ts
git commit -m "feat(core): translation request schema"
```

### Task 6: Response schema + index re-exports

**Files:**
- Create: `packages/core/src/schemas/response.ts`
- Create: `packages/core/src/schemas/index.ts`
- Test: `packages/core/src/schemas/response.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { TranslationResponseSchema, SegmentResultSchema } from "./response.js";

describe("response schemas", () => {
  it("accepts a valid segment result", () => {
    const r = SegmentResultSchema.safeParse({
      id: "t",
      translatedText: "やあ",
      status: "translated",
      sourceHash: "abc123",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a full multi-language response", () => {
    const r = TranslationResponseSchema.safeParse({
      status: "ok",
      sourceLang: "en",
      results: [
        {
          targetLang: "ja",
          status: "ok",
          segments: [{ id: "t", translatedText: "やあ", status: "translated", sourceHash: "h" }],
          summary: { total: 1, translated: 1, reused: 0, unchanged: 0, failed: 0, skipped: 0, iterationsTotal: 1, cost: { inputTokens: 10, outputTokens: 5 } },
        },
      ],
      summary: { total: 1, translated: 1, reused: 0, unchanged: 0, failed: 0, skipped: 0, iterationsTotal: 1, cost: { inputTokens: 10, outputTokens: 5 } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const r = SegmentResultSchema.safeParse({ id: "t", translatedText: "x", status: "bogus", sourceHash: "h" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/schemas/response.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `response.ts`**

```typescript
import { z } from "zod";

export const CostSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    usd: z.number().nonnegative().optional(),
  })
  .strict();

export const SegmentResultSchema = z
  .object({
    id: z.string(),
    translatedText: z.string(),
    status: z.enum(["translated", "reused", "unchanged", "skipped", "failed"]),
    sourceHash: z.string(),
    tmMatch: z
      .object({ type: z.enum(["exact", "fuzzy"]), score: z.number() })
      .strict()
      .optional(),
    confidence: z.number().min(0).max(1).optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  })
  .strict();

const SummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    translated: z.number().int().nonnegative(),
    reused: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    iterationsTotal: z.number().int().nonnegative(),
    cost: CostSchema,
    budgetHit: z.boolean().optional(),
  })
  .strict();

export const LanguageResultSchema = z
  .object({
    targetLang: z.string(),
    status: z.enum(["ok", "partial", "failed"]),
    segments: z.array(SegmentResultSchema),
    summary: SummarySchema,
  })
  .strict();

export const TranslationResponseSchema = z
  .object({
    status: z.enum(["ok", "partial", "failed"]),
    sourceLang: z.string(),
    results: z.array(LanguageResultSchema),
    summary: SummarySchema,
    trace: z.unknown().optional(), // DocumentTrace shape defined in trace module
  })
  .strict();

export type Cost = z.infer<typeof CostSchema>;
export type SegmentResult = z.infer<typeof SegmentResultSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type LanguageResult = z.infer<typeof LanguageResultSchema>;
export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;
```

- [ ] **Step 4: Write `schemas/index.ts`**

```typescript
export * from "./segment.js";
export * from "./config.js";
export * from "./request.js";
export * from "./response.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/schemas/response.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/response.ts packages/core/src/schemas/index.ts packages/core/src/schemas/response.test.ts
git commit -m "feat(core): response schemas + schema index"
```

---

## Milestone 2: Foundational Utilities

### Task 7: sourceHash (stable, language-independent)

**Files:**
- Create: `packages/core/src/util/hash.ts`
- Test: `packages/core/src/util/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { sourceHash } from "./hash.js";

describe("sourceHash", () => {
  it("is stable for identical input", () => {
    expect(sourceHash("Hello")).toBe(sourceHash("Hello"));
  });
  it("differs for different input", () => {
    expect(sourceHash("Hello")).not.toBe(sourceHash("World"));
  });
  it("returns a hex string", () => {
    expect(sourceHash("x")).toMatch(/^[0-9a-f]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/util/hash.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { createHash } from "node:crypto";

/** Stable, language-independent hash of a segment's source text. */
export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/util/hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/util/hash.ts packages/core/src/util/hash.test.ts
git commit -m "feat(core): stable sourceHash util"
```

### Task 8: Gate types

**Files:**
- Create: `packages/core/src/gates/types.ts`

- [ ] **Step 1: Write the types (no test; consumed by later tested tasks)**

```typescript
import type { Segment, GlossaryEntry } from "../schemas/index.js";

/** A group of segments translated together for context. */
export interface AssembledGroup {
  groupKey: string;
  segments: Segment[];          // ordered
  targetLang: string;
  sourceLang: string;
  glossary: GlossaryEntry[];    // resolved for this target lang
  context?: string;             // caller-provided background
}

/** Draft (or revision) output: segmentId -> translated text. */
export interface DraftResult {
  translations: Record<string, string>;
}

export interface GateViolation {
  gate: string;
  segmentId: string;
  message: string;
}

export interface Gate {
  name: string;
  check(group: AssembledGroup, draft: DraftResult): GateViolation[];
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @yaku/core typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/gates/types.ts
git commit -m "feat(core): gate types"
```

### Task 9: Placeholder preservation gate

**Files:**
- Create: `packages/core/src/gates/placeholders.ts`
- Test: `packages/core/src/gates/placeholders.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { placeholderGate } from "./placeholders.js";
import type { AssembledGroup } from "./types.js";

function group(segText: string): AssembledGroup {
  return {
    groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [],
    segments: [{ id: "s1", text: segText }],
  };
}

describe("placeholderGate", () => {
  it("passes when placeholders are preserved", () => {
    const v = placeholderGate.check(group("Hi {name}, you have %s items"), {
      translations: { s1: "こんにちは {name}、%s 件あります" },
    });
    expect(v).toHaveLength(0);
  });

  it("flags a missing {curly} placeholder", () => {
    const v = placeholderGate.check(group("Hi {name}"), { translations: { s1: "こんにちは" } });
    expect(v).toHaveLength(1);
    expect(v[0]!.segmentId).toBe("s1");
  });

  it("flags a missing {{double}} placeholder", () => {
    const v = placeholderGate.check(group("Total: {{count}}"), { translations: { s1: "合計:" } });
    expect(v).toHaveLength(1);
  });

  it("flags a missing %s placeholder", () => {
    const v = placeholderGate.check(group("%s left"), { translations: { s1: "残り" } });
    expect(v).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/gates/placeholders.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Gate, GateViolation } from "./types.js";

// Matches {{double}}, {single}, and printf-style %s %d %1$s
const PLACEHOLDER_RE = /\{\{[^}]+\}\}|\{[^}]+\}|%(?:\d+\$)?[sdif]/g;

function extract(text: string): string[] {
  return (text.match(PLACEHOLDER_RE) ?? []).sort();
}

export const placeholderGate: Gate = {
  name: "placeholders",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const want = extract(seg.text);
      if (want.length === 0) continue;
      const got = extract(draft.translations[seg.id] ?? "");
      const missing = subtractMultiset(want, got);
      if (missing.length > 0) {
        violations.push({
          gate: "placeholders",
          segmentId: seg.id,
          message: `missing placeholders: ${missing.join(", ")}`,
        });
      }
    }
    return violations;
  },
};

function subtractMultiset(want: string[], got: string[]): string[] {
  const counts = new Map<string, number>();
  for (const g of got) counts.set(g, (counts.get(g) ?? 0) + 1);
  const missing: string[] = [];
  for (const w of want) {
    const c = counts.get(w) ?? 0;
    if (c > 0) counts.set(w, c - 1);
    else missing.push(w);
  }
  return missing;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/gates/placeholders.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/gates/placeholders.ts packages/core/src/gates/placeholders.test.ts
git commit -m "feat(core): placeholder preservation gate"
```

### Task 10: Markup integrity gate

**Files:**
- Create: `packages/core/src/gates/markup.ts`
- Test: `packages/core/src/gates/markup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { markupGate } from "./markup.js";
import type { AssembledGroup } from "./types.js";

function group(text: string): AssembledGroup {
  return { groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [], segments: [{ id: "s1", text }] };
}

describe("markupGate", () => {
  it("passes when tags are preserved", () => {
    const v = markupGate.check(group("Click <a href='x'>here</a>"), {
      translations: { s1: "<a href='x'>ここ</a>をクリック" },
    });
    expect(v).toHaveLength(0);
  });
  it("flags a dropped tag", () => {
    const v = markupGate.check(group("<b>Bold</b>"), { translations: { s1: "太字" } });
    expect(v).toHaveLength(1);
  });
  it("ignores segments with no markup", () => {
    const v = markupGate.check(group("plain"), { translations: { s1: "プレーン" } });
    expect(v).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/gates/markup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Gate, GateViolation } from "./types.js";

const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

function tagNames(text: string): string[] {
  return (text.match(TAG_RE) ?? [])
    .map((t) => t.replace(/<\/?\s*([a-zA-Z0-9]+)[\s\S]*?>/, "$1").toLowerCase())
    .sort();
}

export const markupGate: Gate = {
  name: "markup",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const want = tagNames(seg.text);
      if (want.length === 0) continue;
      const got = tagNames(draft.translations[seg.id] ?? "");
      if (want.join("|") !== got.join("|")) {
        violations.push({
          gate: "markup",
          segmentId: seg.id,
          message: `markup tags mismatch (expected [${want.join(",")}], got [${got.join(",")}])`,
        });
      }
    }
    return violations;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/gates/markup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/gates/markup.ts packages/core/src/gates/markup.test.ts
git commit -m "feat(core): markup integrity gate"
```

### Task 11: Glossary gate

**Files:**
- Create: `packages/core/src/gates/glossary-gate.ts`
- Test: `packages/core/src/gates/glossary-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { glossaryGate } from "./glossary-gate.js";
import type { AssembledGroup } from "./types.js";

function group(text: string, glossary: AssembledGroup["glossary"], tr: string): AssembledGroup {
  return { groupKey: "g", targetLang: "ja", sourceLang: "en", glossary, segments: [{ id: "s1", text }] };
}

describe("glossaryGate", () => {
  it("passes when do-not-translate term is kept verbatim", () => {
    const g = group("Welcome to Acme", [{ source: "Acme" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "Acme へようこそ" } });
    expect(v).toHaveLength(0);
  });
  it("flags a do-not-translate term that was translated away", () => {
    const g = group("Welcome to Acme", [{ source: "Acme" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "頂点へようこそ" } });
    expect(v).toHaveLength(1);
  });
  it("flags a forced mapping not applied", () => {
    const g = group("Sign in", [{ source: "Sign in", target: "ログイン", lang: "ja" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "サインイン" } });
    expect(v).toHaveLength(1);
  });
  it("passes a forced mapping that was applied", () => {
    const g = group("Sign in", [{ source: "Sign in", target: "ログイン", lang: "ja" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "ログイン" } });
    expect(v).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/gates/glossary-gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Gate, GateViolation } from "./types.js";

export const glossaryGate: Gate = {
  name: "glossary",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const translated = draft.translations[seg.id] ?? "";
      for (const entry of group.glossary) {
        const sourceHasTerm = contains(seg.text, entry.source, entry.caseSensitive);
        if (!sourceHasTerm) continue;
        if (entry.target) {
          // forced mapping: target text must contain the target term
          if (!translated.includes(entry.target)) {
            violations.push({
              gate: "glossary",
              segmentId: seg.id,
              message: `forced mapping "${entry.source}" -> "${entry.target}" not applied`,
            });
          }
        } else {
          // do-not-translate: term must remain verbatim
          if (!contains(translated, entry.source, entry.caseSensitive)) {
            violations.push({
              gate: "glossary",
              segmentId: seg.id,
              message: `do-not-translate term "${entry.source}" was altered`,
            });
          }
        }
      }
    }
    return violations;
  },
};

function contains(haystack: string, needle: string, caseSensitive?: boolean): boolean {
  if (caseSensitive) return haystack.includes(needle);
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/gates/glossary-gate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/gates/glossary-gate.ts packages/core/src/gates/glossary-gate.test.ts
git commit -m "feat(core): glossary enforcement gate"
```

### Task 12: Length gate

**Files:**
- Create: `packages/core/src/gates/length.ts`
- Test: `packages/core/src/gates/length.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { lengthGate } from "./length.js";
import type { AssembledGroup } from "./types.js";

function group(maxChars: number | undefined, tr: string): AssembledGroup {
  return {
    groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [],
    segments: [{ id: "s1", text: "src", metadata: maxChars === undefined ? {} : { maxChars } }],
  };
}

describe("lengthGate", () => {
  it("passes within maxChars", () => {
    expect(lengthGate.check(group(10, ""), { translations: { s1: "12345" } })).toHaveLength(0);
  });
  it("flags exceeding maxChars", () => {
    const v = lengthGate.check(group(3, ""), { translations: { s1: "12345" } });
    expect(v).toHaveLength(1);
  });
  it("ignores segments without maxChars", () => {
    expect(lengthGate.check(group(undefined, ""), { translations: { s1: "very long text here" } })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/gates/length.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Gate, GateViolation } from "./types.js";

export const lengthGate: Gate = {
  name: "length",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const max = seg.metadata?.maxChars;
      if (max === undefined) continue;
      const len = [...(draft.translations[seg.id] ?? "")].length;
      if (len > max) {
        violations.push({
          gate: "length",
          segmentId: seg.id,
          message: `length ${len} exceeds maxChars ${max}`,
        });
      }
    }
    return violations;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/gates/length.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/gates/length.ts packages/core/src/gates/length.test.ts
git commit -m "feat(core): length bound gate"
```

### Task 13: Leftover-source gate + gate registry

**Files:**
- Create: `packages/core/src/gates/leftover.ts`
- Create: `packages/core/src/gates/index.ts`
- Test: `packages/core/src/gates/leftover.test.ts`
- Test: `packages/core/src/gates/index.test.ts`

- [ ] **Step 1: Write the failing tests**

`leftover.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { leftoverGate } from "./leftover.js";
import type { AssembledGroup } from "./types.js";

function group(src: string, tr: string): AssembledGroup {
  return { groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [], segments: [{ id: "s1", text: src }] };
}

describe("leftoverGate", () => {
  it("passes when target differs from source", () => {
    expect(leftoverGate.check(group("Hello world", ""), { translations: { s1: "こんにちは世界" } })).toHaveLength(0);
  });
  it("flags target identical to a multi-word source", () => {
    const v = leftoverGate.check(group("Hello world friend", ""), { translations: { s1: "Hello world friend" } });
    expect(v).toHaveLength(1);
  });
  it("ignores short/identifier-like sources", () => {
    expect(leftoverGate.check(group("OK", ""), { translations: { s1: "OK" } })).toHaveLength(0);
  });
});
```

`index.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { runGates, GATES } from "./index.js";
import type { AssembledGroup } from "./types.js";

describe("runGates", () => {
  it("includes all five built-in gates", () => {
    expect(GATES.map((g) => g.name)).toEqual(["placeholders", "markup", "glossary", "length", "leftover"]);
  });
  it("aggregates violations across gates", () => {
    const g: AssembledGroup = {
      groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [],
      segments: [{ id: "s1", text: "Hi {name}", metadata: { maxChars: 2 } }],
    };
    const v = runGates(g, { translations: { s1: "こんにちは" } }); // missing placeholder + too long
    expect(v.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/gates/leftover.test.ts packages/core/src/gates/index.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write `leftover.ts`**

```typescript
import type { Gate, GateViolation } from "./types.js";

export const leftoverGate: Gate = {
  name: "leftover",
  check(group, draft): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const seg of group.segments) {
      const src = seg.text.trim();
      const tr = (draft.translations[seg.id] ?? "").trim();
      // Heuristic: only flag identical when source is "wordy" (>= 3 words, > 10 chars).
      const wordy = src.split(/\s+/).length >= 3 && src.length > 10;
      if (wordy && tr === src) {
        violations.push({
          gate: "leftover",
          segmentId: seg.id,
          message: "target identical to source (likely untranslated)",
        });
      }
    }
    return violations;
  },
};
```

- [ ] **Step 4: Write `index.ts`**

```typescript
import type { Gate, GateViolation, AssembledGroup, DraftResult } from "./types.js";
import { placeholderGate } from "./placeholders.js";
import { markupGate } from "./markup.js";
import { glossaryGate } from "./glossary-gate.js";
import { lengthGate } from "./length.js";
import { leftoverGate } from "./leftover.js";

// Cheap-first order.
export const GATES: Gate[] = [placeholderGate, markupGate, glossaryGate, lengthGate, leftoverGate];

export function runGates(group: AssembledGroup, draft: DraftResult): GateViolation[] {
  return GATES.flatMap((gate) => gate.check(group, draft));
}

export type { Gate, GateViolation, AssembledGroup, DraftResult } from "./types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/gates/leftover.test.ts packages/core/src/gates/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/gates/leftover.ts packages/core/src/gates/index.ts packages/core/src/gates/leftover.test.ts packages/core/src/gates/index.test.ts
git commit -m "feat(core): leftover gate + gate registry"
```

---

## Milestone 3: Glossary & Assembly

### Task 14: Glossary resolution (global + per-language)

**Files:**
- Create: `packages/core/src/glossary/glossary.ts`
- Test: `packages/core/src/glossary/glossary.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { resolveGlossary } from "./glossary.js";
import type { GlossaryEntry } from "../schemas/index.js";

const g: GlossaryEntry[] = [
  { source: "Acme" },                                    // global do-not-translate
  { source: "Sign in", target: "ログイン", lang: "ja" }, // ja-only forced mapping
  { source: "Sign in", target: "로그인", lang: "ko" },   // ko-only forced mapping
];

describe("resolveGlossary", () => {
  it("includes global entries and the matching-language entries", () => {
    const ja = resolveGlossary(g, "ja");
    expect(ja).toContainEqual({ source: "Acme" });
    expect(ja).toContainEqual({ source: "Sign in", target: "ログイン", lang: "ja" });
    expect(ja.find((e) => e.lang === "ko")).toBeUndefined();
  });
  it("returns only global when language has no specific entries", () => {
    const fr = resolveGlossary(g, "fr");
    expect(fr).toEqual([{ source: "Acme" }]);
  });
  it("handles undefined glossary", () => {
    expect(resolveGlossary(undefined, "ja")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/glossary/glossary.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { GlossaryEntry } from "../schemas/index.js";

/** Resolve the glossary entries that apply to a target language:
 *  all global entries (no lang) plus entries scoped to this lang. */
export function resolveGlossary(
  glossary: GlossaryEntry[] | undefined,
  targetLang: string
): GlossaryEntry[] {
  if (!glossary) return [];
  return glossary.filter((e) => e.lang === undefined || e.lang === targetLang);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/glossary/glossary.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/glossary/glossary.ts packages/core/src/glossary/glossary.test.ts
git commit -m "feat(core): glossary resolution (global + per-language)"
```

### Task 15: Segment assembly & de-assembly

**Files:**
- Create: `packages/core/src/assembly/assemble.ts`
- Test: `packages/core/src/assembly/assemble.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { groupSegments } from "./assemble.js";
import type { Segment } from "../schemas/index.js";

const segs: Segment[] = [
  { id: "title", text: "Welcome", metadata: { group: "hero", order: 0, role: "title" } },
  { id: "sub", text: "Get started today", metadata: { group: "hero", order: 1, role: "body" } },
  { id: "footer", text: "Contact us", metadata: { group: "foot", order: 0 } },
  { id: "loose", text: "Hi" }, // no group
];

describe("groupSegments", () => {
  it("groups by metadata.group and orders within group", () => {
    const groups = groupSegments(segs);
    const hero = groups.find((g) => g.groupKey === "hero")!;
    expect(hero.segments.map((s) => s.id)).toEqual(["title", "sub"]);
  });
  it("puts ungrouped segments each in their own group", () => {
    const groups = groupSegments(segs);
    const loose = groups.find((g) => g.segments.some((s) => s.id === "loose"))!;
    expect(loose.segments).toHaveLength(1);
  });
  it("covers every input segment exactly once", () => {
    const groups = groupSegments(segs);
    const ids = groups.flatMap((g) => g.segments.map((s) => s.id)).sort();
    expect(ids).toEqual(["footer", "loose", "sub", "title"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/assembly/assemble.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Segment } from "../schemas/index.js";

export interface SegmentGroup {
  groupKey: string;
  segments: Segment[]; // ordered by metadata.order, then input order
}

/** Group segments by metadata.group. Ungrouped segments each become a
 *  singleton group keyed by their id. Within a group, sort by order. */
export function groupSegments(segments: Segment[]): SegmentGroup[] {
  const grouped = new Map<string, Segment[]>();
  const order = new Map<string, number>(); // first-seen index for stable group order
  let idx = 0;

  for (const seg of segments) {
    const key = seg.metadata?.group ?? `__single__:${seg.id}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.set(key, idx);
    }
    grouped.get(key)!.push(seg);
    idx++;
  }

  const result: SegmentGroup[] = [];
  for (const [key, segs] of grouped) {
    const sorted = [...segs].sort((a, b) => (a.metadata?.order ?? 0) - (b.metadata?.order ?? 0));
    const groupKey = key.startsWith("__single__:") ? sorted[0]!.id : key;
    result.push({ groupKey, segments: sorted });
  }
  // Stable order across groups by first-seen index.
  result.sort((a, b) => {
    const ka = a.groupKey, kb = b.groupKey;
    return (order.get(a.segments[0]!.metadata?.group ?? `__single__:${ka}`) ?? 0)
         - (order.get(b.segments[0]!.metadata?.group ?? `__single__:${kb}`) ?? 0);
  });
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/assembly/assemble.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assembly/assemble.ts packages/core/src/assembly/assemble.test.ts
git commit -m "feat(core): segment grouping/assembly"
```

---

## Milestone 4: Providers

### Task 16: Provider types + retry wrapper

**Files:**
- Create: `packages/core/src/providers/types.ts`
- Create: `packages/core/src/providers/retry.ts`
- Test: `packages/core/src/providers/retry.test.ts`

- [ ] **Step 1: Write `types.ts`**

```typescript
import type { ZodSchema } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  usd?: number;
}

export type LLMRole = "translator" | "reviewer" | "backTranslator";

export interface CompleteArgs<T> {
  role: LLMRole;
  system: string;
  prompt: string;
  schema: ZodSchema<T>;
  model: string;
  temperature?: number;
}

export interface LLMProvider {
  name: string;
  complete<T>(args: CompleteArgs<T>): Promise<{ value: T; usage: TokenUsage }>;
}

export interface EmbeddingProvider {
  name: string;
  embed(texts: string[], model: string): Promise<{ vectors: number[][]; usage: TokenUsage }>;
}
```

- [ ] **Step 2: Write the failing test for retry**

```typescript
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries on failure then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("rate limit")).mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("throws after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/providers/retry.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `retry.ts`**

```typescript
export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = { retries: 3, baseDelayMs: 500 }
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries) break;
      const delay = opts.baseDelayMs * 2 ** attempt;
      await sleep(delay);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/providers/retry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/providers/types.ts packages/core/src/providers/retry.ts packages/core/src/providers/retry.test.ts
git commit -m "feat(core): provider types + retry wrapper"
```

### Task 17: Mock provider (for tests)

**Files:**
- Create: `packages/core/src/providers/mock.ts`
- Test: `packages/core/src/providers/mock.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MockProvider } from "./mock.js";

const schema = z.object({ translations: z.record(z.string(), z.string()) });

describe("MockProvider", () => {
  it("returns scripted responses in order per role", async () => {
    const p = new MockProvider({
      translator: [{ translations: { s1: "draft1" } }, { translations: { s1: "draft2" } }],
    });
    const r1 = await p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" });
    const r2 = await p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" });
    expect(r1.value.translations.s1).toBe("draft1");
    expect(r2.value.translations.s1).toBe("draft2");
  });
  it("reports usage", async () => {
    const p = new MockProvider({ translator: [{ translations: { s1: "x" } }] });
    const r = await p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" });
    expect(r.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });
  it("throws when a role runs out of scripted responses", async () => {
    const p = new MockProvider({ translator: [] });
    await expect(
      p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" })
    ).rejects.toThrow(/no scripted/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/providers/mock.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { LLMProvider, CompleteArgs, LLMRole, TokenUsage } from "./types.js";

type Script = Partial<Record<LLMRole, unknown[]>>;

export class MockProvider implements LLMProvider {
  name = "mock";
  private queues: Map<LLMRole, unknown[]>;
  public calls: Array<{ role: LLMRole; prompt: string }> = [];

  constructor(script: Script) {
    this.queues = new Map();
    for (const role of Object.keys(script) as LLMRole[]) {
      this.queues.set(role, [...(script[role] ?? [])]);
    }
  }

  async complete<T>(args: CompleteArgs<T>): Promise<{ value: T; usage: TokenUsage }> {
    this.calls.push({ role: args.role, prompt: args.prompt });
    const q = this.queues.get(args.role);
    if (!q || q.length === 0) {
      throw new Error(`MockProvider: no scripted response for role "${args.role}"`);
    }
    const raw = q.shift();
    const value = args.schema.parse(raw); // validate against the demanded schema
    const usage: TokenUsage = { inputTokens: args.prompt.length, outputTokens: 1, usd: 0 };
    return { value, usage };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/providers/mock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/mock.ts packages/core/src/providers/mock.test.ts
git commit -m "feat(core): mock LLM provider for tests"
```

### Task 18: OpenAI provider adapter

**Files:**
- Modify: `packages/core/package.json` (add `openai` dependency)
- Create: `packages/core/src/providers/openai.ts`
- Test: `packages/core/src/providers/openai.test.ts`

- [ ] **Step 1: Add dependency**

Edit `packages/core/package.json` dependencies to add:
```json
"openai": "^4.67.0"
```
Run: `pnpm install`

- [ ] **Step 2: Write the failing test (uses a stubbed client, no network)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OpenAIProvider } from "./openai.js";

const schema = z.object({ translations: z.record(z.string(), z.string()) });

describe("OpenAIProvider", () => {
  it("parses a JSON tool/content response into the schema", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ translations: { s1: "やあ" } }) } }],
            usage: { prompt_tokens: 12, completion_tokens: 4 },
          }),
        },
      },
    };
    const p = new OpenAIProvider({ client: fakeClient as any });
    const r = await p.complete({ role: "translator", system: "sys", prompt: "p", schema, model: "gpt-4o" });
    expect(r.value.translations.s1).toBe("やあ");
    expect(r.usage.inputTokens).toBe(12);
    expect(r.usage.outputTokens).toBe(4);
  });

  it("retries then throws on repeated invalid JSON", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "not json" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        },
      },
    };
    const p = new OpenAIProvider({ client: fakeClient as any, parseRetries: 1 });
    await expect(
      p.complete({ role: "translator", system: "sys", prompt: "p", schema, model: "gpt-4o" })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/providers/openai.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write minimal implementation**

```typescript
import OpenAI from "openai";
import type { LLMProvider, CompleteArgs, TokenUsage } from "./types.js";
import { withRetry } from "./retry.js";

export interface OpenAIProviderOptions {
  client?: Pick<OpenAI, "chat">;
  apiKey?: string;
  parseRetries?: number;
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: Pick<OpenAI, "chat">;
  private parseRetries: number;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY });
    this.parseRetries = opts.parseRetries ?? 1;
  }

  async complete<T>(args: CompleteArgs<T>): Promise<{ value: T; usage: TokenUsage }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.parseRetries; attempt++) {
      const res = await withRetry(() =>
        this.client.chat.completions.create({
          model: args.model,
          temperature: args.temperature ?? 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: args.system },
            {
              role: "user",
              content:
                attempt === 0
                  ? args.prompt
                  : `${args.prompt}\n\nIMPORTANT: respond with ONLY valid JSON matching the requested schema.`,
            },
          ],
        })
      );
      const content = res.choices[0]?.message?.content ?? "";
      const usage: TokenUsage = {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      };
      try {
        const parsed = args.schema.parse(JSON.parse(content));
        return { value: parsed, usage };
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`OpenAIProvider: failed to parse response into schema: ${String(lastErr)}`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/providers/openai.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/providers/openai.ts packages/core/src/providers/openai.test.ts pnpm-lock.yaml
git commit -m "feat(core): OpenAI provider adapter"
```

---

## Milestone 5: Cost & Trace

### Task 19: Cost accounting + budget

**Files:**
- Create: `packages/core/src/cost/budget.ts`
- Test: `packages/core/src/cost/budget.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { CostTracker } from "./budget.js";

describe("CostTracker", () => {
  it("accumulates token usage", () => {
    const t = new CostTracker();
    t.add({ inputTokens: 10, outputTokens: 5 });
    t.add({ inputTokens: 3, outputTokens: 2, usd: 0.01 });
    expect(t.total.inputTokens).toBe(13);
    expect(t.total.outputTokens).toBe(7);
    expect(t.total.usd).toBeCloseTo(0.01);
  });
  it("reports budget not exceeded when under cap", () => {
    const t = new CostTracker({ maxUsd: 1 });
    t.add({ inputTokens: 1, outputTokens: 1, usd: 0.1 });
    expect(t.budgetExceeded()).toBe(false);
  });
  it("reports budget exceeded when over usd cap", () => {
    const t = new CostTracker({ maxUsd: 0.05 });
    t.add({ inputTokens: 1, outputTokens: 1, usd: 0.1 });
    expect(t.budgetExceeded()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/cost/budget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { TokenUsage } from "../providers/types.js";
import type { Cost } from "../schemas/index.js";

export interface BudgetOptions {
  maxUsd?: number;
}

export class CostTracker {
  total: Cost = { inputTokens: 0, outputTokens: 0, usd: 0 };
  constructor(private budget: BudgetOptions = {}) {}

  add(usage: TokenUsage): void {
    this.total.inputTokens += usage.inputTokens;
    this.total.outputTokens += usage.outputTokens;
    this.total.usd = (this.total.usd ?? 0) + (usage.usd ?? 0);
  }

  budgetExceeded(): boolean {
    if (this.budget.maxUsd === undefined) return false;
    return (this.total.usd ?? 0) >= this.budget.maxUsd;
  }
}

export function addCost(a: Cost, b: Cost): Cost {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    usd: (a.usd ?? 0) + (b.usd ?? 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/cost/budget.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cost/budget.ts packages/core/src/cost/budget.test.ts
git commit -m "feat(core): cost tracker + budget"
```

### Task 20: Trace builder

**Files:**
- Create: `packages/core/src/trace/trace.ts`
- Test: `packages/core/src/trace/trace.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { GroupTrace } from "./trace.js";

describe("GroupTrace", () => {
  it("records iterations and a stop reason", () => {
    const t = new GroupTrace("hero", "ja");
    t.iteration({ draft: { s1: "d1" }, gateViolations: ["x"], reviewerPassed: false, cost: { inputTokens: 1, outputTokens: 1 } });
    t.iteration({ draft: { s1: "d2" }, gateViolations: [], reviewerPassed: true, cost: { inputTokens: 1, outputTokens: 1 } });
    t.finish("accepted");
    const out = t.toJSON();
    expect(out.iterations).toHaveLength(2);
    expect(out.stopReason).toBe("accepted");
    expect(out.groupKey).toBe("hero");
    expect(out.targetLang).toBe("ja");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/trace/trace.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Cost } from "../schemas/index.js";

export type StopReason = "accepted" | "max-iterations" | "budget-hit" | "back-translation-ok";

export interface IterationTrace {
  draft: Record<string, string>;
  gateViolations: string[];
  reviewerPassed: boolean;
  tmHit?: "exact" | "fuzzy" | "none";
  cost: Cost;
}

export interface GroupTraceJSON {
  groupKey: string;
  targetLang: string;
  iterations: IterationTrace[];
  stopReason: StopReason;
}

export class GroupTrace {
  private iterations: IterationTrace[] = [];
  private stopReason: StopReason = "accepted";
  constructor(private groupKey: string, private targetLang: string) {}

  iteration(it: IterationTrace): void {
    this.iterations.push(it);
  }
  finish(reason: StopReason): void {
    this.stopReason = reason;
  }
  toJSON(): GroupTraceJSON {
    return {
      groupKey: this.groupKey,
      targetLang: this.targetLang,
      iterations: this.iterations,
      stopReason: this.stopReason,
    };
  }
}

export interface DocumentTrace {
  documentId?: string;
  groups: GroupTraceJSON[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/trace/trace.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/trace/trace.ts packages/core/src/trace/trace.test.ts
git commit -m "feat(core): group/document trace builder"
```

---

## Milestone 6: Translation Memory

### Task 21: TM types + lexical fuzzy similarity

**Files:**
- Create: `packages/core/src/memory/types.ts`
- Create: `packages/core/src/memory/fuzzy.ts`
- Test: `packages/core/src/memory/fuzzy.test.ts`

- [ ] **Step 1: Write `types.ts`**

```typescript
export interface TMEntry {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  translatedText: string;
  sourceHash: string;
  namespace?: string;
}

export interface TMMatch {
  entry: TMEntry;
  score: number; // 0..1
}

export interface FuzzyOptions {
  threshold: number; // 0..1
  limit?: number;
  strategy: "lexical" | "semantic" | "both" | "off";
}

export interface TranslationMemory {
  lookupExact(sourceText: string, sourceLang: string, targetLang: string, namespace?: string): Promise<TMEntry | null>;
  lookupFuzzy(sourceText: string, sourceLang: string, targetLang: string, opts: FuzzyOptions, namespace?: string): Promise<TMMatch[]>;
  upsert(entry: TMEntry): Promise<void>;
  invalidate(filter: { sourceLang?: string; targetLang?: string; namespace?: string }): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test for fuzzy**

```typescript
import { describe, it, expect } from "vitest";
import { trigramSimilarity } from "./fuzzy.js";

describe("trigramSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBeCloseTo(1);
  });
  it("is 0 for completely different strings", () => {
    expect(trigramSimilarity("abcdef", "zyxwvu")).toBeLessThan(0.1);
  });
  it("is high for near-identical strings", () => {
    expect(trigramSimilarity("hello world", "hello worlds")).toBeGreaterThan(0.7);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/memory/fuzzy.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `fuzzy.ts`**

```typescript
function trigrams(s: string): Set<string> {
  const norm = `  ${s.toLowerCase().trim()} `;
  const grams = new Set<string>();
  for (let i = 0; i < norm.length - 2; i++) grams.add(norm.slice(i, i + 3));
  return grams;
}

/** Jaccard similarity over character trigrams (0..1). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/memory/fuzzy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/memory/types.ts packages/core/src/memory/fuzzy.ts packages/core/src/memory/fuzzy.test.ts
git commit -m "feat(core): TM types + lexical fuzzy similarity"
```

### Task 22: SQLite TM adapter

**Files:**
- Modify: `packages/core/package.json` (add `better-sqlite3`, dev `@types/better-sqlite3`)
- Create: `packages/core/src/memory/sqlite.ts`
- Test: `packages/core/src/memory/sqlite.test.ts`

- [ ] **Step 1: Add dependencies**

Edit `packages/core/package.json`: add to dependencies `"better-sqlite3": "^11.3.0"`, to devDependencies `"@types/better-sqlite3": "^7.6.0"`.
Run: `pnpm install`

- [ ] **Step 2: Write the failing test (in-memory db)**

```typescript
import { describe, it, expect } from "vitest";
import { SqliteTranslationMemory } from "./sqlite.js";

function tm() {
  return new SqliteTranslationMemory(":memory:");
}

describe("SqliteTranslationMemory", () => {
  it("upserts and finds exact match", async () => {
    const m = tm();
    await m.upsert({ sourceText: "Hello", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    const got = await m.lookupExact("Hello", "en", "ja");
    expect(got?.translatedText).toBe("やあ");
  });
  it("scopes by namespace", async () => {
    const m = tm();
    await m.upsert({ sourceText: "Hello", sourceLang: "en", targetLang: "ja", translatedText: "A", sourceHash: "h", namespace: "p1" });
    expect(await m.lookupExact("Hello", "en", "ja", "p2")).toBeNull();
    expect((await m.lookupExact("Hello", "en", "ja", "p1"))?.translatedText).toBe("A");
  });
  it("returns ranked fuzzy matches above threshold", async () => {
    const m = tm();
    await m.upsert({ sourceText: "hello world", sourceLang: "en", targetLang: "ja", translatedText: "X", sourceHash: "h" });
    const matches = await m.lookupFuzzy("hello worlds", "en", "ja", { threshold: 0.5, strategy: "lexical" });
    expect(matches.length).toBe(1);
    expect(matches[0]!.score).toBeGreaterThan(0.5);
  });
  it("invalidate removes entries by filter", async () => {
    const m = tm();
    await m.upsert({ sourceText: "Hello", sourceLang: "en", targetLang: "ja", translatedText: "A", sourceHash: "h" });
    await m.invalidate({ targetLang: "ja" });
    expect(await m.lookupExact("Hello", "en", "ja")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/memory/sqlite.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `sqlite.ts`**

```typescript
import Database from "better-sqlite3";
import type { TranslationMemory, TMEntry, TMMatch, FuzzyOptions } from "./types.js";
import { trigramSimilarity } from "./fuzzy.js";

const NS = (ns?: string) => ns ?? "__global__";

export class SqliteTranslationMemory implements TranslationMemory {
  private db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tm (
        namespace TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        PRIMARY KEY (namespace, source_lang, target_lang, source_text)
      );
    `);
  }

  async lookupExact(sourceText: string, sourceLang: string, targetLang: string, namespace?: string): Promise<TMEntry | null> {
    const row = this.db
      .prepare(`SELECT * FROM tm WHERE namespace=? AND source_lang=? AND target_lang=? AND source_text=?`)
      .get(NS(namespace), sourceLang, targetLang, sourceText) as any;
    return row ? rowToEntry(row) : null;
  }

  async lookupFuzzy(sourceText: string, sourceLang: string, targetLang: string, opts: FuzzyOptions, namespace?: string): Promise<TMMatch[]> {
    if (opts.strategy === "off" || opts.strategy === "semantic") return []; // semantic handled by Postgres adapter
    const rows = this.db
      .prepare(`SELECT * FROM tm WHERE namespace=? AND source_lang=? AND target_lang=?`)
      .all(NS(namespace), sourceLang, targetLang) as any[];
    const matches: TMMatch[] = [];
    for (const row of rows) {
      const score = trigramSimilarity(sourceText, row.source_text);
      if (score >= opts.threshold) matches.push({ entry: rowToEntry(row), score });
    }
    matches.sort((a, b) => b.score - a.score);
    return opts.limit ? matches.slice(0, opts.limit) : matches;
  }

  async upsert(entry: TMEntry): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO tm (namespace, source_lang, target_lang, source_text, translated_text, source_hash)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(namespace, source_lang, target_lang, source_text)
        DO UPDATE SET translated_text=excluded.translated_text, source_hash=excluded.source_hash
      `)
      .run(NS(entry.namespace), entry.sourceLang, entry.targetLang, entry.sourceText, entry.translatedText, entry.sourceHash);
  }

  async invalidate(filter: { sourceLang?: string; targetLang?: string; namespace?: string }): Promise<void> {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.namespace !== undefined) { clauses.push("namespace=?"); params.push(NS(filter.namespace)); }
    if (filter.sourceLang) { clauses.push("source_lang=?"); params.push(filter.sourceLang); }
    if (filter.targetLang) { clauses.push("target_lang=?"); params.push(filter.targetLang); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    this.db.prepare(`DELETE FROM tm ${where}`).run(...params);
  }
}

function rowToEntry(row: any): TMEntry {
  return {
    sourceText: row.source_text,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    translatedText: row.translated_text,
    sourceHash: row.source_hash,
    namespace: row.namespace === "__global__" ? undefined : row.namespace,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/memory/sqlite.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/memory/sqlite.ts packages/core/src/memory/sqlite.test.ts pnpm-lock.yaml
git commit -m "feat(core): SQLite translation memory adapter"
```

### Task 23: Postgres TM adapter (pgvector)

**Files:**
- Modify: `packages/core/package.json` (add `pg`, dev `@types/pg`)
- Create: `packages/core/src/memory/postgres.ts`
- Test: `packages/core/src/memory/postgres.test.ts`

- [ ] **Step 1: Add dependencies**

Edit `packages/core/package.json`: dependencies add `"pg": "^8.13.0"`; devDependencies add `"@types/pg": "^8.11.0"`.
Run: `pnpm install`

- [ ] **Step 2: Write the failing test (mocked pool — no live DB)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { PostgresTranslationMemory } from "./postgres.js";

function fakePool(rows: any[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

describe("PostgresTranslationMemory", () => {
  it("lookupExact returns a parsed entry", async () => {
    const pool = fakePool([
      { source_text: "Hello", source_lang: "en", target_lang: "ja", translated_text: "やあ", source_hash: "h", namespace: "__global__" },
    ]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    const got = await m.lookupExact("Hello", "en", "ja");
    expect(got?.translatedText).toBe("やあ");
  });
  it("lookupFuzzy returns empty without embedding provider when strategy=semantic", async () => {
    const pool = fakePool([]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    const matches = await m.lookupFuzzy("Hello", "en", "ja", { threshold: 0.5, strategy: "semantic" });
    expect(matches).toEqual([]);
  });
  it("upsert issues an INSERT ... ON CONFLICT query", async () => {
    const pool = fakePool([]);
    const m = new PostgresTranslationMemory({ pool, embeddingProvider: null });
    await m.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    expect(pool.query).toHaveBeenCalled();
    const sql = pool.query.mock.calls.at(-1)![0] as string;
    expect(sql).toMatch(/INSERT INTO tm/i);
    expect(sql).toMatch(/ON CONFLICT/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/memory/postgres.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `postgres.ts`**

```typescript
import type { Pool } from "pg";
import type { TranslationMemory, TMEntry, TMMatch, FuzzyOptions } from "./types.js";
import type { EmbeddingProvider } from "../providers/types.js";
import { trigramSimilarity } from "./fuzzy.js";

const NS = (ns?: string) => ns ?? "__global__";

export interface PostgresTMOptions {
  pool: Pool;
  embeddingProvider?: EmbeddingProvider | null;
  embeddingModel?: string;
}

export class PostgresTranslationMemory implements TranslationMemory {
  constructor(private opts: PostgresTMOptions) {}

  async migrate(): Promise<void> {
    await this.opts.pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS tm (
        namespace TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        embedding vector(1536),
        PRIMARY KEY (namespace, source_lang, target_lang, source_text)
      );
    `);
  }

  async lookupExact(sourceText: string, sourceLang: string, targetLang: string, namespace?: string): Promise<TMEntry | null> {
    const res = await this.opts.pool.query(
      `SELECT * FROM tm WHERE namespace=$1 AND source_lang=$2 AND target_lang=$3 AND source_text=$4`,
      [NS(namespace), sourceLang, targetLang, sourceText]
    );
    return res.rows[0] ? rowToEntry(res.rows[0]) : null;
  }

  async lookupFuzzy(sourceText: string, sourceLang: string, targetLang: string, opts: FuzzyOptions, namespace?: string): Promise<TMMatch[]> {
    if (opts.strategy === "off") return [];

    // Semantic path: requires embedding provider + pgvector cosine distance.
    if ((opts.strategy === "semantic" || opts.strategy === "both") && this.opts.embeddingProvider) {
      const { vectors } = await this.opts.embeddingProvider.embed([sourceText], this.opts.embeddingModel ?? "text-embedding-3-small");
      const vec = `[${vectors[0]!.join(",")}]`;
      const res = await this.opts.pool.query(
        `SELECT *, 1 - (embedding <=> $5::vector) AS score
         FROM tm WHERE namespace=$1 AND source_lang=$2 AND target_lang=$3 AND embedding IS NOT NULL
         AND 1 - (embedding <=> $5::vector) >= $4
         ORDER BY score DESC LIMIT $6`,
        [NS(namespace), sourceLang, targetLang, opts.threshold, vec, opts.limit ?? 5]
      );
      return res.rows.map((r) => ({ entry: rowToEntry(r), score: Number(r.score) }));
    }

    // Lexical fallback (also used for strategy="lexical").
    if (opts.strategy === "lexical" || opts.strategy === "both") {
      const res = await this.opts.pool.query(
        `SELECT * FROM tm WHERE namespace=$1 AND source_lang=$2 AND target_lang=$3`,
        [NS(namespace), sourceLang, targetLang]
      );
      const matches = res.rows
        .map((r) => ({ entry: rowToEntry(r), score: trigramSimilarity(sourceText, r.source_text) }))
        .filter((m) => m.score >= opts.threshold)
        .sort((a, b) => b.score - a.score);
      return opts.limit ? matches.slice(0, opts.limit) : matches;
    }

    return [];
  }

  async upsert(entry: TMEntry): Promise<void> {
    let embedding: string | null = null;
    if (this.opts.embeddingProvider) {
      const { vectors } = await this.opts.embeddingProvider.embed([entry.sourceText], this.opts.embeddingModel ?? "text-embedding-3-small");
      embedding = `[${vectors[0]!.join(",")}]`;
    }
    await this.opts.pool.query(
      `INSERT INTO tm (namespace, source_lang, target_lang, source_text, translated_text, source_hash, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (namespace, source_lang, target_lang, source_text)
       DO UPDATE SET translated_text=EXCLUDED.translated_text, source_hash=EXCLUDED.source_hash, embedding=EXCLUDED.embedding`,
      [NS(entry.namespace), entry.sourceLang, entry.targetLang, entry.sourceText, entry.translatedText, entry.sourceHash, embedding]
    );
  }

  async invalidate(filter: { sourceLang?: string; targetLang?: string; namespace?: string }): Promise<void> {
    const clauses: string[] = [];
    const params: string[] = [];
    let i = 1;
    if (filter.namespace !== undefined) { clauses.push(`namespace=$${i++}`); params.push(NS(filter.namespace)); }
    if (filter.sourceLang) { clauses.push(`source_lang=$${i++}`); params.push(filter.sourceLang); }
    if (filter.targetLang) { clauses.push(`target_lang=$${i++}`); params.push(filter.targetLang); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    await this.opts.pool.query(`DELETE FROM tm ${where}`, params);
  }
}

function rowToEntry(row: any): TMEntry {
  return {
    sourceText: row.source_text,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    translatedText: row.translated_text,
    sourceHash: row.source_hash,
    namespace: row.namespace === "__global__" ? undefined : row.namespace,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/memory/postgres.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/memory/postgres.ts packages/core/src/memory/postgres.test.ts pnpm-lock.yaml
git commit -m "feat(core): Postgres+pgvector translation memory adapter"
```

---

## Milestone 7: Orchestrator (the agentic refine loop)

### Task 24: Prompt builders + reviewer schema

**Files:**
- Create: `packages/core/src/orchestrator/prompts.ts`
- Create: `packages/core/src/orchestrator/reviewer.ts`
- Test: `packages/core/src/orchestrator/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildTranslatorPrompt } from "./prompts.js";
import { ReviewSchema } from "./reviewer.js";
import type { AssembledGroup } from "../gates/types.js";

const group: AssembledGroup = {
  groupKey: "hero", targetLang: "ja", sourceLang: "en",
  glossary: [{ source: "Acme" }, { source: "Sign in", target: "ログイン", lang: "ja" }],
  context: "A landing page",
  segments: [{ id: "title", text: "Welcome to Acme", metadata: { role: "title" } }],
};

describe("buildTranslatorPrompt", () => {
  it("includes target language, segments, glossary, and context", () => {
    const p = buildTranslatorPrompt(group, {});
    expect(p).toContain("ja");
    expect(p).toContain("Welcome to Acme");
    expect(p).toContain("Acme");
    expect(p).toContain("ログイン");
    expect(p).toContain("A landing page");
    expect(p).toContain("title"); // segment id present so model keys output correctly
  });
  it("includes prior critique on revision", () => {
    const p = buildTranslatorPrompt(group, { critique: "too literal", gateViolations: ["missing placeholder"] });
    expect(p).toContain("too literal");
    expect(p).toContain("missing placeholder");
  });
  it("includes fuzzy TM suggestions when provided", () => {
    const p = buildTranslatorPrompt(group, { suggestions: { title: "Acme へようこそ" } });
    expect(p).toContain("Acme へようこそ");
  });
});

describe("ReviewSchema", () => {
  it("validates a reviewer verdict", () => {
    const r = ReviewSchema.safeParse({ passed: true, confidence: { title: 0.9 }, critique: "" });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/orchestrator/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `reviewer.ts`**

```typescript
import { z } from "zod";

export const ReviewSchema = z
  .object({
    passed: z.boolean(),
    confidence: z.record(z.string(), z.number().min(0).max(1)),
    critique: z.string(),
  })
  .strict();

export type Review = z.infer<typeof ReviewSchema>;

export const TranslationDraftSchema = z
  .object({ translations: z.record(z.string(), z.string()) })
  .strict();
export type TranslationDraft = z.infer<typeof TranslationDraftSchema>;
```

- [ ] **Step 4: Write `prompts.ts`**

```typescript
import type { AssembledGroup } from "../gates/types.js";

export interface TranslatorPromptExtras {
  critique?: string;
  gateViolations?: string[];
  suggestions?: Record<string, string>; // fuzzy TM hints, segmentId -> suggestion
}

export function buildTranslatorPrompt(group: AssembledGroup, extras: TranslatorPromptExtras): string {
  const lines: string[] = [];
  lines.push(`Translate the following segments from ${group.sourceLang} to ${group.targetLang}.`);
  lines.push(`Return JSON: {"translations": { "<segmentId>": "<translation>", ... }} for EVERY segment id.`);
  if (group.context) lines.push(`\nBackground context (do not translate this, use it for understanding):\n${group.context}`);
  if (group.glossary.length) {
    lines.push(`\nGlossary rules:`);
    for (const g of group.glossary) {
      lines.push(g.target ? `- Always translate "${g.source}" as "${g.target}".` : `- Keep "${g.source}" verbatim (do not translate).`);
    }
  }
  lines.push(`\nSegments:`);
  for (const s of group.segments) {
    const role = s.metadata?.role ? ` (role: ${s.metadata.role})` : "";
    const notes = s.metadata?.notes ? ` [note: ${s.metadata.notes}]` : "";
    lines.push(`- id="${s.id}"${role}${notes}: ${s.text}`);
  }
  if (extras.suggestions && Object.keys(extras.suggestions).length) {
    lines.push(`\nPrior translations to consider (may be reused or adapted):`);
    for (const [id, sug] of Object.entries(extras.suggestions)) lines.push(`- id="${id}": ${sug}`);
  }
  if (extras.gateViolations?.length) {
    lines.push(`\nFix these mechanical problems in your previous attempt:`);
    for (const v of extras.gateViolations) lines.push(`- ${v}`);
  }
  if (extras.critique) lines.push(`\nReviewer critique to address:\n${extras.critique}`);
  return lines.join("\n");
}

export function buildReviewerPrompt(group: AssembledGroup, draft: Record<string, string>): string {
  const lines: string[] = [];
  lines.push(`You are a professional ${group.sourceLang}->${group.targetLang} translation reviewer.`);
  lines.push(`Judge the translations for accuracy, fluency, terminology, and tone, considering all segments together.`);
  lines.push(`Return JSON: {"passed": bool, "confidence": {"<id>": 0..1}, "critique": "actionable notes (empty if passed)"}.`);
  if (group.context) lines.push(`\nContext:\n${group.context}`);
  lines.push(`\nSource & translation pairs:`);
  for (const s of group.segments) {
    lines.push(`- id="${s.id}": SOURCE: ${s.text}  | TARGET: ${draft[s.id] ?? "(missing)"}`);
  }
  return lines.join("\n");
}

export function buildBackTranslationPrompt(group: AssembledGroup, draft: Record<string, string>): string {
  const lines: string[] = [];
  lines.push(`Translate the following from ${group.targetLang} back to ${group.sourceLang}.`);
  lines.push(`Return JSON: {"translations": {"<id>": "<back-translation>"}}.`);
  for (const s of group.segments) lines.push(`- id="${s.id}": ${draft[s.id] ?? ""}`);
  return lines.join("\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/orchestrator/prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/orchestrator/prompts.ts packages/core/src/orchestrator/reviewer.ts packages/core/src/orchestrator/prompts.test.ts
git commit -m "feat(core): orchestrator prompts + reviewer schema"
```

### Task 25: The group refine loop

**Files:**
- Create: `packages/core/src/orchestrator/group-loop.ts`
- Test: `packages/core/src/orchestrator/group-loop.test.ts`

This is the core agentic loop for one (group × language). It uses the MockProvider to drive deterministic scenarios.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runGroupLoop } from "./group-loop.js";
import { MockProvider } from "../providers/mock.js";
import { SqliteTranslationMemory } from "../memory/sqlite.js";
import { CostTracker } from "../cost/budget.js";
import { resolveConfig } from "../schemas/index.js";
import type { AssembledGroup } from "../gates/types.js";

function group(text = "Hello world friend"): AssembledGroup {
  return { groupKey: "g", sourceLang: "en", targetLang: "ja", glossary: [], segments: [{ id: "s1", text }] };
}

const cfg = resolveConfig({
  models: {
    translator: { provider: "mock", model: "m" },
    reviewer: { provider: "mock", model: "m" },
  },
});

describe("runGroupLoop", () => {
  it("accepts when gates pass and reviewer passes on first draft", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { s1: "こんにちは世界の友よ" } }],
      reviewer: [{ passed: true, confidence: { s1: 0.95 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r = await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    expect(r.results[0]!.status).toBe("translated");
    expect(r.results[0]!.translatedText).toBe("こんにちは世界の友よ");
    expect(r.iterations).toBe(1);
  });

  it("revises when reviewer fails, then accepts", async () => {
    const provider = new MockProvider({
      translator: [
        { translations: { s1: "悪い訳" } },
        { translations: { s1: "良い訳です" } },
      ],
      reviewer: [
        { passed: false, confidence: { s1: 0.4 }, critique: "too literal" },
        { passed: true, confidence: { s1: 0.9 }, critique: "" },
      ],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r = await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    expect(r.iterations).toBe(2);
    expect(r.results[0]!.translatedText).toBe("良い訳です");
  });

  it("returns exact TM match without any LLM call", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hello world friend", sourceLang: "en", targetLang: "ja", translatedText: "再利用訳", sourceHash: "h" });
    const provider = new MockProvider({}); // no scripted responses → would throw if called
    const r = await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    expect(r.results[0]!.status).toBe("reused");
    expect(r.results[0]!.translatedText).toBe("再利用訳");
    expect(provider.calls).toHaveLength(0);
  });

  it("stops at maxIterations with best-so-far when reviewer never passes", async () => {
    const provider = new MockProvider({
      translator: [
        { translations: { s1: "v1" } }, { translations: { s1: "v2" } }, { translations: { s1: "v3" } },
      ],
      reviewer: [
        { passed: false, confidence: { s1: 0.5 }, critique: "x" },
        { passed: false, confidence: { s1: 0.5 }, critique: "x" },
        { passed: false, confidence: { s1: 0.5 }, critique: "x" },
      ],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r = await runGroupLoop(group(), { provider, tm, config: resolveConfig({ ...cfg, maxIterations: 3 }), cost: new CostTracker() });
    expect(r.iterations).toBe(3);
    expect(r.stopReason).toBe("max-iterations");
    expect(r.results[0]!.translatedText).toBe("v3");
  });

  it("commits accepted translations to TM", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { s1: "確定訳" } }],
      reviewer: [{ passed: true, confidence: { s1: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    await runGroupLoop(group(), { provider, tm, config: cfg, cost: new CostTracker() });
    const stored = await tm.lookupExact("Hello world friend", "en", "ja");
    expect(stored?.translatedText).toBe("確定訳");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/orchestrator/group-loop.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { LLMProvider } from "../providers/types.js";
import type { TranslationMemory } from "../memory/types.js";
import type { TranslationConfig, SegmentResult } from "../schemas/index.js";
import type { AssembledGroup } from "../gates/types.js";
import { CostTracker } from "../cost/budget.js";
import { runGates } from "../gates/index.js";
import { sourceHash } from "../util/hash.js";
import { TranslationDraftSchema, ReviewSchema } from "./reviewer.js";
import { buildTranslatorPrompt, buildReviewerPrompt } from "./prompts.js";
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
  const trace = new GroupTrace(group.groupKey, group.targetLang);
  const ns = config.tm.namespace;

  // 1. TM LOOKUP
  const reused = new Map<string, { text: string; score: number }>();
  const suggestions: Record<string, string> = {};
  const toTranslate = [...group.segments];

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

  const needLLM = toTranslate.filter((s) => !reused.has(s.id));

  // All exact hits → done.
  if (needLLM.length === 0) {
    trace.finish("accepted");
    return finalize(group, reused, {}, {}, 1, "accepted", trace, "reused-only");
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
    });
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
        prompt: buildReviewerPrompt(llmGroup, draft), schema: ReviewSchema,
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

  // 6. (Back-translation is added in Task 26; loop above is complete for v1 acceptance.)

  // 7. COMMIT accepted translations to TM
  if (config.tm.enabled && (stopReason === "accepted")) {
    for (const seg of needLLM) {
      const text = draft[seg.id];
      if (text !== undefined) {
        await tm.upsert({ sourceText: seg.text, sourceLang: group.sourceLang, targetLang: group.targetLang, translatedText: text, sourceHash: sourceHash(seg.text), namespace: ns });
      }
    }
  }

  return finalize(group, reused, draft, confidence, iteration, stopReason, trace, "translated");
}

function finalize(
  group: AssembledGroup,
  reused: Map<string, { text: string; score: number }>,
  draft: Record<string, string>,
  confidence: Record<string, number>,
  iterations: number,
  stopReason: StopReason,
  trace: GroupTrace,
  defaultStatus: "translated" | "reused-only"
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
      warnings: stopReason !== "accepted" ? [`stopped: ${stopReason}`] : undefined,
    };
  });
  return { results, iterations, stopReason, trace: trace.toJSON() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/orchestrator/group-loop.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrator/group-loop.ts packages/core/src/orchestrator/group-loop.test.ts
git commit -m "feat(core): agentic group refine loop (draft/gates/review/revise/TM)"
```

### Task 26: Optional back-translation stage

**Files:**
- Modify: `packages/core/src/orchestrator/group-loop.ts`
- Create: `packages/core/src/orchestrator/back-translation.ts`
- Test: `packages/core/src/orchestrator/back-translation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { semanticDrift } from "./back-translation.js";

describe("semanticDrift", () => {
  it("is near 0 for identical back-translation", () => {
    expect(semanticDrift("Hello world", "Hello world")).toBeLessThan(0.05);
  });
  it("is high for unrelated back-translation", () => {
    expect(semanticDrift("Hello world", "Goodbye moon forever")).toBeGreaterThan(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/orchestrator/back-translation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `back-translation.ts`**

```typescript
import { trigramSimilarity } from "../memory/fuzzy.js";

/** Lexical drift proxy (0 = identical, 1 = completely different).
 *  For v1 we use trigram similarity; semantic embeddings can replace this later. */
export function semanticDrift(source: string, backTranslated: string): number {
  return 1 - trigramSimilarity(source, backTranslated);
}
```

- [ ] **Step 4: Wire back-translation into `group-loop.ts`**

Add import near the other orchestrator imports:
```typescript
import { buildBackTranslationPrompt } from "./prompts.js";
import { semanticDrift } from "./back-translation.js";
```

Replace the `// 6. (Back-translation ...)` comment block with:
```typescript
  // 6. OPTIONAL BACK-TRANSLATION (config-gated)
  if (config.backTranslation.enabled && stopReason === "accepted" && config.models.backTranslator) {
    const btRes = await provider.complete({
      role: "backTranslator", system: "You are a back-translation checker.",
      prompt: buildBackTranslationPrompt(llmGroup, draft),
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
      const prompt = buildTranslatorPrompt(llmGroup, { critique, suggestions });
      const revRes = await provider.complete({
        role: "translator", system: "You are a professional translator.",
        prompt, schema: TranslationDraftSchema,
        model: config.models.translator!.model, temperature: config.models.translator!.temperature,
      });
      cost.add(revRes.usage);
      draft = revRes.value.translations;
      stopReason = "back-translation-ok";
      trace.iteration({ draft: { ...draft }, gateViolations: [], reviewerPassed: true, cost: cost.total });
    } else {
      stopReason = "back-translation-ok";
    }
    trace.finish(stopReason);
  }
```

- [ ] **Step 5: Add a back-translation integration test to `group-loop.test.ts`**

```typescript
  it("runs back-translation and revises on high drift", async () => {
    const provider = new MockProvider({
      translator: [
        { translations: { s1: "初稿" } },
        { translations: { s1: "改訂稿" } }, // revision after drift
      ],
      reviewer: [{ passed: true, confidence: { s1: 0.9 }, critique: "" }],
      backTranslator: [{ translations: { s1: "totally unrelated text here" } }],
    });
    const { SqliteTranslationMemory } = await import("../memory/sqlite.js");
    const { CostTracker } = await import("../cost/budget.js");
    const { resolveConfig } = await import("../schemas/index.js");
    const tm = new SqliteTranslationMemory(":memory:");
    const cfg2 = resolveConfig({
      models: {
        translator: { provider: "mock", model: "m" },
        reviewer: { provider: "mock", model: "m" },
        backTranslator: { provider: "mock", model: "m" },
      },
      backTranslation: { enabled: true, driftThreshold: 0.2 },
    });
    const g: any = { groupKey: "g", sourceLang: "en", targetLang: "ja", glossary: [], segments: [{ id: "s1", text: "Hello world friend" }] };
    const r = await runGroupLoop(g, { provider, tm, config: cfg2, cost: new CostTracker() });
    expect(r.stopReason).toBe("back-translation-ok");
    expect(r.results[0]!.translatedText).toBe("改訂稿");
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/orchestrator/back-translation.test.ts packages/core/src/orchestrator/group-loop.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/orchestrator/back-translation.ts packages/core/src/orchestrator/group-loop.ts packages/core/src/orchestrator/back-translation.test.ts packages/core/src/orchestrator/group-loop.test.ts
git commit -m "feat(core): optional back-translation verification stage"
```

### Task 27: Top-level translate() — fan out languages & groups

**Files:**
- Create: `packages/core/src/orchestrator/translate.ts`
- Test: `packages/core/src/orchestrator/translate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { translate } from "./translate.js";
import { MockProvider } from "../providers/mock.js";
import { SqliteTranslationMemory } from "../memory/sqlite.js";
import type { TranslationRequest } from "../schemas/index.js";

const req: TranslationRequest = {
  sourceLang: "en",
  targetLangs: ["ja", "ko"],
  document: { id: "doc1", segments: [{ id: "title", text: "Welcome aboard now" }] },
  config: {
    tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 },
    models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
  } as any,
};

describe("translate", () => {
  it("returns one LanguageResult per target language, each with every id", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { title: "ようこそ" } }, { translations: { title: "환영합니다" } }],
      reviewer: [{ passed: true, confidence: { title: 0.9 }, critique: "" }, { passed: true, confidence: { title: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const res = await translate(req, { provider, tm });
    expect(res.results.map((r) => r.targetLang).sort()).toEqual(["ja", "ko"]);
    for (const lr of res.results) {
      expect(lr.segments.map((s) => s.id)).toEqual(["title"]);
    }
    expect(res.status).toBe("ok");
  });

  it("returns verbatim skipped for doNotTranslate segments", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { body: "本文" } }],
      reviewer: [{ passed: true, confidence: { body: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r2: TranslationRequest = {
      sourceLang: "en", targetLangs: ["ja"],
      document: { segments: [
        { id: "brand", text: "Acme", metadata: { doNotTranslate: true } },
        { id: "body", text: "Hello there now", metadata: { group: "g" } },
      ] },
      config: req.config,
    };
    const res = await translate(r2, { provider, tm });
    const brand = res.results[0]!.segments.find((s) => s.id === "brand")!;
    expect(brand.status).toBe("skipped");
    expect(brand.translatedText).toBe("Acme");
  });

  it("marks document partial when a segment fails", async () => {
    const provider = new MockProvider({
      translator: [{ translations: {} }], // produces no translation for the segment
      reviewer: [{ passed: false, confidence: {}, critique: "x" }, { passed: false, confidence: {}, critique: "x" }, { passed: false, confidence: {}, critique: "x" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const r3: TranslationRequest = {
      sourceLang: "en", targetLangs: ["ja"],
      document: { segments: [{ id: "x", text: "Hello there now" }] },
      config: { ...req.config, maxIterations: 1 } as any,
    };
    const res = await translate(r3, { provider, tm });
    expect(res.status).toBe("partial");
    expect(res.results[0]!.segments[0]!.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/orchestrator/translate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
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

    // Run groups with bounded parallelism.
    const tasks: Array<() => Promise<void>> = [];
    for (const g of groups) {
      // Split do-not-translate segments out — returned verbatim.
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
          const r = await runGroupLoop(assembled, { provider, tm, config, cost });
          segResults.push(...r.results);
          iterationsTotal += r.iterations;
          if (config.trace !== "none") documentTraces.push(r.trace);
        } catch (err) {
          for (const s of translatable) {
            segResults.push({ id: s.id, translatedText: "", status: "failed", sourceHash: sourceHash(s.text), error: String(err) });
          }
        }
      });
    }

    await runBounded(tasks, config.concurrency);

    // Preserve original input order.
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
    (response as any).trace = { documentId: req.document.id, groups: documentTraces };
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
  const failed = segs.filter((s) => s.status === "failed").length;
  if (failed === 0) return "ok";
  if (failed === segs.length) return "failed";
  return "partial";
}

function worstStatus(statuses: Array<"ok" | "partial" | "failed">): "ok" | "partial" | "failed" {
  if (statuses.includes("failed") && statuses.every((s) => s === "failed")) return "failed";
  if (statuses.includes("partial") || statuses.includes("failed")) return "partial";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/orchestrator/translate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrator/translate.ts packages/core/src/orchestrator/translate.test.ts
git commit -m "feat(core): top-level translate() with multi-language fan-out + bounded parallelism"
```

---

## Milestone 8: Core Public API

### Task 28: Provider & TM factories + core index

**Files:**
- Create: `packages/core/src/providers/factory.ts`
- Create: `packages/core/src/memory/factory.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createProvider, createTranslationMemory, translate } from "./index.js";

describe("core public API", () => {
  it("exports translate", () => {
    expect(typeof translate).toBe("function");
  });
  it("createProvider builds an openai provider", () => {
    const p = createProvider({ provider: "openai", apiKey: "test" });
    expect(p.name).toBe("openai");
  });
  it("createTranslationMemory builds a sqlite memory", () => {
    const m = createTranslationMemory({ backend: "sqlite", path: ":memory:" });
    expect(m).toBeDefined();
  });
  it("createTranslationMemory throws on unknown backend", () => {
    // @ts-expect-error invalid backend
    expect(() => createTranslationMemory({ backend: "nope" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `providers/factory.ts`**

```typescript
import type { LLMProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
}

export function createProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "openai":
      return new OpenAIProvider({ apiKey: cfg.apiKey });
    default:
      throw new Error(`unknown provider: ${cfg.provider}`);
  }
}
```

- [ ] **Step 4: Write `memory/factory.ts`**

```typescript
import type { TranslationMemory } from "./types.js";
import { SqliteTranslationMemory } from "./sqlite.js";
import { PostgresTranslationMemory } from "./postgres.js";
import type { Pool } from "pg";
import type { EmbeddingProvider } from "../providers/types.js";

export type MemoryConfig =
  | { backend: "sqlite"; path?: string }
  | { backend: "postgres"; pool: Pool; embeddingProvider?: EmbeddingProvider | null; embeddingModel?: string };

export function createTranslationMemory(cfg: MemoryConfig): TranslationMemory {
  switch (cfg.backend) {
    case "sqlite":
      return new SqliteTranslationMemory(cfg.path ?? ":memory:");
    case "postgres":
      return new PostgresTranslationMemory({ pool: cfg.pool, embeddingProvider: cfg.embeddingProvider ?? null, embeddingModel: cfg.embeddingModel });
    default:
      throw new Error(`unknown memory backend: ${(cfg as { backend: string }).backend}`);
  }
}
```

- [ ] **Step 5: Write `index.ts`**

```typescript
export const VERSION = "0.1.0";

// Schemas & types (the I/O contract)
export * from "./schemas/index.js";

// Engine
export { translate } from "./orchestrator/translate.js";
export type { TranslateDeps } from "./orchestrator/translate.js";

// Providers
export type { LLMProvider, EmbeddingProvider, TokenUsage } from "./providers/types.js";
export { MockProvider } from "./providers/mock.js";
export { OpenAIProvider } from "./providers/openai.js";
export { createProvider } from "./providers/factory.js";
export type { ProviderConfig } from "./providers/factory.js";

// Translation memory
export type { TranslationMemory, TMEntry, TMMatch } from "./memory/types.js";
export { SqliteTranslationMemory } from "./memory/sqlite.js";
export { PostgresTranslationMemory } from "./memory/postgres.js";
export { createTranslationMemory } from "./memory/factory.js";
export type { MemoryConfig } from "./memory/factory.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full core typecheck + tests + build**

Run: `pnpm --filter @yaku/core typecheck && pnpm vitest run packages/core && pnpm --filter @yaku/core build`
Expected: all pass; `packages/core/dist/` produced.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/providers/factory.ts packages/core/src/memory/factory.ts packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "feat(core): provider/TM factories + public API surface"
```

### Task 29: Batch runner (multiple documents)

**Files:**
- Create: `packages/core/src/batch/runner.ts`
- Modify: `packages/core/src/index.ts` (export `translateBatch`)
- Test: `packages/core/src/batch/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { translateBatch } from "./runner.js";
import { MockProvider } from "../providers/mock.js";
import { SqliteTranslationMemory } from "../memory/sqlite.js";
import type { TranslationRequest } from "../schemas/index.js";

function makeReq(id: string, text: string): TranslationRequest {
  return {
    sourceLang: "en", targetLangs: ["ja"],
    document: { id, segments: [{ id: "t", text }] },
    config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } } as any,
  };
}

describe("translateBatch", () => {
  it("translates multiple documents and isolates failures", async () => {
    // doc A succeeds; doc B has no scripted responses → fails but doesn't kill the batch.
    const provider = new MockProvider({
      translator: [{ translations: { t: "やあ" } }],
      reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const results = await translateBatch([makeReq("A", "Hello there now"), makeReq("B", "Another line here")], { provider, tm }, 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe("ok");
    expect(results[1]!.status).toBe("partial"); // B failed gracefully
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/batch/runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `runner.ts`**

```typescript
import type { TranslationRequest, TranslationResponse } from "../schemas/index.js";
import { translate, type TranslateDeps } from "../orchestrator/translate.js";

/** Translate multiple documents with bounded parallelism; per-document isolation. */
export async function translateBatch(
  requests: TranslationRequest[],
  deps: TranslateDeps,
  concurrency = 4
): Promise<TranslationResponse[]> {
  const results: TranslationResponse[] = new Array(requests.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, requests.length) }, async () => {
    while (i < requests.length) {
      const idx = i++;
      try {
        results[idx] = await translate(requests[idx]!, deps);
      } catch (err) {
        results[idx] = {
          status: "failed",
          sourceLang: requests[idx]!.sourceLang,
          results: [],
          summary: { total: 0, translated: 0, reused: 0, unchanged: 0, failed: 0, skipped: 0, iterationsTotal: 0, cost: { inputTokens: 0, outputTokens: 0, usd: 0 } },
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Export from `index.ts`**

Add to `packages/core/src/index.ts`:
```typescript
export { translateBatch } from "./batch/runner.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/batch/runner.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/batch/runner.ts packages/core/src/index.ts packages/core/src/batch/runner.test.ts
git commit -m "feat(core): batch document runner"
```

---

## Milestone 9: CLI Surface

### Task 30: CLI package + translate command

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/translate-cmd.ts`
- Create: `packages/cli/src/index.ts`
- Test: `packages/cli/src/translate-cmd.test.ts`

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@yaku/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "yaku": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@yaku/core": "workspace:*",
    "commander": "^12.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`

- [ ] **Step 4: Write the failing test**

`translate-cmd.test.ts` tests the pure handler (no process spawning):
```typescript
import { describe, it, expect } from "vitest";
import { runTranslate } from "./translate-cmd.js";
import { MockProvider } from "@yaku/core";
import { SqliteTranslationMemory } from "@yaku/core";

describe("runTranslate", () => {
  it("reads a request object and returns a response object", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { t: "やあ" } }],
      reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const res = await runTranslate(
      { sourceLang: "en", targetLangs: ["ja"], document: { segments: [{ id: "t", text: "Hello there now" }] },
        config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } } },
      { provider, tm }
    );
    expect(res.results[0]!.segments[0]!.translatedText).toBe("やあ");
  });

  it("rejects an invalid request with a validation error", async () => {
    const provider = new MockProvider({});
    const tm = new SqliteTranslationMemory(":memory:");
    await expect(runTranslate({ sourceLang: "en", targetLangs: [], document: { segments: [] } } as any, { provider, tm })).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/translate-cmd.test.ts`
Expected: FAIL.

- [ ] **Step 6: Write `translate-cmd.ts`**

```typescript
import { translate, TranslationRequestSchema, type TranslateDeps, type TranslationResponse } from "@yaku/core";

/** Pure handler: validate request, run translate. Surface-agnostic for testing. */
export async function runTranslate(rawRequest: unknown, deps: TranslateDeps): Promise<TranslationResponse> {
  const request = TranslationRequestSchema.parse(rawRequest);
  return translate(request, deps);
}
```

- [ ] **Step 7: Write `index.ts` (commander wiring)**

```typescript
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { createProvider, createTranslationMemory, type TranslateDeps } from "@yaku/core";
import { runTranslate } from "./translate-cmd.js";

const program = new Command();
program.name("yaku").description("Agentic translation engine").version("0.1.0");

program
  .command("translate")
  .description("Translate a structured request")
  .option("--in <file>", "input request JSON file (default: stdin)")
  .option("--out <file>", "output response JSON file (default: stdout)")
  .option("--provider <name>", "LLM provider", "openai")
  .option("--tm <path>", "SQLite TM path", ":memory:")
  .option("--trace <level>", "none|summary|full")
  .action(async (opts) => {
    const raw = opts.in ? readFileSync(opts.in, "utf8") : readFileSync(0, "utf8");
    const request = JSON.parse(raw);
    if (opts.trace) request.config = { ...(request.config ?? {}), trace: opts.trace };

    const deps: TranslateDeps = {
      provider: createProvider({ provider: opts.provider }),
      tm: createTranslationMemory({ backend: "sqlite", path: opts.tm }),
    };
    const res = await runTranslate(request, deps);
    const out = JSON.stringify(res, null, 2);
    if (opts.out) writeFileSync(opts.out, out);
    else process.stdout.write(out + "\n");

    process.exit(res.status === "ok" ? 0 : res.status === "partial" ? 1 : 2);
  });

program.parseAsync(process.argv);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/translate-cmd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/cli pnpm-lock.yaml
git commit -m "feat(cli): yaku translate command + pure handler"
```

### Task 31: CLI tm subcommands

**Files:**
- Create: `packages/cli/src/tm-cmd.ts`
- Modify: `packages/cli/src/index.ts` (register tm command)
- Test: `packages/cli/src/tm-cmd.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { tmInvalidate, tmExport } from "./tm-cmd.js";
import { SqliteTranslationMemory } from "@yaku/core";

describe("tm commands", () => {
  it("invalidate removes matching entries", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    await tmInvalidate(tm, { targetLang: "ja" });
    expect(await tm.lookupExact("Hi", "en", "ja")).toBeNull();
  });
  it("export returns entries (smoke)", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    const out = await tmExport(tm);
    expect(Array.isArray(out)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/tm-cmd.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add an `export()` method to the SQLite TM (needed by tmExport)**

In `packages/core/src/memory/sqlite.ts`, add a method to the class:
```typescript
  async exportAll(): Promise<import("./types.js").TMEntry[]> {
    const rows = this.db.prepare(`SELECT * FROM tm`).all() as any[];
    return rows.map(rowToEntry);
  }
```
Re-export type is unchanged. Rebuild core: `pnpm --filter @yaku/core build`.

- [ ] **Step 4: Write `tm-cmd.ts`**

```typescript
import type { TranslationMemory, TMEntry } from "@yaku/core";

export async function tmInvalidate(
  tm: TranslationMemory,
  filter: { sourceLang?: string; targetLang?: string; namespace?: string }
): Promise<void> {
  await tm.invalidate(filter);
}

export async function tmExport(tm: TranslationMemory): Promise<TMEntry[]> {
  // exportAll exists on SqliteTranslationMemory; guard for other backends.
  const anyTm = tm as unknown as { exportAll?: () => Promise<TMEntry[]> };
  if (!anyTm.exportAll) throw new Error("export not supported for this TM backend");
  return anyTm.exportAll();
}

export async function tmImport(tm: TranslationMemory, entries: TMEntry[]): Promise<void> {
  for (const e of entries) await tm.upsert(e);
}
```

- [ ] **Step 5: Register tm command in `index.ts`**

Add before `program.parseAsync`:
```typescript
import { tmInvalidate, tmExport, tmImport } from "./tm-cmd.js";

const tmCmd = program.command("tm").description("Manage translation memory");
tmCmd
  .command("invalidate")
  .option("--tm <path>", "SQLite TM path", ":memory:")
  .option("--source <lang>")
  .option("--target <lang>")
  .option("--namespace <ns>")
  .action(async (o) => {
    const tm = createTranslationMemory({ backend: "sqlite", path: o.tm });
    await tmInvalidate(tm, { sourceLang: o.source, targetLang: o.target, namespace: o.namespace });
  });
tmCmd
  .command("export")
  .option("--tm <path>", "SQLite TM path", ":memory:")
  .action(async (o) => {
    const tm = createTranslationMemory({ backend: "sqlite", path: o.tm });
    process.stdout.write(JSON.stringify(await tmExport(tm), null, 2) + "\n");
  });
tmCmd
  .command("import")
  .requiredOption("--tm <path>", "SQLite TM path")
  .option("--in <file>", "entries JSON file (default stdin)")
  .action(async (o) => {
    const { readFileSync } = await import("node:fs");
    const raw = o.in ? readFileSync(o.in, "utf8") : readFileSync(0, "utf8");
    const tm = createTranslationMemory({ backend: "sqlite", path: o.tm });
    await tmImport(tm, JSON.parse(raw));
  });
```

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @yaku/core build && pnpm vitest run packages/cli/src/tm-cmd.test.ts && pnpm --filter @yaku/cli typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/tm-cmd.ts packages/cli/src/index.ts packages/cli/src/tm-cmd.test.ts packages/core/src/memory/sqlite.ts
git commit -m "feat(cli): tm export/import/invalidate subcommands"
```

---

## Milestone 10: API Surface

### Task 32: HTTP API (createServer)

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/routes.ts`
- Create: `packages/api/src/index.ts`
- Test: `packages/api/src/routes.test.ts`

- [ ] **Step 1: Create `packages/api/package.json`**

```json
{
  "name": "@yaku/api",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@yaku/core": "workspace:*",
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0"
  }
}
```

- [ ] **Step 2: Create `packages/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`

- [ ] **Step 4: Write the failing test (uses Hono's app.request, no real port)**

```typescript
import { describe, it, expect } from "vitest";
import { createApp } from "./routes.js";
import { MockProvider, SqliteTranslationMemory } from "@yaku/core";

function deps() {
  return {
    provider: new MockProvider({
      translator: [{ translations: { t: "やあ" } }],
      reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
    }),
    tm: new SqliteTranslationMemory(":memory:"),
  };
}

describe("api routes", () => {
  it("GET /health returns ok", async () => {
    const app = createApp(deps());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("POST /translate returns a TranslationResponse", async () => {
    const app = createApp(deps());
    const res = await app.request("/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceLang: "en", targetLangs: ["ja"],
        document: { segments: [{ id: "t", text: "Hello there now" }] },
        config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].segments[0].translatedText).toBe("やあ");
  });

  it("POST /translate returns 400 on invalid body", async () => {
    const app = createApp(deps());
    const res = await app.request("/translate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceLang: "en", targetLangs: [], document: { segments: [] } }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run packages/api/src/routes.test.ts`
Expected: FAIL.

- [ ] **Step 6: Write `routes.ts`**

```typescript
import { Hono } from "hono";
import { translate, TranslationRequestSchema, type TranslateDeps } from "@yaku/core";

export function createApp(deps: TranslateDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/translate", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = TranslationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }
    const res = await translate(parsed.data, deps);
    return c.json(res);
  });

  return app;
}
```

- [ ] **Step 7: Write `index.ts`**

```typescript
import { serve } from "@hono/node-server";
import { createApp } from "./routes.js";
import { createProvider, createTranslationMemory, type TranslateDeps } from "@yaku/core";

export { createApp } from "./routes.js";

export function createServer(deps?: Partial<TranslateDeps>) {
  const resolved: TranslateDeps = {
    provider: deps?.provider ?? createProvider({ provider: process.env.YAKU_PROVIDER ?? "openai" }),
    tm: deps?.tm ?? createTranslationMemory({ backend: "sqlite", path: process.env.YAKU_TM_PATH ?? "yaku-tm.sqlite" }),
  };
  return createApp(resolved);
}

// Run directly: node dist/index.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createServer();
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`yaku API listening on :${port}`);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run packages/api/src/routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm --filter @yaku/api typecheck`
```bash
git add packages/api pnpm-lock.yaml
git commit -m "feat(api): HTTP translate endpoint + createServer"
```

---

## Milestone 11: MCP Surface

### Task 33: MCP server with translate tool

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts`
- Test: `packages/mcp/src/tools.test.ts`

- [ ] **Step 1: Create `packages/mcp/package.json`**

```json
{
  "name": "@yaku/mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "yaku-mcp": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@yaku/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `packages/mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`

- [ ] **Step 4: Write the failing test (tests the tool handler functions directly)**

```typescript
import { describe, it, expect } from "vitest";
import { makeTranslateHandler } from "./index.js";
import { MockProvider, SqliteTranslationMemory } from "@yaku/core";

describe("mcp translate tool handler", () => {
  it("translates a request and returns content with the response JSON", async () => {
    const deps = {
      provider: new MockProvider({
        translator: [{ translations: { t: "やあ" } }],
        reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
      }),
      tm: new SqliteTranslationMemory(":memory:"),
    };
    const handler = makeTranslateHandler(deps);
    const out = await handler({
      sourceLang: "en", targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "Hello there now" }] },
      config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } },
    });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.results[0].segments[0].translatedText).toBe("やあ");
  });

  it("rejects invalid input", async () => {
    const deps = { provider: new MockProvider({}), tm: new SqliteTranslationMemory(":memory:") };
    const handler = makeTranslateHandler(deps);
    await expect(handler({ sourceLang: "en", targetLangs: [], document: { segments: [] } } as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp/src/tools.test.ts`
Expected: FAIL.

- [ ] **Step 6: Write `index.ts`**

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  translate, TranslationRequestSchema, createProvider, createTranslationMemory,
  type TranslateDeps, type TranslationRequest,
} from "@yaku/core";

export interface ToolContent {
  content: Array<{ type: "text"; text: string }>;
}

/** Pure translate handler — testable without spinning up the MCP transport. */
export function makeTranslateHandler(deps: TranslateDeps) {
  return async (raw: unknown): Promise<ToolContent> => {
    const request: TranslationRequest = TranslationRequestSchema.parse(raw);
    const res = await translate(request, deps);
    return { content: [{ type: "text", text: JSON.stringify(res) }] };
  };
}

export function createMcpServer(deps: TranslateDeps): McpServer {
  const server = new McpServer({ name: "yaku", version: "0.1.0" });
  const handler = makeTranslateHandler(deps);

  server.registerTool(
    "translate",
    {
      title: "Translate",
      description: "Agentic translation of a structured document into one or more target languages.",
      inputSchema: TranslationRequestSchema.shape,
    },
    async (args) => handler(args)
  );

  server.registerTool(
    "tm_invalidate",
    {
      title: "Invalidate translation memory",
      description: "Remove TM entries matching a filter.",
      inputSchema: {
        sourceLang: TranslationRequestSchema.shape.sourceLang.optional(),
        targetLang: TranslationRequestSchema.shape.sourceLang.optional(),
        namespace: TranslationRequestSchema.shape.sourceLang.optional(),
      },
    },
    async (args: { sourceLang?: string; targetLang?: string; namespace?: string }) => {
      await deps.tm.invalidate(args);
      return { content: [{ type: "text", text: "ok" }] };
    }
  );

  return server;
}

// Run directly over stdio.
if (import.meta.url === `file://${process.argv[1]}`) {
  const deps: TranslateDeps = {
    provider: createProvider({ provider: process.env.YAKU_PROVIDER ?? "openai" }),
    tm: createTranslationMemory({ backend: "sqlite", path: process.env.YAKU_TM_PATH ?? "yaku-tm.sqlite" }),
  };
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp/src/tools.test.ts`
Expected: PASS (2 tests).

> If the installed `@modelcontextprotocol/sdk` version exposes a different
> registration API (e.g. `server.tool(...)` vs `registerTool(...)`), adapt the
> `createMcpServer` body accordingly — the `makeTranslateHandler` function and its
> test are the stable contract and must not change.

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm --filter @yaku/mcp typecheck`
```bash
git add packages/mcp pnpm-lock.yaml
git commit -m "feat(mcp): MCP server with translate + tm_invalidate tools"
```

---

## Milestone 12: Integration & Final Verification

### Task 34: Cross-surface contract test

**Files:**
- Test: `packages/core/src/contract.test.ts`

- [ ] **Step 1: Write the test asserting invariants hold end-to-end**

```typescript
import { describe, it, expect } from "vitest";
import { translate, MockProvider, SqliteTranslationMemory, type TranslationRequest } from "./index.js";

const provider = () => new MockProvider({
  translator: [
    { translations: { title: "ようこそ", body: "本文です" } },
    { translations: { title: "환영", body: "본문입니다" } },
  ],
  reviewer: [
    { passed: true, confidence: { title: 0.9, body: 0.9 }, critique: "" },
    { passed: true, confidence: { title: 0.9, body: 0.9 }, critique: "" },
  ],
});

const req: TranslationRequest = {
  sourceLang: "en", targetLangs: ["ja", "ko"],
  document: { segments: [
    { id: "title", text: "Welcome here now", metadata: { group: "g", order: 0 } },
    { id: "body", text: "This is the body text", metadata: { group: "g", order: 1 } },
    { id: "brand", text: "Acme", metadata: { doNotTranslate: true } },
  ] },
  config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } } as any,
};

describe("end-to-end contract", () => {
  it("every input id appears exactly once per language", async () => {
    const res = await translate(req, { provider: provider(), tm: new SqliteTranslationMemory(":memory:") });
    for (const lr of res.results) {
      const ids = lr.segments.map((s) => s.id).sort();
      expect(ids).toEqual(["body", "brand", "title"]);
    }
  });
  it("do-not-translate segments are verbatim and skipped in every language", async () => {
    const res = await translate(req, { provider: provider(), tm: new SqliteTranslationMemory(":memory:") });
    for (const lr of res.results) {
      const brand = lr.segments.find((s) => s.id === "brand")!;
      expect(brand.status).toBe("skipped");
      expect(brand.translatedText).toBe("Acme");
    }
  });
  it("sourceHash is identical across languages for the same segment", async () => {
    const res = await translate(req, { provider: provider(), tm: new SqliteTranslationMemory(":memory:") });
    const ja = res.results.find((r) => r.targetLang === "ja")!.segments.find((s) => s.id === "title")!;
    const ko = res.results.find((r) => r.targetLang === "ko")!.segments.find((s) => s.id === "title")!;
    expect(ja.sourceHash).toBe(ko.sourceHash);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run packages/core/src/contract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/contract.test.ts
git commit -m "test(core): end-to-end multi-language contract invariants"
```

### Task 35: Full build, full test suite, README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: ALL tests pass across all packages.

- [ ] **Step 2: Build all packages**

Run: `pnpm build`
Expected: every package compiles; `dist/` produced for core, cli, api, mcp.

- [ ] **Step 3: Typecheck all packages**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Write `README.md`**

```markdown
# yaku

Agentic translation engine: review/refine loop, native multi-language output,
storage-agnostic structured I/O, translation memory. CLI + HTTP API + MCP.

## Packages
- `@yaku/core` — the engine (translate(), schemas, providers, TM, gates)
- `@yaku/cli`  — `yaku translate --in req.json --out res.json`
- `@yaku/api`  — `POST /translate`
- `@yaku/mcp`  — MCP server exposing the `translate` tool

## Quick start
\`\`\`bash
pnpm install && pnpm build
echo '{"sourceLang":"en","targetLangs":["ja"],"document":{"segments":[{"id":"t","text":"Hello"}]}}' \
  | OPENAI_API_KEY=sk-... node packages/cli/dist/index.js translate
\`\`\`

See `docs/superpowers/specs/2026-06-26-yaku-translation-engine-design.md` for the full design.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: project README"
```

---

## Notes for the Implementing Engineer

- **TDD throughout:** every task writes the failing test first, watches it fail, implements minimally, watches it pass, commits.
- **No real network calls in tests:** all provider interaction goes through `MockProvider`; Postgres goes through a mocked pool. A live smoke test against a real provider is intentionally out of scope for CI.
- **The I/O contract is sacred:** the Zod schemas in `@yaku/core/schemas` are the single source of truth. All three surfaces validate against them. Never let a surface diverge.
- **Stable handler functions:** `runTranslate` (CLI), `createApp` (API), `makeTranslateHandler` (MCP) are the tested seams. Transport wiring around them may be adapted to library versions, but these functions and their tests are the contract.
- **Dependency versions:** pin to the latest stable at implementation time; the versions in this plan are guidance. If an SDK's API differs (notably the MCP SDK), adapt the wiring while preserving the tested handler contract.
