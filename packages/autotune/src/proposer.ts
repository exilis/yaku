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

/** True iff v is a finite integer within [lo, hi] inclusive. */
function inIntRange(v: unknown, [lo, hi]: [number, number]): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

export function validateCandidate(candidate: Candidate): ValidationResult {
  // This gate bounds the search space at the TOP level (allowed keys + numeric
  // ranges) and guards the prompt JSON contract. Deeper structural validation of
  // nested config (e.g. reviewer.enabled type, models shape) is delegated to the
  // engine's strict TranslationConfigSchema, which throws on malformed config.
  // Non-jsonFormat template fields (instruction/judgment) are intentionally
  // unguarded: they affect quality, which the judge measures, not the JSON contract.

  // 1. config keys must all be in the allow-list
  for (const key of Object.keys(candidate.config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      return { ok: false, reason: `disallowed config key: "${key}"` };
    }
  }

  // 2. numeric knob ranges (must be finite integers within bounds)
  const maxIter = candidate.config.maxIterations;
  if (maxIter !== undefined && !inIntRange(maxIter, MAX_ITERATIONS_RANGE)) {
    return { ok: false, reason: `maxIterations must be an integer in ${MAX_ITERATIONS_RANGE.join("-")}` };
  }
  const concurrency = candidate.config.concurrency;
  if (concurrency !== undefined && !inIntRange(concurrency, CONCURRENCY_RANGE)) {
    return { ok: false, reason: `concurrency must be an integer in ${CONCURRENCY_RANGE.join("-")}` };
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
      config: res.value.config ?? {},
      promptTemplates: res.value.promptTemplates,
      rationale: res.value.rationale,
    };
    const v = validateCandidate(candidate);
    if (v.ok) return candidate;
    rejection = v.reason;
  }
  return null;
}
