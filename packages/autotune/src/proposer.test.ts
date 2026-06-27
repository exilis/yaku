import { describe, it, expect } from "vitest";
import { MockProvider, DEFAULT_TEMPLATES } from "@yaku/core";
import { validateCandidate, propose, buildProposerPrompt } from "./proposer.js";

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

  it("rejects non-integer and non-finite maxIterations", () => {
    expect(validateCandidate({ config: { maxIterations: 2.5 } }).ok).toBe(false);
    expect(validateCandidate({ config: { maxIterations: Number.NaN } }).ok).toBe(false);
    expect(validateCandidate({ config: { maxIterations: Number.POSITIVE_INFINITY } }).ok).toBe(false);
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

  it("includes the rejection reason in the retry prompt", () => {
    const prompt = buildProposerPrompt(
      { config: {} },
      { quality: 90, qualityMin: 88, estUsd: 0.5, gatePassRate: 1, inputTokens: 0, outputTokens: 0, scored: 5, unscoreable: false, critiques: ["too literal on titles"] },
      "maxIterations must be an integer in 1-6"
    );
    expect(prompt).toContain("rejected");
    expect(prompt).toContain("maxIterations must be an integer in 1-6");
    expect(prompt).toContain("too literal on titles"); // critiques are surfaced too
  });
});
