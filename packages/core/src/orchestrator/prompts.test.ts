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
    expect(p).toContain("title");
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
